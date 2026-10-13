import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "@liveagent/ui/lib/settings";

/**
 * WebUI 的系统通知实现：**全部空操作**。
 *
 * WebUI 跑在浏览器里，既没有 Tauri 的通知插件，也不该由网关替某台设备发通知
 * （通知是"这台机器上的会话状态"）。因此这里只保留与桌面端一致的导出签名，
 * 让共享 UI（`SystemSettingsForm`）能无差别引用；设置页在 Web 端也隐藏整个通知分节。
 */

export type SystemNotificationKind = "sessionComplete" | "sessionError" | "permissionRequest";
export type NotificationPermissionState = "granted" | "denied" | "prompt";

export const NOTIFICATION_PERMISSION_PROMPT: NotificationPermissionState = "prompt";

export function setNotificationPrefs(_next: NotificationSettings): void {}

export function getNotificationPrefs(): NotificationSettings {
  return { ...DEFAULT_NOTIFICATION_SETTINGS };
}

export function getNotificationPermissionState(): NotificationPermissionState | null {
  return null;
}

export async function refreshNotificationPermissionState(): Promise<NotificationPermissionState> {
  return NOTIFICATION_PERMISSION_PROMPT;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  return NOTIFICATION_PERMISSION_PROMPT;
}

export async function sendSystemNotification(_params: {
  kind: SystemNotificationKind;
  title: string;
  body: string;
}): Promise<void> {}
