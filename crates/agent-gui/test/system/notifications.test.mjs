import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// 系统通知模块（lib/system/notifications.ts）的过滤规则锁：
// 单项开关 → notifyWhenFocused（有焦点全拦）→ 权限（prompt 只自动申请一次）。
// 每个用例都用新的 loader，拿到全新的模块级状态（prefs / 权限态）。
function createEnv(options = {}) {
  const calls = [];
  let focused = options.focused ?? false;
  let permissionState = options.permissionState ?? "granted";
  let requestResult = options.requestResult ?? "granted";
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        invoke: async (command, args) => {
          calls.push({ command, args });
          if (command === "notification_permission_state") return permissionState;
          if (command === "request_notification_permission") {
            permissionState = requestResult;
            return requestResult;
          }
          if (command === "send_system_notification") return undefined;
          throw new Error(`unexpected command ${command}`);
        },
      },
      "@tauri-apps/api/window": {
        getCurrentWindow: () => ({
          isFocused: async () => focused,
        }),
      },
    },
  });
  const module = loader.loadModule("src/lib/system/notifications.ts");
  return {
    module,
    calls,
    sends: () => calls.filter((call) => call.command === "send_system_notification"),
    setFocused: (next) => {
      focused = next;
    },
  };
}

const SESSION_ERROR = {
  kind: "sessionError",
  title: "Session error",
  body: "boom",
};

test("disabled kinds never reach the host", async () => {
  const env = createEnv();
  env.module.setNotificationPrefs({
    sessionComplete: false,
    sessionError: false,
    permissionRequest: false,
    notifyWhenFocused: true,
  });
  await env.module.sendSystemNotification(SESSION_ERROR);
  await env.module.sendSystemNotification({ ...SESSION_ERROR, kind: "sessionComplete" });
  await env.module.sendSystemNotification({ ...SESSION_ERROR, kind: "permissionRequest" });
  assert.deepEqual(env.calls, [], "全部关掉时不该有任何 IPC");
});

test("notifyWhenFocused=false suppresses everything while the window is focused", async () => {
  const env = createEnv({ focused: true });
  env.module.setNotificationPrefs({
    sessionComplete: true,
    sessionError: true,
    permissionRequest: true,
    notifyWhenFocused: false,
  });
  await env.module.sendSystemNotification(SESSION_ERROR);
  await env.module.sendSystemNotification({ ...SESSION_ERROR, kind: "permissionRequest" });
  assert.deepEqual(env.calls, [], "有焦点时连权限请求都不发");

  // 失焦后同样两条都要发出去（权限已授权）。
  env.setFocused(false);
  await env.module.sendSystemNotification(SESSION_ERROR);
  assert.equal(env.sends().length, 1);
  assert.deepEqual(env.sends()[0].args, { title: "Session error", body: "boom" });
});

test("a prompt permission is requested once, and a denial stops further sends", async () => {
  const env = createEnv({ permissionState: "prompt", requestResult: "denied" });
  env.module.setNotificationPrefs({
    sessionComplete: true,
    sessionError: true,
    permissionRequest: true,
    notifyWhenFocused: true,
  });
  await env.module.sendSystemNotification(SESSION_ERROR);
  // 第一次：查权限 → 申请 → 被拒 → 不发。
  assert.deepEqual(
    env.calls.map((call) => call.command),
    ["notification_permission_state", "request_notification_permission"],
  );
  // 第二次：已知被拒，连权限查询都不再发（不反复弹、也不重复 IPC），仍不发通知。
  env.calls.length = 0;
  await env.module.sendSystemNotification(SESSION_ERROR);
  assert.deepEqual(env.calls, []);
  assert.equal(env.module.getNotificationPermissionState(), "denied");
});

test("granted permission sends the localized payload", async () => {
  const env = createEnv({ permissionState: "granted" });
  env.module.setNotificationPrefs({
    sessionComplete: true,
    sessionError: true,
    permissionRequest: true,
    notifyWhenFocused: true,
  });
  await env.module.sendSystemNotification({
    kind: "permissionRequest",
    title: "Approval needed",
    body: "2 tool call(s) are waiting",
  });
  assert.equal(env.sends().length, 1);
  assert.deepEqual(env.sends()[0].args, {
    title: "Approval needed",
    body: "2 tool call(s) are waiting",
  });
});
