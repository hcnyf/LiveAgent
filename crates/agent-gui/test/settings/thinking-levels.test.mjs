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
const {
  getChatRuntimeReasoningLevelsForProvider,
  normalizeChatRuntimeControlsForProvider,
  resolveConfiguredDefaultThinkingLevel,
  resolveConfiguredThinkingAlwaysOn,
  resolveConfiguredThinkingLevels,
  resolveEffectiveDefaultThinkingLevel,
} = loader.loadModule("src/lib/settings/index.ts");

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
  // 从"未自定义"直接勾选 off：初始 trio + off，按规范顺序；默认档落到最高档。
  const withOff = applyModelThinkingLevelToggle(BASE_MODEL, "off", true);
  assert.deepEqual(withOff.thinkingLevels, ["off", "low", "high", "max"]);
  assert.equal(withOff.defaultThinkingLevel, "max");

  // 取消掉最后一档 → 清空自定义（两个字段一起删除，回到按目录推断）。
  let emptied = { ...BASE_MODEL, thinkingLevels: ["low"], defaultThinkingLevel: "low" };
  emptied = applyModelThinkingLevelToggle(emptied, "low", false);
  assert.equal("thinkingLevels" in emptied, false);
  assert.equal("defaultThinkingLevel" in emptied, false);

  // 默认档被取消勾选时不给空档：落到"已勾选的最高档"（规范顺序末位）。
  const droppedDefault = applyModelThinkingLevelToggle(
    { ...BASE_MODEL, thinkingLevels: ["low", "high"], defaultThinkingLevel: "high" },
    "high",
    false,
  );
  assert.deepEqual(droppedDefault.thinkingLevels, ["low"]);
  assert.equal(droppedDefault.defaultThinkingLevel, "low");

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

// ---------------------------------------------------------------------------
// T4.1：档位解析链的覆盖参数（有勾选用勾选，无勾选回落目录）
// ---------------------------------------------------------------------------

const DEEPSEEK_PROVIDER = {
  type: "deepseek",
  requestFormat: undefined,
  models: [
    { id: "deepseek-v4-pro", thinkingLevels: ["low", "high", "max"] },
    { id: "deepseek-v4-flash", thinkingLevels: ["off", "low"] },
  ],
};

test("resolveConfiguredThinkingLevels prefers the declared levels and falls back to the catalog", () => {
  // 有勾选：勾选集合胜出（含 off 这类目录不会给出的档）。
  assert.deepEqual(
    resolveConfiguredThinkingLevels(DEEPSEEK_PROVIDER, "deepseek-v4-flash"),
    ["off", "low"],
  );
  // 有实例但该模型没有勾选：回落目录。
  assert.deepEqual(
    resolveConfiguredThinkingLevels({ type: "deepseek", models: [{ id: "deepseek-v4-pro" }] }, "deepseek-v4-pro"),
    ["low", "high", "max"],
  );
  // 模型列表为空 / 没有 models 字段（WebUI 的窄视图类型）：同样回落目录，不抛错。
  assert.deepEqual(
    resolveConfiguredThinkingLevels({ type: "deepseek", models: [] }, "deepseek-v4-pro"),
    ["low", "high", "max"],
  );
  assert.deepEqual(resolveConfiguredThinkingLevels({ type: "deepseek" }, "deepseek-v4-pro"), [
    "low",
    "high",
    "max",
  ]);
  // 目录未收录的 id：走兜底推断（不是把别处的勾选漏过来）。
  assert.deepEqual(resolveConfiguredThinkingLevels(DEEPSEEK_PROVIDER, "unknown-model"), [
    "minimal",
    "low",
    "medium",
    "high",
  ]);
});

test("getChatRuntimeReasoningLevelsForProvider honors the optional provider instance", () => {
  // 不传实例：维持旧口径（纯目录），既有调用方零改动。
  assert.deepEqual(
    getChatRuntimeReasoningLevelsForProvider({ providerId: "deepseek", modelId: "deepseek-v4-flash" }),
    ["low", "high", "max"],
  );
  // 传实例：该模型的勾选胜出。
  assert.deepEqual(
    getChatRuntimeReasoningLevelsForProvider({
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      provider: DEEPSEEK_PROVIDER,
    }),
    ["off", "low"],
  );
});

test("the declared levels also clamp the selected level at read time", () => {
  const stored = { reasoningByModel: { deepseek: { "deepseek-v4-flash": "high" } } };
  // 未接实例（目录三档）：high 在表内，原样保留。
  assert.equal(
    normalizeChatRuntimeControlsForProvider(stored, {
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
    }).reasoning,
    "high",
  );
  // 接实例（勾选只有 off/low）：high 被钳到勾选集合内的 low。
  assert.equal(
    normalizeChatRuntimeControlsForProvider(stored, {
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      provider: DEEPSEEK_PROVIDER,
    }).reasoning,
    "low",
  );
});

// ---------------------------------------------------------------------------
// T4.2：defaultThinkingLevel 接入解析链（模型桶 → 默认档 → 供应商桶 → 全局）
// ---------------------------------------------------------------------------

const DEEPSEEK_PROVIDER_WITH_DEFAULT = {
  type: "deepseek",
  models: [
    {
      id: "deepseek-v4-pro",
      thinkingLevels: ["low", "high", "max"],
      defaultThinkingLevel: "low",
    },
    // 默认档不在勾选集合内（非法组合）：读侧按"没有默认档"处理。
    { id: "deepseek-v4-flash", thinkingLevels: ["low"], defaultThinkingLevel: "max" },
  ],
};

test("resolveConfiguredDefaultThinkingLevel only accepts a default inside the declared levels", () => {
  assert.equal(
    resolveConfiguredDefaultThinkingLevel(DEEPSEEK_PROVIDER_WITH_DEFAULT, "deepseek-v4-pro"),
    "low",
  );
  assert.equal(
    resolveConfiguredDefaultThinkingLevel(DEEPSEEK_PROVIDER_WITH_DEFAULT, "deepseek-v4-flash"),
    undefined,
  );
  assert.equal(resolveConfiguredDefaultThinkingLevel({ type: "deepseek" }, "deepseek-v4-pro"), undefined);
});

test("resolveEffectiveDefaultThinkingLevel falls back to the highest checked level", () => {
  // 手动指定过默认档：用它。
  assert.equal(
    resolveEffectiveDefaultThinkingLevel(DEEPSEEK_PROVIDER_WITH_DEFAULT, "deepseek-v4-pro"),
    "low",
  );
  // 默认档非法（不在勾选内）：取勾选集合的最高档。
  assert.equal(
    resolveEffectiveDefaultThinkingLevel(DEEPSEEK_PROVIDER_WITH_DEFAULT, "deepseek-v4-flash"),
    "low",
  );
  // 未指定默认档但有勾选：取最高档（规范顺序末位）。
  assert.equal(resolveEffectiveDefaultThinkingLevel(DEEPSEEK_PROVIDER, "deepseek-v4-flash"), "low");
  assert.equal(
    resolveEffectiveDefaultThinkingLevel(
      { type: "deepseek", models: [{ id: "deepseek-v4-pro", thinkingLevels: ["off", "high"] }] },
      "deepseek-v4-pro",
    ),
    "high",
  );
  // 完全没声明（按目录推断）：不给默认档，交由运行时回落。
  assert.equal(resolveEffectiveDefaultThinkingLevel({ type: "deepseek" }, "deepseek-v4-pro"), undefined);
  assert.equal(resolveEffectiveDefaultThinkingLevel(undefined, "deepseek-v4-pro"), undefined);
});

test("the default level sits between the model bucket and the provider bucket", () => {
  const stored = { reasoning: "high", reasoningByProvider: { deepseek: "max" } };
  const params = {
    providerId: "deepseek",
    modelId: "deepseek-v4-pro",
    provider: DEEPSEEK_PROVIDER_WITH_DEFAULT,
  };
  // 未单独选过档位：落到该模型的默认档（而不是供应商桶里的 max）。
  assert.equal(normalizeChatRuntimeControlsForProvider(stored, params).reasoning, "low");
  // 没有默认档时维持旧口径：供应商桶胜出。
  assert.equal(
    normalizeChatRuntimeControlsForProvider(stored, {
      ...params,
      provider: {
        type: "deepseek",
        models: [{ id: "deepseek-v4-pro", thinkingLevels: ["low", "high", "max"] }],
      },
    }).reasoning,
    "max",
  );
  // 模型桶永远最优先（会话里显式选过就听会话的）。
  assert.equal(
    normalizeChatRuntimeControlsForProvider(
      { ...stored, reasoningByModel: { deepseek: { "deepseek-v4-pro": "high" } } },
      params,
    ).reasoning,
    "high",
  );
});

// ---------------------------------------------------------------------------
// T4.3：off 是否可选由勾选决定（有勾选时不再听目录的 alwaysOn）
// ---------------------------------------------------------------------------

test("resolveConfiguredThinkingAlwaysOn follows the declaration, then the catalog", () => {
  // 勾选里含 off → 可关闭。
  assert.equal(
    resolveConfiguredThinkingAlwaysOn("deepseek", DEEPSEEK_PROVIDER, "deepseek-v4-flash"),
    false,
  );
  // 勾选里没有 off → 不可关闭（即使目录说可关）。
  assert.equal(
    resolveConfiguredThinkingAlwaysOn("deepseek", DEEPSEEK_PROVIDER, "deepseek-v4-pro"),
    true,
  );
  // 未自定义 → 目录：xai 恒开、deepseek flash 可关。
  assert.equal(resolveConfiguredThinkingAlwaysOn("xai", undefined, "grok-4.5"), true);
  assert.equal(resolveConfiguredThinkingAlwaysOn("deepseek", undefined, "deepseek-v4-flash"), false);
  assert.equal(resolveConfiguredThinkingAlwaysOn(undefined, { type: "xai" }, "grok-4.5"), true);
});
