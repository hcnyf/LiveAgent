import { useSubagentRunDetail } from "@liveagent/adapters/assistantBubble";
import { LazyCollapse } from "@liveagent/ui/components/chat/LazyCollapse";
import { ChevronRight } from "@liveagent/ui/components/IconSet";
import { useLocale } from "@liveagent/ui/i18n/index";
import { cn } from "@liveagent/ui/lib/shared/utils";
import { useState } from "react";

/**
 * 子代理「运行过程」：它自己每一轮做了什么（思考摘要 / 正文摘要 / 工具调用）。
 *
 * 父会话原本只有子代理的终态报告，所以运行中那张卡片除了 task 什么都看不到。过程数据
 * 由宿主经 adapter 注入（桌面端从子代理运行态里取，WebUI 取不到就整块不渲染）。
 */
export function SubagentRunProcess(props: {
  agentId: string;
  parentToolCallId: string;
  agentIndex: number;
  /** 子代理还在跑：每秒刷新一次过程。 */
  active: boolean;
}) {
  const { t } = useLocale();
  const { agentId, parentToolCallId, agentIndex, active } = props;
  const { detail, loading } = useSubagentRunDetail({
    agentId,
    parentToolCallId,
    agentIndex,
    active,
  });
  // 过程默认收着：详情区本身已经限高，再自动铺开会把这一步的摘要挤没。
  const [open, setOpen] = useState(false);

  if (!agentId) return null;
  const steps = detail?.steps ?? [];
  if (steps.length === 0) {
    return loading ? (
      <div className="text-tiny text-muted-foreground/60">
        {t("chat.tool.subagentProcessLoading")}
      </div>
    ) : (
      <div className="text-tiny text-muted-foreground/60">
        {t("chat.tool.subagentProcessEmpty")}
      </div>
    );
  }

  return (
    <div className="space-y-1" data-subagent-run-process="">
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          "-mx-1.5 flex w-fit max-w-bleed-0p75rem cursor-pointer select-none items-center gap-1 rounded-lg px-1.5 py-0.5",
          "text-tiny font-medium text-foreground/70 transition-colors hover:bg-foreground/[0.04]",
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight
          className={cn("size-2.5 transition-transform duration-200", open && "rotate-90")}
        />
        {t("chat.tool.subagentProcess").replace("{count}", String(steps.length))}
      </button>
      <LazyCollapse open={open}>
        {() => (
          <ol className="space-y-1 border-l border-border/55 pl-3">
            {steps.map((step) => (
              <li key={step.step} className="space-y-0.5 text-tiny leading-1p5">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-muted-foreground/60">#{step.step}</span>
                  {step.tools.length > 0 ? (
                    <span className="min-w-0 font-mono text-foreground/75">
                      {step.tools.map((tool, index) => (
                        <span key={tool.id}>
                          {index > 0 ? ", " : ""}
                          <span
                            className={tool.isError ? "text-[hsl(var(--chat-error))]" : undefined}
                          >
                            {tool.name}
                          </span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/60">
                      {t("chat.tool.subagentProcessNoTools")}
                    </span>
                  )}
                </div>
                {step.thinking ? (
                  <div className="text-muted-foreground/70">
                    <span className="mr-1 opacity-70">{t("chat.thinkingProcess")}</span>
                    {step.thinking}
                  </div>
                ) : null}
                {step.text ? <div className="text-foreground/70">{step.text}</div> : null}
              </li>
            ))}
          </ol>
        )}
      </LazyCollapse>
    </div>
  );
}
