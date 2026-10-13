import type { SessionImageSaveResult } from "@liveagent/ui/contracts/sessionImageSave";
import { saveImageToWorkdir } from "./imageArtifacts";

/**
 * 「保存到工作区」的桌面实现：复制文件 → 改写会话引用。
 *
 * 为什么用模块级槽位而不是 props：动作的触发点在**共享 UI**（
 * `ToolImages.tsx` 的右键菜单，与 `ImagePreviewContextMenu` 的其它动作同列），
 * 而"改写会话引用"只有宿主知道怎么做（要运行时缓存 + 持久化）。共享 UI 通过
 * `@liveagent/adapters/sessionImageSave` 调用这里，两个宿主各自给实现
 * （WebUI 侧是不支持的 no-op）。这与 `toolApproval` / `askUserQuestion` 等
 * 模块级 store 是同一套做法。
 */

type SessionImageTransferContext = {
  conversationId: string;
  workdir: string;
};

export type SessionImageRewriteRequest = {
  /** 被转存的临时路径。 */
  oldPath: string;
  /** 转存后的结果（工作区路径与元数据）。 */
  saved: SessionImageSaveResult;
};

/** 返回实际改写的图片条目数；0 = 没找到引用（不必持久化）。 */
export type SessionImageRewriteHandler = (request: SessionImageRewriteRequest) => Promise<number>;

let transferContext: SessionImageTransferContext | null = null;
let rewriteHandler: SessionImageRewriteHandler | null = null;

export function setSessionImageTransferContext(next: SessionImageTransferContext | null) {
  transferContext = next;
}

export function setSessionImageRewriteHandler(next: SessionImageRewriteHandler | null) {
  rewriteHandler = next;
}

export function getSessionImageTransferContext(): SessionImageTransferContext | null {
  return transferContext;
}

export type SaveSessionImageOutcome =
  | { status: "saved"; saved: SessionImageSaveResult; rewritten: number }
  | { status: "unsupported" }
  | { status: "no-workspace" };

/**
 * 把会话里的一张图保存到当前会话的工作区，并把引用切到工作区路径。
 *
 * 目标工作区取**当前正在看的那个会话**（多栏时即聚焦栏）：转存是用户对着眼前
 * 那张图点的动作，用别的会话的工作区会让人莫名其妙。
 */
export async function saveSessionImageToWorkspace(
  sourcePath: string,
): Promise<SaveSessionImageOutcome> {
  const context = transferContext;
  if (!context?.workdir) return { status: "no-workspace" };

  const saved = await saveImageToWorkdir({ workdir: context.workdir, sourcePath });
  let rewritten = 0;
  if (!saved.alreadyInsideWorkdir && rewriteHandler) {
    rewritten = await rewriteHandler({ oldPath: sourcePath, saved });
  }
  return { status: "saved", saved, rewritten };
}

/** 仅测试用：清掉模块级槽位，避免用例之间互相串。 */
export function resetSessionImageTransferForTests() {
  transferContext = null;
  rewriteHandler = null;
}
