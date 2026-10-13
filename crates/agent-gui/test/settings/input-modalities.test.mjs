import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// inputModalities（模型输入模态用户声明）的反漂移锁：
// 1. normalizer 的过滤/补齐/规范顺序契约（text → image → pdf）；
// 2. 设置加载往返不丢字段；
// 3. modelFactory 把声明里的 text/image 投影到 model.input（codex/gemini/deepseek
//    分支），anthropic 分支的 model.input 维持保守占位值；声明原文一律另挂在
//    inputModalitiesOverride 上供附件层读（决定 PDF 是否原生内联）。
const loader = createTsModuleLoader();
const { normalizeInputModalities, normalizeProviderModelConfig, normalizeProviderModelConfigs } =
  loader.loadModule("src/lib/settings/index.ts");
const { createModelFromConfig } = loader.loadModule(
  "src/lib/providers/runtime/modelFactory.ts",
);
// providerUtils 依赖 tauri invoke；normalizeFetchedModels 本身不触发网络，
// mock 仅为满足模块加载。
const providerUtilsLoader = createTsModuleLoader({
  mocks: { "@tauri-apps/api/core": { invoke: async () => ({}) } },
});
const {
  applyModelInputModalitiesSelection,
  getModelInputModalitiesSelection,
  hasModelInputModalitiesItem,
  normalizeFetchedModels,
  providerSupportsModelInputModalitiesOverride,
  toggleModelInputModalitiesItem,
} = providerUtilsLoader.loadModule("@liveagent/ui/pages/settings/providerUtils.ts");

test("normalizeInputModalities rejects non-arrays and empty/fully-invalid arrays", () => {
  assert.equal(normalizeInputModalities(undefined), undefined);
  assert.equal(normalizeInputModalities(null), undefined);
  assert.equal(normalizeInputModalities("image"), undefined);
  assert.equal(normalizeInputModalities({ 0: "image" }), undefined);
  assert.equal(normalizeInputModalities([]), undefined);
  assert.equal(normalizeInputModalities(["audio"]), undefined);
  assert.equal(normalizeInputModalities([" image "]), undefined);
});

test("normalizeInputModalities filters mixed arrays and dedupes", () => {
  assert.deepEqual(normalizeInputModalities(["image", 123, "future"]), ["text", "image"]);
  assert.deepEqual(normalizeInputModalities(["image", "image", "text"]), ["text", "image"]);
  assert.deepEqual(normalizeInputModalities(["pdf", "pdf", "audio"]), ["text", "pdf"]);
});

test("normalizeInputModalities auto-adds text and emits canonical order", () => {
  // 聊天协议始终发送文本：image/pdf-only 声明自动补齐 text
  assert.deepEqual(normalizeInputModalities(["image"]), ["text", "image"]);
  assert.deepEqual(normalizeInputModalities(["image", "text"]), ["text", "image"]);
  assert.deepEqual(normalizeInputModalities(["text"]), ["text"]);
  assert.deepEqual(normalizeInputModalities(["pdf"]), ["text", "pdf"]);
  // 规范顺序恒为 text → image → pdf，与输入顺序无关
  assert.deepEqual(normalizeInputModalities(["pdf", "image"]), ["text", "image", "pdf"]);
  assert.deepEqual(normalizeInputModalities(["pdf", "text", "image", "pdf"]), [
    "text",
    "image",
    "pdf",
  ]);
});

test("normalizeProviderModelConfig preserves a valid inputModalities override", () => {
  const normalized = normalizeProviderModelConfig(
    {
      id: "k3",
      contextWindow: 258000,
      maxOutputToken: 32000,
      limitsSource: "user",
      inputModalities: ["text", "image"],
    },
    "codex",
  );
  assert.deepEqual(normalized.inputModalities, ["text", "image"]);

  // 既有两种存档值（["text"] / ["text","image"]）与新增的 pdf 形态同样原样往返：
  // 零迁移。
  for (const stored of [["text"], ["text", "image"], ["text", "pdf"], ["text", "image", "pdf"]]) {
    const viaLoad = normalizeProviderModelConfig(
      { id: "k3", contextWindow: 258000, maxOutputToken: 32000, inputModalities: stored },
      "claude_code",
    );
    assert.deepEqual(viaLoad.inputModalities, stored);
  }
});

test("normalizeProviderModelConfig drops malformed inputModalities and legacy archives", () => {
  const malformed = normalizeProviderModelConfig(
    { id: "k3", contextWindow: 258000, maxOutputToken: 32000, inputModalities: "image" },
    "codex",
  );
  assert.equal("inputModalities" in malformed, false);
  const legacy = normalizeProviderModelConfig(
    { id: "k3", contextWindow: 258000, maxOutputToken: 32000 },
    "codex",
  );
  assert.equal("inputModalities" in legacy, false);
});

test("modelFactory: codex completions custom model honors the override", () => {
  const base = ["codex", "k3", "https://api.kimi.com/coding/v1", "openai-completions"];
  const withoutOverride = createModelFromConfig(...base);
  assert.deepEqual(withoutOverride.input, ["text"]);
  const withOverride = createModelFromConfig(...base, {
    id: "k3",
    contextWindow: 258000,
    maxOutputToken: 32000,
    inputModalities: ["text", "image"],
  });
  // 构造带覆盖的模型不能反向污染此前创建的无覆盖模型实例。
  assert.deepEqual(withoutOverride.input, ["text"]);
  assert.deepEqual(withOverride.input, ["text", "image"]);
});

test(
  "ProviderModal input capability selection preserves auto/text/image/pdf semantics and provider boundary",
  () => {
    const baseModel = { id: "k3", contextWindow: 258000, maxOutputToken: 32000 };
    assert.equal(getModelInputModalitiesSelection(baseModel), "auto");

    const textOnly = applyModelInputModalitiesSelection(baseModel, ["text"]);
    assert.deepEqual(textOnly.inputModalities, ["text"]);
    assert.deepEqual(getModelInputModalitiesSelection(textOnly), ["text"]);
    const textAndImage = applyModelInputModalitiesSelection(textOnly, ["text", "image"]);
    assert.deepEqual(textAndImage.inputModalities, ["text", "image"]);
    assert.deepEqual(getModelInputModalitiesSelection(textAndImage), ["text", "image"]);
    const automatic = applyModelInputModalitiesSelection(textAndImage, "auto");
    assert.equal("inputModalities" in automatic, false);
    assert.equal(getModelInputModalitiesSelection(automatic), "auto");

    // 勾选态：自动态下图片/PDF 都视为未勾选（"自动"与其余互斥）。
    assert.equal(hasModelInputModalitiesItem("auto", "image"), false);
    assert.equal(hasModelInputModalitiesItem("auto", "pdf"), false);
    assert.equal(hasModelInputModalitiesItem(["text", "image"], "image"), true);
    assert.equal(hasModelInputModalitiesItem(["text", "image"], "pdf"), false);
    assert.equal(hasModelInputModalitiesItem(["text", "pdf"], "pdf"), true);

    // 勾选/取消产出规范顺序；取消到空集合回落 ["text"]（文本恒开）。
    assert.deepEqual(toggleModelInputModalitiesItem("auto", "pdf", true), ["text", "pdf"]);
    assert.deepEqual(toggleModelInputModalitiesItem("auto", "image", true), ["text", "image"]);
    assert.deepEqual(toggleModelInputModalitiesItem(["text", "image"], "pdf", true), [
      "text",
      "image",
      "pdf",
    ]);
    assert.deepEqual(toggleModelInputModalitiesItem(["text", "image", "pdf"], "pdf", false), [
      "text",
      "image",
    ]);
    assert.deepEqual(toggleModelInputModalitiesItem(["text", "pdf"], "pdf", false), ["text"]);
    assert.deepEqual(toggleModelInputModalitiesItem(["text"], "image", false), ["text"]);

    assert.equal(providerSupportsModelInputModalitiesOverride("codex"), true);
    assert.equal(providerSupportsModelInputModalitiesOverride("xai"), true);
    assert.equal(providerSupportsModelInputModalitiesOverride("gemini"), true);
    assert.equal(providerSupportsModelInputModalitiesOverride("deepseek"), true);
    // claude_code 现开放：anthropic 附件路径直接读声明（图片/PDF 是否原生内联）。
    assert.equal(providerSupportsModelInputModalitiesOverride("claude_code"), true);
  },
);

test("modelFactory: codex custom model ignores a malformed override", () => {
  const model = createModelFromConfig(
    "codex",
    "k3",
    "https://api.kimi.com/coding/v1",
    "openai-completions",
    { id: "k3", contextWindow: 258000, maxOutputToken: 32000, inputModalities: ["audio"] },
  );
  assert.deepEqual(model.input, ["text"]);
  // 全非法 = 无声明：不得挂上空声明。
  assert.equal("inputModalitiesOverride" in model, false);
});

test("modelFactory: gemini custom model honors the override", () => {
  const model = createModelFromConfig(
    "gemini",
    "some-custom-proxy-model",
    "https://gemini-proxy.example.com",
    undefined,
    {
      id: "some-custom-proxy-model",
      contextWindow: 128000,
      maxOutputToken: 32000,
      inputModalities: ["text"],
    },
  );
  assert.deepEqual(model.input, ["text"]);
});

test("modelFactory: deepseek infers image input from the model id and honors the override", () => {
  // 官方《图像理解》指南只承诺 flash 家族吃图，Pro 与更早的模型不跟着放开。
  const flash = createModelFromConfig(
    "deepseek",
    "deepseek-v4-flash",
    "https://api.deepseek.com",
  );
  assert.deepEqual(flash.input, ["text", "image"]);

  const pro = createModelFromConfig("deepseek", "deepseek-v4-pro", "https://api.deepseek.com");
  assert.deepEqual(pro.input, ["text"]);

  // 中转端点不吃图时用覆盖改回纯文本（覆盖优先于 id 推断）。
  const forcedText = createModelFromConfig(
    "deepseek",
    "deepseek-v4-flash",
    "https://relay.example.com",
    undefined,
    {
      id: "deepseek-v4-flash",
      contextWindow: 128000,
      maxOutputToken: 32000,
      inputModalities: ["text"],
    },
  );
  assert.deepEqual(forcedText.input, ["text"]);

  // 反向：用户明确知道自家端点支持时，也能给 Pro 开图。
  const forcedImage = createModelFromConfig(
    "deepseek",
    "deepseek-v4-pro",
    "https://api.deepseek.com",
    undefined,
    {
      id: "deepseek-v4-pro",
      contextWindow: 128000,
      maxOutputToken: 32000,
      inputModalities: ["text", "image"],
    },
  );
  assert.deepEqual(forcedImage.input, ["text", "image"]);
});

test("modelFactory: anthropic custom model keeps placeholder model.input but carries the declaration", () => {
  const model = createModelFromConfig(
    "claude_code",
    "unknown-relay-claude-model",
    "https://claude-relay.example.com",
    undefined,
    {
      id: "unknown-relay-claude-model",
      contextWindow: 200000,
      maxOutputToken: 32000,
      inputModalities: ["text", "image"],
    },
  );
  // 自定义 anthropic 模型的 input 仍是保守占位值：附件层不读它（见
  // nativeResponsesAttachments 的 modelSupportsImageInput），改读下面的声明。
  assert.deepEqual(model.input, ["text"]);
  assert.deepEqual(model.inputModalitiesOverride, ["text", "image"]);
});

test("modelFactory: declared pdf rides on the runtime model, never in pi-ai Model.input", () => {
  const withPdf = createModelFromConfig(
    "claude_code",
    "unknown-relay-claude-model",
    "https://claude-relay.example.com",
    undefined,
    {
      id: "unknown-relay-claude-model",
      contextWindow: 200000,
      maxOutputToken: 32000,
      inputModalities: ["text", "pdf"],
    },
  );
  // pi-ai 的 Model.input 类型只接受 text/image：pdf 只能走声明字段。
  assert.deepEqual(withPdf.input, ["text"]);
  assert.deepEqual(withPdf.inputModalitiesOverride, ["text", "pdf"]);

  const codexWithPdf = createModelFromConfig(
    "codex",
    "k3",
    "https://api.kimi.com/coding/v1",
    "openai-completions",
    {
      id: "k3",
      contextWindow: 258000,
      maxOutputToken: 32000,
      inputModalities: ["text", "pdf"],
    },
  );
  assert.deepEqual(codexWithPdf.input, ["text"]);
  assert.deepEqual(codexWithPdf.inputModalitiesOverride, ["text", "pdf"]);

  // 自动态不带声明字段（缺失 = 自动）。
  const automatic = createModelFromConfig(
    "claude_code",
    "unknown-relay-claude-model",
    "https://claude-relay.example.com",
  );
  assert.equal("inputModalitiesOverride" in automatic, false);
});

test("gemini persisted model survives the ProviderModal open/save round trip", () => {
  const persisted = [
    {
      id: "gemini-custom",
      contextWindow: 123456,
      maxOutputToken: 789,
      limitsSource: "user",
      inputModalities: ["text", "image"],
    },
  ];
  // ProviderModal 初始化（持久化归一化）：所有用户字段原样往返
  const viaModal = normalizeProviderModelConfigs(persisted, "gemini");
  assert.deepEqual(viaModal[0], {
    id: "gemini-custom",
    contextWindow: 123456,
    maxOutputToken: 789,
    limitsSource: "user",
    inputModalities: ["text", "image"],
  });
});

test("gemini fetch-path normalization preserves the inputModalities override", () => {
  // API 响应形状的条目（inputTokenLimit/outputTokenLimit）混有用户覆盖字段时，
  // 刷新后覆盖不得丢失（此前 normalizeGeminiFetchedModels 重建对象会洗掉它）。
  const fetched = [
    {
      name: "models/gemini-custom",
      inputTokenLimit: 123456,
      outputTokenLimit: 789,
      inputModalities: ["image"],
    },
  ];
  const viaFetch = normalizeFetchedModels(fetched, "gemini");
  assert.equal(viaFetch.length, 1);
  assert.deepEqual(viaFetch[0].inputModalities, ["text", "image"]);
});


test("model display names survive normalization without changing the request id", () => {
  for (const field of ["displayName", "display_name", "name"]) {
    const model = normalizeProviderModelConfig({ id: "my-model-id", [field]: "My Model" }, "codex");
    assert.equal(model.id, "my-model-id");
    assert.equal(model.displayName, "My Model");
    assert.equal(normalizeProviderModelConfig(model, "codex").displayName, "My Model");
  }
});
