import type { AppSettings } from "@liveagent/app/lib/settings";
import { useCallback, useEffect, useRef } from "react";
import type { ConversationViewState } from "../../../lib/chat/conversation/conversationState";
import {
  type DisplayImagePathReplacement,
  rewriteDisplayImagePaths,
} from "../../../lib/images/rewriteDisplayImagePaths";
import {
  setSessionImageRewriteHandler,
  setSessionImageTransferContext,
} from "../../../lib/images/sessionImageTransfer";
import type { PersistConversationAction } from "../history/useConversationHistoryActions";
import type { ConversationRuntimeEntry } from "./chatPageRuntime";
import { resolveEffectiveChatModelSelection } from "./modelSelection";

/**
 * 把「保存到工作区」接到当前会话的运行时缓存与持久化上（T5.5）。
 *
 * 为什么是这个形态：触发点在**共享 UI** 的图片右键菜单，而"改写会话引用"只有
 * 桌面宿主做得到（要运行时缓存 + 历史持久化）。所以共享 UI 通过
 * `@liveagent/adapters/sessionImageSave` 回调，宿主在这里注册实现——与
 * `toolApproval` / `askUserQuestion` 等模块级 store 同一套做法。
 *
 * 改写落点的选择（详见 `rewriteDisplayImagePaths` 的注释）：必须换**新对象**并
 * 走 `replaceActiveSegmentMessages`，否则共享 UI 的按引用 WeakMap 缓存会继续渲染
 * 旧路径。
 *
 * 目标工作区取当前聚焦会话的工作区：用户是对着眼前那张图点的动作。
 */
export function useSessionImageTransfer(params: {
  settings: AppSettings;
  t: (key: string) => string;
  currentConversationId: string;
  currentConversationWorkdir: string;
  conversationRuntimeCacheRef: React.MutableRefObject<Map<string, ConversationRuntimeEntry>>;
  updateConversationRuntimeEntry: (
    conversationId: string,
    updater: (prev: ConversationRuntimeEntry) => ConversationRuntimeEntry,
  ) => ConversationRuntimeEntry;
  persistConversation: PersistConversationAction;
}) {
  // 只解构这两个：它们决定"目标工作区"，切会话时必须跟着变。
  const { currentConversationId, currentConversationWorkdir } = params;

  // 处理器只在挂载时注册一次，通过 ref 读最新入参——每次渲染重注册会让
  // "注册/注销"与渲染竞争，动作可能打到已经过期的闭包上。
  const latest = useRef(params);
  latest.current = params;

  const handleRewrite = useCallback(
    async ({ oldPath, saved }: { oldPath: string; saved: DisplayImagePathReplacement }) => {
      const current = latest.current;
      const conversationId = current.currentConversationId;
      const entry = current.conversationRuntimeCacheRef.current.get(conversationId);
      if (!entry) return 0;

      const result = rewriteDisplayImagePaths(entry.state, oldPath, saved);
      if (result.rewritten === 0) return 0;

      // 先落运行时缓存：UI 立刻显示新路径（持久化失败也不至于让用户以为没保存）。
      const next = current.updateConversationRuntimeEntry(conversationId, (prev) => ({
        ...prev,
        state: result.state,
      }));

      let effective: ReturnType<typeof resolveEffectiveChatModelSelection>;
      try {
        effective = resolveEffectiveChatModelSelection({
          settings: current.settings,
          conversationSelectedModel: next.selectedModel,
        });
      } catch {
        // 模型选择不可解析（配置被改坏等）：引用已在运行时改好，跳过持久化即可，
        // 不该把一次已经成功的文件转存变成报错。
        return result.rewritten;
      }

      const persisted: ConversationViewState | null = await current.persistConversation({
        conversationId,
        sessionId: next.sessionId,
        providerId: effective.providerId,
        model: effective.model,
        selectedModel: effective.selectedModel,
        cwd: next.workdir,
        state: result.state,
        fallbackTitle: current.t("chat.pendingTitle"),
        createdAt: next.createdAt,
        titlePromise: null,
      });
      // 写库成功后必须落**带 revision 的**那份状态（CAS 令牌只能由 summary 重建）。
      if (persisted) {
        current.updateConversationRuntimeEntry(conversationId, (prev) => ({
          ...prev,
          state: persisted,
        }));
      }
      return result.rewritten;
    },
    [],
  );

  useEffect(() => {
    setSessionImageRewriteHandler(handleRewrite);
    return () => setSessionImageRewriteHandler(null);
  }, [handleRewrite]);

  useEffect(() => {
    setSessionImageTransferContext({
      conversationId: currentConversationId,
      workdir: currentConversationWorkdir,
    });
    return () => setSessionImageTransferContext(null);
  }, [currentConversationId, currentConversationWorkdir]);
}
