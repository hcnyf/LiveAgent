import { isSubagentCardToolCall } from "@liveagent/ui/components/chat/assistant-bubble/assistantBubbleUtils";

/** 一个子代理的运行态（浅层：谁在跑 / 多久 / 轮数 / 工具调用数 / 终态）。 */
export type SubagentProgressEntry = {
  /** 卡片 id（`parentToolCallId:agent:N`），聚焦与去重用。 */
  id: string;
  name: string;
  role?: string;
  task?: string;
  status: string;
  /** 还在跑：用时按当前时间现算，并显示活动指示。 */
  running: boolean;
  startedAtMs?: number;
  durationMs?: number;
  rounds?: number;
  toolCalls?: number;
  index: number;
  total: number;
};

/** 一次 `Agent` 调用（父节点）fan-out 出来的全部子代理（子节点）。 */
export type SubagentProgressGroup = {
  id: string;
  /**
   * 父节点文案。父 `Agent` 调用本身在会话里是被折叠掉的（只留 fan-out 出来的
   * 卡片），所以宿主通常拿不到它的一句话描述；拿不到时留空，由渲染方决定退
   * 回文案，绝不把内部调用 id 当作标题显示给用户。
   */
  label?: string;
  entries: SubagentProgressEntry[];
};

export type SubagentProgressValue = {
  groups: readonly SubagentProgressGroup[];
  /** 点击会话里的子代理卡片时，宿主据此打开面板并聚焦该子代理。 */
  onOpenSubagent?: (entryId: string) => void;
  /** 面板里当前聚焦的子代理（宿主传入，用于高亮）。 */
  focusedEntryId?: string;
};

/**
 * 持久化运行态的实时快照。子代理每过一个回合边界就会把自己的
 * `status/roundCount/toolCallCount/startedAt` 落盘，但**不发事件**，所以宿主只能按
 * 轮询拿到它；有就传，没有就退化为卡片自带的信息（终态报告 + 是否在跑）。
 */
export type SubagentLiveRun = {
  status?: string;
  /** 权威开始时刻：运行中的用时按它现算，而不是由宿主猜一个。 */
  startedAtMs?: number;
  rounds?: number;
  toolCalls?: number;
};

/** 进度面板的输入：只描述「卡片」这一层，与工具块的完整结构解耦。 */
export type SubagentProgressCardInput = {
  id: string;
  /** 卡片 toolCall 的 arguments（`subagent_card: true` + name/id/prompt）。 */
  arguments?: Record<string, unknown>;
  /** 卡片 toolResult 的 details（未完成时为 undefined）。 */
  details?: unknown;
  /** 还在跑（宿主按 runningToolCallIds 判定）。 */
  running: boolean;
  /** 开始时刻，用于运行中现算用时。 */
  startedAtMs?: number;
  /** 父 `Agent` 调用的一句话描述，宿主能拿到就传。 */
  parentLabel?: string;
  /** 持久化运行态快照（见 SubagentLiveRun），终态报告还没到时的数字来源。 */
  run?: SubagentLiveRun;
};

const SUBAGENT_CARD_ID_MARKER = ":agent:";

/**
 * 卡片 id 形如 `<parentToolCallId>:agent:N`，父节点 id 就是标记之前的前缀。
 * 认不出这个形状时原样返回，卡片自己成一个组（至少不会把它错并到别的调用下）。
 */
export function subagentParentId(cardId: string): string {
  const at = cardId.lastIndexOf(SUBAGENT_CARD_ID_MARKER);
  return at > 0 ? cardId.slice(0, at) : cardId;
}

export function isSubagentProgressCard(toolCall: {
  name: string;
  arguments?: Record<string, unknown>;
}): boolean {
  return isSubagentCardToolCall(toolCall);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 把子代理卡片按「哪一次 `Agent` 调用 fan-out 出来的」分组，供进度面板画父子树。
 *
 * 分组键是卡片 id 的前缀，所以同一个父调用的子代理自然聚在一起，并保持出现顺序。
 * 文案优先取结果里的 `details.agent`（有 status/durationMs/rounds/toolCalls），卡片还在
 * 跑时退回持久化运行态快照（`card.run`，有 status/rounds/toolCalls/startedAt），再退回
 * toolCall 的 arguments（只有 name/id/prompt）。子代理内部逐次工具调用没有回流父会话，
 * 这里不编造。父节点的 `label` 只有宿主给了才有。
 */
export function buildSubagentProgressGroups(
  cards: readonly SubagentProgressCardInput[],
): SubagentProgressGroup[] {
  const groups = new Map<string, SubagentProgressGroup>();

  for (const card of cards) {
    const args = card.arguments ?? {};
    const details = record(card.details);
    const agent = record(details.agent);
    const run = card.run ?? {};
    const parentId = subagentParentId(card.id);

    const entry: SubagentProgressEntry = {
      id: card.id,
      name: text(agent.name) ?? text(args.name) ?? text(args.id) ?? parentId,
      role: text(agent.role) ?? text(args.role),
      task: text(agent.prompt) ?? text(args.prompt),
      // 终态报告 > 持久化运行态 > 「在跑」这个事实本身。
      status: text(agent.status) ?? text(run.status) ?? (card.running ? "running" : ""),
      running: card.running,
      startedAtMs: card.startedAtMs ?? count(run.startedAtMs),
      durationMs: count(agent.durationMs),
      rounds: count(agent.rounds) ?? count(run.rounds),
      toolCalls: count(agent.toolCalls) ?? count(run.toolCalls),
      index: count(details.index) ?? 0,
      total: count(details.total) ?? 1,
    };

    const existing = groups.get(parentId);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    groups.set(parentId, {
      id: parentId,
      label: text(card.parentLabel),
      entries: [entry],
    });
  }

  return [...groups.values()];
}
