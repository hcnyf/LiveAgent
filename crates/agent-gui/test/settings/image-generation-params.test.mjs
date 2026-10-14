import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// 生图默认参数（T5.1）的反漂移锁：
// 1. 取值按协议白名单校验，不做跨协议统一枚举（codex 的 WxH 与 gemini 的宽高比
//    互不承认，写成对方的值一律丢弃）；
// 2. 仅 kind === "image" 的供应商保留这些字段——chat 供应商即便用 codex/gemini
//    协议也不该背着一份永不生效的配置；
// 3. 越界/非整数张数一律丢弃（不钳制），由调用期给出明确报错；
// 4. 解析顺序：调用参数 ?? 模型默认值 ?? 协议默认值。
const loader = createTsModuleLoader();
const {
  normalizeProviderModelConfig,
  normalizeProviderModelConfigs,
  normalizeCustomProvider,
  normalizeImageSize,
  normalizeImageQuality,
  normalizeImageCount,
  resolveImageGenerationParams,
  isImageGenerationProviderId,
  imageSizeOptions,
  imageQualityOptions,
  IMAGE_COUNT_MIN,
  IMAGE_COUNT_MAX,
  DEFAULT_IMAGE_COUNT,
  CODEX_IMAGE_SIZES,
  GEMINI_IMAGE_ASPECT_RATIOS,
  AGNES_IMAGE_RATIOS,
  AGNES_IMAGE_TIERS,
  isAgnesImageEndpoint,
} = loader.loadModule("src/lib/settings/index.ts");

const BASE_MODEL = { id: "img-1", contextWindow: 4096, maxOutputToken: 1024 };

test("image generation is limited to codex and gemini", () => {
  assert.equal(isImageGenerationProviderId("codex"), true);
  assert.equal(isImageGenerationProviderId("gemini"), true);
  // claude_code / deepseek 官方无生图 API，xai 本期不做 —— 三者都不是生图协议。
  assert.equal(isImageGenerationProviderId("claude_code"), false);
  assert.equal(isImageGenerationProviderId("deepseek"), false);
  assert.equal(isImageGenerationProviderId("xai"), false);
  // 两套枚举互不承认：这是"不做跨协议统一枚举"的可执行证据。
  assert.deepEqual(imageSizeOptions("codex"), [...CODEX_IMAGE_SIZES]);
  assert.deepEqual(imageSizeOptions("gemini"), [...GEMINI_IMAGE_ASPECT_RATIOS]);
  assert.equal(normalizeImageSize("gemini", "1024x1024"), undefined);
  assert.equal(normalizeImageQuality("gemini", "high"), undefined);
  // Agnes 例外：它挂在 codex 协议下，但词汇表是「档位 + 宽高比」。归一化按并集收，
  // 否则落库的 Agnes 取值会在下次读设置时被静默抹掉（真正的门是界面的选项表）。
  assert.equal(normalizeImageSize("codex", "16:9"), "16:9");
  assert.equal(normalizeImageQuality("codex", "2K"), "2K");
  // 界面按端点换表：Agnes 端点给官方词汇表，别的 codex 端点仍是 WxH。
  assert.deepEqual(imageSizeOptions("codex", "https://apihub.agnes-ai.com/v1"), [
    ...AGNES_IMAGE_RATIOS,
  ]);
  assert.deepEqual(imageQualityOptions("codex", "https://apihub.agnes-ai.com/v1"), [
    ...AGNES_IMAGE_TIERS,
  ]);
  assert.deepEqual(imageSizeOptions("codex", "https://api.openai.com/v1"), [...CODEX_IMAGE_SIZES]);
  assert.equal(isAgnesImageEndpoint("https://apihub.agnes-ai.com/v1"), true);
  assert.equal(isAgnesImageEndpoint("https://api.openai.com/v1"), false);
});

test("image params survive a normalize round trip only for image providers", () => {
  const imageProvider = normalizeCustomProvider({
    type: "codex",
    kind: "image",
    models: [{ ...BASE_MODEL, imageSize: "1024x1536", imageQuality: "high", imageCount: 4 }],
  });
  assert.deepEqual(
    {
      imageSize: imageProvider.models[0].imageSize,
      imageQuality: imageProvider.models[0].imageQuality,
      imageCount: imageProvider.models[0].imageCount,
    },
    { imageSize: "1024x1536", imageQuality: "high", imageCount: 4 },
  );

  // 同一份模型字段挂在 chat 供应商上：整组丢弃（不落库，读侧也不会用）。
  const chatProvider = normalizeCustomProvider({
    type: "codex",
    kind: "chat",
    models: [{ ...BASE_MODEL, imageSize: "1024x1536", imageQuality: "high", imageCount: 4 }],
  });
  assert.equal("imageSize" in chatProvider.models[0], false);
  assert.equal("imageQuality" in chatProvider.models[0], false);
  assert.equal("imageCount" in chatProvider.models[0], false);
});

test("legacy image model archives keep zero extra fields", () => {
  const legacy = normalizeProviderModelConfig({ ...BASE_MODEL }, "codex", "image");
  assert.equal("imageSize" in legacy, false);
  assert.equal("imageQuality" in legacy, false);
  assert.equal("imageCount" in legacy, false);
});

test("invalid values are dropped, never coerced into a neighbouring option", () => {
  // 非法取值 = 未配置（而不是"退回第一个选项"）：静默纠正会掩盖配置错误。
  const dropped = normalizeProviderModelConfig(
    { ...BASE_MODEL, imageSize: "4096x4096", imageQuality: "ultra", imageCount: 99 },
    "codex",
    "image",
  );
  assert.equal("imageSize" in dropped, false);
  assert.equal("imageQuality" in dropped, false);
  assert.equal("imageCount" in dropped, false);

  assert.equal(normalizeImageCount(IMAGE_COUNT_MAX), IMAGE_COUNT_MAX);
  assert.equal(normalizeImageCount(IMAGE_COUNT_MIN), IMAGE_COUNT_MIN);
  assert.equal(normalizeImageCount(IMAGE_COUNT_MAX + 1), undefined);
  assert.equal(normalizeImageCount(0), undefined);
  assert.equal(normalizeImageCount(-3), undefined);
  assert.equal(normalizeImageCount(2.5), undefined);
  assert.equal(normalizeImageCount("3"), 3);
  assert.equal(normalizeImageCount(""), undefined);
  assert.equal(normalizeImageCount(undefined), undefined);
});

test("resolveImageGenerationParams prefers call overrides, then model, then protocol default", () => {
  const model = { imageSize: "1024x1024", imageQuality: "low", imageCount: 2 };
  assert.deepEqual(resolveImageGenerationParams("codex", model, undefined), {
    size: "1024x1024",
    quality: "low",
    count: 2,
  });
  // 调用参数优先。
  assert.deepEqual(resolveImageGenerationParams("codex", model, { size: "auto", count: 5 }), {
    size: "auto",
    quality: "low",
    count: 5,
  });
  // 非法调用参数按"未传"处理，回落到模型配置（16:9 现在是 Agnes 的合法取值，
  // 所以这里改用两套词汇表都不认的值）。
  assert.deepEqual(resolveImageGenerationParams("codex", model, { size: "17:9", count: 99 }), {
    size: "1024x1024",
    quality: "low",
    count: 2,
  });
  // Agnes 端点：词汇表换成它自己的档位/宽高比，缺省值也跟着换（2K + 1:1）。
  assert.deepEqual(
    resolveImageGenerationParams("codex", {}, undefined, "https://apihub.agnes-ai.com/v1"),
    { size: "1:1", quality: "2K", count: DEFAULT_IMAGE_COUNT },
  );
  // 模型未配置 → 协议默认值（codex 用上游自己的 auto 语义，不替用户猜具体尺寸）。
  assert.deepEqual(resolveImageGenerationParams("codex", {}, undefined), {
    size: "auto",
    quality: "auto",
    count: DEFAULT_IMAGE_COUNT,
  });
  assert.deepEqual(resolveImageGenerationParams("gemini", {}, undefined), {
    size: "1:1",
    quality: "1K",
    count: DEFAULT_IMAGE_COUNT,
  });
});

test("normalizeProviderModelConfigs threads the provider kind through", () => {
  const rows = [{ ...BASE_MODEL, imageSize: "auto", imageCount: 3 }];
  assert.equal(normalizeProviderModelConfigs(rows, "codex", "image")[0].imageCount, 3);
  assert.equal("imageCount" in normalizeProviderModelConfigs(rows, "codex", "chat")[0], false);
  // 缺省 kind = "chat"：既有调用点（两参）语义不变。
  assert.equal("imageCount" in normalizeProviderModelConfigs(rows, "codex")[0], false);
});
