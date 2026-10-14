import type { Context, Message } from "@earendil-works/pi-ai";
import {
  estimateContentBlockTokenUnits,
  estimateContentTokenUnits,
  estimateJsonTokens,
  estimateTextTokenUnits,
  MESSAGE_ENVELOPE_TOKENS,
  stringifiedTokenUnits,
} from "@liveagent/ui/lib/chat/contextUsage";

// 与 tokenLedger 同源的「一次请求要发多少 token」估算。
//
// 单独成模块是为了切断依赖环：providers 侧的「按剩余窗口夹紧 max_tokens」也要用
// 同一套口径，而 `tokenLedger` 依赖 `conversation/conversationState`——直接从
// providers 引它会形成环（实测会以 TDZ 报 `Cannot access 'piAiAdapter' before
// initialization` 崩掉）。这里只依赖共享层，谁都能引。

// 消息在本代码库中是不可变值对象（状态变更只新建数组），因此估算结果可跨
// state/segment/临时 state 按对象身份缓存，热路径不再重复序列化。
const messageTokenCache = new WeakMap<object, number>();
const toolsTokenCache = new WeakMap<object, number>();

// 统一走共享层的内容块口径（文本 CJK 感知、二进制块按计价常量、小结构兜底
// 序列化）。toolResult 的 details 是 UI/记账负载，provider 转换只发送 content，
// 一律不计——shell 全量输出、文件读取元数据都挂在 details 上，计入即双算。
function estimateMessageTokenUnits(message: Message): number {
  if (message.role === "assistant") {
    let units = 0;
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "toolCall") {
        units += estimateTextTokenUnits(block.name) + stringifiedTokenUnits(block.arguments);
        continue;
      }
      // hostedSearch 块（供应商托管搜索的 UI 负载）在请求侧被 sanitizer 剥除，
      // 从不发送给模型；按序列化估算会把 queries/sources JSON 虚计进上下文。
      if ((block as { type?: string }).type === "hostedSearch") continue;
      units += estimateContentBlockTokenUnits(block);
    }
    return units;
  }

  if (message.role === "toolResult") {
    return estimateContentTokenUnits(message.content);
  }

  return estimateContentTokenUnits((message as { content?: unknown }).content);
}

export function estimateMessageTokens(message: Message): number {
  const cached = messageTokenCache.get(message);
  if (cached !== undefined) return cached;
  const tokens = Math.ceil(estimateMessageTokenUnits(message)) + MESSAGE_ENVELOPE_TOKENS;
  messageTokenCache.set(message, tokens);
  return tokens;
}

export function estimateToolsTokens(tools: Context["tools"]): number {
  if (!tools || tools.length === 0) return 0;
  const cached = toolsTokenCache.get(tools);
  if (cached !== undefined) return cached;
  // 工具定义是 JSON schema，不是散文：走 estimateJsonTokens（约 2.5 字/token），
  // 不要用 chars/4，否则 fixedTokens 会比真实首轮 prompt 少 4–8k。
  const tokens = estimateJsonTokens(JSON.stringify(tools));
  toolsTokenCache.set(tools, tokens);
  return tokens;
}
