//! 应用级生图临时根：落盘、命名与超期清理。
//!
//! 为什么需要它（spec 决策 P=丙）：仓库此前只有零散的 `std::env::temp_dir()`
//! 拼接，没有带生命周期管理的根目录，也没有清理调度。生图产物必须有一个
//! **可枚举、可清理、可识别**的家，否则临时图会永久堆积在系统临时目录里。
//!
//! 两条不变量：
//! 1. **文件名由内容决定**（`liveagent-<fnv1a64>.<ext>`）——同样的字节永远落在
//!    同一个文件上，重复生成不产生副本；这也是"转存到工作区"能按内容去重的依据。
//! 2. **清理按 mtime**，而命中既有文件时会刷新 mtime——"最近还被用到"的图不会被
//!    当成陈旧条目删掉。

use std::{
    fs,
    io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

/// 应用级临时根的目录名（位于系统临时目录之下）。
pub const IMAGE_ARTIFACT_DIR_NAME: &str = "liveagent-images";

/// 超期阈值：30 天（spec 决策，已由用户确认）。
pub const IMAGE_ARTIFACT_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// 单张图片的字节上限。生图产物通常在几 MB 内；64 MB 是防御性上限，
/// 用来挡住"上游返回了一个巨型 payload"而不是作为产品约束。
pub const IMAGE_ARTIFACT_MAX_BYTES: u64 = 64 * 1024 * 1024;

/// 应用级临时根（不保证存在，需要时用 [`ensure_images_temp_root`]）。
pub fn images_temp_root() -> PathBuf {
    std::env::temp_dir().join(IMAGE_ARTIFACT_DIR_NAME)
}

pub fn ensure_images_temp_root() -> Result<PathBuf, String> {
    let root = images_temp_root();
    fs::create_dir_all(&root)
        .map_err(|error| format!("创建生图临时目录失败（{}）：{error}", root.display()))?;
    Ok(root)
}

/// 内容哈希：FNV-1a 64 位，输出 16 位十六进制。
///
/// **必须与 `commands/workspace/fs.rs::hash_bytes` 同算法**：全仓的 `contentHash`
/// 字段都吃这一份口径，同一份字节在生图落盘与文件读取两条链路上必须得到同一个
/// 哈希，否则"按内容去重"与"按 hash 比对"会各自为政。
pub fn content_hash(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// 受支持的图片 MIME → 扩展名。未列出的类型一律拒绝：生图产物只可能是这几种，
/// 放行未知类型等于让上游替我们决定落什么文件到磁盘上。
pub fn extension_for_mime(mime_type: &str) -> Option<&'static str> {
    match mime_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/bmp" => Some("bmp"),
        "image/svg+xml" => Some("svg"),
        _ => None,
    }
}

/// 由内容哈希与扩展名构造文件名（纯函数，便于单测钉住命名契约）。
pub fn artifact_file_name(content_hash: &str, extension: &str) -> String {
    format!("liveagent-{content_hash}.{extension}")
}

pub struct SavedImageArtifact {
    pub path: PathBuf,
    pub mime_type: String,
    pub size_bytes: u64,
    pub content_hash: String,
    /// true = 命中同内容的既有文件（未重复写盘，只刷新了 mtime）。
    pub reused: bool,
}

/// 把一张图片写进应用级临时根。同内容重复调用复用同一文件。
pub fn save_image_artifact(bytes: &[u8], mime_type: &str) -> Result<SavedImageArtifact, String> {
    if bytes.is_empty() {
        return Err("生图结果为空，未写入临时目录".to_string());
    }
    if bytes.len() as u64 > IMAGE_ARTIFACT_MAX_BYTES {
        return Err(format!(
            "生图结果超过单张上限（{} 字节 > {IMAGE_ARTIFACT_MAX_BYTES} 字节）",
            bytes.len()
        ));
    }
    let extension = extension_for_mime(mime_type)
        .ok_or_else(|| format!("不支持的图片类型：{mime_type}"))?;
    let root = ensure_images_temp_root()?;
    let content_hash = content_hash(bytes);
    let path = root.join(artifact_file_name(&content_hash, extension));

    let reused = match fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() && metadata.len() == bytes.len() as u64 => {
            // 命中：只刷新 mtime（"最近还被用到"），不重复写盘。
            touch_modified(&path);
            true
        }
        _ => {
            fs::write(&path, bytes)
                .map_err(|error| format!("写入生图临时文件失败（{}）：{error}", path.display()))?;
            false
        }
    };

    Ok(SavedImageArtifact {
        path,
        mime_type: mime_type.to_string(),
        size_bytes: bytes.len() as u64,
        content_hash,
        reused,
    })
}

fn touch_modified(path: &Path) {
    if let Ok(file) = fs::File::open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

/// 纯函数：单个条目是否超期。阈值是"超过 max_age 即视为陈旧"。
pub fn is_expired(modified: SystemTime, now: SystemTime, max_age: Duration) -> bool {
    match now.duration_since(modified) {
        Ok(age) => age > max_age,
        // mtime 在未来（时钟回拨/时区事故）：不当作超期，宁可留着也不要误删。
        Err(_) => false,
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct PruneReport {
    pub scanned: usize,
    pub removed: usize,
    pub failed: usize,
}

/// 清理超期条目。只处理本目录下的**普通文件**：子目录一律跳过（本模块从不创建
/// 子目录，出现了说明是别的程序写的，不该由我们递归删）。
pub fn prune_expired_artifacts(
    root: &Path,
    now: SystemTime,
    max_age: Duration,
) -> Result<PruneReport, String> {
    let mut report = PruneReport::default();
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        // 目录不存在 = 从没生过图，不是错误。
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(report),
        Err(error) => {
            return Err(format!(
                "读取生图临时目录失败（{}）：{error}",
                root.display()
            ))
        }
    };

    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            report.failed += 1;
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        report.scanned += 1;
        let modified = metadata.modified().unwrap_or(now);
        if !is_expired(modified, now, max_age) {
            continue;
        }
        match fs::remove_file(entry.path()) {
            Ok(()) => report.removed += 1,
            Err(_) => report.failed += 1,
        }
    }

    Ok(report)
}

/// 启动时清理超期条目；失败只记录，绝不阻断启动（与上传暂存区 GC 同策略）。
pub fn prune_expired_artifacts_on_startup() {
    tauri::async_runtime::spawn_blocking(|| {
        let root = images_temp_root();
        match prune_expired_artifacts(&root, SystemTime::now(), IMAGE_ARTIFACT_MAX_AGE) {
            Ok(report) if report.removed > 0 => {
                eprintln!(
                    "pruned {} expired image artifact(s) from {}",
                    report.removed,
                    root.display()
                );
            }
            Ok(_) => {}
            Err(error) => eprintln!("failed to prune image artifacts: {error}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::UNIX_EPOCH;

    fn at(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    #[test]
    fn content_hash_matches_the_repo_fnv1a_convention() {
        // FNV-1a 64 的偏移基量与空输入结果：这一条钉住"与 fs.rs::hash_bytes 同算法"，
        // 将来有人换成 sha256 会立刻在这里失败。
        assert_eq!(content_hash(b""), "cbf29ce484222325");
        assert_eq!(content_hash(b"a"), "af63dc4c8601ec8c");
        assert_eq!(content_hash(b"abc").len(), 16);
    }

    #[test]
    fn artifact_file_name_is_pure_and_content_addressed() {
        assert_eq!(
            artifact_file_name("0123456789abcdef", "png"),
            "liveagent-0123456789abcdef.png"
        );
        // 同内容同名字（去重的根据）；不同内容不同名字。
        assert_eq!(
            artifact_file_name(&content_hash(b"x"), "webp"),
            artifact_file_name(&content_hash(b"x"), "webp")
        );
        assert_ne!(content_hash(b"x"), content_hash(b"y"));
    }

    #[test]
    fn extension_for_mime_normalizes_parameters_and_case() {
        assert_eq!(extension_for_mime("image/png"), Some("png"));
        assert_eq!(extension_for_mime("IMAGE/PNG"), Some("png"));
        assert_eq!(extension_for_mime("image/jpeg; charset=binary"), Some("jpg"));
        assert_eq!(extension_for_mime("image/svg+xml"), Some("svg"));
        // 未知/非图片类型必须拒绝，不能悄悄落一个 .bin。
        assert_eq!(extension_for_mime("application/pdf"), None);
        assert_eq!(extension_for_mime(""), None);
    }

    #[test]
    fn is_expired_only_past_the_threshold() {
        let now = at(1_000_000);
        assert!(!is_expired(now, now, IMAGE_ARTIFACT_MAX_AGE));
        assert!(!is_expired(
            now - Duration::from_secs(29 * 24 * 60 * 60),
            now,
            IMAGE_ARTIFACT_MAX_AGE
        ));
        assert!(is_expired(
            now - Duration::from_secs(31 * 24 * 60 * 60),
            now,
            IMAGE_ARTIFACT_MAX_AGE
        ));
        // mtime 在未来：不误删。
        assert!(!is_expired(
            now + Duration::from_secs(3600),
            now,
            IMAGE_ARTIFACT_MAX_AGE
        ));
    }

    #[test]
    fn save_and_prune_round_trip_in_a_temp_root() {
        // 直接用显式 root 走 prune（不碰进程级 temp_dir），避免测试互相干扰。
        let root = std::env::temp_dir().join(format!(
            "{IMAGE_ARTIFACT_DIR_NAME}-test-{}",
            content_hash(std::process::id().to_string().as_bytes())
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create test root");

        let fresh = root.join(artifact_file_name(&content_hash(b"fresh"), "png"));
        let stale = root.join(artifact_file_name(&content_hash(b"stale"), "png"));
        fs::write(&fresh, b"fresh").expect("write fresh");
        fs::write(&stale, b"stale").expect("write stale");
        // 目录不该被清理（本模块从不创建子目录）。
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("create nested dir");

        let now = SystemTime::now();
        let report = prune_expired_artifacts(&root, now, Duration::from_secs(1)).expect("prune");
        // 两个文件都是刚刚写入的，1 秒阈值下都不超期。
        assert_eq!(report.scanned, 2);
        assert_eq!(report.removed, 0);
        assert!(fresh.exists() && stale.exists());

        // 阈值归零后两个文件都超期；子目录仍在。
        let report = prune_expired_artifacts(&root, now, Duration::ZERO).expect("prune");
        assert_eq!(report.removed, 2);
        assert!(!fresh.exists() && !stale.exists());
        assert!(nested.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn prune_tolerates_a_missing_root() {
        let missing = std::env::temp_dir().join("liveagent-images-does-not-exist-xyz");
        let report =
            prune_expired_artifacts(&missing, SystemTime::now(), IMAGE_ARTIFACT_MAX_AGE).unwrap();
        assert_eq!(report, PruneReport::default());
    }
}
