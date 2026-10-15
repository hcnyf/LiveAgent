import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

/**
 * 读者是否正停在历史里（没有跟随会话底部）。
 *
 * 转录里有一批**自动**的展开/收起：思考落定后折起、工具批次翻篇后收起、概括条
 * 「模型有输出」后收起、回合结束时整段工作轨迹折起。它们都靠高度动画落地，而读者
 * 如果正在往上翻历史，这些高度变化就会把他正在看的内容顶走——他翻得越认真，越容易被
 * 抽走脚下的地板（用户原话：「思考结束后收起思考内容又回落，导致我很难将想看的内容
 * 固定在一处」）。
 *
 * 所以把「读者是否停住了」下发到这些披露组件：停住时冻结自动展开态，等读者回到
 * 底部再一次性生效。默认 `false`（不冻结），WebUI 不接这个上下文也不受影响。
 */
const ReaderDetachedContext = createContext(false);

export function useReaderDetached(): boolean {
  return useContext(ReaderDetachedContext);
}

export function ReaderDetachedProvider(props: { detached: boolean; children: ReactNode }) {
  return (
    <ReaderDetachedContext.Provider value={props.detached}>
      {props.children}
    </ReaderDetachedContext.Provider>
  );
}

/**
 * 读者停在历史里时把 `value` 冻在上一次的值，回到底部后立刻跟上。
 *
 * 用它包住「由运行态推导出来的自动展开态」：冻结的是**自动**那一半，用户手动点过之后
 * 仍然以手动为准（调用方照旧 `manual ?? auto`）。
 */
export function useFrozenWhileReaderDetached<T>(value: T): T {
  const detached = useReaderDetached();
  const [frozen, setFrozen] = useState(value);

  useEffect(() => {
    if (!detached) setFrozen(value);
  }, [detached, value]);

  return detached ? frozen : value;
}
