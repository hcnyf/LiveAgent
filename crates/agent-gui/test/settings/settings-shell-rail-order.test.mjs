import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// T1.2：设置页左栏两元素对调——桌面端顶部＝已保存指示器、底部＝返回对话，
// 搜索框留在顶部；Web 端窄屏分支与标题行右侧的已保存指示器不受影响。
const source = readFileSync(
  new URL("../../../agent-ui/src/pages/settings/SettingsShell.tsx", import.meta.url),
  "utf8",
);

test("desktop settings rail keeps the save indicator on top and the back button at the bottom", () => {
  const indicatorIndex = source.indexOf("saveIndicator.dotClass");
  const searchIndex = source.indexOf('t("settings.searchPlaceholder")');
  const navIndex = source.indexOf('"settings-nav flex-1 overflow-y-auto');
  const backIndex = source.indexOf('"settings-back-button flex w-full');
  for (const [name, index] of [
    ["indicator", indicatorIndex],
    ["search", searchIndex],
    ["nav", navIndex],
    ["back", backIndex],
  ]) {
    assert.notEqual(index, -1, `${name} block must exist`);
  }

  // 顶部块：已保存指示器在搜索框之前（搜索框本身仍在导航之上）。
  assert.ok(indicatorIndex < searchIndex, "the save indicator must sit above the search box");
  assert.ok(searchIndex < navIndex, "the search box stays in the top block");
  // 底部块：返回对话在导航之后。
  assert.ok(navIndex < backIndex, "the back button must sit below the navigation list");

  // padding 按新位置回写：顶部块仍是 pt-4，底部块 pb-3。
  assert.match(source.slice(0, indicatorIndex), /px-3 pb-2 pt-4 web:max-820:hidden[\s\S]{0,400}$/);
  assert.match(
    source,
    /\{!web \? \(\s*<div className="px-3 pb-3 pt-2 web:max-820:hidden">/,
    "the back button block must carry the bottom padding (pb-3)",
  );
});

test("the web narrow-screen rail and the header indicator stay untouched", () => {
  // Web 窄屏分支：返回对话仍是左栏首行（在已保存/搜索块之前）。
  const webBackIndex = source.indexOf('"settings-back-button flex cursor-pointer items-center gap-1');
  const desktopTopIndex = source.indexOf("web:max-820:pt-settings-back-bar-pt");
  assert.notEqual(webBackIndex, -1);
  assert.notEqual(desktopTopIndex, -1);
  assert.ok(webBackIndex < source.indexOf("saveIndicator.dotClass"));
  // 标题行右侧的已保存指示器仍只在 Web 端渲染。
  assert.match(source, /\{web && showSaveIndicator \? \(/);
});
