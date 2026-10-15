import type { SubagentLiveRun } from "@liveagent/ui/lib/subagents/progressGroups";
import { useEffect, useState } from "react";
import {
  collectSubagentLiveRuns,
  type SubagentRunSnapshot,
} from "../../../lib/subagents/progressCards";

const EMPTY_RUNS: ReadonlyMap<string, SubagentLiveRun> = new Map();

/**
 * 轮询当前会话的持久化子代理运行态（轮数 / 工具调用数 / 权威开始时刻）。
 *
 * 子代理每过一个回合边界就把状态落盘，但**不发事件**，父会话也没有别的通道拿到
 * 它，所以只能轮询。只在「确实有子代理在跑」时开定时器：跑完立刻停，空闲会话
 * 不会每秒唤醒一次。
 */
export function useSubagentLiveRuns(
  readRuns: (() => Iterable<SubagentRunSnapshot>) | undefined,
  active: boolean,
): ReadonlyMap<string, SubagentLiveRun> {
  const [runs, setRuns] = useState<ReadonlyMap<string, SubagentLiveRun>>(EMPTY_RUNS);

  useEffect(() => {
    if (!readRuns) {
      setRuns(EMPTY_RUNS);
      return;
    }
    const read = () => {
      try {
        setRuns(collectSubagentLiveRuns(readRuns()));
      } catch {
        // 读运行态只是锦上添花：失败就退回卡片自带的信息，不打扰会话。
        setRuns(EMPTY_RUNS);
      }
    };
    read();
    if (!active) return;
    const timer = window.setInterval(read, 1_000);
    return () => window.clearInterval(timer);
  }, [active, readRuns]);

  return runs;
}
