import type { SidebarStore } from "@liveagent/ui/lib/sidebar/store";
import type { MutableRefObject } from "react";
import type { Locale } from "../../../i18n/config";
import type { GatewayBridgeEventController } from "../../../lib/chat/conversation/run";
import {
  buildConversationTitlePrompt,
  buildConversationTitleSystemPrompt,
  normalizeGeneratedConversationTitle,
} from "../../../lib/chat/page/chatPageHelpers";
import { assistantMessageToText, streamAssistantMessage } from "../../../lib/providers/llm";
import type { ProviderId } from "../../../lib/settings";

type TitleJobRefValue = {
  conversationId: string;
  promise: Promise<string | null>;
} | null;

type StartConversationTitleJobParams = {
  providerId: ProviderId;
  model: string;
  runtime: Parameters<typeof streamAssistantMessage>[0]["runtime"];
  signal: AbortSignal;
  conversationId: string;
  titleSourceText: string;
  content: string;
  /**
   * UI locale; the generated title language follows it. Required so a new
   * caller cannot silently fall back to Chinese titles in an English UI.
   */
  locale: Locale;
  // 生成过程中的预览只推给网关（WebUI 标签名）；侧栏只在标题定稿后写一次。
  sidebarStore: Pick<SidebarStore, "peek" | "upsertLocal">;
  titleJobRef: MutableRefObject<TitleJobRefValue>;
  gatewayBridgeEvents: GatewayBridgeEventController;
};

const GATEWAY_BRIDGE_TITLE_MIN_INTERVAL_MS = 250;

export function buildConversationTitleRuntime(
  runtime: Parameters<typeof streamAssistantMessage>[0]["runtime"],
): Parameters<typeof streamAssistantMessage>[0]["runtime"] {
  return {
    ...runtime,
    reasoning: "off",
    promptCachingEnabled: false,
    nativeWebSearchEnabled: false,
  };
}

export function startConversationTitleJob(params: StartConversationTitleJobParams) {
  const {
    providerId,
    model,
    runtime,
    signal,
    conversationId,
    titleSourceText,
    content,
    locale,
    sidebarStore,
    titleJobRef,
    gatewayBridgeEvents,
  } = params;
  let streamedTitle = "";
  let lastForwardedGatewayTitle = "";
  let lastForwardedGatewayTitleAt = 0;

  const forwardGatewayTitlePreview = (preview: string, force = false) => {
    const title = preview.trim();
    if (!title || title === lastForwardedGatewayTitle) {
      return;
    }
    const now = Date.now();
    if (!force && now - lastForwardedGatewayTitleAt < GATEWAY_BRIDGE_TITLE_MIN_INTERVAL_MS) {
      return;
    }
    lastForwardedGatewayTitle = title;
    lastForwardedGatewayTitleAt = now;
    gatewayBridgeEvents.queueTitle(title, force);
  };

  const titleRuntime = buildConversationTitleRuntime(runtime);

  const titlePromise = streamAssistantMessage({
    providerId,
    model,
    runtime: titleRuntime,
    signal,
    cacheRetention: "none",
    nativeWebSearch: false,
    context: {
      systemPrompt: buildConversationTitleSystemPrompt(locale),
      messages: [
        {
          role: "user",
          content: buildConversationTitlePrompt(titleSourceText || content, locale),
          timestamp: Date.now(),
        },
      ],
    },
    onTextDelta: (delta) => {
      streamedTitle += delta;
      const preview = streamedTitle
        .replace(/[\r\n]+/g, " ")
        .replace(/^[`"'""'']+|[`"'""'']+$/g, "")
        .trim();
      if (!preview) return;
      // 刻意**不写侧栏**：逐字写侧栏会让标题在生成过程中一路变形，用户看到的就是
      // "任务进行时标题一直在动"。侧栏只在标题定稿后写一次（见下方 titlePromise 的
      // 收尾），中间态只推给网关的 WebUI 标签名。
      forwardGatewayTitlePreview(preview);
    },
  })
    .then((assistant) => normalizeGeneratedConversationTitle(assistantMessageToText(assistant)))
    .then((title) => title || null)
    .catch(() => null);

  titleJobRef.current = {
    conversationId,
    promise: titlePromise,
  };

  void titlePromise
    .then((resolvedTitle) => {
      if (!resolvedTitle) return;
      forwardGatewayTitlePreview(resolvedTitle, true);
      const currentItem = sidebarStore.peek(conversationId);
      if (!currentItem?.isPending) return;
      if (currentItem.title === resolvedTitle) return;
      sidebarStore.upsertLocal({
        ...currentItem,
        title: resolvedTitle,
        updatedAt: Date.now(),
      });
    })
    .catch(() => {
      // ignore title preview failures; the pending row keeps the default title
    });

  return titlePromise;
}
