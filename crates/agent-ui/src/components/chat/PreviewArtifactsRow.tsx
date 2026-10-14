import { ChevronDown, ImageIcon } from "@liveagent/ui/components/IconSet";
import { useLocale } from "@liveagent/ui/i18n/index";
import type { ToolTraceItem } from "@liveagent/ui/lib/chat/assistantBubbleAdapter";
import { cn } from "@liveagent/ui/lib/shared/utils";
import { memo, useState } from "react";
import {
  getNativeDisplayImagePayload,
  NativeDisplayImageBlock,
} from "./assistant-bubble/ToolImages";

/**
 * 回合结束后的「产物预览」行：work trace 收起后，`display_image` 结果
 * （Image / GenerateImage，含 png/jpg/svg 等）仍在答案下方保持可见。
 *
 * 与 `ChangedFilesCard` 同构——都是"回合落定后额外多出来的一条输出"、都可手动折叠、
 * 都不依赖 work-trace 上下文。**不要**改回"有图片就不收起 work trace"：那会让思考过程
 * 在回合结束后一直摊开着。
 */
export const PreviewArtifactsRow = memo(function PreviewArtifactsRow(props: {
  items: readonly ToolTraceItem[];
  readOnly?: boolean;
  className?: string;
}) {
  const { items, readOnly = false, className } = props;
  const { t } = useLocale();
  // 默认展开：用户要的就是"会话完成后产物还在眼前"。折叠态刻意不持久化，
  // 重挂载回到默认展开（虚拟列表会反复重挂载，持久化反而会让人以为预览丢了）。
  const [expanded, setExpanded] = useState(true);
  if (items.length === 0) return null;
  const title = t("chat.previewArtifacts.title").replace("{count}", String(items.length));

  return (
    <div
      data-preview-artifacts-row
      className={cn(
        "preview-artifacts-row overflow-hidden rounded-2xl border border-border/55 bg-background/55 backdrop-blur-sm",
        "dark:border-white/[0.09] dark:bg-white/[0.035]",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        title={t("chat.previewArtifacts.toggle")}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-foreground/70 dark:bg-white/[0.07]">
          <ImageIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight text-foreground/90">
          {title}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded ? (
        <div className="flex flex-col gap-2 border-t border-border/30 px-3 py-2 dark:border-white/[0.05]">
          {items.map((item, index) => {
            const payload = getNativeDisplayImagePayload(item);
            if (!payload) return null;
            return (
              <NativeDisplayImageBlock
                key={item.toolCall.id || `preview-artifact-${index}`}
                payload={payload}
                readOnly={readOnly}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
