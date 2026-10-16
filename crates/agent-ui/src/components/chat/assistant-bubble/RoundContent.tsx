import { CompactingText } from "@liveagent/ui/components/chat/AssistantStatus";
import { AssistantWorkTrace } from "@liveagent/ui/components/chat/AssistantWorkTrace";
import { HostedSearchGroupView } from "@liveagent/ui/components/chat/HostedSearchGroupView";
import { LiveSparkle } from "@liveagent/ui/components/chat/LiveSparkle";
import { StreamingSplitMarkdown } from "@liveagent/ui/components/chat/StreamingSplitMarkdown";
import { Markdown } from "@liveagent/ui/components/Markdown";
import { useLocale } from "@liveagent/ui/i18n/index";
import type { ToolTraceItem, UiRound } from "@liveagent/ui/lib/chat/assistantBubbleAdapter";
import { normalizeLiveToolStatus } from "@liveagent/ui/lib/chat/assistantStatus";
import type { ChatFileLink } from "@liveagent/ui/lib/chat/chatFileLinks";
import { cn } from "@liveagent/ui/lib/shared/utils";
import { Fragment, memo, type ReactNode, useMemo } from "react";
import { PreviewArtifactsRow } from "../PreviewArtifactsRow";
import { WorkProcessOlderEntries } from "../WorkProcessOlderEntries";
import { WorkProcessRow } from "../WorkProcessRow";
import {
  type AssistantTurnLayoutEntry,
  collectWorkPreviewItems,
  countWorkEntries,
  formatWorkCountsLabel,
  type GroupedRoundBlock,
  hasActiveUserInteraction,
  isBuiltinShareToolName,
  resolveActiveThinkingEntryKey,
  resolveActiveWorkEntry,
  resolveActiveWorkTailKeys,
  resolveAssistantTurnLayout,
  resolveCurrentWorkEntryKey,
  segmentWorkEntries,
} from "./assistantBubbleUtils";
import { CompactionSeamRow } from "./CompactionSeamRow";
import { ThinkingDisclosure } from "./ThinkingDisclosure";
import { MemoToolCallItem } from "./ToolCallItem";
import { getNativeDisplayImagePayload, NativeDisplayImageBlock } from "./ToolImages";
import { ToolTraceGroup } from "./ToolTraceGroup";

const EMPTY_RUNNING_TOOL_CALL_IDS: string[] = [];

/** 稳定空引用：让 `previewArtifacts` 的 useMemo 不会每次渲染都换新数组。 */
const EMPTY_PREVIEW_ITEMS: ToolTraceItem[] = [];

/** 稳定空引用：非活回合没有「尾巴」，不必每次渲染都建一个空 Set。 */
const EMPTY_WORK_TAIL_KEYS: ReadonlySet<string> = new Set();

export const RoundBlockContent = memo(function RoundBlockContent(props: {
  block: GroupedRoundBlock;
  isLive: boolean;
  renderMode: "streaming" | "static";
  runningToolCallIds: string[];
  thinkingOpen: boolean;
  isLatestThinking: boolean;
  /** Transcript-stable entry key; block ids alone repeat across rounds. */
  traceKey?: string;
  showTurnStatus?: boolean;
  /** 这一段之后模型还没有写出东西（活回合的尾巴）；工具批次据此默认展开。 */
  activeWorkTail?: boolean;
  /**
   * 这条 entry 是活尾巴里最新的一条，也就是「当前进行中的那一步」。工具行、搜索行、
   * 子代理卡片据此自动展开；离开这一位（模型写出下一条输出）就自动收起。
   */
  isCurrentWorkEntry?: boolean;
  readOnly?: boolean;
  redactToolContent?: boolean;
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const {
    block,
    isLive,
    renderMode,
    runningToolCallIds,
    thinkingOpen,
    isLatestThinking,
    traceKey,
    showTurnStatus = false,
    activeWorkTail = false,
    isCurrentWorkEntry = false,
    readOnly = false,
    redactToolContent = false,
    workdir,
    onOpenFileLink,
  } = props;

  let content: ReactNode;
  if (block.kind === "thinking") {
    // Shared/redacted views hide tool internals; model reasoning is at least
    // as sensitive, so it disappears entirely there instead of rendering a
    // teasing header without a body.
    content = redactToolContent ? null : (
      <ThinkingDisclosure
        text={block.text}
        trackKey={traceKey ?? block.key}
        active={Boolean(isLive && thinkingOpen && isLatestThinking)}
        renderMode={renderMode}
        readOnly={readOnly}
        workdir={workdir}
        onOpenFileLink={onOpenFileLink}
      />
    );
  } else if (block.kind === "tool") {
    const isRedactedToolContent =
      redactToolContent && isBuiltinShareToolName(block.item.toolCall.name);
    const displayImagePayload = getNativeDisplayImagePayload(block.item);
    if (!isRedactedToolContent && displayImagePayload) {
      content = <NativeDisplayImageBlock payload={displayImagePayload} readOnly={readOnly} />;
    } else if (
      !isRedactedToolContent &&
      block.item.toolCall.name === "Image" &&
      !block.item.toolResult?.isError
    ) {
      content = null;
    } else {
      const toolIsRunning = Boolean(
        isLive && block.item.toolCall.id && runningToolCallIds.includes(block.item.toolCall.id),
      );
      content = (
        <MemoToolCallItem
          item={block.item}
          isRunning={toolIsRunning}
          // 活回合里参与「当前进行中才展开、离开就收起」的自动展开/收起；历史不参与。
          liveAutoState={isLive ? toolIsRunning || isCurrentWorkEntry : undefined}
          readOnly={readOnly}
          redactToolContent={redactToolContent}
          onOpenFileLink={onOpenFileLink}
        />
      );
    }
  } else if (block.kind === "toolGroup") {
    content = (
      <ToolTraceGroup
        items={block.items}
        runningToolCallIds={isLive ? runningToolCallIds : []}
        readOnly={readOnly}
        redactToolContent={redactToolContent}
        onOpenFileLink={onOpenFileLink}
        showTurnStatus={showTurnStatus}
        active={activeWorkTail}
        isCurrentEntry={isCurrentWorkEntry}
      />
    );
  } else if (block.kind === "hostedSearch" || block.kind === "hostedSearchGroup") {
    content = (
      <HostedSearchGroupView
        items={block.kind === "hostedSearch" ? [block.item] : block.items}
        isLive={isLive}
        isCurrentEntry={isCurrentWorkEntry}
        readOnly={readOnly}
      />
    );
  } else if (block.kind === "checkpoint") {
    content = <CompactionSeamRow seam={block.seam} readOnly={readOnly} workdir={workdir} />;
  } else if (block.text.trim()) {
    // 流式模式下把已完成段落冻结为 static 实例，每帧只重解析活跃尾部；
    // 落定孪生行保持 renderMode="streaming"（零 remount 设计），此时文本静止，
    // 切分状态不再变化，成本为零。
    content =
      renderMode === "streaming" ? (
        <StreamingSplitMarkdown
          content={block.text}
          className="font-chat"
          readOnly={readOnly}
          workdir={workdir}
          onOpenFileLink={onOpenFileLink}
        />
      ) : (
        <Markdown
          content={block.text}
          className="font-chat"
          renderMode={renderMode}
          readOnly={readOnly}
          workdir={workdir}
          onOpenFileLink={onOpenFileLink}
        />
      );
  } else {
    content = null;
  }

  if (!content) return null;

  const isOperationBlock = block.kind !== "text";
  return (
    <div
      className={cn(!isLive && "w-full")}
      data-assistant-operation={isOperationBlock ? "" : undefined}
    >
      {content}
    </div>
  );
});

type AssistantTurnRound = UiRound & {
  key?: string;
  runningToolCallIds?: string[];
  thinkingOpen?: boolean;
};

function hasRunningToolCall(entries: AssistantTurnLayoutEntry[]) {
  return entries.some((entry) => {
    const runningIds = new Set(entry.runningToolCallIds);
    if (entry.block.kind === "tool") {
      return Boolean(entry.block.item.toolCall.id && runningIds.has(entry.block.item.toolCall.id));
    }
    if (entry.block.kind === "toolGroup") {
      return entry.block.items.some((item) =>
        Boolean(item.toolCall.id && runningIds.has(item.toolCall.id)),
      );
    }
    return false;
  });
}

function hasInteractionRequiringAttention(entries: AssistantTurnLayoutEntry[]) {
  return entries.some((entry) => {
    if (entry.block.kind === "tool") {
      return hasActiveUserInteraction([entry.block.item], entry.runningToolCallIds);
    }
    if (entry.block.kind === "toolGroup") {
      return hasActiveUserInteraction(entry.block.items, entry.runningToolCallIds);
    }
    return false;
  });
}

export const AssistantTurnContent = memo(function AssistantTurnContent(props: {
  rounds: AssistantTurnRound[];
  isLive?: boolean;
  isStreaming?: boolean;
  toolStatus?: string | null;
  toolStatusVariant?: "default" | "compaction";
  durationMs?: number;
  startedAtMs?: number;
  renderMode?: "streaming" | "static";
  readOnly?: boolean;
  redactToolContent?: boolean;
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const {
    rounds,
    isLive = false,
    isStreaming = isLive,
    toolStatus,
    toolStatusVariant,
    durationMs,
    startedAtMs,
    renderMode = isStreaming ? "streaming" : "static",
    readOnly = false,
    redactToolContent = false,
    workdir,
    onOpenFileLink,
  } = props;
  const layout = useMemo(
    () => resolveAssistantTurnLayout(rounds, { live: isLive }),
    [isLive, rounds],
  );
  const { locale, t } = useLocale();
  const running = Boolean(isLive && isStreaming);
  const normalizedToolStatus = running ? normalizeLiveToolStatus(toolStatus ?? null) : null;
  const isCompactionStatus = toolStatusVariant === "compaction";
  const showDetailedStatus = Boolean(
    normalizedToolStatus && isCompactionStatus && !hasRunningToolCall(layout.work),
  );
  const attentionRequired =
    running && hasInteractionRequiringAttention([...layout.work, ...layout.interaction]);
  const latestToolGroupKey = useMemo(() => {
    for (let index = layout.work.length - 1; index >= 0; index -= 1) {
      const entry = layout.work[index];
      if (entry?.block.kind === "toolGroup") return entry.key;
    }
    return null;
  }, [layout.work]);
  const activeThinkingKey = running ? resolveActiveThinkingEntryKey(layout.work) : null;
  // 工具批次和思考一样按「这段之后模型还没输出」判断是否还在进行；非活回合没有尾巴，
  // 历史记录里的批次照旧收起。
  const activeWorkTailKeys = useMemo(
    () => (running ? resolveActiveWorkTailKeys(layout.work) : EMPTY_WORK_TAIL_KEYS),
    [running, layout.work],
  );
  // 尾巴里最新的一条 = 「当前进行中的那一步」；工具行/搜索行/子代理卡片据此自动展开。
  const currentWorkEntryKey = running
    ? resolveCurrentWorkEntryKey(layout.work, activeWorkTailKeys)
    : null;
  const collapsedTailEntry = running ? resolveActiveWorkEntry(layout.work) : null;
  const showWorkTrace = running || layout.work.length > 0;
  // 回合落定后思考过程照旧收起；可预览产物改由答案下方独立一行承载（见
  // PreviewArtifactsRow）。运行中不渲染：那时 work trace 是展开的，产物就在里面。
  const settledWithAnswer = !running && layout.answer.length > 0;
  const previewArtifacts = useMemo(
    () => (settledWithAnswer ? collectWorkPreviewItems(layout.work) : EMPTY_PREVIEW_ITEMS),
    [settledWithAnswer, layout.work],
  );
  // 两次输出之间的过程收成概括条：正文（text）与压缩里程碑留在条外可见，
  // 连续的非正文 entry 归一段。只有一条 entry 的段不包条，短回合渲染不变。
  const workSegments = useMemo(
    () => segmentWorkEntries(layout.work, { activeKey: collapsedTailEntry?.key ?? null }),
    [collapsedTailEntry, layout.work],
  );

  if (!showWorkTrace && layout.interaction.length === 0 && layout.answer.length === 0) return null;

  const renderEntry = (
    entry: AssistantTurnLayoutEntry,
    insideWorkTrace: boolean,
    liveInteraction = false,
  ) => (
    <RoundBlockContent
      key={entry.key}
      block={entry.block}
      isLive={running && (insideWorkTrace || liveInteraction)}
      renderMode={renderMode}
      runningToolCallIds={entry.runningToolCallIds}
      thinkingOpen={insideWorkTrace && running ? entry.thinkingOpen : false}
      isLatestThinking={entry.key === activeThinkingKey}
      traceKey={entry.key}
      showTurnStatus={insideWorkTrace && running && entry.key === latestToolGroupKey}
      activeWorkTail={activeWorkTailKeys.has(entry.key)}
      isCurrentWorkEntry={entry.key === currentWorkEntryKey}
      readOnly={readOnly}
      redactToolContent={redactToolContent}
      workdir={workdir}
      onOpenFileLink={onOpenFileLink}
    />
  );

  return (
    <div className="space-y-2">
      {showWorkTrace ? (
        <AssistantWorkTrace
          attentionRequired={attentionRequired}
          awaitingDecision={attentionRequired}
          collapseAfterAnswer={layout.answer.length > 0}
          collapsedTail={collapsedTailEntry ? renderEntry(collapsedTailEntry, true) : null}
          durationMs={durationMs}
          hasDetails={layout.work.length > 0 || showDetailedStatus}
          running={running}
          startedAtMs={startedAtMs}
        >
          {workSegments.map((segment) =>
            segment.kind === "process" ? (
              <WorkProcessRow
                key={segment.key}
                label={formatWorkCountsLabel(countWorkEntries(segment.entries), t, locale)}
                running={segment.running}
                hasOutputAfter={segment.hasOutputAfter}
              >
                {segment.hiddenEntries.length > 0 ? (
                  <WorkProcessOlderEntries count={segment.hiddenEntries.length}>
                    {() => segment.hiddenEntries.map((entry) => renderEntry(entry, true))}
                  </WorkProcessOlderEntries>
                ) : null}
                {segment.visibleEntries.map((entry) => renderEntry(entry, true))}
              </WorkProcessRow>
            ) : (
              <Fragment key={segment.key}>{renderEntry(segment.entry, true)}</Fragment>
            ),
          )}
          {showDetailedStatus ? (
            <div className="py-1.5">
              <CompactingText progress={normalizedToolStatus} />
            </div>
          ) : null}
        </AssistantWorkTrace>
      ) : null}

      {layout.interaction.map((entry) => renderEntry(entry, false, true))}
      {layout.answer.map((entry) => renderEntry(entry, false))}
      {previewArtifacts.length > 0 && !redactToolContent ? (
        <PreviewArtifactsRow items={previewArtifacts} readOnly={readOnly} />
      ) : null}
      {running ? <LiveSparkle paused={attentionRequired} /> : null}
    </div>
  );
});

export const RoundContent = memo(function RoundContent(props: {
  round: UiRound;
  isLive?: boolean;
  isStreaming?: boolean;
  isActive?: boolean;
  toolStatus?: string | null;
  toolStatusVariant?: "default" | "compaction";
  durationMs?: number;
  runningToolCallIds?: string[];
  thinkingOpen?: boolean;
  renderMode?: "streaming" | "static";
  readOnly?: boolean;
  redactToolContent?: boolean;
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const {
    round,
    isLive,
    isStreaming = isLive,
    isActive,
    toolStatus,
    toolStatusVariant,
    durationMs,
    runningToolCallIds,
    thinkingOpen,
    renderMode,
    readOnly = false,
    redactToolContent = false,
    workdir,
    onOpenFileLink,
  } = props;
  const activeLive = Boolean(isLive && (isActive ?? true));
  const decoratedRound = useMemo<AssistantTurnRound>(
    () => ({
      ...round,
      runningToolCallIds: runningToolCallIds ?? EMPTY_RUNNING_TOOL_CALL_IDS,
      thinkingOpen: thinkingOpen ?? false,
    }),
    [round, runningToolCallIds, thinkingOpen],
  );
  const rounds = useMemo(() => [decoratedRound], [decoratedRound]);

  return (
    <AssistantTurnContent
      rounds={rounds}
      isLive={activeLive}
      isStreaming={isStreaming}
      toolStatus={toolStatus}
      toolStatusVariant={toolStatusVariant}
      durationMs={durationMs}
      renderMode={renderMode}
      readOnly={readOnly}
      redactToolContent={redactToolContent}
      workdir={workdir}
      onOpenFileLink={onOpenFileLink}
    />
  );
});
