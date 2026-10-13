import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const presets = loader.loadModule("@liveagent/ui/lib/settings/modelLimitPresets.ts");

test("model limit presets keep the documented literal values", () => {
  // 需求文档给的是**字面值**：上下文那行十进制（1M = 1000000）与二进制（1M = 1048576）
  // 并存；最大输出那行 384K 走十进制 384000，而其余 K 按 1024。
  // 若有人"顺手统一"进制，这里必须变红——标签里带字面值就是为了让 UI 也无法悄悄漂移。
  assert.deepEqual(
    presets.CONTEXT_WINDOW_PRESETS.map((preset) => [preset.label, preset.value]),
    [
      ["128K", 131072],
      ["256K", 262144],
      ["512K", 524288],
      ["1M (1000000)", 1000000],
      ["1M (1048576)", 1048576],
    ],
  );
  assert.deepEqual(
    presets.MAX_OUTPUT_TOKEN_PRESETS.map((preset) => [preset.label, preset.value]),
    [
      ["32K", 32768],
      ["64K", 65536],
      ["128K", 131072],
      ["256K", 262144],
      ["384K (384000)", 384000],
      ["512K", 524288],
    ],
  );
});
