import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const {
  WORK_TRACE_VISIBLE_ENTRY_LIMIT,
  countWorkEntries,
  resolveAssistantTurnLayout,
  segmentWorkEntries,
} = loader.loadModule("@liveagent/ui/components/chat/assistant-bubble/assistantBubbleUtils.ts");

function thinkingBlock(id) {
  return { kind: "thinking", id, text: `思考 ${id}` };
}

function toolBlock(id) {
  return {
    kind: "tool",
    item: {
      toolCall: { type: "toolCall", id, name: "Read", arguments: { path: "a.ts" } },
      toolResult: { role: "toolResult", toolCallId: id, isError: false, content: [] },
    },
  };
}

function textBlock(id, text) {
  return { kind: "text", id, text };
}

/** 「两次输出之间反复思考 + 调工具」：交替的思考/工具块。 */
function alternating(count, prefix = "") {
  return Array.from({ length: count }, (_, index) =>
    index % 2 === 0 ? thinkingBlock(`${prefix}t${index}`) : toolBlock(`${prefix}c${index}`),
  );
}

function processSegment(blocks) {
  const rounds = [{ round: 1, key: "r1", blocks, runningToolCallIds: [], thinkingOpen: false }];
  const layout = resolveAssistantTurnLayout(rounds, { live: true });
  return segmentWorkEntries(layout.work).find((segment) => segment.kind === "process");
}

test("a long process segment lays out only its most recent entries", () => {
  const process = processSegment([textBlock("p1", "先看一眼"), ...alternating(20)]);
  assert.ok(process, "两次输出之间的长过程应收成概括条");
  assert.equal(process.entries.length, 20);
  assert.equal(process.visibleEntries.length, WORK_TRACE_VISIBLE_ENTRY_LIMIT);
  assert.equal(process.hiddenEntries.length, 20 - WORK_TRACE_VISIBLE_ENTRY_LIMIT);

  // 隐藏的是前缀、可见的是连续后缀，拼起来仍是原顺序——渲染不会乱序。
  assert.deepEqual(
    [...process.hiddenEntries, ...process.visibleEntries].map((entry) => entry.key),
    process.entries.map((entry) => entry.key),
  );

  // 段的最后一条（当前正在进行的那一条）永远在可见后缀里。
  assert.equal(process.visibleEntries.at(-1).key, process.entries.at(-1).key);

  // 文案口径不变：计数仍按整段全量算，窗口化不会让「N 次工具调用」少算。
  assert.equal(countWorkEntries(process.entries).tools, 10);
  assert.equal(countWorkEntries(process.visibleEntries).tools, 3);
});

test("a short process segment keeps every entry visible", () => {
  const process = processSegment([textBlock("p1", "先看一眼"), ...alternating(4)]);
  assert.ok(process);
  assert.equal(process.entries.length, 4);
  assert.deepEqual(process.hiddenEntries, []);
  assert.equal(process.visibleEntries.length, 4);
});

test("the window counts entries, not the tool calls inside a batch", () => {
  const process = processSegment([
    thinkingBlock("t0"),
    ...Array.from({ length: 8 }, (_, index) => toolBlock(`c${index}`)),
  ]);
  assert.ok(process);
  // 8 条连续调用合成一个 toolGroup 行：按行算只占 1 条，窗口不该切它。
  assert.deepEqual(
    process.entries.map((entry) => entry.block.kind),
    ["thinking", "toolGroup"],
  );
  assert.equal(countWorkEntries(process.entries).tools, 8);
  assert.deepEqual(process.hiddenEntries, []);
});

test("every process segment is windowed independently", () => {
  const rounds = [
    {
      round: 1,
      key: "r1",
      blocks: [...alternating(8), textBlock("p1", "第一段结束"), ...alternating(9, "b")],
      runningToolCallIds: [],
      thinkingOpen: false,
    },
  ];
  const layout = resolveAssistantTurnLayout(rounds, { live: true });
  const processes = segmentWorkEntries(layout.work).filter(
    (segment) => segment.kind === "process",
  );
  assert.equal(processes.length, 2);
  assert.deepEqual(
    processes.map((segment) => [segment.entries.length, segment.visibleEntries.length]),
    [
      [8, WORK_TRACE_VISIBLE_ENTRY_LIMIT],
      [9, WORK_TRACE_VISIBLE_ENTRY_LIMIT],
    ],
  );
});
