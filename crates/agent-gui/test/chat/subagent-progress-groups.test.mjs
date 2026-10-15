import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { buildSubagentProgressGroups, isSubagentProgressCard, subagentParentId } = loader.loadModule(
  "@liveagent/ui/lib/subagents/progressGroups.ts",
);

function cardArgs(id, name, prompt) {
  return { subagent_card: true, id, name, prompt };
}

function cardDetails(index, total, agent) {
  return { kind: "subagent_card", index, total, agent };
}

test("cards fanned out from one Agent call group by their id prefix", () => {
  assert.equal(subagentParentId("call-1:agent:0"), "call-1");
  assert.equal(subagentParentId("call-1:agent:12"), "call-1");
  // 认不出形状时原样返回，不会把卡片错并到别的调用下。
  assert.equal(subagentParentId("plain-id"), "plain-id");

  const groups = buildSubagentProgressGroups([
    { id: "call-1:agent:0", arguments: cardArgs("a", "甲", "任务甲"), running: true },
    { id: "call-1:agent:1", arguments: cardArgs("b", "乙", "任务乙"), running: true },
    { id: "call-2:agent:0", arguments: cardArgs("c", "丙", "任务丙"), running: true },
  ]);

  assert.deepEqual(
    groups.map((group) => [group.id, group.entries.length]),
    [
      ["call-1", 2],
      ["call-2", 1],
    ],
  );
  assert.deepEqual(
    groups[0].entries.map((entry) => entry.name),
    ["甲", "乙"],
  );
});

test("a running card reports only what the toolCall arguments carry", () => {
  const [group] = buildSubagentProgressGroups([
    {
      id: "call-1:agent:0",
      arguments: cardArgs("a", "调研员", "查清 X"),
      running: true,
      startedAtMs: 1_700_000_000_000,
    },
  ]);

  const entry = group.entries[0];
  assert.equal(entry.name, "调研员");
  assert.equal(entry.task, "查清 X");
  assert.equal(entry.status, "running");
  assert.equal(entry.running, true);
  assert.equal(entry.startedAtMs, 1_700_000_000_000);
  // 结果还没回来：轮数/调用数/耗时都拿不到，界面据此不显示（而不是显示 0）。
  assert.equal(entry.rounds, undefined);
  assert.equal(entry.toolCalls, undefined);
  assert.equal(entry.durationMs, undefined);
});

test("a finished card reads status, rounds and tool calls from the result", () => {
  const [group] = buildSubagentProgressGroups([
    {
      id: "call-1:agent:0",
      arguments: cardArgs("a", "调研员", "查清 X"),
      details: cardDetails(1, 3, {
        name: "调研员",
        role: "研究",
        prompt: "查清 X",
        status: "completed",
        durationMs: 83_000,
        rounds: 4,
        toolCalls: 12,
      }),
      running: false,
    },
  ]);

  const entry = group.entries[0];
  assert.equal(entry.status, "completed");
  assert.equal(entry.role, "研究");
  assert.equal(entry.durationMs, 83_000);
  assert.equal(entry.rounds, 4);
  assert.equal(entry.toolCalls, 12);
  assert.equal(entry.index, 1);
  assert.equal(entry.total, 3);
});

test("the parent node label is optional and never falls back to the internal call id", () => {
  const [labelled] = buildSubagentProgressGroups([
    {
      id: "call-1:agent:0",
      arguments: cardArgs("a", "甲", "任务甲"),
      running: false,
      parentLabel: "查清滚动锚定",
    },
  ]);
  assert.equal(labelled.label, "查清滚动锚定");

  const [unlabelled] = buildSubagentProgressGroups([
    { id: "call-2:agent:0", arguments: cardArgs("b", "乙", "任务乙"), running: false },
  ]);
  // 父 `Agent` 调用本身在会话里被折叠掉了，宿主拿不到它的一句话描述；这时留空，
  // 由渲染方决定退回文案，绝不能把 `call-2` 这种内部 id 当标题显示。
  assert.equal(unlabelled.label, undefined);
  assert.equal(unlabelled.id, "call-2");
});

test("a running card falls back to the persisted run snapshot for its live numbers", () => {
  const [group] = buildSubagentProgressGroups([
    {
      id: "call-1:agent:0",
      arguments: cardArgs("a", "调研员", "查清 X"),
      running: true,
      run: { status: "running", startedAtMs: 1_700_000_000_000, rounds: 3, toolCalls: 9 },
    },
  ]);

  const entry = group.entries[0];
  assert.equal(entry.status, "running");
  assert.equal(entry.startedAtMs, 1_700_000_000_000);
  assert.equal(entry.rounds, 3);
  assert.equal(entry.toolCalls, 9);
  // 终态耗时只在结果里，快照没有这一项，所以运行中仍然不显示耗时读数。
  assert.equal(entry.durationMs, undefined);
});

test("the final report wins over the live run snapshot once the card settles", () => {
  const [group] = buildSubagentProgressGroups([
    {
      id: "call-1:agent:0",
      arguments: cardArgs("a", "调研员", "查清 X"),
      details: cardDetails(1, 1, {
        name: "调研员",
        prompt: "查清 X",
        status: "completed",
        durationMs: 83_000,
        rounds: 4,
        toolCalls: 12,
      }),
      running: false,
      run: { status: "running", startedAtMs: 1_700_000_000_000, rounds: 3, toolCalls: 9 },
    },
  ]);

  const entry = group.entries[0];
  assert.equal(entry.status, "completed");
  assert.equal(entry.durationMs, 83_000);
  assert.equal(entry.rounds, 4);
  assert.equal(entry.toolCalls, 12);
});

test("only Agent tool calls carrying the card marker count as subagent cards", () => {
  assert.equal(isSubagentProgressCard({ name: "Agent", arguments: { subagent_card: true } }), true);
  assert.equal(isSubagentProgressCard({ name: "Agent", arguments: {} }), false);
  assert.equal(
    isSubagentProgressCard({ name: "Read", arguments: { subagent_card: true } }),
    false,
  );
});
