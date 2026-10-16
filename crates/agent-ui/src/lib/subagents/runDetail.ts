/**
 * 子代理「运行过程」的展示数据：把子代理自己的私有上下文（它每一轮的思考 / 正文 /
 * 工具调用）压成一份可渲染的骨架。
 *
 * 这是协议里没有的东西——父会话只收到子代理的终态报告，看不到它内部走了哪些步。数据
 * 只能从子代理运行态（`subagentRun` 段）里取，所以由宿主经 adapter 注入（见
 * `@liveagent/adapters/assistantBubble` 的 `useSubagentRunDetail`）；WebUI 拿不到时
 * 卡片照旧只显示报告，不退化。
 */

/** 一步 = 子代理的一次 assistant 消息（含它发起的工具调用）。 */
export type SubagentRunStepTool = {
  /** 稳定 id（工具调用 id；缺失时由「第几步 + 序号」兜底），只用于渲染 key。 */
  id: string;
  name: string;
  isError: boolean;
};

export type SubagentRunStep = {
  step: number;
  /** 这一轮的思考摘要（已截断，可能为空）。 */
  thinking?: string;
  /** 这一轮的正文摘要（已截断，可能为空）。 */
  text?: string;
  tools: SubagentRunStepTool[];
};

export type SubagentRunDetail = {
  /** 运行状态：running / completed / failed / cancelled。 */
  status?: string;
  rounds?: number;
  toolCalls?: number;
  steps: readonly SubagentRunStep[];
};

/** 单段摘要字符上限：过程区是给人扫一眼的，不搬全文。 */
const STEP_TEXT_MAX_CHARS = 240;
const MAX_STEPS = 60;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function summarize(value: string): string | undefined {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > STEP_TEXT_MAX_CHARS
    ? `${compact.slice(0, STEP_TEXT_MAX_CHARS)}…`
    : compact;
}

function blocksOf(message: Record<string, unknown>) {
  return Array.isArray(message.content) ? message.content : [];
}

/**
 * 从子代理的消息数组抽出逐轮过程。入参是解析后的 `messages_json`，内容不受信任。
 *
 * 只保留「看得懂」的东西：思考与正文各取一段摘要，工具只留名字与是否出错。工具的
 * 结果正文不进来——那是子代理的内部细节，搬进父会话只会淹掉摘要。
 */
export function extractSubagentRunSteps(messages: unknown): SubagentRunStep[] {
  if (!Array.isArray(messages)) return [];
  const steps: SubagentRunStep[] = [];
  const errorByCallId = new Set<string>();

  // 先收结果侧的错误标记，再回填到对应的 step，避免依赖消息顺序。
  for (const message of messages) {
    if (!isRecordLike(message) || message.role !== "toolResult") continue;
    if (message.isError !== true) continue;
    const callId = typeof message.toolCallId === "string" ? message.toolCallId : "";
    if (callId) errorByCallId.add(callId);
  }

  for (const message of messages) {
    if (!isRecordLike(message) || message.role !== "assistant") continue;
    if (steps.length >= MAX_STEPS) break;
    const thinking: string[] = [];
    const text: string[] = [];
    const tools: SubagentRunStepTool[] = [];
    for (const block of blocksOf(message)) {
      if (!isRecordLike(block)) continue;
      if (block.type === "thinking" && typeof block.thinking === "string") {
        thinking.push(block.thinking);
        continue;
      }
      if (block.type === "text" && typeof block.text === "string") {
        text.push(block.text);
        continue;
      }
      if (block.type === "toolCall") {
        const name = typeof block.name === "string" ? block.name.trim() : "";
        if (!name) continue;
        const callId = typeof block.id === "string" ? block.id : "";
        tools.push({
          id: callId !== "" ? callId : `step-${steps.length + 1}-tool-${tools.length + 1}`,
          name,
          isError: callId !== "" && errorByCallId.has(callId),
        });
      }
    }
    const step: SubagentRunStep = {
      step: steps.length + 1,
      thinking: summarize(thinking.join("\n")),
      text: summarize(text.join("\n")),
      tools,
    };
    if (!step.thinking && !step.text && step.tools.length === 0) continue;
    steps.push(step);
  }

  return steps;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 运行态摘要（`SubagentRunSummary` 的结构子集）里的过程元信息。 */
export type SubagentRunDetailMeta = {
  status?: string;
  rounds?: number;
  toolCalls?: number;
};

export function buildSubagentRunDetail(
  messages: unknown,
  meta: SubagentRunDetailMeta = {},
): SubagentRunDetail {
  return {
    status: meta.status,
    rounds: meta.rounds,
    toolCalls: meta.toolCalls,
    steps: extractSubagentRunSteps(messages),
  };
}

export { record as subagentRunRecord };
