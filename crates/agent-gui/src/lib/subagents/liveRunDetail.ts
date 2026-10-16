import {
  buildSubagentRunDetail,
  type SubagentRunDetail,
} from "@liveagent/ui/lib/subagents/runDetail";
import type { SubagentConversationStore } from "./store";

/**
 * 子代理「运行过程」的桌面侧取数。
 *
 * 父会话只拿到子代理的终态报告，看不到它内部走了哪些步；过程只能从子代理运行态里取。
 * 好消息是运行态已经在内存里：`SubagentConversationStore.saveRunState` 每次落盘都会把
 * 分段塞进 `hydrated` 缓存，所以 `loadRunState` 命中缓存时是同步的、不花 IPC。
 *
 * 取数时机：卡片挂载时取一次（历史卡片也能看到过程），运行中按 1s 轮询刷新（子代理每个
 * 回合边界落一次盘，所以最细也就这个粒度）。用户切会话时宿主会重新注册数据源。
 *
 * 已知边界：运行态按 `parentToolCallId + agentIndex` 定位，但 store 只保留每个 agentId
 * **最新一次**运行的摘要，所以同一个 agentId 被更早的 Agent 调用用过时，那些历史卡片取
 * 不到过程（显示为「暂无过程」）。要覆盖全部历史需要按 (parentToolCallId, agentIndex)
 * 反查 runId，留待后续。
 */

const REFRESH_INTERVAL_MS = 1_000;

type RunDetailState = {
  detail: SubagentRunDetail | undefined;
  loading: boolean;
};

const EMPTY_STATE: RunDetailState = { detail: undefined, loading: false };

let source: (() => SubagentConversationStore | null) | null = null;
const states = new Map<string, RunDetailState>();
const listeners = new Set<() => void>();
const timers = new Map<string, number>();
const inflight = new Set<string>();

function notify() {
  for (const listener of listeners) listener();
}

/** 宿主在会话切换时注册「当前会话的子代理 store」读取入口。 */
export function setSubagentRunDetailSource(next: (() => SubagentConversationStore | null) | null) {
  source = next;
  for (const key of [...timers.keys()]) stopPolling(key);
  for (const key of [...states.keys()]) states.delete(key);
  notify();
}

export function subscribeSubagentRunDetail(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSubagentRunDetailState(agentId: string): RunDetailState {
  return states.get(agentId) ?? EMPTY_STATE;
}

function runKey(parentToolCallId: string, agentIndex: number) {
  return `${parentToolCallId.trim()}#${agentIndex}`;
}

function resolveRunSummary(store: SubagentConversationStore, key: string) {
  for (const summary of store.latestRunsByAgent().values()) {
    if (runKey(summary.parentToolCallId, summary.agentIndex) === key) return summary;
  }
  return undefined;
}

async function loadDetail(agentId: string, parentToolCallId: string, agentIndex: number) {
  const store = source?.() ?? null;
  if (!store || inflight.has(agentId)) return;
  inflight.add(agentId);
  try {
    const summary = resolveRunSummary(store, runKey(parentToolCallId, agentIndex));
    if (!summary) return;
    // 空 systemPrompt/tools 只影响规范化时的兜底，不影响分段里的消息本身。
    const state = await store.loadRunState({
      runSummary: summary,
      systemPrompt: "",
      tools: [],
    });
    const messages = state?.segments.flatMap((segment) => segment.messages) ?? [];
    const detail = buildSubagentRunDetail(messages, {
      status: summary.status,
      rounds: summary.roundCount,
      toolCalls: summary.toolCallCount,
    });
    const previous = states.get(agentId);
    states.set(agentId, { detail, loading: false });
    if (previous?.detail !== detail || previous.loading) notify();
  } catch {
    // 过程只是附加信息：取不到就保持「暂无过程」，不打扰会话。
  } finally {
    inflight.delete(agentId);
  }
}

function stopPolling(agentId: string) {
  const timer = timers.get(agentId);
  if (timer === undefined) return;
  window.clearInterval(timer);
  timers.delete(agentId);
}

/**
 * 卡片挂载时调一次：立刻取一次过程，并在运行中时每秒刷新。
 * `active` 为 false（子代理已结束）时只取一次，不挂定时器。
 */
export function trackSubagentRunDetail(params: {
  agentId: string;
  parentToolCallId: string;
  agentIndex: number;
  active: boolean;
}) {
  const { agentId, parentToolCallId, agentIndex, active } = params;
  if (!agentId) return;
  if (!states.has(agentId)) {
    states.set(agentId, { detail: undefined, loading: true });
    notify();
  }
  void loadDetail(agentId, parentToolCallId, agentIndex);

  stopPolling(agentId);
  if (!active) return;
  timers.set(
    agentId,
    window.setInterval(
      () => void loadDetail(agentId, parentToolCallId, agentIndex),
      REFRESH_INTERVAL_MS,
    ),
  );
}

export function untrackSubagentRunDetail(agentId: string) {
  stopPolling(agentId);
}
