import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// T1.4 的三个触发点 + 设置页分节 + Rust 命令名一致性（源码断言）。
const read = (relativePath) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const hookSource = read("src/pages/chat/hooks/useNotifyToasts.ts");
const chatPageSource = read("src/pages/ChatPage.tsx");
const formSource = readFileSync(
  new URL("../../../agent-ui/src/pages/settings/SystemSettingsForm.tsx", import.meta.url),
  "utf8",
);
const rustCommands = readFileSync(
  new URL("../../src-tauri/src/commands/app/notifications.rs", import.meta.url),
  "utf8",
);
const rustLib = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("the three trigger points send system notifications", () => {
  // 1) 会话出错：与 toast 同一分支。
  assert.match(
    hookSource,
    /toast\.error\(errorMessage, \{ id: `\$\{scope\}-error` \}\);[\s\S]{0,200}?sendSystemNotification\(\{[\s\S]{0,120}?kind: "sessionError"/,
  );
  // 2) 会话完成："运行中 → 空闲"的下降沿，且出错结束时不再补一条完成。
  assert.match(hookSource, /const wasRunningRef = useRef\(isRunning\)/);
  assert.match(hookSource, /if \(!wasRunning \|\| isRunning \|\| errorMessage\) return;/);
  assert.match(hookSource, /kind: "sessionComplete"/);
  // 3) 权限请求：待审批"空 → 非空"报一次 + 超时前补一条。
  assert.match(hookSource, /if \(previous > 0\) return;/);
  assert.match(hookSource, /kind: "permissionRequest"/);
  assert.match(hookSource, /APPROVAL_REMINDER_LEAD_MS = 60_000/);
  assert.match(hookSource, /getPendingToolApprovalsSnapshot\(conversationId\)\.length === 0\) return;/);
  // 过滤只在模块里做一次，hook 不重复判 prefs。
  assert.doesNotMatch(hookSource, /notifyWhenFocused/);
});

test("ChatPage feeds the hook the run state and pushes the preferences", () => {
  assert.match(chatPageSource, /setNotificationPrefs\(settings\.system\.notifications\)/);
  assert.match(chatPageSource, /conversationId: currentConversationId,/);
  assert.match(chatPageSource, /isRunning: runningConversationIds\.has\(currentConversationId\)/);
});

test("the settings form exposes four switches and hides the section on the web build", () => {
  for (const key of [
    "sessionComplete",
    "sessionError",
    "permissionRequest",
    "notifyWhenFocused",
  ]) {
    assert.match(formSource, new RegExp(`key: "${key}"`), `${key} must be offered`);
  }
  assert.match(formSource, /\{isGatewayWebuiRuntime\(\) \? null : \(\s*<SettingsGroup title=\{t\("settings\.notifications"\)\}>/);
  // 被拒后显示原因并可手动重申请，不自动反复弹。
  assert.match(formSource, /t\("settings\.notificationsPermissionDenied"\)/);
  assert.match(formSource, /requestNotificationPermission\(\)\.then\(setNotificationPermission\)/);
});

test("the desktop notification module owns the filtering rules", () => {
  const moduleSource = read("src/lib/system/notifications.ts");
  assert.match(moduleSource, /if \(!prefs\[params\.kind\]\) return;/);
  assert.match(moduleSource, /if \(!prefs\.notifyWhenFocused && \(await isAppFocused\(\)\)\) return;/);
  assert.match(moduleSource, /if \(permissionState === "prompt" && !permissionRequested\)/);
});

test("Rust command names match what the frontend invokes", () => {
  for (const command of [
    "send_system_notification",
    "notification_permission_state",
    "request_notification_permission",
  ]) {
    assert.match(rustCommands, new RegExp(`pub async fn ${command}\\(`), `${command} must exist`);
    assert.match(
      rustLib,
      new RegExp(`commands::notifications::${command},`),
      `${command} must be registered`,
    );
  }
});
