import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from "../settings";

/**
 * 会话类系统通知的桌面实现（agent-gui 专有；WebUI 无系统通知能力，不引用本模块）。
 *
 * 分工：**过滤在这里，发送在 Rust**。
 * - 过滤顺序（spec ①-4）：单项开关 → `notifyWhenFocused`（为 false 且窗口有焦点时
 *   全部拦截，含权限请求）→ 权限。
 * - 发送/权限查询走自家命令（`send_system_notification` 等），不直接 invoke 插件的
 *   `plugin:notification|*`：JS 侧插件包本仓库没装，自家命令的参数形状与错误信息
 *   都在 Rust 里受编译期约束。
 * - 通知失败一律静默降级（打日志），绝不因为通知发不出去而影响会话流程。
 */

export type SystemNotificationKind = "sessionComplete" | "sessionError" | "permissionRequest";

export type NotificationPermissionState = "granted" | "denied" | "prompt";

export const NOTIFICATION_PERMISSION_PROMPT: NotificationPermissionState = "prompt";

let prefs: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
/** 最近一次查询到的权限态；设置页据此显示"被拒"的原因。 */
let permissionState: NotificationPermissionState | null = null;
/** 权限申请只自动发一次，被拒后不反复弹（spec ①-4）。 */
let permissionRequested = false;

/** 设置变化时由宿主（ChatPage）写入；这是本模块唯一的外部输入。 */
export function setNotificationPrefs(next: NotificationSettings): void {
  prefs = { ...next };
}

export function getNotificationPrefs(): NotificationSettings {
  return prefs;
}

export function getNotificationPermissionState(): NotificationPermissionState | null {
  return permissionState;
}

/** 查询权限态（不申请）。设置页挂载时调用，用于显示"被拒"原因。 */
export async function refreshNotificationPermissionState(): Promise<NotificationPermissionState> {
  try {
    permissionState =
      (await invoke<NotificationPermissionState>("notification_permission_state")) ?? "prompt";
  } catch (error) {
    console.warn("[notifications] permission_state failed", error);
  }
  return permissionState ?? "prompt";
}

/** 显式申请权限（设置页的"重新申请"入口）；被拒后再点仍可重试，但不会自动重弹。 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  try {
    permissionState =
      (await invoke<NotificationPermissionState>("request_notification_permission")) ?? "prompt";
  } catch (error) {
    console.warn("[notifications] request_permission failed", error);
  }
  return permissionState ?? "prompt";
}

/**
 * 首次发送前**自动申请一次**：权限处于 prompt 时申请，被拒则此后只发不弹。
 * 返回是否已获授权。
 */
async function ensurePermission(): Promise<boolean> {
  if (permissionState === null) {
    await refreshNotificationPermissionState();
  }
  if (permissionState === "prompt" && !permissionRequested) {
    permissionRequested = true;
    await requestNotificationPermission();
  }
  return permissionState === "granted";
}

/** 窗口当前是否有焦点。拿不到窗口状态时按"有焦点"处理（宁可少发，不打扰）。 */
async function isAppFocused(): Promise<boolean> {
  try {
    return await getCurrentWindow().isFocused();
  } catch {
    return true;
  }
}

/** 发一条系统通知；未通过过滤、无权限或调用失败都不抛错。 */
export async function sendSystemNotification(params: {
  kind: SystemNotificationKind;
  title: string;
  body: string;
}): Promise<void> {
  try {
    if (!prefs[params.kind]) return;
    if (!prefs.notifyWhenFocused && (await isAppFocused())) return;
    if (!(await ensurePermission())) return;
    await invoke("send_system_notification", { title: params.title, body: params.body });
  } catch (error) {
    console.warn("[notifications] send failed", error);
  }
}
