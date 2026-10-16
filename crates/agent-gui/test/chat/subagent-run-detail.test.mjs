import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { extractSubagentRunSteps, buildSubagentRunDetail } = loader.loadModule(
  "@liveagent/ui/lib/subagents/runDetail.ts",
);

test("subagent run steps keep thinking, text and tool names per assistant round", () => {
  const steps = extractSubagentRunSteps([
    { role: "user", content: [{ type: "text", text: "查清 X" }] },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "先看目录\n再看文件" },
        { type: "toolCall", id: "c1", name: "Bash", arguments: { command: "ls" } },
        { type: "toolCall", id: "c2", name: "Read", arguments: { path: "a.ts" } },
      ],
    },
    { role: "toolResult", toolCallId: "c1", isError: false, content: [] },
    { role: "toolResult", toolCallId: "c2", isError: true, content: [] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "看完  了" },
        { type: "toolCall", id: "c3", name: "Edit", arguments: {} },
      ],
    },
  ]);

  assert.equal(steps.length, 2);
  // 思考与正文都压成一行摘要（换行/多空格折叠），工具只留名字与是否出错。
  assert.equal(steps[0].thinking, "先看目录 再看文件");
  assert.deepEqual(
    steps[0].tools.map((tool) => [tool.name, tool.isError]),
    [
      ["Bash", false],
      ["Read", true],
    ],
  );
  assert.equal(steps[1].text, "看完 了");
  assert.deepEqual(steps[1].tools.map((tool) => tool.name), ["Edit"]);
  // 工具 id 稳定且互不相同（渲染 key 用，不能靠数组下标）。
  const ids = steps.flatMap((step) => step.tools.map((tool) => tool.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("garbage input degrades to an empty step list", () => {
  assert.deepEqual(extractSubagentRunSteps(null), []);
  assert.deepEqual(extractSubagentRunSteps("nope"), []);
  assert.deepEqual(extractSubagentRunSteps([{ role: "assistant", content: "bad" }]), []);
  assert.deepEqual(buildSubagentRunDetail(undefined, { rounds: 3 }).steps, []);
  assert.equal(buildSubagentRunDetail(undefined, { rounds: 3 }).rounds, 3);
});
