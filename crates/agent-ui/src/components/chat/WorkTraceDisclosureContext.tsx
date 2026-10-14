import {
  WORK_TRACE_DISCLOSURE_DEFAULT,
  type WorkTraceDisclosure,
} from "@liveagent/ui/lib/settings/types";
import { createContext, type ReactNode, useContext } from "react";

/**
 * 过程概括条的展开策略（设置项 `system.workTraceDisclosure`）。
 *
 * 用 context 而不是逐层传 prop：概括条由两个表面各自渲染（GUI 的
 * `AssistantBubble`、共享的 `RoundContent`），从宿主设置到它们中间隔着转录渲染、
 * 虚拟列表好几层。宿主只在根节点提供一次，缺省即默认档。
 */
const WorkTraceDisclosureContext = createContext<WorkTraceDisclosure>(
  WORK_TRACE_DISCLOSURE_DEFAULT,
);

export function useWorkTraceDisclosure(): WorkTraceDisclosure {
  return useContext(WorkTraceDisclosureContext);
}

export function WorkTraceDisclosureProvider(props: {
  value: WorkTraceDisclosure | undefined;
  children: ReactNode;
}) {
  return (
    <WorkTraceDisclosureContext.Provider value={props.value ?? WORK_TRACE_DISCLOSURE_DEFAULT}>
      {props.children}
    </WorkTraceDisclosureContext.Provider>
  );
}
