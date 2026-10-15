import { isCuaDriverServerId } from "@liveagent/ui/contracts/mcpServerDefaults";
import { isTaskToolName } from "@liveagent/ui/contracts/task";
import type {
  HostedSearchBlock,
  ToolResultMessage,
  ToolTraceItem,
  UiRound,
} from "@liveagent/ui/lib/chat/assistantBubbleAdapter";
import {
  isDynamicMcpToolName,
  safeStringify,
  shouldDisplayToolTraceItem,
} from "@liveagent/ui/lib/chat/assistantBubbleAdapter";
import { type ChatFileLink, parseChatFileLink } from "@liveagent/ui/lib/chat/chatFileLinks";
import { type CompactionSeam, getCompactionSeam } from "@liveagent/ui/lib/chat/replyContinuity";
import { isTaskToolBlock } from "@liveagent/ui/lib/chat/taskProgress";
import { readToolApprovalPending } from "@liveagent/ui/lib/chat/toolApprovalArgs";
import type {
  SubagentCardDetails,
  SubagentReportDetails,
} from "@liveagent/ui/lib/subagents/protocol";
import {
  Bot,
  Brain,
  CircleHelp,
  Clock3,
  Eye,
  FilePenLine,
  FileText,
  FolderTree,
  Hand,
  type IconComponent,
  ImageIcon,
  Link2,
  ListChecks,
  Plug,
  Search,
  Server,
  Terminal,
  Trash2,
  Wrench,
} from "../../IconSet";

export type ToolActivityCategory =
  | "read"
  | "search"
  | "edit"
  | "command"
  | "list"
  | "agent"
  | "other";

export function getToolActivityCategory(name: string): ToolActivityCategory {
  if (isTaskToolName(name)) return "other";
  switch (name) {
    case "Read":
    case "Image":
    case "SkillsManager":
      return "read";
    case "Glob":
    case "Grep":
    case "ToolSearch":
      return "search";
    case "Write":
    case "Edit":
    case "Delete":
      return "edit";
    case "Bash":
    case "ManagedProcess":
    case "ProcessWait":
    case "ProcessStop":
    case "SSHManager":
    case "SshManager":
      return "command";
    case "List":
      return "list";
    case "Agent":
    case "SendMessage":
      return "agent";
    default:
      return "other";
  }
}

const ATTENTION_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode"]);

export function isUserInteractionToolName(name: string) {
  return ATTENTION_TOOL_NAMES.has(name);
}

/**
 * The turn is parked on the user rather than on the model: an unanswered
 * question / plan card, or an ordinary tool held at the approval gate. The
 * gate fires *before* the call executes, so approval-pending items are not in
 * `runningToolCallIds` and are recognised by the synced argument marker.
 */
export function hasActiveUserInteraction(items: ToolTraceItem[], runningToolCallIds: string[]) {
  if (items.length === 0) return false;
  const runningIds = new Set(runningToolCallIds);
  return items.some((item) => {
    if (item.toolResult) return false;
    if (readToolApprovalPending(item.toolCall.arguments)) return true;
    return (
      isUserInteractionToolName(item.toolCall.name) &&
      Boolean(item.toolCall.id && runningIds.has(item.toolCall.id))
    );
  });
}

export function getToolMeta(name: string): {
  Icon: IconComponent;
  accent: string;
  category: string;
} {
  if (isTaskToolName(name)) {
    return { Icon: ListChecks, accent: "var(--tool-list-accent)", category: "system" };
  }
  // 动态 MCP 工具此前全落进 default 分支（扳手 / other），与内置工具混在
  // 一起看不出来源。给它们一个专属图标；cua-driver 再单独区分——它的工具
  // 是在真实点击、输入、关闭应用，值得比「又一个 MCP 工具」更醒目。
  if (isDynamicMcpToolName(name)) {
    return isCuaDriverToolName(name)
      ? { Icon: Hand, accent: "var(--tool-bash-accent)", category: "cua" }
      : { Icon: Plug, accent: "var(--tool-list-accent)", category: "mcp" };
  }
  switch (name) {
    case "Bash":
    case "ManagedProcess":
    case "ProcessWait":
    case "ProcessStop":
      return { Icon: Terminal, accent: "var(--tool-bash-accent)", category: "terminal" };
    case "Read":
      return { Icon: Eye, accent: "var(--tool-file-accent)", category: "file" };
    case "Image":
      return { Icon: ImageIcon, accent: "var(--tool-file-accent)", category: "file" };
    case "SkillsManager":
      return { Icon: Eye, accent: "var(--tool-file-accent)", category: "file" };
    case "CronTaskManager":
      return { Icon: Clock3, accent: "var(--tool-list-accent)", category: "system" };
    case "MemoryManager":
    case "ReadConversation":
      return { Icon: Brain, accent: "var(--tool-list-accent)", category: "system" };
    case "McpManager":
      return { Icon: Plug, accent: "var(--tool-list-accent)", category: "mcp" };
    case "TunnelManager":
      return { Icon: Link2, accent: "var(--tool-list-accent)", category: "system" };
    case "SSHManager":
    case "SshManager":
      return { Icon: Server, accent: "var(--tool-bash-accent)", category: "terminal" };
    case "Agent":
      return { Icon: Bot, accent: "var(--tool-list-accent)", category: "system" };
    case "SendMessage":
      return { Icon: Bot, accent: "var(--tool-list-accent)", category: "system" };
    case "Write":
      return { Icon: FileText, accent: "var(--tool-file-accent)", category: "file" };
    case "Edit":
      return { Icon: FilePenLine, accent: "var(--tool-file-accent)", category: "file" };
    case "Delete":
      return { Icon: Trash2, accent: "var(--tool-file-accent)", category: "file" };
    case "Glob":
      return { Icon: Search, accent: "var(--tool-search-accent)", category: "search" };
    case "Grep":
      return { Icon: Search, accent: "var(--tool-search-accent)", category: "search" };
    case "List":
      return { Icon: FolderTree, accent: "var(--tool-list-accent)", category: "list" };
    case "AskUserQuestion":
      return { Icon: CircleHelp, accent: "var(--tool-list-accent)", category: "system" };
    case "ExitPlanMode":
      return { Icon: ListChecks, accent: "var(--tool-list-accent)", category: "system" };
    case "ToolSearch":
      return { Icon: Search, accent: "var(--tool-search-accent)", category: "search" };
    default:
      return { Icon: Wrench, accent: "var(--tool-file-accent)", category: "other" };
  }
}

export function displayString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function compactInlineText(value: unknown, maxChars = 120) {
  const text = displayString(value).replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

export function isSubagentCardToolCall(toolCall: {
  name: string;
  arguments?: Record<string, unknown>;
}) {
  return toolCall.name === "Agent" && toolCall.arguments?.subagent_card === true;
}

export function getSubagentTask(agent: { prompt?: unknown }) {
  return displayString(agent.prompt);
}

export function getSubagentInlineSummary(item: ToolTraceItem) {
  const details = item.toolResult?.details as Partial<SubagentCardDetails> | undefined;
  const agent = details?.kind === "subagent_card" ? details.agent : undefined;
  const args = item.toolCall.arguments || {};
  const name = displayString(agent?.name) || displayString(args.name) || displayString(args.id);
  const task = agent ? getSubagentTask(agent) : displayString(args.prompt);

  if (name && task) return `${name} - ${compactInlineText(task, 96)}`;
  return name || compactInlineText(task, 120);
}

export function shouldShowSubagentApplyStatus(agent: SubagentReportDetails) {
  if (!agent.applyStatus) return false;
  if (agent.applyStatus === "applied" || agent.applyStatus === "failed") return true;
  return Boolean(agent.applySkippedReason && agent.applySkippedReason !== "no_changes");
}

export function shouldShowSubagentCleanupStatus(agent: SubagentReportDetails) {
  return Boolean(
    agent.worktreeCleanupStatus &&
      agent.worktreeCleanupStatus !== "removed" &&
      agent.worktreeCleanupStatus !== "skipped",
  );
}

export function shouldShowSubagentWorktreeLocation(agent: SubagentReportDetails) {
  return Boolean(
    agent.worktreeRoot &&
      (agent.status !== "completed" ||
        agent.worktreeCleanupStatus === "retained" ||
        agent.worktreeCleanupStatus === "failed"),
  );
}

export type GroupedRoundBlock =
  | {
      kind: "thinking";
      key: string;
      text: string;
    }
  | {
      kind: "text";
      key: string;
      text: string;
    }
  | {
      kind: "tool";
      key: string;
      item: ToolTraceItem;
    }
  | {
      kind: "hostedSearch";
      key: string;
      item: HostedSearchBlock;
    }
  | {
      kind: "hostedSearchGroup";
      key: string;
      items: HostedSearchBlock[];
    }
  | {
      kind: "toolGroup";
      key: string;
      items: ToolTraceItem[];
    }
  | {
      /**
       * A context compaction that landed inside this reply. Rendered as a
       * seam milestone in the work trace so the reply reads as one
       * continuous turn instead of two replies split by a card.
       */
      kind: "checkpoint";
      key: string;
      seam: CompactionSeam;
    };

function isReasoningOrSearchBlock(block: GroupedRoundBlock) {
  return (
    block.kind === "thinking" || block.kind === "hostedSearch" || block.kind === "hostedSearchGroup"
  );
}

export function resolveReasoningSearchWorkLayout(blocks: GroupedRoundBlock[]) {
  let lastWorkIndex = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block && isReasoningOrSearchBlock(block)) {
      lastWorkIndex = index;
      break;
    }
  }
  if (lastWorkIndex === -1) {
    return { firstIndex: -1, indexes: [] as number[] };
  }

  const answerStartIndex = blocks.findIndex(
    (block, index) =>
      index > lastWorkIndex && block.kind === "text" && block.text.trim().length > 0,
  );
  const indexes: number[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (isReasoningOrSearchBlock(block)) {
      indexes.push(index);
      continue;
    }
    if (
      block.kind === "text" &&
      block.text.trim().length > 0 &&
      index < (answerStartIndex === -1 ? blocks.length : answerStartIndex)
    ) {
      indexes.push(index);
    }
  }
  return { firstIndex: indexes[0] ?? -1, indexes };
}

export type AssistantTurnLayoutEntry = {
  key: string;
  roundKey: string;
  roundMeta?: UiRound["meta"];
  block: GroupedRoundBlock;
  runningToolCallIds: string[];
  thinkingOpen: boolean;
};

export type AssistantTurnLayout = {
  work: AssistantTurnLayoutEntry[];
  interaction: AssistantTurnLayoutEntry[];
  answer: AssistantTurnLayoutEntry[];
};

type AssistantTurnRound = UiRound & {
  key?: string;
  runningToolCallIds?: string[];
  thinkingOpen?: boolean;
};

function isVisibleTurnBlock(block: GroupedRoundBlock) {
  if (block.kind === "text" || block.kind === "thinking") {
    return block.text.trim().length > 0;
  }
  if (block.kind === "checkpoint") return true;
  return !isTaskToolBlock(block);
}

function isTerminalStopReason(stopReason: string | undefined) {
  return Boolean(stopReason && stopReason !== "toolUse");
}

function isAnswerResultBlock(block: GroupedRoundBlock) {
  if (block.kind === "text") return block.text.trim().length > 0;
  if (block.kind === "hostedSearch" || block.kind === "hostedSearchGroup") return true;
  if (block.kind !== "tool") return false;
  if (block.item.toolCall.name !== "Image" || block.item.toolResult?.isError) return false;
  return getBuiltinResultKind(block.item.toolResult) === "display_image";
}

function mergeRunningToolCallIds(left: string[], right: string[]) {
  if (right.length === 0) return left;
  if (left.length === 0) return right;
  return Array.from(new Set([...left, ...right]));
}

/**
 * Turn raw round-by-round activity into the stage-oriented trace used by the
 * transcript. Provider rounds often alternate `thinking -> one tool` dozens
 * of times; exposing that shape produces a repetitive log instead of a useful
 * work summary. Thinking segments stay in the trace as collapsed disclosures
 * (the reasoning body only mounts when the user expands one), and they act as
 * stage boundaries: neighboring tool/search activity merges into one group
 * until a thinking segment or a visible progress note starts the next stage.
 */
export function compactAssistantWorkEntries(
  entries: readonly AssistantTurnLayoutEntry[],
): AssistantTurnLayoutEntry[] {
  const compacted: AssistantTurnLayoutEntry[] = [];

  for (const entry of entries) {
    const previous = compacted.at(-1);
    if (previous?.block.kind === "toolGroup" && entry.block.kind === "toolGroup") {
      compacted[compacted.length - 1] = {
        ...previous,
        block: {
          ...previous.block,
          items: [...previous.block.items, ...entry.block.items],
        },
        runningToolCallIds: mergeRunningToolCallIds(
          previous.runningToolCallIds,
          entry.runningToolCallIds,
        ),
      };
      continue;
    }

    if (previous?.block.kind === "hostedSearchGroup" && entry.block.kind === "hostedSearchGroup") {
      compacted[compacted.length - 1] = {
        ...previous,
        block: {
          ...previous.block,
          items: [...previous.block.items, ...entry.block.items],
        },
      };
      continue;
    }

    compacted.push(entry);
  }

  return compacted;
}

export type WorkCounts = {
  thinking: number;
  tools: number;
  searches: number;
};

/** 过程明细里各类活动的条数，供概括条文案使用（「N 次工具调用｜N 次思考」）。 */
export function countWorkEntries(entries: readonly AssistantTurnLayoutEntry[]): WorkCounts {
  let thinking = 0;
  let tools = 0;
  let searches = 0;
  for (const entry of entries) {
    const block = entry.block;
    if (block.kind === "thinking") thinking += 1;
    else if (block.kind === "tool") tools += 1;
    else if (block.kind === "toolGroup") tools += block.items.length;
    else if (block.kind === "hostedSearch") searches += 1;
    else if (block.kind === "hostedSearchGroup") searches += block.items.length;
  }
  return { thinking, tools, searches };
}

/**
 * 概括条展开时最多铺出的 entry 行数。两次输出之间模型可能反复思考/调工具几十次，全铺
 * 出来会把会话拉得很长；超出的更早记录收成一行「更早的 N 条记录」，点开才铺。
 *
 * 口径是 **entry 行数**（不是思考/工具调用条数）：决定高度的是行数，而一个 `toolGroup`
 * 里塞十几条调用时按调用数切，窗口长度会随内容漂移。
 */
export const WORK_TRACE_VISIBLE_ENTRY_LIMIT = 6;

/** 稳定空引用：短段（未超上限）直接复用，避免每次渲染都建新数组。 */
const EMPTY_WORK_ENTRIES: AssistantTurnLayoutEntry[] = [];

/**
 * 段内窗口化：只保留**连续后缀**（最近 `WORK_TRACE_VISIBLE_ENTRY_LIMIT` 条），更早的进
 * 隐藏集。短段原样返回（隐藏集为空），短回合渲染逐字节不变。
 *
 * 「当前正在进行的那一条」不需要额外兜底：运行时每一轮都要等本轮工具全部返回才进入
 * 下一轮，所以还在跑的思考/工具调用必然是段的最后一条，天然落在后缀里；段里更早那些
 * 已经落定的记录，正是要收起来的东西。
 *
 * （刻意不用 `entry.thinkingOpen` 兜底：它是**轮级**标志，同一轮里所有 entry 都会是
 * true，拿它当「这一条还在流」用会让上限直接失效。）
 */
function windowProcessEntries(entries: AssistantTurnLayoutEntry[]): {
  hidden: AssistantTurnLayoutEntry[];
  visible: AssistantTurnLayoutEntry[];
} {
  const start = Math.max(0, entries.length - WORK_TRACE_VISIBLE_ENTRY_LIMIT);
  if (start === 0) return { hidden: EMPTY_WORK_ENTRIES, visible: entries };
  return { hidden: entries.slice(0, start), visible: entries.slice(start) };
}

export type WorkSegment =
  | {
      kind: "process";
      key: string;
      /** 这一段里的全部 entry（计数与文案按它算，窗口化不影响口径）。 */
      entries: AssistantTurnLayoutEntry[];
      /** 默认收起的更早 entry（`entries` 的前缀）。为空时渲染与改动前逐字节一致。 */
      hiddenEntries: AssistantTurnLayoutEntry[];
      /** 直接铺出来的 entry（`entries` 的连续后缀）。 */
      visibleEntries: AssistantTurnLayoutEntry[];
      /** 这一段里含当前正在进行的活动（用于标题的 shimmer）。 */
      running: boolean;
      /**
       * 这一段之后模型已经写出过东西（正文或压缩里程碑）。`active` 档据此收起：
       * 收起的时机是「模型有输出」，而不是「这一段的活动跑完了」——后者会让
       * 还在跑的思考/工具链中途就被折起来。
       */
      hasOutputAfter: boolean;
    }
  | { kind: "entry"; key: string; entry: AssistantTurnLayoutEntry };

/**
 * 把 work 层按「模型写出来的正文」切段：连续的非正文 entry 归一段，正文与压缩
 * 里程碑各自独立成段。
 *
 * 渲染时每段过程收成一条可折叠的概括条（「N 次工具调用｜N 次思考」），正文照常
 * 留在外面可见——用户要的是「两次输出之间的过程别铺满一屏」，不是「把正文也藏起来」。
 *
 * 只有一条 entry 的段不包概括条：`toolGroup` 自己已经是折叠行，再套一层只是多一次
 * 点击。因此短回合的渲染结果与改动前逐字节一致，长回合（思考/工具反复交替）才收成条。
 *
 * 段内还会再窗口化一次：超过 `WORK_TRACE_VISIBLE_ENTRY_LIMIT` 条的段只铺最近的连续后缀，
 * 更早的进 `hiddenEntries`（渲染成一行「更早的 N 条记录」，点开才铺）。正在进行的思考/
 * 工具调用必然是段的最后一条，天然落在可见后缀里，不会被收掉。
 */
export function segmentWorkEntries(
  entries: readonly AssistantTurnLayoutEntry[],
  options?: { activeKey?: string | null },
): WorkSegment[] {
  const activeKey = options?.activeKey ?? null;
  const segments: WorkSegment[] = [];
  let pending: AssistantTurnLayoutEntry[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    const group = pending;
    pending = [];
    if (group.length === 1) {
      const only = group[0];
      if (only) segments.push({ kind: "entry", key: only.key, entry: only });
      return;
    }
    const window = windowProcessEntries(group);
    segments.push({
      kind: "process",
      key: `process:${group[0]?.key ?? segments.length}`,
      entries: group,
      hiddenEntries: window.hidden,
      visibleEntries: window.visible,
      running: activeKey !== null && group.some((entry) => entry.key === activeKey),
      hasOutputAfter: false,
    });
  };

  for (const entry of entries) {
    if (entry.block.kind === "text" || entry.block.kind === "checkpoint") {
      flush();
      segments.push({ kind: "entry", key: entry.key, entry });
      continue;
    }
    pending.push(entry);
  }
  flush();

  // 反向扫一遍定稿：后面还有模型输出（正文/里程碑）的过程段才算「已翻篇」。
  let sawOutput = false;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment) continue;
    if (segment.kind === "process") segment.hasOutputAfter = sawOutput;
    else sawOutput = true;
  }

  return segments;
}

/**
 * 活回合里「模型还没有写出东西」的那一截 work entry：从末尾往前扫，遇到正文或压缩
 * 里程碑就停。
 *
 * 与 `segmentWorkEntries` 的 `hasOutputAfter` 同一口径，区别只是按 entry 给而不是按
 * 段给——单条 entry 的段（例如夹在两次输出之间的孤零零一批工具）不会包概括条，拿不到
 * `hasOutputAfter`，但工具批次同样需要这条判据来决定默认展开。
 */
export function resolveActiveWorkTailKeys(
  entries: readonly AssistantTurnLayoutEntry[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.block.kind === "text" || entry.block.kind === "checkpoint") break;
    keys.add(entry.key);
  }
  return keys;
}

/**
 * 概括条文案：「N 次工具调用｜N 次思考｜N 次搜索」，零计数的类别不出现在串里。
 * 分隔符与工具批次同一口径（中文全角、英文半角竖线）。
 */
export function formatWorkCountsLabel(
  counts: WorkCounts,
  t: (key: string) => string,
  locale: string,
): string {
  const parts: string[] = [];
  const push = (key: string, count: number) => {
    if (count > 0) parts.push(t(key).replace("{count}", String(count)));
  };
  push("chat.work.process.tools", counts.tools);
  push("chat.work.process.thinking", counts.thinking);
  push("chat.work.process.searches", counts.searches);
  return parts.join(locale === "zh-CN" ? "｜" : " | ");
}

/**
 * The most recent thinking entry is the only one that can still be streaming.
 * Its key is exposed so renderers can show that single disclosure in the live
 * "思考中" state; every earlier segment is a settled "思考了/思考过程" row.
 */
export function resolveActiveThinkingEntryKey(
  entries: readonly AssistantTurnLayoutEntry[],
): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.block.kind !== "thinking") continue;
    return entry.thinkingOpen ? entry.key : null;
  }
  return null;
}

/**
 * The work entry the turn is visibly busy with *right now*: a streaming
 * reasoning segment, a tool batch with running calls, an in-flight hosted
 * search, or the progress note currently being streamed. When the user
 * collapses the processing disclosure mid-run, this entry is re-rendered
 * outside it so the transcript never goes blank while work continues. A
 * settled trailing entry returns null — the liveness sparkle alone covers
 * gaps between activities.
 */
export function resolveActiveWorkEntry(
  entries: readonly AssistantTurnLayoutEntry[],
): AssistantTurnLayoutEntry | null {
  const entry = entries.at(-1);
  if (!entry) return null;
  const block = entry.block;
  if (block.kind === "checkpoint") return null;
  if (block.kind === "thinking") return entry.thinkingOpen ? entry : null;
  if (block.kind === "text") return entry;
  if (block.kind === "tool" || block.kind === "toolGroup") {
    const runningIds = new Set(entry.runningToolCallIds);
    const items = block.kind === "tool" ? [block.item] : block.items;
    return items.some((item) => item.toolCall.id && runningIds.has(item.toolCall.id))
      ? entry
      : null;
  }
  const searches = block.kind === "hostedSearch" ? [block.item] : block.items;
  return searches.some((item) => item.status === "searching") ? entry : null;
}

/**
 * Only an *unanswered* interaction is pinned outside the processing
 * disclosure — it must stay visible and operable while it blocks the run.
 * The moment it settles (answered, cancelled or timed out) it becomes
 * ordinary timeline activity and flows back into the trace at the position
 * where it happened, so later reasoning/tools stack below it instead of the
 * answered card trailing the whole turn.
 */
export function isPendingUserInteractionBlock(block: GroupedRoundBlock) {
  if (block.kind === "tool") {
    return isUserInteractionToolName(block.item.toolCall.name) && !block.item.toolResult;
  }
  if (block.kind === "toolGroup") {
    return block.items.some(
      (item) => isUserInteractionToolName(item.toolCall.name) && !item.toolResult,
    );
  }
  return false;
}

function splitInteractionEntries(entries: readonly AssistantTurnLayoutEntry[]) {
  const interactionIndexes = new Set<number>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || !isPendingUserInteractionBlock(entry.block)) continue;
    interactionIndexes.add(index);

    // A model usually explains why it needs input immediately before calling
    // AskUserQuestion / ExitPlanMode. Keep that adjacent prose with the card so
    // neither can disappear inside the processing disclosure.
    for (let proseIndex = index - 1; proseIndex >= 0; proseIndex -= 1) {
      const proseEntry = entries[proseIndex];
      if (!proseEntry || proseEntry.block.kind !== "text") break;
      interactionIndexes.add(proseIndex);
    }
  }

  return {
    background: entries.filter((_, index) => !interactionIndexes.has(index)),
    interaction: entries.filter((_, index) => interactionIndexes.has(index)),
  };
}

// Per-round layout entries are a pure function of the (immutable) round
// object: roundKey, meta, runningToolCallIds, thinkingOpen and the grouped
// blocks are all derived from it. Streaming replaces only the mutated
// round's reference (updateLiveRound / appendTextDeltaToRound keep every
// other round identical), so caching by round identity turns each rebuild
// of a long reply from O(whole reply) into O(changed round). Reference-
// stable entries also let downstream reuse checks (canReuseLiveUnit, memo
// comparators) short-circuit on identity instead of deep-comparing text.
const roundLayoutEntriesCache = new WeakMap<object, AssistantTurnLayoutEntry[]>();

function buildRoundLayoutEntries(round: AssistantTurnRound): AssistantTurnLayoutEntry[] {
  const cached = roundLayoutEntriesCache.get(round);
  if (cached) return cached;
  const roundKey = round.key?.trim() || `r${round.round}`;
  const runningToolCallIds = round.runningToolCallIds ?? [];
  const thinkingOpen = round.thinkingOpen ?? false;
  const seam = getCompactionSeam(round);
  let entries: AssistantTurnLayoutEntry[];
  if (seam) {
    // A compaction seam is a stage boundary of its own: it renders as a
    // milestone row in the work trace and, like a thinking segment, keeps
    // the tool batches on either side from merging into one group.
    entries = [
      {
        key: `${roundKey}:checkpoint`,
        roundKey,
        roundMeta: round.meta,
        block: { kind: "checkpoint" as const, key: `checkpoint-${seam.key}`, seam },
        runningToolCallIds,
        thinkingOpen,
      },
    ];
  } else {
    entries = groupRoundBlocks(round.blocks)
      .filter(isVisibleTurnBlock)
      .map((block) => ({
        key: `${roundKey}:${block.key}`,
        roundKey,
        roundMeta: round.meta,
        block,
        runningToolCallIds,
        thinkingOpen,
      }));
  }
  roundLayoutEntriesCache.set(round, entries);
  return entries;
}

/**
 * Project every model/tool round produced by one user request into the three
 * visual layers used by the transcript:
 *
 * - `work` is the visible in-progress trace (reasoning disclosures, progress
 *   notes, searches and tool activity), shown inside one collapsible section.
 * - `interaction` is user-facing decision prose plus its interactive card,
 *   rendered outside the work disclosure so it cannot be hidden while pending.
 * - `answer` is the final trailing user-visible result, rendered as the
 *   assistant's durable response below that section. It may include prose,
 *   native image results, or hosted search results produced at the end of the
 *   same provider round.
 *
 * A live, non-terminal turn deliberately keeps trailing prose in `work`.
 * Otherwise a progress note would jump in and out of the final-answer layer
 * every time the model resumes with another tool call.
 */
export function resolveAssistantTurnLayout(
  rounds: readonly AssistantTurnRound[],
  options: { live: boolean },
): AssistantTurnLayout {
  const entries = rounds.flatMap((round) => buildRoundLayoutEntries(round));

  if (entries.length === 0) return { work: [], interaction: [], answer: [] };

  const { background, interaction } = splitInteractionEntries(entries);

  const lastRound = rounds.at(-1);
  if (options.live && !isTerminalStopReason(lastRound?.meta?.stopReason)) {
    return {
      work: compactAssistantWorkEntries(background),
      interaction,
      answer: [],
    };
  }

  const lastEntry = background.at(-1);
  if (!lastEntry || !isAnswerResultBlock(lastEntry.block)) {
    return {
      work: compactAssistantWorkEntries(background),
      interaction,
      answer: [],
    };
  }

  let answerStart = background.length - 1;
  while (answerStart > 0) {
    const previous = background[answerStart - 1];
    if (
      !previous ||
      previous.roundKey !== lastEntry.roundKey ||
      !isAnswerResultBlock(previous.block)
    ) {
      break;
    }
    answerStart -= 1;
  }

  return {
    work: compactAssistantWorkEntries(background.slice(0, answerStart)),
    interaction,
    answer: background.slice(answerStart),
  };
}

const stableValueSignatureCache = new WeakMap<object, string>();

export function getStableValueSignature(value: unknown) {
  if (value && typeof value === "object") {
    const cached = stableValueSignatureCache.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const signature = safeStringify(value);
    stableValueSignatureCache.set(value, signature);
    return signature;
  }
  return safeStringify(value);
}

export function areStableValuesEqual(previous: unknown, next: unknown) {
  return previous === next || getStableValueSignature(previous) === getStableValueSignature(next);
}

export function getToolTraceKey(item: ToolTraceItem, index: number) {
  const id = item.toolCall.id?.trim();
  if (id) return id;
  return `${item.toolCall.name}-${index}-${getStableValueSignature(item.toolCall.arguments)}`;
}

export function isAgentToolName(name: string) {
  return name === "Agent";
}

/**
 * 拆开动态 MCP 工具名。命名规则见 `mcpTools.ts`：
 * `mcp_<sanitizedServerId>_<sanitizedToolName>`。
 *
 * 两段本身都可能含下划线，所以按第一个 `_` 切分是启发式而非精确解析。
 * 实践中 server id 是 kebab-case（sanitize 保留 `-`），切分正确；即便切
 * 错也只影响标题渲染，不参与任何判定或 key。
 */
export function parseDynamicMcpToolName(name: string): { serverId: string; tool: string } | null {
  const trimmed = name.trim();
  if (!isDynamicMcpToolName(trimmed)) return null;
  const rest = trimmed.slice("mcp_".length);
  const separator = rest.indexOf("_");
  if (separator <= 0 || separator === rest.length - 1) return null;
  return { serverId: rest.slice(0, separator), tool: rest.slice(separator + 1) };
}

/**
 * cua-driver 的工具会真实操作用户的机器，值得在气泡里一眼可辨。
 *
 * 走 `isCuaDriverServerId` 而不是直接比字符串：工具名里的 server id 段是
 * 从配置原文 sanitize 出来的，大小写照抄。这里只影响图标，但同一个判断在
 * 别处关系到审批缺省，口径不该有两套。
 */
export function isCuaDriverToolName(name: string) {
  const parsed = parseDynamicMcpToolName(name);
  return parsed ? isCuaDriverServerId(parsed.serverId) : false;
}

export function getToolDisplayName(name: string) {
  if (name === "SshManager") return "SSHManager";
  // `mcp_cua-driver_get_desktop_state` 这样的原始名在气泡标题里又长又
  // 难读。拆成 `cua-driver · get_desktop_state`：server 仍然可见（同时
  // 挂多个 MCP 时需要区分），但工具本身成为视觉重心。
  const parsed = parseDynamicMcpToolName(name);
  if (parsed) return `${parsed.serverId} · ${parsed.tool}`;
  return name;
}

type ShellSessionDisplayDetails = {
  sessionId: string;
  status: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export type FileOperationKind = "read" | "create" | "edit" | "delete";

export type FileOperationDisplay = {
  kind: FileOperationKind;
  path: string;
  fileName: string;
  link: ChatFileLink | null;
};

function getFileOperationKind(item: ToolTraceItem): FileOperationKind | null {
  switch (item.toolCall.name) {
    case "Read":
      return "read";
    case "Write": {
      const details = asRecord(item.toolResult?.details);
      return details?.existedBefore === true ? "edit" : "create";
    }
    case "Edit":
      return "edit";
    case "Delete":
      return "delete";
    default:
      return null;
  }
}

function fileNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

/**
 * Extract the concise, IDE-addressable target used by successful file-tool rows.
 * Result metadata wins because it carries the host-resolved absolute path; the
 * original argument remains the streaming and legacy-history fallback.
 */
export function getFileOperationDisplay(item: ToolTraceItem): FileOperationDisplay | null {
  const kind = getFileOperationKind(item);
  if (!kind) return null;

  const details = asRecord(item.toolResult?.details);
  const args = item.toolCall.arguments || {};
  const displayPath =
    displayString(details?.displayPath) ||
    displayString(details?.relativePath) ||
    displayString(details?.path) ||
    displayString(args.path) ||
    displayString(args.notebook_path);
  if (!displayPath) return null;

  const linkPath =
    displayString(details?.absolutePath) ||
    displayString(details?.relativePath) ||
    displayString(details?.path) ||
    displayString(args.path) ||
    displayString(args.notebook_path);
  const parsedLink = linkPath ? parseChatFileLink(linkPath) : null;
  const startLine = args.start_line;
  const link =
    parsedLink &&
    parsedLink.line === undefined &&
    typeof startLine === "number" &&
    Number.isSafeInteger(startLine) &&
    startLine > 0
      ? { ...parsedLink, line: startLine }
      : parsedLink;

  return {
    kind,
    path: displayPath,
    fileName: fileNameFromPath(displayPath),
    link,
  };
}

export function getShellSessionDisplayDetails(
  result?: ToolResultMessage,
): ShellSessionDisplayDetails | null {
  const details = asRecord(result?.details);
  const sessionId = typeof details?.session_id === "string" ? details.session_id.trim() : "";
  const status = typeof details?.status === "string" ? details.status.trim() : "";
  if (!sessionId || !status) return null;
  return {
    sessionId,
    status,
  };
}

const TOOL_CARD_ACTION_NAMES = new Set([
  "SkillsManager",
  "CronTaskManager",
  "McpManager",
  "MemoryManager",
  "TunnelManager",
  "SSHManager",
  "ManagedProcess",
]);

export function getManagerToolActionName(toolCall: {
  name: string;
  arguments?: Record<string, unknown>;
}) {
  const name = getToolDisplayName(toolCall.name);
  if (!TOOL_CARD_ACTION_NAMES.has(name)) return "";
  const args = toolCall.arguments || {};
  const action = displayString(args.action);
  if (action) return action;
  if (name === "SkillsManager") {
    return displayString(args.path) ? "read" : "list";
  }
  return "";
}

export function getToolDisplayTitle(toolCall: {
  name: string;
  arguments?: Record<string, unknown>;
}) {
  const name = getToolDisplayName(toolCall.name);
  const action = getManagerToolActionName(toolCall);
  return { name, action };
}

export function groupRoundBlocks(blocks: UiRound["blocks"]): GroupedRoundBlock[] {
  const groupedBlocks: GroupedRoundBlock[] = [];
  let pendingTools: ToolTraceItem[] = [];
  let pendingStartIndex = 0;
  let pendingSearches: HostedSearchBlock[] = [];
  let pendingSearchStartIndex = 0;
  const hasHostedSearch = blocks.some((block) => block.kind === "hostedSearch");

  const flushPendingTools = () => {
    if (pendingTools.length === 0) return;
    groupedBlocks.push({
      kind: "toolGroup",
      // The wrapper exists from the first ordinary tool onward. Appending a
      // second tool therefore updates one activity in place instead of
      // replacing a `tool` row with a differently keyed `toolGroup` row.
      key: `tool-group-${getToolTraceKey(pendingTools[0], pendingStartIndex)}`,
      items: pendingTools,
    });
    pendingTools = [];
  };

  const flushPendingSearches = () => {
    if (pendingSearches.length === 0) return;
    const firstSearch = pendingSearches[0];
    groupedBlocks.push({
      kind: "hostedSearchGroup",
      key: `hosted-search-group-${firstSearch?.id || pendingSearchStartIndex}`,
      items: pendingSearches,
    });
    pendingSearches = [];
  };

  blocks.forEach((block, index) => {
    if (block.kind === "tool") {
      if (!shouldDisplayToolTraceItem(block.item, { hasHostedSearch })) {
        return;
      }
      flushPendingSearches();
      if (
        block.item.toolCall.name === "Image" ||
        isTaskToolName(block.item.toolCall.name) ||
        isUserInteractionToolName(block.item.toolCall.name) ||
        block.item.toolCall.name === "ProcessWait" ||
        block.item.toolCall.name === "ProcessStop" ||
        isAgentToolName(block.item.toolCall.name)
      ) {
        flushPendingTools();
        groupedBlocks.push({
          kind: "tool",
          key: `tool-${getToolTraceKey(block.item, index)}`,
          item: block.item,
        });
        return;
      }
      if (pendingTools.length === 0) {
        pendingStartIndex = index;
      }
      pendingTools.push(block.item);
      return;
    }

    flushPendingTools();
    if (block.kind === "hostedSearch") {
      if (pendingSearches.length === 0) {
        pendingSearchStartIndex = index;
      }
      pendingSearches.push(block.item);
      return;
    }
    flushPendingSearches();
    if (block.kind === "thinking") {
      groupedBlocks.push({ kind: "thinking", key: block.id, text: block.text });
      return;
    }
    groupedBlocks.push({ kind: "text", key: block.id, text: block.text });
  });

  flushPendingTools();
  flushPendingSearches();
  return groupedBlocks;
}

export function getBuiltinResultKind(result?: ToolResultMessage) {
  if (!result?.details || typeof result.details !== "object") return null;
  const kind = (result.details as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

/**
 * work 层里可预览的产物（`display_image` 工具结果：Image / GenerateImage）。
 *
 * 这些区块原先只活在 work trace 里：回合结束收起后连图片预览灯箱一起被卸载。
 * 现在由 `PreviewArtifactsRow` 在答案下方独立一行重新呈现，所以这里只负责**收集**，
 * 不再用它去门控 work trace 的自动收起（那样会让思考过程永远不收起）。
 */
export function collectWorkPreviewItems(
  entries: readonly AssistantTurnLayoutEntry[],
): ToolTraceItem[] {
  const items: ToolTraceItem[] = [];
  const push = (item: ToolTraceItem) => {
    if (getBuiltinResultKind(item.toolResult) === "display_image") items.push(item);
  };
  for (const entry of entries) {
    if (entry.block.kind === "tool") push(entry.block.item);
    else if (entry.block.kind === "toolGroup") entry.block.items.forEach(push);
  }
  return items;
}

export function isBuiltinShareToolName(name: string) {
  const trimmed = name.trim();
  if (isDynamicMcpToolName(trimmed)) {
    return true;
  }
  if (isTaskToolName(trimmed)) {
    return true;
  }
  return [
    "Agent",
    "AskUserQuestion",
    "Bash",
    "Browser",
    "CronTaskManager",
    "Delete",
    "Edit",
    "ExitPlanMode",
    "GenerateImage",
    "Glob",
    "Grep",
    "Image",
    "List",
    "ManagedProcess",
    "ProcessStop",
    "ProcessWait",
    "McpManager",
    "MemoryManager",
    "PlanningMutate",
    "PlanningQuery",
    "Read",
    "ReadConversation",
    "ReadTerminal",
    "SendMessage",
    "SkillsManager",
    "ToolSearch",
    "SSHManager",
    "SshManager",
    "TunnelManager",
    "Write",
  ].includes(trimmed);
}
