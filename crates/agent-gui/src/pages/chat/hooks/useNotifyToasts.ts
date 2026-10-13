import { type ToastTone, toast } from "@liveagent/ui/components/ui/toast-manager";
import { useLocale } from "@liveagent/ui/i18n/index";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { CompactionStatus } from "../../../lib/chat/compaction/types";
import { sendSystemNotification } from "../../../lib/system/notifications";
import {
  getPendingToolApprovalsSnapshot,
  subscribeToolApprovalsForConversation,
} from "../../../lib/tools/toolApproval";

type UseNotifyToastsParams = {
  /** 当前会话：会话完成/审批通知都按这个会话判定。 */
  conversationId: string;
  /** 本会话是否正在运行（"运行中 → 空闲"的下降沿即"会话完成"）。 */
  isRunning: boolean;
  errorMessage: string | null;
  hookWarning: string | null;
  compactionStatus: CompactionStatus;
};

/** 审批即将超时的提前提醒量：deadline 前 60s。 */
const APPROVAL_REMINDER_LEAD_MS = 60_000;
/** 提醒不得过近（deadline 已经很近时也给一点缓冲）。 */
const APPROVAL_REMINDER_MIN_DELAY_MS = 5_000;

/**
 * Bridges errorMessage / hookWarning /
 * compaction failed / degraded transitions into toast notifications,
 * and session error / session complete / tool approval transitions into
 * desktop system notifications (过滤规则见 lib/system/notifications.ts).
 */
export function useNotifyToasts(params: UseNotifyToastsParams) {
  const { conversationId, isRunning, errorMessage, hookWarning, compactionStatus } = params;
  const { t } = useLocale();
  const scope = useId();
  useEffect(() => {
    if (!errorMessage) return;
    toast.error(errorMessage, { id: `${scope}-error` });
    void sendSystemNotification({
      kind: "sessionError",
      title: t("chat.notifySessionErrorTitle"),
      body: errorMessage,
    });
  }, [errorMessage, scope, t]);

  useEffect(() => {
    if (hookWarning) toast.warning(hookWarning, { id: `${scope}-hook` });
  }, [hookWarning, scope]);

  useEffect(() => {
    if (compactionStatus.phase === "failed") {
      // 函数替换：供应商错误里的 $& / $' 不得被当成替换模式。
      const { message } = compactionStatus;
      toast.error(
        message
          ? t("chat.compactionFailed").replace("{message}", () => message)
          : t("chat.manualCompactFailed"),
        { id: `${scope}-compaction` },
      );
    } else if (compactionStatus.phase === "completed" && compactionStatus.degraded) {
      // LLM 档全部失败、由 deterministic 兜底：压缩成功但摘要有损，提醒用户留意质量。
      toast.warning(t("chat.compactionDegraded"), { id: `${scope}-compaction` });
    }
  }, [compactionStatus, scope, t]);

  // 会话完成 = "运行中 → 空闲"的下降沿；出错结束时已经发过出错通知，不再补一条完成。
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = isRunning;
    if (!wasRunning || isRunning || errorMessage) return;
    void sendSystemNotification({
      kind: "sessionComplete",
      title: t("chat.notifySessionCompleteTitle"),
      body: t("chat.notifySessionCompleteBody"),
    });
  }, [errorMessage, isRunning, t]);

  // 待审批工具：空 → 非空报一次；这批里最早的超时点前 60s 补一条提醒。
  const pendingApprovals = useSyncExternalStore(
    (listener) => subscribeToolApprovalsForConversation(conversationId, listener),
    () => getPendingToolApprovalsSnapshot(conversationId),
  );
  const previousApprovalCountRef = useRef(0);
  const approvalReminderRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const count = pendingApprovals.length;
    const previous = previousApprovalCountRef.current;
    previousApprovalCountRef.current = count;
    if (count === 0) {
      if (approvalReminderRef.current) {
        clearTimeout(approvalReminderRef.current);
        approvalReminderRef.current = null;
      }
      return;
    }
    // 同一批内不再重复报（用户逐个审批时 count 会变，但不再是"空 → 非空"）。
    if (previous > 0) return;
    void sendSystemNotification({
      kind: "permissionRequest",
      title: t("chat.notifyApprovalTitle"),
      body: t("chat.notifyApprovalBody").replace("{count}", String(count)),
    });
    const earliestDeadline = Math.min(...pendingApprovals.map((item) => item.deadlineAt));
    const delay = Math.max(
      APPROVAL_REMINDER_MIN_DELAY_MS,
      earliestDeadline - Date.now() - APPROVAL_REMINDER_LEAD_MS,
    );
    approvalReminderRef.current = setTimeout(() => {
      approvalReminderRef.current = null;
      if (getPendingToolApprovalsSnapshot(conversationId).length === 0) return;
      void sendSystemNotification({
        kind: "permissionRequest",
        title: t("chat.notifyApprovalTimeoutTitle"),
        body: t("chat.notifyApprovalTimeoutBody"),
      });
    }, delay);
  }, [conversationId, pendingApprovals, t]);
  useEffect(
    () => () => {
      if (approvalReminderRef.current) clearTimeout(approvalReminderRef.current);
    },
    [],
  );

  return { addNotify };
}

const addNotify = (type: ToastTone, message: string) =>
  toast[type](message, { id: `app-notify:${type}:${message}` });
