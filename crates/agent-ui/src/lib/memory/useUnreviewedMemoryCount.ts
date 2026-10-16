import { useCallback, useEffect, useState } from "react";
import { memoryQuotaSummary } from "./api";
import { subscribeMemoryChanged } from "./changes";

/**
 * 兜底轮询间隔。正常情况下靠 `subscribeMemoryChanged` 立刻刷新；轮询只负责覆盖
 * 「别的进程 / CLI 改了记忆」这种本进程收不到通知的情况，所以不必太密。
 */
const REFRESH_INTERVAL_MS = 15_000;

/**
 * 待审核记忆条数（入口角标用）。
 *
 * 数据源是既有的 `memory_quota_summary`：它按作用域返回 `unreviewedCount`，后端已经把
 * daily 排除在外（daily 不可审核），与记忆面板的 `isPendingReview` 是同一口径。只统计
 * 「全局 + 当前工作目录」两个作用域——别的项目的待审核记忆不该在这里打扰你。
 *
 * 刷新时机：挂载、窗口重新获得焦点 / 重新可见、低频兜底轮询，以及**本进程内的记忆变更
 * 通知**（`lib/memory/changes`，由 `lib/memory/api.ts` 的变更类命令广播）。最后一条是
 * 关键：审核完「待审核」条目后角标必须立刻消失，不能等轮询——「已全部审核还是有提醒」
 * 就是这条路径缺失导致的（后端计数其实已经是 0，只是角标拿着旧快照）。
 *
 * 角标只是提示：读失败就保持上一次的值，绝不因为计数失败而报错或清零。
 */
export function useUnreviewedMemoryCount(workdir?: string): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const summary = await memoryQuotaSummary(workdir ? { workdir } : undefined);
      setCount(summary.scopes.reduce((total, scope) => total + (scope.unreviewedCount ?? 0), 0));
    } catch {
      // 提示性数据，静默忽略。
    }
  }, [workdir]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const unsubscribe = subscribeMemoryChanged(() => void refresh());
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    };
  }, [refresh]);

  return count;
}
