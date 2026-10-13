import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import type {
  DisplayImageItemDetails,
  DisplayImageResultDetails,
} from "@liveagent/ui/contracts/builtinTools";
import {
  type ConversationViewState,
  getActiveSegment,
  replaceActiveSegmentMessages,
} from "../chat/conversation/conversationState";

/**
 * 把会话记录里指向某张图片的引用改写为新的路径（「保存到工作区」之后用）。
 *
 * 为什么要改历史而不是只改展示：临时根里的图会在 30 天后被清理，如果会话记录
 * 仍指向临时路径，那张图迟早变成碎图（spec 风险 R12 / 验收 5）。转存的意义正是
 * "让这张图不再受临时目录清理影响"，所以引用必须一起搬。
 *
 * 两条实现约束：
 * 1. **必须产生新的 message 对象**（不能原地改 details）：共享 UI 的
 *    `displayImagePayloadCache` 是按 `ToolResultMessage` 的**对象引用**缓存的，
 *    原地 mutate 会命中旧 payload，继续渲染旧路径与旧文件名；
 * 2. 改写走 `replaceActiveSegmentMessages`——仓库里"改写 active segment 既有
 *    消息"的既有写法（见 `lib/chat/compaction/controller.ts`），它负责重建
 *    timeline 投影，避免 UI 与真相脱节。
 */

export type DisplayImagePathReplacement = {
  path: string;
  displayPath?: string;
  absolutePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  contentHash?: string;
  fileId?: string;
};

export type RewriteDisplayImagePathsResult = {
  state: ConversationViewState;
  /** 被改写的图片条目数（0 = 这条会话里没有引用该路径的图，调用方不必持久化）。 */
  rewritten: number;
};

/** 路径比较：大小写与斜杠方向都不该让同一条引用"看起来不同"。 */
function samePath(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const normalize = (value: string) => value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalize(left).toLowerCase() === normalize(right).toLowerCase();
}

function itemMatchesPath(item: DisplayImageItemDetails, targetPath: string): boolean {
  return (
    samePath(item.path, targetPath) ||
    samePath(item.absolutePath, targetPath) ||
    samePath(item.displayPath, targetPath)
  );
}

function rewriteItem(
  item: DisplayImageItemDetails,
  targetPath: string,
  replacement: DisplayImagePathReplacement,
): DisplayImageItemDetails {
  if (!itemMatchesPath(item, targetPath)) return item;
  return {
    ...item,
    path: replacement.path,
    ...(replacement.displayPath ? { displayPath: replacement.displayPath } : {}),
    ...(replacement.absolutePath ? { absolutePath: replacement.absolutePath } : {}),
    ...(replacement.mimeType ? { mimeType: replacement.mimeType } : {}),
    ...(typeof replacement.sizeBytes === "number" ? { sizeBytes: replacement.sizeBytes } : {}),
    ...(replacement.contentHash ? { contentHash: replacement.contentHash } : {}),
    ...(replacement.fileId ? { fileId: replacement.fileId } : {}),
  };
}

type DisplayImageToolResult = ToolResultMessage<DisplayImageResultDetails> & {
  details: DisplayImageResultDetails;
};

function isDisplayImageResult(message: Message): message is DisplayImageToolResult {
  const details = (message as { details?: unknown }).details;
  return (
    message.role === "toolResult" &&
    Boolean(details) &&
    typeof details === "object" &&
    (details as { kind?: unknown }).kind === "display_image" &&
    Array.isArray((details as { images?: unknown }).images)
  );
}

/** 文本块里的路径也一并替换：模型侧靠 details 重建文本，但转录里的摘要文本是落盘内容。 */
function rewriteTextBlocks(
  message: DisplayImageToolResult,
  targetPath: string,
  nextPath: string,
): DisplayImageToolResult["content"] {
  if (!Array.isArray(message.content)) return message.content;
  return message.content.map((block) =>
    block.type === "text" && block.text.includes(targetPath)
      ? { ...block, text: block.text.split(targetPath).join(nextPath) }
      : block,
  );
}

export function rewriteDisplayImagePaths(
  state: ConversationViewState,
  targetPath: string,
  replacement: DisplayImagePathReplacement,
): RewriteDisplayImagePathsResult {
  const trimmed = targetPath.trim();
  if (!trimmed) return { state, rewritten: 0 };
  const messages = getActiveSegment(state)?.messages ?? [];
  if (messages.length === 0) return { state, rewritten: 0 };

  let rewritten = 0;
  const nextMessages = messages.map((message) => {
    if (!isDisplayImageResult(message)) return message;
    const images = message.details.images;
    const matched = images.filter((item) => itemMatchesPath(item, trimmed)).length;
    if (matched === 0) return message;
    rewritten += matched;
    const nextDetails: DisplayImageResultDetails = {
      ...message.details,
      images: images.map((item) => rewriteItem(item, trimmed, replacement)),
    };
    // 顶层冗余字段（path/mimeType/sizeBytes/contentHash）与首图同步，保持契约自洽。
    const first = nextDetails.images[0];
    return {
      ...message,
      content: rewriteTextBlocks(message, trimmed, replacement.path),
      details: {
        ...nextDetails,
        ...(first ? { path: first.path, mimeType: first.mimeType } : {}),
        ...(first && typeof first.sizeBytes === "number" ? { sizeBytes: first.sizeBytes } : {}),
        ...(first?.contentHash ? { contentHash: first.contentHash } : {}),
      },
    };
  });

  if (rewritten === 0) return { state, rewritten: 0 };
  return { state: replaceActiveSegmentMessages(state, nextMessages), rewritten };
}
