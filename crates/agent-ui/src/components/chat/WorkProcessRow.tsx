import { ChevronDown } from "@liveagent/ui/components/IconSet";
import { cn } from "@liveagent/ui/lib/shared/utils";
import { memo, type ReactNode, useState } from "react";
import { LazyCollapse } from "./LazyCollapse";
import { useWorkTraceDisclosure } from "./WorkTraceDisclosureContext";

/**
 * 「两次输出之间」的过程概括条：把思考、工具调用、搜索收成一行计数，点开才铺出
 * 完整明细。
 *
 * 长回合里思考与工具会交替几十次，每段都铺一行会把模型写出的正文挤出视野。默认
 * 展开策略见 `system.workTraceDisclosure`：
 * - `active`（默认）：正在跑的那一段展开，落定后自动收起；
 * - `expanded`：默认展开；
 * - `collapsed`：默认收起。
 * 三档都保留手动点击，且手动点过之后以手动为准（不再被策略收回）；展开态刻意不
 * 跨挂载记忆——虚拟列表会反复重挂载，持久化反而会让人以为明细丢了。
 */
export const WorkProcessRow = memo(function WorkProcessRow(props: {
  /** 预格式化的计数文案，如「5 次工具调用｜3 次思考」。 */
  label: string;
  /** 这一段里含当前正在进行的活动。 */
  running?: boolean;
  children: ReactNode;
}) {
  const { label, running = false, children } = props;
  const disclosure = useWorkTraceDisclosure();
  const [manual, setManual] = useState<boolean | null>(null);
  const autoExpanded =
    disclosure === "expanded" ? true : disclosure === "collapsed" ? false : running;
  const expanded = manual ?? autoExpanded;

  return (
    <div className="min-w-0 max-w-full" data-work-process-row="">
      <button
        type="button"
        data-work-process-toggle=""
        aria-expanded={expanded}
        aria-label={label}
        className={cn(
          "group/work-process flex w-full items-center gap-2 rounded-lg py-1 text-left",
          "text-sm font-[450] transition-colors",
          "hover:text-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        onClick={() => setManual(!expanded)}
      >
        {/* 12px 占位：与 work trace 表头的像素格同宽，概括条的文案才和
            思考/工具行、以及表头的「处理中」对齐在同一条左基准线上。 */}
        <span aria-hidden="true" className="w-3 shrink-0" />
        <span className={cn("min-w-0 truncate", running ? "shimmer" : "text-foreground/55")}>
          {label}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-foreground/40 transition-transform duration-150 ease-out motion-reduce:transition-none",
            !expanded && "-rotate-90",
          )}
        />
      </button>
      <LazyCollapse className="[contain:layout_paint]" open={expanded}>
        {() => <div className="mt-1 space-y-2 border-l border-foreground/10 pl-3">{children}</div>}
      </LazyCollapse>
    </div>
  );
});
