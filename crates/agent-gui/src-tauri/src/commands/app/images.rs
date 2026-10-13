//! 生图产物的落盘与临时根信息。
//!
//! 分工：**字节从哪来、叫什么名字、什么时候清**在
//! `services/image_artifacts.rs`（纯逻辑 + 单测）；这里只做 Tauri 边界
//! （base64 解码、serde 形状、错误转字符串），不重复实现任何规则。

use base64::Engine as _;
use serde::Serialize;
use std::time::SystemTime;

use crate::services::image_artifacts::{
    self, IMAGE_ARTIFACT_MAX_AGE, IMAGE_ARTIFACT_MAX_BYTES, ensure_images_temp_root,
    save_image_artifact,
};

#[derive(Serialize)]
pub struct ImageArtifactInfo {
    /// 应用级临时根（绝对路径）。UI 用它做"这些图会被清理"的说明与排查。
    #[serde(rename = "root")]
    pub root: String,
    #[serde(rename = "maxAgeDays")]
    pub max_age_days: u64,
    #[serde(rename = "maxBytes")]
    pub max_bytes: u64,
}

#[derive(Serialize)]
pub struct SavedImageArtifactResponse {
    pub path: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    #[serde(rename = "contentHash")]
    pub content_hash: String,
    /// true = 命中同内容的既有文件（未重复写盘）。
    pub reused: bool,
}

#[derive(Serialize)]
pub struct PruneImageArtifactsResponse {
    pub scanned: usize,
    pub removed: usize,
    pub failed: usize,
}

/// 应用级临时根的信息（不存在时也会给出应然路径，不创建目录）。
#[tauri::command]
pub fn image_artifact_info() -> ImageArtifactInfo {
    ImageArtifactInfo {
        root: image_artifacts::images_temp_root().display().to_string(),
        max_age_days: IMAGE_ARTIFACT_MAX_AGE.as_secs() / (24 * 60 * 60),
        max_bytes: IMAGE_ARTIFACT_MAX_BYTES,
    }
}

/// 把一张生图结果写进应用级临时根，返回可直接喂给 `display_image` 的路径。
///
/// 只接受 base64：上游生图接口（OpenAI 的 `b64_json`、Gemini 的 `inlineData.data`）
/// 本来就给 base64，前端无需先转成二进制数组再走 IPC。
#[tauri::command]
pub fn image_artifact_save(data_base64: String, mime_type: String) -> Result<SavedImageArtifactResponse, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|error| format!("生图结果不是合法的 base64：{error}"))?;
    let saved = save_image_artifact(&bytes, &mime_type)?;
    Ok(SavedImageArtifactResponse {
        path: saved.path.display().to_string(),
        mime_type: saved.mime_type,
        size_bytes: saved.size_bytes,
        content_hash: saved.content_hash,
        reused: saved.reused,
    })
}

/// 手动触发一次超期清理（启动时另有一次自动清理）。
#[tauri::command]
pub fn image_artifact_prune() -> Result<PruneImageArtifactsResponse, String> {
    let root = ensure_images_temp_root()?;
    let report = image_artifacts::prune_expired_artifacts(&root, SystemTime::now(), IMAGE_ARTIFACT_MAX_AGE)?;
    Ok(PruneImageArtifactsResponse {
        scanned: report.scanned,
        removed: report.removed,
        failed: report.failed,
    })
}
