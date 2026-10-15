import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { SubagentProgressValue } from "./progressGroups";

export type {
  SubagentProgressEntry,
  SubagentProgressGroup,
  SubagentProgressValue,
} from "./progressGroups";

const EMPTY_DATA: SubagentProgressValue = { groups: [] };

/** 卡片入口需要的部分：只有「有没有入口 / 当前聚焦谁」——与流式进度数据分开。 */
export type SubagentProgressActions = {
  onOpenSubagent?: (entryId: string) => void;
  focusedEntryId?: string;
};

const EMPTY_ACTIONS: SubagentProgressActions = {};

const SubagentProgressDataContext = createContext<SubagentProgressValue>(EMPTY_DATA);
const SubagentProgressActionsContext = createContext<SubagentProgressActions>(EMPTY_ACTIONS);

/**
 * 子代理进度的**数据**读取点（面板用）。刻意与入口动作分成两个 context：数据在
 * 流式期间会变，而会话里每一行工具调用都要读入口，合成一个 context 会让每个工具
 * 行跟着 token 一起重渲染。
 */
export function useSubagentProgress(): SubagentProgressValue {
  return useContext(SubagentProgressDataContext);
}

/** 子代理进度**入口**读取点（会话里的子代理卡片用）。 */
export function useSubagentProgressActions(): SubagentProgressActions {
  return useContext(SubagentProgressActionsContext);
}

/**
 * 子代理进度数据的注入点。数据是**桌面端独有**的（来自 liveTranscriptStore 与
 * 会话行），所以由宿主提供；WebUI 不提供时面板走空状态、卡片不渲染进度入口。
 */
export function SubagentProgressProvider(props: {
  value: SubagentProgressValue;
  children: ReactNode;
}) {
  const { onOpenSubagent, focusedEntryId } = props.value;
  const actions = useMemo<SubagentProgressActions>(
    () => ({ onOpenSubagent, focusedEntryId }),
    [focusedEntryId, onOpenSubagent],
  );
  return (
    <SubagentProgressActionsContext.Provider value={actions}>
      <SubagentProgressDataContext.Provider value={props.value}>
        {props.children}
      </SubagentProgressDataContext.Provider>
    </SubagentProgressActionsContext.Provider>
  );
}
