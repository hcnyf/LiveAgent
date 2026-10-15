import {
  buildSubagentProgressGroups,
  type SubagentProgressValue,
} from "@liveagent/ui/lib/subagents/progressGroups";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { RenderTimelineItem } from "../../../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import {
  attachSubagentLiveRuns,
  collectLiveSubagentCards,
  collectPersistedSubagentCards,
  mergeSubagentCards,
  type SubagentRunSnapshot,
} from "../../../lib/subagents/progressCards";
import { useSubagentLiveRuns } from "./useSubagentLiveRuns";

type UseSubagentProgressValueParams = {
  items: readonly RenderTimelineItem[];
  liveStore: LiveTranscriptStore;
  /** 面板入口不可用时（例如没有项目桶可承载 dock tab）不传，卡片就不渲染入口。 */
  onOpenSubagent?: (entryId: string) => void;
  focusedEntryId?: string;
  /**
   * 读当前会话的持久化子代理运行态（宿主注入）。有它时，运行中的子代理也能显示
   * 轮数/工具调用数/权威用时；没有就只显示「在跑」。
   */
  readLiveRuns?: () => Iterable<SubagentRunSnapshot>;
};

/**
 * 当前会话的子代理进度（浅层：状态 / 轮数 / 工具调用数 / 用时 / 终态）。
 *
 * 数据只来自父会话确实拿到的东西：历史里的子代理卡片 + 正在流式的 live rounds
 * （见 lib/subagents/progressCards），以及宿主注入的持久化运行态轮询。子代理内部
 * 逐次工具调用没有回流父会话，这里不编造；运行中的用时用 store 的权威开始时刻算，
 * 拿不到就不显示，而不是猜一个（见 v1.7.4 的思考计时回归）。
 *
 * 注意：这个 hook 会订阅 live store，所以调用它的组件（见 SubagentProgressBridge）
 * 会随流式更新重渲染；ChatPage 自己不订阅。
 */
export function useSubagentProgressValue({
  items,
  liveStore,
  onOpenSubagent,
  focusedEntryId,
  readLiveRuns,
}: UseSubagentProgressValueParams): SubagentProgressValue {
  const getLiveRounds = useCallback(() => liveStore.getSnapshot().liveRounds, [liveStore]);
  const liveRounds = useSyncExternalStore(liveStore.subscribe, getLiveRounds, getLiveRounds);

  const persistedCards = useMemo(() => collectPersistedSubagentCards(items), [items]);
  const liveRunningIds = useMemo(
    () => liveRounds.map((round) => round.runningToolCallIds),
    [liveRounds],
  );
  const liveCards = useMemo(
    () => collectLiveSubagentCards(liveRounds, liveRunningIds),
    [liveRounds, liveRunningIds],
  );
  // 只有真的有子代理在跑时才去轮询运行态，空闲会话不挂定时器。
  const liveRuns = useSubagentLiveRuns(
    readLiveRuns,
    liveCards.some((card) => card.running),
  );
  const cards = useMemo(
    () => attachSubagentLiveRuns(mergeSubagentCards(persistedCards, liveCards), liveRuns),
    [liveCards, liveRuns, persistedCards],
  );
  const groups = useMemo(() => buildSubagentProgressGroups(cards), [cards]);

  return useMemo(
    () => ({ groups, onOpenSubagent, focusedEntryId }),
    [focusedEntryId, groups, onOpenSubagent],
  );
}
