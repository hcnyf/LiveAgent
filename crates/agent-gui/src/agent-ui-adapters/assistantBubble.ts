import type { AskUserQuestionAnswer } from "@liveagent/ui/lib/chat/askUserQuestion";
import type { PlanDecisionAnswer } from "@liveagent/ui/lib/chat/planMode";
import type { SubagentRunDetail } from "@liveagent/ui/lib/subagents/runDetail";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getSubagentRunDetailState,
  subscribeSubagentRunDetail,
  trackSubagentRunDetail,
  untrackSubagentRunDetail,
} from "../lib/subagents/liveRunDetail";
import {
  answerAskUserQuestion,
  getAskUserQuestionDeadlineAt,
} from "../lib/tools/askUserQuestionTools";
import { getLiveToolOutput, subscribeLiveToolOutput } from "../lib/tools/liveShellOutput";
import {
  answerPlanDecision,
  getPlanDecisionVersion,
  isPlanApprovalToolCall,
  isPlanDecisionPending,
  subscribePlanDecisions,
} from "../lib/tools/planModeTools";
import {
  getPendingToolApproval,
  getToolApprovalVersion,
  subscribeToolApprovals,
} from "../lib/tools/toolApproval";

export const deferLargeToolImages = false;
export const retainRunningToolContent = true;

export function usePendingToolApproval(
  toolCallId: string,
  _toolArguments: Record<string, unknown>,
) {
  useSyncExternalStore(subscribeToolApprovals, getToolApprovalVersion, getToolApprovalVersion);
  return Boolean(getPendingToolApproval(toolCallId));
}

export function readAskUserQuestionDeadline(
  toolCallId: string,
  _toolArguments: Record<string, unknown>,
) {
  return getAskUserQuestionDeadlineAt(toolCallId) ?? undefined;
}

export function submitAskUserQuestionAnswers(toolCallId: string, answers: AskUserQuestionAnswer[]) {
  return Promise.resolve(answerAskUserQuestion(toolCallId, answers));
}

export function usePlanDecisionState(toolCallId: string, _toolArguments: Record<string, unknown>) {
  useSyncExternalStore(subscribePlanDecisions, getPlanDecisionVersion, getPlanDecisionVersion);
  return {
    pending: isPlanDecisionPending(toolCallId),
    approved: isPlanApprovalToolCall(toolCallId),
  };
}

export function submitPlanDecision(toolCallId: string, answer: PlanDecisionAnswer) {
  return Promise.resolve(answerPlanDecision(toolCallId, answer));
}

/**
 * 子代理的运行过程（它每一轮的思考 / 正文 / 工具调用）。父会话只拿到终态报告，过程要
 * 从子代理运行态里取——桌面端取得到，WebUI 没有这个数据源。
 */
export function useSubagentRunDetail(params: {
  agentId: string;
  parentToolCallId: string;
  agentIndex: number;
  active: boolean;
}): { detail: SubagentRunDetail | undefined; loading: boolean } {
  const { agentId, parentToolCallId, agentIndex, active } = params;
  useEffect(() => {
    trackSubagentRunDetail({ agentId, parentToolCallId, agentIndex, active });
    return () => untrackSubagentRunDetail(agentId);
  }, [agentId, active, agentIndex, parentToolCallId]);
  const subscribe = useCallback((listener: () => void) => subscribeSubagentRunDetail(listener), []);
  const getSnapshot = useCallback(() => getSubagentRunDetailState(agentId), [agentId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 运行中的 Bash 会话实时输出。命令跑着而工具还没返回时，界面本来只能显示「运行中」；
 * 桌面端能拿到会话的增量输出，就在这一小段时间里把它显示出来。
 */
export function useLiveToolOutput(toolCallId: string): string | undefined {
  const subscribe = useCallback((listener: () => void) => subscribeLiveToolOutput(listener), []);
  const getSnapshot = useCallback(() => getLiveToolOutput(toolCallId), [toolCallId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
