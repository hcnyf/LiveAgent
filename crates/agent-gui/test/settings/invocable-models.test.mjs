import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { invocableModelKey, listInvocableModels, pickInvocableModel, pickInvocableModelOrCurrent } =
  loader.loadModule("@liveagent/ui/lib/models/invocableModels.ts");

function provider(overrides = {}) {
  return {
    id: "p1",
    type: "codex",
    models: [
      { id: "a", allowModelInvocation: true },
      { id: "b" },
      { id: "c", allowModelInvocation: true },
    ],
    activeModels: ["a", "b", "c"],
    ...overrides,
  };
}

test("only enabled models that opted in are invocable", () => {
  const listed = listInvocableModels({ customProviders: [provider()] });
  assert.deepEqual(
    listed.map((item) => item.model),
    ["a", "c"],
  );
  assert.deepEqual(listed[0], { customProviderId: "p1", model: "a", providerType: "codex" });

  // 勾了「允许调用」但没启用 → 不进候选（不该被后台任务选中）。
  assert.deepEqual(
    listInvocableModels({
      customProviders: [provider({ activeModels: ["b"] })],
    }),
    [],
  );
});

test("picking skips already tried models and wraps around", () => {
  const settings = { customProviders: [provider()] };
  assert.equal(pickInvocableModel(settings)?.model, "a");
  assert.equal(pickInvocableModel(settings, { offset: 1 })?.model, "c");
  // 试过 a 之后轮到 c；两个都试过 = 没有候选（调用方回落到会话模型）。
  assert.equal(pickInvocableModel(settings, { exclude: new Set(["p1::a"]) })?.model, "c");
  assert.equal(
    pickInvocableModel(settings, { exclude: new Set(["p1::a", "p1::c"]) }),
    undefined,
  );
});

test("no candidate falls back to the current conversation model", () => {
  const current = { customProviderId: "session", model: "m", providerType: "codex" };
  assert.deepEqual(pickInvocableModelOrCurrent({ customProviders: [] }, current), current);
  const picked = pickInvocableModelOrCurrent({ customProviders: [provider()] }, current);
  assert.equal(picked.model, "a");
  assert.equal(invocableModelKey(picked), "p1::a");
});
