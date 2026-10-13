/**
 * 模型限额输入框的快捷填入取值。
 *
 * **数值口径按需求文档字面给出，不做单位换算**：上下文一行里十进制与二进制并存
 * （`1M (1000000)` 与 `1M (1048576)` 是两个并列按钮），最大输出一行里 `384K` 是
 * 十进制 384000 而其余 `K` 按 1024。这是文档原意，**不要"顺手统一"**。
 *
 * 单独放成纯数据模块（不引入 React）是为了能被测试直接加载——这些数字是需求原文，
 * 值得有断言锁住。
 */
export type ModelLimitPreset = { readonly label: string; readonly value: number };

export const CONTEXT_WINDOW_PRESETS: readonly ModelLimitPreset[] = [
  { label: "128K", value: 128 * 1024 },
  { label: "256K", value: 256 * 1024 },
  { label: "512K", value: 512 * 1024 },
  { label: "1M (1000000)", value: 1_000_000 },
  { label: "1M (1048576)", value: 1_048_576 },
];

export const MAX_OUTPUT_TOKEN_PRESETS: readonly ModelLimitPreset[] = [
  { label: "32K", value: 32 * 1024 },
  { label: "64K", value: 64 * 1024 },
  { label: "128K", value: 128 * 1024 },
  { label: "256K", value: 256 * 1024 },
  { label: "384K (384000)", value: 384_000 },
  { label: "512K", value: 512 * 1024 },
];
