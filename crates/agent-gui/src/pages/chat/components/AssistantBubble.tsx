import { LiveAssistantStatus } from "@liveagent/ui/components/chat/AssistantStatus";
import { AssistantWorkTrace } from "@liveagent/ui/components/chat/AssistantWorkTrace";
import type { AssistantTurnLayoutEntry } from "@liveagent/ui/components/chat/assistant-bubble/assistantBubbleUtils";
import {
  countWorkEntries,
  formatWorkCountsLabel,
  resolveActiveThinkingEntryKey,
  resolveActiveWorkEntry,
  segmentWorkEntries,
} from "@liveagent/ui/components/chat/assistant-bubble/assistantBubbleUtils";
import { RoundBlockContent } from "@liveagent/ui/components/chat/assistant-bubble/RoundContent";
import { RetryDetailsBlock } from "@liveagent/ui/components/chat/RetryDetailsBlock";
import { WorkProcessRow } from "@liveagent/ui/components/chat/WorkProcessRow";
import { useLocale } from "@liveagent/ui/i18n/index";
import type { ChatFileLink } from "@liveagent/ui/lib/chat/chatFileLinks";
import { Fragment, memo } from "react";
import type { RetryAttemptRecord } from "../../../lib/chat/conversation/liveTranscriptStore";
import type { AssistantUnitRow } from "../transcript/rowModel";

export const AssistantBubbleUnit = memo(function AssistantBubbleUnit(props: {
  row: AssistantUnitRow;
  isCompactionRunning: boolean;
  awaitingDecision?: boolean;
  toolStatus: string | null;
  retryAttempts?: RetryAttemptRecord[];
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const {
    row,
    isCompactionRunning,
    awaitingDecision = false,
    toolStatus,
    retryAttempts,
    workdir,
    onOpenFileLink,
  } = props;
  // hook 必须在下面 `footer` 的提前 return 之前调用。
  const { locale, t } = useLocale();
  const { unit } = row;
  if (unit.kind === "footer") return null;

  const workEntries = unit.kind === "work-trace" ? unit.entries : [];
  const activeThinkingKey =
    unit.kind === "work-trace" && row.live ? resolveActiveThinkingEntryKey(workEntries) : null;
  const collapsedTailEntry =
    unit.kind === "work-trace" && row.live ? resolveActiveWorkEntry(workEntries) : null;
  // 两次输出之间的过程收成概括条；正文与压缩里程碑留在条外可见。
  const workSegments = segmentWorkEntries(workEntries, {
    activeKey: collapsedTailEntry?.key ?? null,
  });

  const renderWorkEntry = (entry: AssistantTurnLayoutEntry) => (
    <RoundBlockContent
      key={entry.key}
      block={entry.block}
      isLive={row.live}
      renderMode={row.renderMode}
      runningToolCallIds={entry.runningToolCallIds}
      thinkingOpen={row.live ? entry.thinkingOpen : false}
      isLatestThinking={entry.key === activeThinkingKey}
      traceKey={entry.key}
      showTurnStatus={
        row.live && unit.kind === "work-trace" && entry.key === unit.latestToolGroupKey
      }
      workdir={workdir}
      onOpenFileLink={onOpenFileLink}
    />
  );

  return (
    <div className="w-full max-w-full">
      <div className="min-w-0 space-y-2">
        {row.mutable && retryAttempts && retryAttempts.length > 0 ? (
          <RetryDetailsBlock attempts={retryAttempts} />
        ) : null}

        {unit.kind === "block" ? (
          <RoundBlockContent
            block={unit.block}
            isLive={row.live}
            renderMode={row.renderMode}
            runningToolCallIds={unit.runningToolCallIds}
            thinkingOpen={unit.thinkingOpen}
            isLatestThinking={unit.isLatestThinking}
            traceKey={row.key}
            workdir={workdir}
            onOpenFileLink={onOpenFileLink}
          />
        ) : null}

        {unit.kind === "work-trace" ? (
          <AssistantWorkTrace
            className="mt-0"
            awaitingDecision={awaitingDecision}
            collapseAfterAnswer={unit.hasAnswer}
            collapsedTail={collapsedTailEntry ? renderWorkEntry(collapsedTailEntry) : null}
            durationMs={unit.durationMs}
            hasDetails={workEntries.length > 0 || isCompactionRunning}
            running={row.live}
            startedAtMs={unit.startedAtMs}
          >
            {workSegments.map((segment) =>
              segment.kind === "process" ? (
                <WorkProcessRow
                  key={segment.key}
                  label={formatWorkCountsLabel(countWorkEntries(segment.entries), t, locale)}
                  running={segment.running}
                >
                  {segment.entries.map((entry) => renderWorkEntry(entry))}
                </WorkProcessRow>
              ) : (
                <Fragment key={segment.key}>{renderWorkEntry(segment.entry)}</Fragment>
              ),
            )}
            {isCompactionRunning ? (
              <LiveAssistantStatus status={toolStatus} isCompaction className="w-full py-1.5" />
            ) : null}
          </AssistantWorkTrace>
        ) : null}
      </div>
    </div>
  );
});
