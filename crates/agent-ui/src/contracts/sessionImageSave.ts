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
