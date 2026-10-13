import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// T1.3：应用代理「跟随系统」的 UI 契约（源码断言）。
// 数据层语义（mode 归一化）由 normalization.test.mjs 锁，这里只锁界面行为与
// 桌面/Web 的分工。
const source = readFileSync(
  new URL("../../../agent-ui/src/pages/settings/SystemSettingsForm.tsx", import.meta.url),
  "utf8",
);

test("the proxy dialog offers a manual/system source switch", () => {
  assert.match(source, /aria-label=\{t\("settings\.systemProxyMode"\)\}/);
  assert.match(source, /<SettingsToggleGroupItem value="manual">/);
  assert.match(source, /<SettingsToggleGroupItem value="system">/);
  assert.match(source, /patchSystemProxy\(\{ mode: next as SystemProxyMode \}\)/);
});

test("manual-only fields and the enable guard are gated by the mode", () => {
  // 手填字段整组只在手动模式下渲染。
  assert.match(source, /\{systemProxy\.mode === "system" \? \(/);
  // 护栏 A（host/port 无效就禁止开启）不再拦"跟随系统"。
  assert.match(
    source,
    /const systemProxyInvalid =\s*systemProxy\.enabled && systemProxy\.mode === "manual" && !proxyConfigValid;/,
  );
  assert.match(
    source,
    /const proxyNeedsConfiguration =\s*!systemProxy\.enabled && systemProxy\.mode === "manual" && !proxyConfigValid;/,
  );
  // 摘要行区分两种来源。
  assert.match(source, /systemProxy\.mode === "system"\s*\? t\("settings\.systemProxySystemActive"\)/);
});

test("the OS reading is only requested on the desktop build", () => {
  // 命令名必须与 Rust 侧注册的一致。
  assert.match(source, /invoke<SystemProxyOsStatus>\("system_proxy_os_status"\)/);
  assert.match(source, /if \(mode !== "system" \|\| isGatewayWebuiRuntime\(\)\) \{/);
  // PAC 提示与"读到的代理"两条分支都在。
  assert.match(source, /systemProxyOsStatus\?\.pacUrl \?/);
  assert.match(source, /t\("settings\.systemProxyPacHint"\)/);
  assert.match(source, /t\("settings\.systemProxySystemDetected"\)/);
});
