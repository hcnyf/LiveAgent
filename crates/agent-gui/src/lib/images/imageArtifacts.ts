import { invoke } from "@tauri-apps/api/core";

/**
 * 生图产物的落盘与转存（Rust 侧 `commands/app/images.rs` +
 * `commands/workspace/fs.rs::fs_save_image_to_workdir`）。
 *
 * 落盘规则（临时根、内容 hash 命名、30 天清理）全在 Rust 侧，这里只做 IPC 边界，
 * 不在前端重复实现任何一条。
 */

export type SavedImageArtifact = {
  path: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  /** true = 命中同内容的既有文件（未重复写盘）。 */
  reused: boolean;
};

export type ImageArtifactInfo = {
  root: string;
  maxAgeDays: number;
  maxBytes: number;
};

export type SaveImageToWorkdirResult = {
  path: string;
  absolutePath: string;
  displayPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
  contentHash: string;
  fileId?: string;
  alreadyInsideWorkdir: boolean;
};

export async function saveImageArtifact(input: {
  dataBase64: string;
  mimeType: string;
}): Promise<SavedImageArtifact> {
  return invoke<SavedImageArtifact>("image_artifact_save", {
    dataBase64: input.dataBase64,
    mimeType: input.mimeType,
  });
}

export async function getImageArtifactInfo(): Promise<ImageArtifactInfo> {
  return invoke<ImageArtifactInfo>("image_artifact_info");
}

export async function pruneImageArtifacts(): Promise<{
  scanned: number;
  removed: number;
  failed: number;
}> {
  return invoke("image_artifact_prune");
}

/**
 * 把一张图保存到工作区。源只允许「工作区内」或「应用生图临时根内」——白名单在
 * Rust 侧强制，前端传任意外部路径会被拒。
 */
export async function saveImageToWorkdir(input: {
  workdir: string;
  sourcePath: string;
  fileName?: string;
}): Promise<SaveImageToWorkdirResult> {
  return invoke<SaveImageToWorkdirResult>("fs_save_image_to_workdir", {
    workdir: input.workdir,
    source_path: input.sourcePath,
    file_name: input.fileName ?? null,
    checkpoint: null,
  });
}
