import type { ReactNode } from "react";

export type UiSurface = "desktop" | "web";

export type UiServices = Readonly<Record<string, unknown>>;

export type UiExtensionSlots = {
  sidebarLeading?: ReactNode;
  mainLeading?: ReactNode;
};

export type SettingsSaveState =
  | { status: "idle" | "saving" | "saved" }
  | { status: "error"; message: string };

export type SettingsSectionDefinition<Context> = {
  id: string;
  groupKey: string;
  groupOrder: number;
  order: number;
  labelKey: string;
  icon: ReactNode;
  contentMode?: "scroll" | "fill";
  showSaveIndicator?: boolean;
  /**
   * 导航项右侧的提醒角标（0 或缺省则不显示）。给「有待办需要你看一眼」的入口用，
   * 例如记忆的待审核条数。宿主在构建定义时算好数值传进来，`SettingsShell` 只负责画。
   */
  badgeCount?: number;
  isAvailable?: (services: UiServices) => boolean;
  render: (context: Context) => ReactNode;
};

export type UiExtensionRegistry<Context> = {
  surface: UiSurface;
  services: UiServices;
  slots: UiExtensionSlots;
  settingsSections: readonly SettingsSectionDefinition<Context>[];
};
