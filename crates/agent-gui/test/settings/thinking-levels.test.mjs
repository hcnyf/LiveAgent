import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// thinkingLevels / defaultThinkingLevel（模型思考档位勾选与默认档）的反漂移锁：
// 1. normalizer 的过滤/去重/规范顺序契约（off → minimal → … → max）；
// 2. 旧存档零迁移（字段缺失时不得被凭空补齐）；
// 3. 默认档必须属于勾选集合，否则丢弃；
// 4. 表单读写助手（勾选/取消/默认档）与"目录未声明支持"偏差标注的取值规则。
const loader = createTsModuleLoader();
const {
  normalizeProviderModelConfig,
  normalizeProviderModelConfigs,
  normalizeThinkingLevels,
  REASONING_LEVEL_CHOICES,
} = loader.loadModule("src/lib/settings/index.ts");
// providerUtils 依赖 tauri invoke；这里只调用纯函数，mock 仅为满足模块加载。
const providerUtilsLoader = createTsModuleLoader({
  mocks: { "@tauri-apps/api/core": { invoke: async () => ({}) } },
});
const {
  applyModelDefaultThinkingLevel,
  applyModelThinkingLevelToggle,
  getModelThinkingLevelsSelection,
  hasModelThinkingLevelsOverride,
  resolveUnsupportedThinkingLevels,
} = providerUtilsLoader.loadModule("@liveagent/ui/pages/settings/providerUtils.ts");

const BASE_MODEL = { id: "k3", contextWindow: 258000, maxOutputToken: 32000 };

test("normalizeThinkingLevels rejects non-arrays and empty/fully-invalid arrays", () => {
  assert.equal(normalizeThinkingLevels(undefined), undefined);
  assert.equal(normalizeThinkingLevels(null), undefined);
  assert.equal(normalizeThinkingLevels("high"), undefined);
  assert.equal(normalizeThinkingLevels([]), undefined);
  assert.equal(normalizeThinkingLevels(["ultra"]), undefined);
  assert.equal(normalizeThinkingLevels([" high "]), undefined);
});

test("normalizeThinkingLevels filters, dedupes, and emits canonical order", () => {
  assert.deepEqual(normalizeThinkingLevels(["high", "off", "bogus", "high"]), ["off", "high"]);
  assert.deepEqual(normalizeThinkingLevels(["max", "minimal"]), ["minimal", "max"]);
  assert.deepEqual(normalizeThinkingLevels([...REASONING_LEVEL_CHOICES].reverse()), [
    ...REASONING_LEVEL_CHOICES,
  ]);
  // 规范顺序全集：off 在首位（与设置页勾选行、默认档下拉同序）。
  assert.deepEqual(REASONING_LEVEL_CHOICES, [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
});

test("legacy model archives keep zero extra fields", () => {
  const legacy = normalizeProviderModelConfig({ ...BASE_MODEL }, "codex");
  assert.equal("thinkingLevels" in legacy, false);
  assert.equal("defaultThinkingLevel" in legacy, false);
  assert.deepEqual(normalizeProviderModelConfigs([{ ...BASE_MODEL }], "codex")[0], {
    id: "k3",
    contextWindow: 258000,
    maxOutputToken: 32000,
    limitsSource: "user",
  });
});

test("normalizer keeps a coherent thinking pair and drops a stray default level", () => {
  const roundTrip = normalizeProviderModelConfig(
    {
      ...BASE_MODEL,
      thinkingLevels: ["medium", "off", "medium"],
      defaultThinkingLevel: "medium",
    },
    "codex",
  );
  assert.deepEqual(roundTrip.thinkingLevels, ["off", "medium"]);
  assert.equal(roundTrip.defaultThinkingLevel, "medium");

  // 默认档不属于勾选集合 → 丢弃默认档，勾选集合照旧。
  const strayDefault = normalizeProviderModelConfig(
    { ...BASE_MODEL, thinkingLevels: ["low"], defaultThinkingLevel: "max" },
    "codex",
  );
  assert.deepEqual(strayDefault.thinkingLevels, ["low"]);
  assert.equal("defaultThinkingLevel" in strayDefault, false);

  // 勾选集合非法/缺失时，默认档无处安放，一并丢弃。
  const orphanDefault = normalizeProviderModelConfig(
    { ...BASE_MODEL, thinkingLevels: "max", defaultThinkingLevel: "max" },
    "codex",
  );
  assert.equal("thinkingLevels" in orphanDefault, false);
  assert.equal("defaultThinkingLevel" in orphanDefault, false);
});

test("model thinking selection falls back to the initial trio without writing it", () => {
  assert.equal(hasModelThinkingLevelsOverride(BASE_MODEL), false);
  assert.deepEqual(getModelThinkingLevelsSelection(BASE_MODEL), ["low", "high", "max"]);
  const stored = { ...BASE_MODEL, thinkingLevels: ["off", "low"] };
  assert.equal(hasModelThinkingLevelsOverride(stored), true);
  assert.deepEqual(getModelThinkingLevelsSelection(stored), ["off", "low"]);
});

test("toggling a thinking level materializes the pair and clears it when emptied", () => {
  // 从"未自定义"直接勾选 off：初始 trio + off，按规范顺序。
  const withOff = applyModelThinkingLevelToggle(BASE_MODEL, "off", true);
  assert.deepEqual(withOff.thinkingLevels, ["off", "low", "high", "max"]);

  // 取消掉最后一档 → 清空自定义（两个字段一起删除，回到按目录推断）。
  let emptied = { ...BASE_MODEL, thinkingLevels: ["low"], defaultThinkingLevel: "low" };
  emptied = applyModelThinkingLevelToggle(emptied, "low", false);
  assert.equal("thinkingLevels" in emptied, false);
  assert.equal("defaultThinkingLevel" in emptied, false);

  // 默认档被取消勾选时一并清掉，其余保留。
  const droppedDefault = applyModelThinkingLevelToggle(
    { ...BASE_MODEL, thinkingLevels: ["low", "high"], defaultThinkingLevel: "high" },
    "high",
    false,
  );
  assert.deepEqual(droppedDefault.thinkingLevels, ["low"]);
  assert.equal("defaultThinkingLevel" in droppedDefault, false);

  // 默认档仍在集合内则保留。
  const keptDefault = applyModelThinkingLevelToggle(
    { ...BASE_MODEL, thinkingLevels: ["low", "high"], defaultThinkingLevel: "high" },
    "max",
    true,
  );
  assert.deepEqual(keptDefault.thinkingLevels, ["low", "high", "max"]);
  assert.equal(keptDefault.defaultThinkingLevel, "high");
});

test("setting the default level merges it into the checked set", () => {
  const fromUnset = applyModelDefaultThinkingLevel(BASE_MODEL, "minimal");
  assert.deepEqual(fromUnset.thinkingLevels, ["minimal", "low", "high", "max"]);
  assert.equal(fromUnset.defaultThinkingLevel, "minimal");

  const alreadyChecked = applyModelDefaultThinkingLevel(
    { ...BASE_MODEL, thinkingLevels: ["low", "high"] },
    "high",
  );
  assert.deepEqual(alreadyChecked.thinkingLevels, ["low", "high"]);
  assert.equal(alreadyChecked.defaultThinkingLevel, "high");
});

test("unsupported thinking levels come only from an authoritative catalog verdict", () => {
  // 目录命中且声明了档位：未声明的档给出提示，off 可用时不提示。
  assert.deepEqual(resolveUnsupportedThinkingLevels("deepseek", "deepseek-v4-pro"), [
    "minimal",
    "medium",
    "xhigh",
  ]);
  // xAI 的 off 在 wire 上无法表达（目录 off:false + 供应商级 alwaysOn）→ 提示。
  assert.deepEqual(resolveUnsupportedThinkingLevels("xai", "grok-4.5"), [
    "off",
    "minimal",
    "xhigh",
    "max",
  ]);
  // 目录明确判非推理模型：七档全部提示，但不阻断。
  assert.deepEqual(resolveUnsupportedThinkingLevels("xai", "grok-4.20-0309-non-reasoning"), [
    ...REASONING_LEVEL_CHOICES,
  ]);
  // 自定义/未收录模型：目录判不出，方向单一，一律不给提示。
  assert.deepEqual(resolveUnsupportedThinkingLevels("claude_code", "totally-unknown-relay-model"), []);
});
