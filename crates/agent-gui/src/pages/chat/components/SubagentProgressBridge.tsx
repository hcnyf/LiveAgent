import { SubagentProgressProvider } from "@liveagent/ui/components/project-tools/SubagentProgressPanel";
import type { ReactNode } from "react";
import type { RenderTimelineItem } from "../../../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import type { SubagentRunSnapshot } from "../../../lib/subagents/progressCards";
import { useSubagentProgressValue } from "../hooks/useSubagentProgressValue";

/**
 * 会话与右侧面板之间唯一的接线点：会话里的子代理卡片和「子代理」面板都要读到
 * 同一份进度，所以在两者共同的外层包一个 Provider。
 *
 * 订阅 live store 的重渲染被关在这一个组件里——`children` 是父级传下来的同一个
 * element 引用，React 会跳过它的子树，所以流式期间只有这里重算进度，不会把整个
 * 工作台带着重渲染。
 */
export function SubagentProgressBridge({
  items,
  liveStore,
  onOpenSubagent,
  focusedEntryId,
  readLiveRuns,
  children,
}: {
  items: readonly RenderTimelineItem[];
  liveStore: LiveTranscriptStore;
  onOpenSubagent?: (entryId: string) => void;
  focusedEntryId?: string;
  readLiveRuns?: () => Iterable<SubagentRunSnapshot>;
  children: ReactNode;
}) {
  const value = useSubagentProgressValue({
    items,
    liveStore,
    onOpenSubagent,
    focusedEntryId,
    readLiveRuns,
  });
  return <SubagentProgressProvider value={value}>{children}</SubagentProgressProvider>;
}
