import type { CustomProvider } from "@liveagent/app/lib/settings";
import { prepareUpstreamProxyRequest } from "@liveagent/ui/lib/providers/proxy";
import { AGNES_IMAGE_RATIOS } from "@liveagent/ui/lib/settings";
import { decodeBase64ToBytes, encodeBytesToBase64 } from "../base64";
import {
  buildImageRequestTransport,
  type ImageRequestTransport,
  summarizeUpstreamError,
} from "../providerRequest";
import type { GeneratedImage } from "../types";

/**
 * OpenAI Images 适配器（`codex` 协议族）。
 *
 * 两个端点形状完全不同，因此分成两个函数：
 * - 文生图：`POST {base}/images/generations`（JSON）；
 * - 编辑/图生图：`POST {base}/images/edits`（multipart/form-data）。
 * 后者经本地反代逐字节转发（已实测，见 proxy.rs 的 forwards_multipart_body_verbatim）。
 *
 * **例外：Agnes AI**（`agnes-ai.com`）虽然自称 OpenAI 兼容，但请求形态更严格，走
 * `generateAgnesImages` / `editAgnesImages` 两个分支（见 `isAgnesImageProvider`）。
 */

type OpenAIImagesPayload = {
  data?: Array<{ b64_json?: unknown; url?: unknown; revised_prompt?: unknown }>;
};

/**
 * 是否是 Agnes AI 的图片端点。
 *
 * 我们的 codex 协议默认值是 gpt-image-1 口径（`size: "auto"` + `quality: "auto"` +
 * `n`），发给 Agnes 会直接 400：它的 `size` 必填且只认档位（`1K/2K/3K/4K`）或旧式
 * 精确尺寸（`1024x768` 这类会被归一化到最近档位），既没有 `quality` 也没有 `n`；
 * 图生图还走**同一个** `/images/generations`，参考图放 `extra_body.image`（Data URI），
 * 不是 `/images/edits` 的 multipart。
 *
 * 按主机名分支出这一支兼容形态，避免给所有 OpenAI 兼容供应商套上更窄的请求体。
 * 文档：https://wiki.agnes-ai.com/en/docs/agnes-image-21-flash
 */
export function isAgnesImageProvider(provider: CustomProvider): boolean {
  return /(^|\.)agnes-ai\.com$/i.test(hostOfBaseUrl(provider.baseUrl));
}

function hostOfBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  try {
    return new URL(trimmed).hostname;
  } catch {
    // 用户可能填的是缺 scheme 的 `apihub.agnes-ai.com/v1`：退化成子串提取。
    const match = /(?:^|\/\/)([^/?#]+)/.exec(trimmed);
    return match?.[1]?.split(":")[0] ?? "";
  }
}

/**
 * Agnes 的 `size` 只认档位（1K/2K/3K/4K），宽高比走独立的 `ratio`：官方的
 * 「2K + 16:9」就是 `size:"2K" + ratio:"16:9"`。我们的界面按端点换成 Agnes 自己的
 * 选项表（宽高比 + 档位），所以这里两件事分开翻译：
 * - 值已经是 Agnes 的宽高比 → 原样当 `ratio`；
 * - 值还是 codex 的精确尺寸 → 按它真实的比例映射（1024x1024→1:1 等）；
 * - `auto` 或认不出的值 → 1:1（Agnes 自己的默认）。
 */
function agnesImageParams(size: string, quality: string): { size: string; ratio: string } {
  const tier = agnesTier(quality);
  const trimmed = size.trim();
  if ((AGNES_IMAGE_RATIOS as readonly string[]).includes(trimmed)) {
    return { size: tier, ratio: trimmed };
  }
  return { size: tier, ratio: AGNES_RATIO_BY_EXACT_SIZE[trimmed.toLowerCase()] ?? "1:1" };
}

/** 精确尺寸 → 宽高比；Agnes 会把不支持的精确尺寸标准化，所以这里按实际比例给。 */
const AGNES_RATIO_BY_EXACT_SIZE: Record<string, string> = {
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
};

/**
 * Agnes 里「质量」就是分辨率档：codex 的 low/medium/high 与 gemini 的 1K/2K 都
 * 收敛到它自己的 1K/2K/3K/4K。`auto` 取 2K——与官方示例同档，1K 太小、3K/4K 偏慢。
 */
function agnesTier(quality: string): string {
  switch (quality.trim().toLowerCase()) {
    case "low":
      return "1K";
    case "high":
      return "4K";
    case "1k":
      return "1K";
    case "2k":
      return "2K";
    case "3k":
      return "3K";
    case "4k":
      return "4K";
    default:
      return "2K";
  }
}

function toDataUri(image: GeneratedImage): string {
  return `data:${image.mimeType};base64,${image.dataBase64}`;
}

export async function generateOpenAIImages(params: {
  provider: CustomProvider;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
  signal?: AbortSignal;
}): Promise<GeneratedImage[]> {
  if (isAgnesImageProvider(params.provider)) {
    return generateAgnesImages(params);
  }
  const transport = await buildImageRequestTransport(
    params.provider,
    params.model,
    "/images/generations",
  );
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: params.count,
    size: params.size,
    quality: params.quality,
  };
  // 刻意**不发 response_format**：gpt-image-1 只返回 b64_json 且拒绝该字段，
  // 而 dall-e-3 的默认是 url。两种形状下面都解析，所以不需要靠参数去约定。
  const response = await fetch(transport.url, {
    method: "POST",
    headers: { ...transport.headers, "content-type": "application/json" },
    body: JSON.stringify(body),
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
  const payload = (await response.json()) as OpenAIImagesPayload;
  return collectOpenAIImageEntries(payload);
}

async function generateAgnesImages(params: {
  provider: CustomProvider;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
  signal?: AbortSignal;
}): Promise<GeneratedImage[]> {
  const transport = await buildImageRequestTransport(
    params.provider,
    params.model,
    "/images/generations",
  );
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    ...agnesImageParams(params.size, params.quality),
    // 文档给文生图的口径：要 base64 就发顶层 `return_base64`。这样也省掉一次
    // 「拿到 URL 再去下载」——那个下载不带鉴权头，对需要鉴权的图床会 401。
    return_base64: true,
  };
  return postAgnesImageRequests(transport, body, params.count, params);
}

async function editAgnesImages(params: {
  provider: CustomProvider;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
  referenceImages: readonly GeneratedImage[];
  signal?: AbortSignal;
}): Promise<GeneratedImage[]> {
  const transport = await buildImageRequestTransport(
    params.provider,
    params.model,
    "/images/generations",
  );
  const referenceImages = params.referenceImages.map(toDataUri);
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    ...agnesImageParams(params.size, params.quality),
    // 官方示例与「重要说明」一致：输入图放 `extra_body.image`（Data URI 或 URL），
    // base64 输出用 `extra_body.response_format`；顶层只能放 `return_base64`。
    extra_body: { image: referenceImages, response_format: "b64_json" },
  };
  return postAgnesImageRequests(transport, body, params.count, params);
}

/** Agnes 没有 `n`：要几张就发几次（顺序发，避免撞上按档位计的 RPM 上限）。 */
async function postAgnesImageRequests(
  transport: ImageRequestTransport,
  body: Record<string, unknown>,
  count: number,
  params: { provider: CustomProvider; model: string; signal?: AbortSignal },
): Promise<GeneratedImage[]> {
  const requests = Math.max(1, Math.trunc(count) || 1);
  const images: GeneratedImage[] = [];
  for (let index = 0; index < requests; index += 1) {
    const response = await fetch(transport.url, {
      method: "POST",
      headers: { ...transport.headers, "content-type": "application/json" },
      body: JSON.stringify(body),
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
    images.push(
      ...(await collectOpenAIImageEntries((await response.json()) as OpenAIImagesPayload)),
    );
  }
  return images;
}

export async function editOpenAIImages(params: {
  provider: CustomProvider;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
  referenceImages: readonly GeneratedImage[];
  signal?: AbortSignal;
}): Promise<GeneratedImage[]> {
  if (isAgnesImageProvider(params.provider)) {
    return editAgnesImages(params);
  }
  const transport = await buildImageRequestTransport(
    params.provider,
    params.model,
    "/images/edits",
  );
  const form = new FormData();
  form.append("model", params.model);
  form.append("prompt", params.prompt);
  form.append("n", String(params.count));
  form.append("size", params.size);
  form.append("quality", params.quality);
  for (const [index, image] of params.referenceImages.entries()) {
    form.append(
      "image[]",
      new Blob([decodeBase64ToBytes(image.dataBase64)], { type: image.mimeType }),
      `reference-${index + 1}.${extensionForMime(image.mimeType)}`,
    );
  }
  // 不手动设 content-type：multipart 的 boundary 必须由 FormData/fetch 生成，
  // 自己写一个 content-type 会把 boundary 丢掉（上游直接 400）。
  const response = await fetch(transport.url, {
    method: "POST",
    headers: transport.headers,
    body: form,
    ...(params.signal ? { signal: params.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(
      `图生图请求失败（${params.provider.name} / ${params.model}）：${summarizeUpstreamError(
        response.status,
        await response.text().catch(() => ""),
      )}`,
    );
  }
  const payload = (await response.json()) as OpenAIImagesPayload;
  return collectOpenAIImageEntries(payload);
}

async function collectOpenAIImageEntries(payload: OpenAIImagesPayload): Promise<GeneratedImage[]> {
  const entries = Array.isArray(payload.data) ? payload.data : [];
  const images: GeneratedImage[] = [];
  for (const entry of entries) {
    if (typeof entry?.b64_json === "string" && entry.b64_json.trim()) {
      images.push({ dataBase64: entry.b64_json.trim(), mimeType: "image/png" });
      continue;
    }
    if (typeof entry?.url === "string" && entry.url.trim()) {
      images.push(await downloadImageThroughProxy(entry.url.trim()));
    }
  }
  if (images.length === 0) {
    throw new Error("生图接口返回成功，但响应里没有任何图片数据");
  }
  return images;
}

/**
 * 上游只给 URL 时（dall-e 系列默认行为）自己取回字节。
 *
 * 走 `prepareUpstreamProxyRequest`（hub 链路）：图片 URL 的主机与供应商端点往往
 * 不同（blob 存储），必须让本地反代按应用代理配置出网，而不是让渲染进程直连。
 */
async function downloadImageThroughProxy(url: string): Promise<GeneratedImage> {
  const prepared = await prepareUpstreamProxyRequest(url);
  const response = await fetch(prepared.url, { headers: prepared.headers });
  if (!response.ok) {
    throw new Error(`下载生图结果失败：${summarizeUpstreamError(response.status, "")}`);
  }
  const mimeType =
    (response.headers.get("content-type") ?? "image/png").split(";")[0] ?? "image/png";
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { dataBase64: encodeBytesToBase64(bytes), mimeType };
}

function extensionForMime(mimeType: string): string {
  switch (mimeType.split(";")[0]?.trim().toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}
