import type { CustomProvider } from "@liveagent/app/lib/settings";
import { prepareUpstreamProxyRequest } from "@liveagent/ui/lib/providers/proxy";
import { decodeBase64ToBytes, encodeBytesToBase64 } from "../base64";
import { buildImageRequestTransport, summarizeUpstreamError } from "../providerRequest";
import type { GeneratedImage } from "../types";

/**
 * OpenAI Images 适配器（`codex` 协议族）。
 *
 * 两个端点形状完全不同，因此分成两个函数：
 * - 文生图：`POST {base}/images/generations`（JSON）；
 * - 编辑/图生图：`POST {base}/images/edits`（multipart/form-data）。
 * 后者经本地反代逐字节转发（已实测，见 proxy.rs 的 forwards_multipart_body_verbatim）。
 */

type OpenAIImagesPayload = {
  data?: Array<{ b64_json?: unknown; url?: unknown; revised_prompt?: unknown }>;
};

export async function generateOpenAIImages(params: {
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
