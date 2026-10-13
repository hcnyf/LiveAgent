import type { CustomProvider } from "@liveagent/app/lib/settings";
import { buildImageRequestTransport, summarizeUpstreamError } from "../providerRequest";
import type { GeneratedImage } from "../types";

/**
 * Gemini 生图适配器（`generateContent` + `responseModalities: ["IMAGE"]`）。
 *
 * **不得复用 codex 的解析逻辑**（spec 明文）：请求与响应的形状与 OpenAI Images
 * 完全不同——没有 `data[].b64_json`，图片藏在 `candidates[0].content.parts[].inlineData`
 * 里，且 `n` 不是协议字段（一次 generateContent 只出一张，多张靠重复调用）。
 */

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: unknown; data?: unknown } }> };
    finishReason?: unknown;
  }>;
  promptFeedback?: { blockReason?: unknown };
};

/**
 * `generationConfig.imageConfig.imageSize` 只在 Gemini 3 的图像模型上存在；
 * 2.5 代只认 `aspectRatio`，多送一个字段会 400。按模型 id 做保守判定，宁可
 * 少发一个字段，也不要让"选了 1K/2K"变成请求失败。
 */
export function supportsGeminiImageSize(modelId: string): boolean {
  return /gemini-3/i.test(modelId) && /image/i.test(modelId);
}

export function buildGeminiImageEndpointPath(model: string): string {
  const normalized = model.trim().replace(/^models\//, "");
  return `/models/${normalized}:generateContent`;
}

export function buildGeminiImagePayload(params: {
  prompt: string;
  size: string;
  quality: string;
  model: string;
  referenceImages?: readonly GeneratedImage[];
}): Record<string, unknown> {
  const parts: Array<Record<string, unknown>> = [{ text: params.prompt }];
  for (const image of params.referenceImages ?? []) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.dataBase64 } });
  }
  const imageConfig: Record<string, unknown> = { aspectRatio: params.size };
  if (supportsGeminiImageSize(params.model)) {
    imageConfig.imageSize = params.quality;
  }
  return {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig,
    },
  };
}

export async function generateGeminiImages(params: {
  provider: CustomProvider;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
  referenceImages?: readonly GeneratedImage[];
  signal?: AbortSignal;
}): Promise<GeneratedImage[]> {
  const transport = await buildImageRequestTransport(
    params.provider,
    params.model,
    buildGeminiImageEndpointPath(params.model),
  );
  const payload = buildGeminiImagePayload({
    prompt: params.prompt,
    size: params.size,
    quality: params.quality,
    model: params.model,
    referenceImages: params.referenceImages,
  });

  // n>1：协议没有批量参数，按次数串行重复请求（不是"一次请求拿多张"）。
  const images: GeneratedImage[] = [];
  for (let attempt = 0; attempt < params.count; attempt += 1) {
    if (params.signal?.aborted) throw new Error("Cancelled");
    const response = await fetch(transport.url, {
      method: "POST",
      headers: { ...transport.headers, "content-type": "application/json" },
      body: JSON.stringify(payload),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    if (!response.ok) {
      throw new Error(
        `生图请求失败（${params.provider.name} / ${params.model}）：${summarizeUpstreamError(
          response.status,
          await response.text().catch(() => ""),
        )}`,
      );
    }
    images.push(...collectGeminiImageParts((await response.json()) as GeminiResponse));
  }

  if (images.length === 0) {
    throw new Error("生图接口返回成功，但响应里没有任何图片数据");
  }
  return images;
}

function collectGeminiImageParts(payload: GeminiResponse): GeneratedImage[] {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const images: GeneratedImage[] = [];
  for (const part of parts) {
    const inline = part?.inlineData;
    if (typeof inline?.data === "string" && inline.data.trim()) {
      images.push({
        dataBase64: inline.data.trim(),
        mimeType:
          typeof inline.mimeType === "string" && inline.mimeType ? inline.mimeType : "image/png",
      });
    }
  }
  if (images.length === 0) {
    // 被安全策略拦下时 candidates 为空、只有 promptFeedback——把原因说出来，
    // 否则模型只会看到一句"没有图片数据"。
    const blocked = payload.promptFeedback?.blockReason;
    if (typeof blocked === "string" && blocked) {
      throw new Error(`生图被上游安全策略拦下（blockReason=${blocked}）`);
    }
  }
  return images;
}
