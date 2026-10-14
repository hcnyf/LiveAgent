import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { estimateTextTokens } from "@liveagent/ui/lib/chat/contextUsage";
import { resolveRequestMaxTokens } from "@liveagent/ui/lib/models/outputBudget";
import { estimateMessageTokens, estimateToolsTokens } from "../../chat/contextEstimate";

/**
 * 本次请求实际能给的输出上限：`min(模型声明值, 窗口 − 本次输入估算)`。
 *
 * 声明值只当**上限**用（回复不被截断），真正的约束是「输入 + max_tokens ≤ 窗口」，
 * 所以每次请求都要按当轮输入重算——输入小时能一路给到声明值，输入快满时自动缩到
 * 剩余空间。固定预留会把大声明值白白浪费掉（1M 窗口配 384k 只剩 63% 输入）。
 *
 * 输入估算走压缩账本同一套口径（`chat/contextEstimate`，它被 `tokenLedger`
 * re-export）：两边同源，才不会出现「压缩线按一套数算、夹紧按另一套数算」而把
 * 窗口算穿。这里刻意不引 `tokenLedger`——它会拖进 conversationState 并形成依赖环。
 */
export function resolveRequestMaxTokensForContext(
  model: Pick<Model<Api>, "contextWindow" | "maxTokens">,
  context: Context,
): number {
  const clamped = resolveRequestMaxTokens({
    declared: model.maxTokens,
    contextWindow: model.contextWindow,
    inputTokens: estimateContextInputTokens(context),
  });
  return clamped ?? model.maxTokens;
}

/** system + tools + 全部消息的 token 估算（与账本的 fixed + messages 同口径）。 */
function estimateContextInputTokens(context: Context): number {
  let total = estimateToolsTokens(context.tools) + estimateTextTokens(context.systemPrompt ?? "");
  for (const message of context.messages) total += estimateMessageTokens(message);
  return total;
}
