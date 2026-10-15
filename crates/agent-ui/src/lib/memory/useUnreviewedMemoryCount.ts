import { useCallback, useEffect, useState } from "react";
import { memoryQuotaSummary } from "./api";

/** 轮询间隔：本地 SQLite 计数很便宜，但没必要更密。 */
const REFRESH_INTERVAL_MS = 60_000;

/**
 * 待审核记忆条数（入口角标用）。
 *
 * 数据源是既有的 `memory_quota_summary`：它按作用域返回 `unreviewedCount`，后端已经把
 * daily 排除在外（daily 不可审核），与记忆面板的 `isPendingReview` 是同一口径。只统计
 * 「全局 + 当前工作目录」两个作用域——别的项目的待审核记忆不该在这里打扰你。
 *
 * 刷新时机：挂载、窗口重新获得焦点、低频轮询。仓库里没有记忆变更的事件总线（organizer
 * 的 window 事件总线已被删除），所以提取器在回合中写入的新记忆只能靠这几条路径被发现。
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
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return count;
}
