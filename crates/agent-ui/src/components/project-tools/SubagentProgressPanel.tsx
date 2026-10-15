import { formatElapsedTime } from "@liveagent/ui/components/chat/AssistantWorkTrace";
import { Bot } from "@liveagent/ui/components/IconSet";
import { useLocale } from "@liveagent/ui/i18n/index";
import { cn } from "@liveagent/ui/lib/shared/utils";
import { useSubagentProgress } from "@liveagent/ui/lib/subagents/progressContext";
import type { SubagentProgressEntry } from "@liveagent/ui/lib/subagents/progressGroups";
import { useEffect, useRef, useState } from "react";

export { SubagentProgressProvider } from "@liveagent/ui/lib/subagents/progressContext";
export type {
  SubagentProgressEntry,
  SubagentProgressGroup,
  SubagentProgressValue,
} from "@liveagent/ui/lib/subagents/progressGroups";

/** 运行中的用时每秒走一次；没有「带起点的运行中子代理」时不挂定时器。 */
function useElapsedTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function elapsedLabel(entry: SubagentProgressEntry, now: number): string {
  if (entry.running && entry.startedAtMs !== undefined) {
    return formatElapsedTime(Math.max(0, now - entry.startedAtMs));
  }
  return entry.durationMs !== undefined ? formatElapsedTime(entry.durationMs) : "";
}

/**
 * 「子代理」右侧面板：把一次 `Agent` 调用的父子关系画成一棵树——父节点一行，子代理挂在
 * 竖线上、每个再拉一条横线接过去（思维导图式的两级连线）。浅层信息：状态、用时、轮数、
 * 工具调用数；子代理内部逐次工具调用没有回流父会话，所以不在这里编造。
 */
export function SubagentProgressPanel() {
  const { t } = useLocale();
  const { groups, focusedEntryId } = useSubagentProgress();
  // 只有拿到起点的运行中子代理才需要每秒重算（当前宿主不编造起点，见
  // useSubagentProgressValue）；否则这个定时器只会在没有任何可见变化时空转。
  const ticking = groups.some((group) =>
    group.entries.some((entry) => entry.running && entry.startedAtMs !== undefined),
  );
  const now = useElapsedTick(ticking);
  const focusedRef = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 聚焦行经 ref 读取，这里要的就是「聚焦目标变了就滚过去」。
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusedEntryId]);

  if (groups.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center"
        data-subagent-progress-empty=""
      >
        <Bot className="size-5 text-muted-foreground/60" />
        <div className="text-xs text-muted-foreground">{t("projectTools.subagentsEmpty")}</div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-subagent-progress="">
      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.id} className="space-y-1" data-subagent-group={group.id}>
            {/* 父节点：一次 Agent 调用 */}
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/85">
              <Bot className="size-3 shrink-0 text-foreground/50" />
              <span className="min-w-0 truncate">
                {group.label ?? t("projectTools.subagentsGroup")}
              </span>
              <span className="shrink-0 text-muted-foreground/70">
                {t("projectTools.subagentsCount").replace("{count}", String(group.entries.length))}
              </span>
            </div>
            {/* 子节点：挂在竖线上，每个再拉一条横线接过去 */}
            <div className="relative ml-1.5 space-y-1 border-l border-foreground/15 pl-3">
              {group.entries.map((entry) => (
                <div
                  key={entry.id}
                  ref={entry.id === focusedEntryId ? focusedRef : undefined}
                  data-subagent-entry={entry.id}
                  data-focused={entry.id === focusedEntryId ? "true" : undefined}
                  className={cn(
                    "relative rounded-md px-1.5 py-1",
                    entry.id === focusedEntryId ? "bg-foreground/[0.06]" : "",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="absolute -left-3 top-3 h-px w-3 bg-foreground/15"
                  />
                  <div className="flex items-center gap-1.5 text-xs leading-1p5">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        entry.running ? "bg-foreground/60 shimmer" : "bg-foreground/25",
                      )}
                    />
                    <span className="min-w-0 truncate font-medium text-foreground/85">
                      {entry.name}
                    </span>
                    {entry.status ? (
                      <span className="shrink-0 text-muted-foreground/70">{entry.status}</span>
                    ) : null}
                  </div>
                  {entry.role || entry.task ? (
                    <div className="mt-0.5 break-words pl-3 text-tiny text-muted-foreground/75">
                      {entry.role ? `${entry.role} · ` : ""}
                      {entry.task ?? ""}
                    </div>
                  ) : null}
                  <div className="mt-0.5 flex flex-wrap gap-x-2 pl-3 text-tiny text-muted-foreground/60">
                    <span>
                      {entry.index + 1}/{entry.total}
                    </span>
                    {elapsedLabel(entry, now) ? <span>{elapsedLabel(entry, now)}</span> : null}
                    {entry.rounds !== undefined ? (
                      <span>
                        {t("projectTools.subagentsRounds").replace("{count}", String(entry.rounds))}
                      </span>
                    ) : null}
                    {entry.toolCalls !== undefined ? (
                      <span>
                        {t("projectTools.subagentsTools").replace(
                          "{count}",
                          String(entry.toolCalls),
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
