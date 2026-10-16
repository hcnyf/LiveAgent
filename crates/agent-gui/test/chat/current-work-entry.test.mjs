import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { resolveActiveWorkTailKeys, resolveCurrentWorkEntryKey } = loader.loadModule(
  "@liveagent/ui/components/chat/assistant-bubble/assistantBubbleUtils.ts",
);

function entry(key, kind = "tool") {
  return { key, block: { kind, key } };
}

test("the tail is the trailing run of non-output entries", () => {
  const entries = [
    entry("t1", "thinking"),
    entry("x1", "text"),
    entry("t2", "thinking"),
    entry("g1", "toolGroup"),
    entry("s1", "hostedSearchGroup"),
  ];
  assert.deepEqual([...resolveActiveWorkTailKeys(entries)].sort(), ["g1", "s1", "t2"]);
  // 尾部为空（模型刚输出过正文）时没有「当前那一步」。
  assert.equal(resolveCurrentWorkEntryKey(entries, new Set()), null);
});

test("only the newest tail entry counts as the current step", () => {
  const entries = [entry("x1", "text"), entry("g1", "toolGroup"), entry("s1", "hostedSearchGroup")];
  const tail = resolveActiveWorkTailKeys(entries);
  // 展开的只有最后一条：更早那批工具跟着塌掉，正跑着的那一步才占着屏幕。
  assert.equal(resolveCurrentWorkEntryKey(entries, tail), "s1");

  const onlyGroup = [entry("g1", "toolGroup")];
  assert.equal(resolveCurrentWorkEntryKey(onlyGroup, resolveActiveWorkTailKeys(onlyGroup)), "g1");
});

test("a text entry ending the tail leaves no current step", () => {
  // resolveActiveWorkTailKeys 遇正文即停，所以这里尾巴就是空的。
  const entries = [entry("g1", "toolGroup"), entry("x2", "text")];
  assert.equal(resolveCurrentWorkEntryKey(entries, resolveActiveWorkTailKeys(entries)), null);
});
