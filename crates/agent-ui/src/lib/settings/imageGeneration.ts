import type { ProviderId } from "./types";

/**
 * 生图模型的「默认生成参数」契约（供应商配置 → 工具调用）。
 *
 * 为什么字段取值是 `string` 而不是联合类型：spec 明确要求**不做跨协议统一枚举**
 * ——codex（OpenAI Images）用 `WxH` 尺寸 + `low/medium/high` 质量，gemini
 * （generateContent + responseModalities:["IMAGE"]）用宽高比 + 分辨率档，两套
 * 取值语义不同。用 string 承载「协议相关取值」，合法性由本模块按协议白名单校验，
 * 而不是把两套枚举硬塞进一个联合类型（那会诱导调用方写出跨协议比较）。
 */
export const IMAGE_GENERATION_PROVIDER_IDS = ["codex", "gemini"] as const;

export type ImageGenerationProviderId = (typeof IMAGE_GENERATION_PROVIDER_IDS)[number];

/**
 * 生图供应商协议子集：`claude_code` / `deepseek` 官方无生图 API，`xai` 本期不做
 * （spec「生图协议子集」）。这里是**唯一**判定点，UI 选项与运行时分派共用，
 * 避免两处各写一份 switch 后逐渐分叉。
 */
export function isImageGenerationProviderId(
  providerId: ProviderId | string,
): providerId is ImageGenerationProviderId {
  return (IMAGE_GENERATION_PROVIDER_IDS as readonly string[]).includes(providerId);
}

/** codex（OpenAI Images API）支持的尺寸；`auto` 由上游自行决定。 */
export const CODEX_IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"] as const;

/** codex 支持的质量档。 */
export const CODEX_IMAGE_QUALITIES = ["low", "medium", "high", "auto"] as const;

/**
 * gemini 支持的宽高比（`generationConfig.imageConfig.aspectRatio`）。
 * 与 codex 的 WxH 不是同一件事，故单独一张表。
 */
export const GEMINI_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

/** gemini 的分辨率档（`generationConfig.imageConfig.imageSize`）。 */
export const GEMINI_IMAGE_RESOLUTIONS = ["1K", "2K"] as const;

const IMAGE_SIZE_OPTIONS: Record<ImageGenerationProviderId, readonly string[]> = {
  codex: CODEX_IMAGE_SIZES,
  gemini: GEMINI_IMAGE_ASPECT_RATIOS,
};

const IMAGE_QUALITY_OPTIONS: Record<ImageGenerationProviderId, readonly string[]> = {
  codex: CODEX_IMAGE_QUALITIES,
  gemini: GEMINI_IMAGE_RESOLUTIONS,
};

export function imageSizeOptions(providerId: ImageGenerationProviderId): readonly string[] {
  return IMAGE_SIZE_OPTIONS[providerId];
}

export function imageQualityOptions(providerId: ImageGenerationProviderId): readonly string[] {
  return IMAGE_QUALITY_OPTIONS[providerId];
}

/**
 * 一次生图的张数边界。上界与 `display_image` 结果的承载能力一致
 * （agent-gui `fsTools.ts` 的 `MAX_DISPLAY_IMAGE_PATHS`）——超过就没有地方放，
 * 所以不是"建议值"而是硬边界；两处一致性由 agent-gui 侧单测锁定。
 */
export const IMAGE_COUNT_MIN = 1;
export const IMAGE_COUNT_MAX = 12;
export const DEFAULT_IMAGE_COUNT = 1;

/**
 * 未配置时的协议默认值。刻意用**上游自己的默认语义**（codex 的 `auto`）而不是
 * 我们替用户猜一个具体尺寸：猜错会让用户以为配置生效了。
 */
const DEFAULT_IMAGE_SIZE: Record<ImageGenerationProviderId, string> = {
  codex: "auto",
  gemini: "1:1",
};

const DEFAULT_IMAGE_QUALITY: Record<ImageGenerationProviderId, string> = {
  codex: "auto",
  gemini: "1K",
};

export function defaultImageSize(providerId: ImageGenerationProviderId): string {
  return DEFAULT_IMAGE_SIZE[providerId];
}

export function defaultImageQuality(providerId: ImageGenerationProviderId): string {
  return DEFAULT_IMAGE_QUALITY[providerId];
}

export function normalizeImageSize(
  providerId: ImageGenerationProviderId,
  input: unknown,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  return (IMAGE_SIZE_OPTIONS[providerId] as readonly string[]).includes(value) ? value : undefined;
}

export function normalizeImageQuality(
  providerId: ImageGenerationProviderId,
  input: unknown,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  return (IMAGE_QUALITY_OPTIONS[providerId] as readonly string[]).includes(value)
    ? value
    : undefined;
}

/**
 * 张数归一化：只接受 [1, IMAGE_COUNT_MAX] 内的整数，其余一律 undefined
 * （= 未配置）。**不做钳制**：把用户存的 99 静默改成 12 会掩盖配置错误，
 * 而调用期越界另有明确报错（spec 验收 6 要求"明确错误而非静默截断"）。
 */
export function normalizeImageCount(input: unknown): number | undefined {
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  if (value < IMAGE_COUNT_MIN || value > IMAGE_COUNT_MAX) return undefined;
  return value;
}

export type ResolvedImageGenerationParams = {
  size: string;
  quality: string;
  count: number;
};

/**
 * 解析一次生图调用最终使用的参数：**调用参数 ?? 模型配置默认值 ?? 协议默认值**。
 * 调用参数由调用方先过一遍 normalize*（非法值当作未传），这里只负责回落顺序。
 */
export function resolveImageGenerationParams(
  providerId: ImageGenerationProviderId,
  modelDefaults: { imageSize?: string; imageQuality?: string; imageCount?: number },
  callOverrides?: { size?: unknown; quality?: unknown; count?: unknown },
): ResolvedImageGenerationParams {
  const callSize = normalizeImageSize(providerId, callOverrides?.size);
  const callQuality = normalizeImageQuality(providerId, callOverrides?.quality);
  const callCount = normalizeImageCount(callOverrides?.count);
  return {
    size:
      callSize ??
      normalizeImageSize(providerId, modelDefaults.imageSize) ??
      DEFAULT_IMAGE_SIZE[providerId],
    quality:
      callQuality ??
      normalizeImageQuality(providerId, modelDefaults.imageQuality) ??
      DEFAULT_IMAGE_QUALITY[providerId],
    count: callCount ?? normalizeImageCount(modelDefaults.imageCount) ?? DEFAULT_IMAGE_COUNT,
  };
}
