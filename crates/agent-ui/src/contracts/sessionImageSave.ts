/**
 * 「保存到工作区」的跨宿主契约（共享 UI ↔ 宿主 adapter）。
 *
 * 桌面端把图复制进工作区并改写会话引用；WebUI 端没有本地工作区写入能力，
 * 声明为不支持（菜单项直接不出现）。
 */
export type SessionImageSaveResult = {
  /** 工作区相对路径（正斜杠）。 */
  path: string;
  absolutePath: string;
  displayPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
  contentHash: string;
  fileId?: string;
  /** true = 源本来就在工作区内，未发生复制。 */
  alreadyInsideWorkdir: boolean;
};

export type SaveSessionImageOutcome =
  | { status: "saved"; saved: SessionImageSaveResult; rewritten: number }
  | { status: "unsupported" }
  | { status: "no-workspace" };

/**
 * 应用级生图临时根的目录名与保留期。
 *
 * 真源在 Rust 侧（`services/image_artifacts.rs` 的 `IMAGE_ARTIFACT_DIR_NAME` /
 * `IMAGE_ARTIFACT_MAX_AGE`），这里是共享 UI 的展示镜像——UI 需要它来判断
 * "这张图会不会被清理"并给出提示（spec 决策 P=丙 / 风险 R12）。两处一致性由
 * `crates/agent-gui/test/images/image-generation.test.mjs` 的源码断言锁定。
 */
export const IMAGE_TEMP_ARTIFACT_DIR_NAME = "liveagent-images";
export const SESSION_IMAGE_TEMP_RETENTION_DAYS = 30;

/**
 * 这张图是否落在应用生图临时根下（据此提示"会被清理"）。
 *
 * 只做路径**片段**匹配：这里唯一的用途是决定要不要显示一句提示，误判的代价是
 * 多显示/少显示一行文字；换成"向宿主查询临时根"会让共享 UI 依赖桌面实现，
 * 不值得。
 */
export function looksLikeImageTempArtifact(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, "/").toLowerCase();
  return normalized.includes(`/${IMAGE_TEMP_ARTIFACT_DIR_NAME.toLowerCase()}/`);
}
