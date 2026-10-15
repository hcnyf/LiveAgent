import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const {
  attachSubagentLiveRuns,
  collectLiveSubagentCards,
  collectPersistedSubagentCards,
  collectSubagentLiveRuns,
  mergeSubagentCards,
  subagentCardRunKey,
} = loader.loadModule("src/lib/subagents/progressCards.ts");

function card(index, total, extra = {}) {
  return {
    type: "toolCall",
    id: `call-1:agent:${index}`,
    name: "Agent",
    arguments: {
      subagent_card: true,
      parent_tool_call_id: "call-1",
      index,
      total,
      id: `agent-${index}`,
      name: `子代理${index}`,
      prompt: `任务${index}`,
      ...extra,
    },
  };
}

function toolBlock(toolCall, details) {
  return {
    kind: "tool",
    item: details
      ? { toolCall, toolResult: { role: "toolResult", details, isError: false } }
      : { toolCall },
  };
}

test("persisted cards come only from assistant rounds' subagent cards", () => {
  const items = [
    { kind: "user", text: "hi" },
    {
      kind: "assistant",
      rounds: [
        { blocks: [toolBlock({ type: "toolCall", id: "bash-1", name: "Bash", arguments: {} })] },
        {
          blocks: [
            toolBlock(card(1, 2), { kind: "subagent_card", index: 0, total: 2, agent: {} }),
            toolBlock(card(2, 2)),
          ],
        },
      ],
    },
    { kind: "summary", content: "..." },
  ];

  const cards = collectPersistedSubagentCards(items);
  assert.deepEqual(
    cards.map((item) => [item.id, item.running, item.details !== undefined]),
    [
      ["call-1:agent:1", false, true],
      ["call-1:agent:2", false, false],
    ],
  );
});

test("live cards take their running state from the round's runningToolCallIds", () => {
  const rounds = [
    {
      blocks: [toolBlock(card(1, 2)), toolBlock(card(2, 2))],
      runningToolCallIds: ["call-1:agent:1"],
    },
  ];

  const cards = collectLiveSubagentCards(rounds, [rounds[0].runningToolCallIds]);
  assert.deepEqual(
    cards.map((item) => [item.id, item.running]),
    [
      ["call-1:agent:1", true],
      ["call-1:agent:2", false],
    ],
  );
});

test("a card that landed in history keeps the live running state and its position", () => {
  const settled = [
    { id: "call-1:agent:1", running: false, details: undefined },
    { id: "call-1:agent:2", running: false, details: undefined },
  ];
  const live = [
    // 同一张卡片：live 版本带运行态，必须覆盖历史版本。
    { id: "call-1:agent:2", running: true, details: undefined },
    { id: "call-1:agent:3", running: true, details: undefined },
  ];

  assert.deepEqual(
    mergeSubagentCards(settled, live).map((item) => [item.id, item.running]),
    [
      ["call-1:agent:1", false],
      ["call-1:agent:2", true],
      ["call-1:agent:3", true],
    ],
  );
});

test("a card joins the persisted run snapshot by parent call plus one-based index", () => {
  // store 的 agentIndex 是 0 基，卡片 arguments 的 index 是 1 基。
  assert.equal(subagentCardRunKey({ parent_tool_call_id: "call-1", index: 2 }), "call-1#1");
  assert.equal(subagentCardRunKey({ parent_tool_call_id: "call-1" }), undefined);
  assert.equal(subagentCardRunKey(undefined), undefined);

  const runs = collectSubagentLiveRuns([
    {
      parentToolCallId: "call-1",
      agentIndex: 1,
      status: "running",
      startedAt: 1_700_000_000_000,
      roundCount: 3,
      toolCallCount: 9,
    },
  ]);
  assert.deepEqual(runs.get("call-1#1"), {
    status: "running",
    startedAtMs: 1_700_000_000_000,
    rounds: 3,
    toolCalls: 9,
  });

  const [withRun, withoutRun] = attachSubagentLiveRuns(
    [
      { id: "call-1:agent:2", arguments: { parent_tool_call_id: "call-1", index: 2 }, running: true },
      { id: "call-2:agent:1", arguments: { parent_tool_call_id: "call-2", index: 1 }, running: true },
    ],
    runs,
  );
  assert.equal(withRun.run?.rounds, 3);
  assert.equal(withoutRun.run, undefined);
});

test("attaching no runs keeps the card array identity", () => {
  const cards = [
    { id: "call-1:agent:1", arguments: { parent_tool_call_id: "call-1", index: 1 }, running: false },
  ];
  assert.equal(attachSubagentLiveRuns(cards, new Map()), cards);
});