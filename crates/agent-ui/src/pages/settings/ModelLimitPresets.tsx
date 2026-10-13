import { Button } from "@liveagent/ui/components/ui/button";
import type { ModelLimitPreset } from "@liveagent/ui/lib/settings/modelLimitPresets";
import { cn } from "@liveagent/ui/lib/shared/utils";

export type { ModelLimitPreset } from "@liveagent/ui/lib/settings/modelLimitPresets";

/**
 * 模型限额输入框上方的快捷填入按钮行。
 *
 * 取值与口径见 `@liveagent/ui/lib/settings/modelLimitPresets`。点击即走输入框既有的
 * onChange 路径，因此 `limitsSource` 会自动落到 `user`（见 `providerUtils.ts` 的
 * `applyProviderModelDraft`），不需要新的保存动作。
 */
export function ModelLimitPresetRow(props: {
  presets: readonly ModelLimitPreset[];
  onPick: (value: number) => void;
  label: string;
}) {
  const { presets, onPick, label } = props;
  return (
    // 用 fieldset 而非 div[role=group]：仓库同族写法见 ComposerModelControls 的
    // 运行控制组。inner div 承担 flex 布局——fieldset 作 flex 容器在部分浏览器有怪癖。
    <fieldset aria-label={label} className="m-0 min-w-0 border-0 p-0">
      <div className="flex flex-wrap gap-1">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              // 覆盖 size="sm" 的 h-8/rounded-md/px-3/text-xs：面板是窄栏，六七个 chip
              // 需要能换行且不喧宾夺主。cn 走 tailwind-merge，覆盖是可靠的。
              "h-6 shrink-0 rounded-full bg-settings-tile-hover px-2 text-tiny font-normal",
              "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onPick(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
