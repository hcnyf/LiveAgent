import {
  isSubagentProgressCard,
  type SubagentLiveRun,
  type SubagentProgressCardInput,
} from "@liveagent/ui/lib/subagents/progressGroups";
import type { RenderTimelineItem } from "../chat/conversation/conversationState";
import type { UiRound } from "../chat/messages/uiMessages";

/** 子代理 store 里一条运行态快照里我们用得到的字段（SubagentRunSummary 的结构子集）。 */
export type SubagentRunSnapshot = {
  parentToolCallId: string;
  /** 0 基，与卡片 arguments 里的 1 基 `index` 差一。 */
  agentIndex: number;
  status: string;
  startedAt: number;
  roundCount: number;
  toolCallCount: number;
};

/** 运行态快照的键：一次 `Agent` 调用 + 它 fan-out 出来的第几个子代理。 */
export function subagentRunKey(parentToolCallId: string, agentIndex: number) {
  return `${parentToolCallId.trim()}#${agentIndex}`;
}

/** 卡片 arguments 侧的同一个键（`parent_tool_call_id` + 1 基 `index`）。 */
export function subagentCardRunKey(args: Record<string, unknown> | undefined) {
  const parentToolCallId =
    typeof args?.parent_tool_call_id === "string" ? args.parent_tool_call_id.trim() : "";
  const index = typeof args?.index === "number" && Number.isFinite(args.index) ? args.index : NaN;
  if (!parentToolCallId || !Number.isFinite(index)) return undefined;
  return subagentRunKey(parentToolCallId, index - 1);
}

/** 把 store 的持久化运行态收成按键可查的快照表。 */
export function collectSubagentLiveRuns(runs: Iterable<SubagentRunSnapshot>) {
  const byKey = new Map<string, SubagentLiveRun>();
  for (const run of runs) {
    const key = subagentRunKey(run.parentToolCallId, run.agentIndex);
    byKey.set(key, {
      status: run.status,
      startedAtMs: run.startedAt,
      rounds: run.roundCount,
      toolCalls: run.toolCallCount,
    });
  }
  return byKey;
}

/** 给卡片挂上持久化运行态：终态报告还没到的那些卡片靠它拿到实时数字。 */
export function attachSubagentLiveRuns(
  cards: readonly SubagentProgressCardInput[],
  runs: ReadonlyMap<string, SubagentLiveRun>,
) {
  if (runs.size === 0) return cards;
  return cards.map((card) => {
    const key = subagentCardRunKey(card.arguments);
    const run = key ? runs.get(key) : undefined;
    return run ? { ...card, run } : card;
  });
}

/**
 * 把一轮里的子代理卡片捞出来。`runningIds` 为 null 表示这轮已经落定（历史），
 * 否则按 live round 的 runningToolCallIds 判定运行态。
 */
function collectRound(
  round: UiRound,
  runningIds: ReadonlySet<string> | null,
  out: SubagentProgressCardInput[],
) {
  for (const block of round.blocks) {
    if (block.kind !== "tool") continue;
    const { toolCall, toolResult } = block.item;
    if (!isSubagentProgressCard(toolCall)) continue;
    const id = toolCall.id?.trim();
    if (!id) continue;
    out.push({
      id,
      arguments: toolCall.arguments,
      details: toolResult?.details,
      running: runningIds ? runningIds.has(id) : false,
    });
  }
}

/** 已落定的历史：只在消息真正提交时重扫（流式期间 transcript 引用不变）。 */
export function collectPersistedSubagentCards(items: readonly RenderTimelineItem[]) {
  const out: SubagentProgressCardInput[] = [];
  for (const item of items) {
    if (item.kind !== "assistant") continue;
    for (const round of item.rounds) collectRound(round, null, out);
  }
  return out;
}

/** 正在流式的那几轮：每轮更新都重扫，但 live rounds 很小。 */
export function collectLiveSubagentCards(
  rounds: readonly UiRound[],
  runningIds: readonly (readonly string[])[],
) {
  const out: SubagentProgressCardInput[] = [];
  rounds.forEach((round, index) => {
    collectRound(round, new Set(runningIds[index] ?? []), out);
  });
  return out;
}

/**
 * 同一张卡片可能同时出现在刚落定的历史与还没清空的 live rounds 里（卡片先流式
 * 出现、随后随消息落定进历史）。live 版本带运行态，所以按 id 去重时让它覆盖历史
 * 版本；顺序仍按首次出现的次序，历史在前。
 */
export function mergeSubagentCards(
  persisted: readonly SubagentProgressCardInput[],
  live: readonly SubagentProgressCardInput[],
) {
  const byId = new Map<string, SubagentProgressCardInput>();
  const order: string[] = [];
  const push = (card: SubagentProgressCardInput) => {
    if (!byId.has(card.id)) order.push(card.id);
    byId.set(card.id, card);
  };
  for (const card of persisted) push(card);
  for (const card of live) push(card);
  return order.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}
