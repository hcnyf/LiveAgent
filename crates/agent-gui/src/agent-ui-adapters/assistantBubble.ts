import type { AskUserQuestionAnswer } from "@liveagent/ui/lib/chat/askUserQuestion";
import type { PlanDecisionAnswer } from "@liveagent/ui/lib/chat/planMode";
import { useCallback, useSyncExternalStore } from "react";
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
 * 运行中的 Bash 会话实时输出。命令跑着而工具还没返回时，界面本来只能显示「运行中」；
 * 桌面端能拿到会话的增量输出，就在这一小段时间里把它显示出来。
 */
export function useLiveToolOutput(toolCallId: string): string | undefined {
  const subscribe = useCallback((listener: () => void) => subscribeLiveToolOutput(listener), []);
  const getSnapshot = useCallback(() => getLiveToolOutput(toolCallId), [toolCallId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
