import { LazyCollapse } from "@liveagent/ui/components/chat/LazyCollapse";
import { ChevronRight } from "@liveagent/ui/components/IconSet";
import { useLocale } from "@liveagent/ui/i18n/index";
import { cn } from "@liveagent/ui/lib/shared/utils";
import { type ReactNode, useState } from "react";

/**
 * 概括条里「更早的记录」那一行：段内 entry 超过 `WORK_TRACE_VISIBLE_ENTRY_LIMIT` 时，
 * 更早的部分不直接铺出来，而是收成这一行，点开才铺。
 *
 * 默认收起，且**不**跟随 `system.workTraceDisclosure` 三档——那一项管的是「概括条整体
 * 展开还是收起」，而这一行管的是「展开之后还要不要再铺一屏旧记录」，两者不是一回事；
 * 而且「把几十条旧记录一次铺满」正是这一行要防的事。展开态刻意不跨挂载记忆：虚拟列表
 * 会反复重挂载，记住反而会让人以为旧记录丢了。
 *
 * 行内的 12px 占位与思考/工具行的图标同宽，文案才和它们落在同一条左基准线上。
 */
export function WorkProcessOlderEntries(props: {
  count: number;
  /** 懒挂载：只有展开时才调用，避免把几十条旧记录提前构造出来。 */
  children: () => ReactNode;
}) {
  const { count, children } = props;
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const label = t("chat.work.olderEntries").replace("{count}", String(count));

  return (
    <div className="min-w-0 max-w-full" data-work-older-entries="">
      <button
        type="button"
        data-work-older-entries-toggle=""
        aria-expanded={expanded}
        aria-label={label}
        className={cn(
          "-mx-1.5 flex w-fit max-w-bleed-0p75rem cursor-pointer select-none items-center gap-1.5",
          "rounded-lg px-1.5 py-1",
          "text-left text-sm font-[450] text-foreground/50 transition-colors duration-150 hover:bg-foreground/[0.04] hover:text-foreground/70",
        )}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span aria-hidden="true" className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-foreground/40 transition-transform duration-150 ease-out motion-reduce:transition-none",
            expanded ? "rotate-90" : "",
          )}
        />
      </button>
      <LazyCollapse className="[contain:layout_paint]" open={expanded}>
        {() => <div className="space-y-2">{children()}</div>}
      </LazyCollapse>
    </div>
  );
}
