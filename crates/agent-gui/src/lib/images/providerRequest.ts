import type { CustomProvider } from "@liveagent/app/lib/settings";
import { createProviderRuntimeConfig } from "../providers/runtime/providerRuntimeConfig";
import { prepareProviderRequest } from "../providers/runtime/requestOptions";

/**
 * 生图请求的传输装配。
 *
 * **必须复用聊天链路那一份装配**，不得另起一套 fetch：
 * - `createProviderRuntimeConfig` 是 `ProviderRuntimeConfig` 的唯一构造点；
 * - `prepareProviderRequest` 是上游请求的唯一装配入口（内置头 + 用户自定义头 +
 *   本地反代的路由头 + use-system-proxy 标记）。
 * 自己拼一套的后果不是"少几个头"，而是自定义请求头静默失效、应用代理不生效——
 * 这两件事都不会报错，只会表现为"某些中转供应商出不了图"。
 *
 * `stateless: true`：生图端点是**无状态**的一次调用，不该携带 Codex CLI 那组
 * 会话身份头（session-id / thread-id / x-client-request-id）。那是 Responses
 * 链路专属，泄漏到别的端点上没有收益、只有噪音。
 */
export type ImageRequestTransport = {
  url: string;
  headers: Record<string, string>;
};

export async function buildImageRequestTransport(
  provider: CustomProvider,
  model: string,
  endpointPath: string,
): Promise<ImageRequestTransport> {
  const runtime = createProviderRuntimeConfig(provider, model, undefined);
  const prepared = await prepareProviderRequest(provider.type, runtime, { stateless: true });
  // 完整 URL 模式下 baseUrl 就是上游的最终地址（由反代的 upstream-url 头承载），
  // 再追加协议路径只会被忽略——干脆不追加，避免制造"看起来拼了路径"的假象。
  const url = runtime.isFullUrl
    ? prepared.baseUrl
    : `${prepared.baseUrl}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;
  return { url, headers: prepared.headers };
}

/** 上游错误体里最有信息量的一小段，用于给模型一个可读的失败原因。 */
export function summarizeUpstreamError(status: number, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return `HTTP ${status}`;
  // 上游错误体通常是 JSON（OpenAI: {error:{message}}；Gemini: {error:{message}}）。
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === "string" && message.trim()) {
      return `HTTP ${status}: ${message.trim().slice(0, 400)}`;
    }
  } catch {
    // 不是 JSON：退回纯文本切片。
  }
  return `HTTP ${status}: ${trimmed.slice(0, 400)}`;
}
