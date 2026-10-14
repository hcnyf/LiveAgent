/**
 * 输出预留与单次输出上限。
 *
 * provider 要求 `输入 + max_tokens ≤ 窗口`，于是 `max_tokens` 同时扮演两个角色，
 * 而这两个角色的最优取值恰好相反：
 *
 * - **预留**（决定压缩线能推到多晚）：越小越好，只要还装得下一次像样的回复。把它
 *   当成「模型能吐多少」会把输入预算白白砍掉一大块：1M 窗口配 384k 声明值只剩 63%
 *   输入，安全线把触发线压在窗口的 60% 上下，设置里填 85% 也够不到——看起来就是
 *   「设置没生效」。
 * - **上限**（决定回复会不会被截断）：应该就是声明值，但只有在窗口还装得下时
 *   才给得起。
 *
 * 所以两者分开：压缩线按 `MIN_REQUEST_OUTPUT_TOKENS` 扣输入预算，线上
 * `max_tokens` 按「窗口 − 本次实际输入」动态给，上限仍是声明值。
 */

/**
 * 单次请求至少给输出留的余量。
 *
 * 它只影响压缩线（输入预算 = 窗口 − 这个余量），不影响实际上限：真正发送时
 * `max_tokens` 按当次输入算，输入小时能一路给到声明值。取 8k 是「压缩后还够写
 * 一段完整回复」的量级——再小会让贴近触发线的那些轮次输出被截断。
 */
export const MIN_REQUEST_OUTPUT_TOKENS = 8_000;

/** 模型声明的输出上限（设置里的 `maxOutputToken`）；缺失或 ≤0 视为未配置。 */
export function declaredMaxOutputTokens(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * 压缩策略扣掉的「输出预留」= `min(声明值, MIN_REQUEST_OUTPUT_TOKENS)`。
 *
 * 声明值比余量还小时按声明值扣（模型本来也吐不了那么多）；未配置（0）时返回 0，
 * 让 `decideCompaction` 继续把它判为 disabled。
 */
export function resolveOutputReserve(declaredMaxOutputTokensValue: number | undefined): number {
  const declared = declaredMaxOutputTokens(declaredMaxOutputTokensValue);
  return declared === 0 ? 0 : Math.min(declared, MIN_REQUEST_OUTPUT_TOKENS);
}

/**
 * 线上 `max_tokens` = `min(声明值, 窗口 − 本次输入估算)`，下界 `min(声明值, MIN)`。
 *
 * 返回 `undefined` 表示「不夹紧」（声明值缺失或窗口未知时沿用调用方原值）。
 * 下界保证贴近压缩触发线的那一轮仍有最小输出空间——压缩策略保证输入不超过
 * `窗口 − min(声明值, MIN)`，所以下界不会把窗口算穿。
 */
export function resolveRequestMaxTokens(params: {
  declared: number | undefined;
  contextWindow: number | undefined;
  inputTokens: number;
}): number | undefined {
  const declared = declaredMaxOutputTokens(params.declared);
  if (declared === 0) return undefined;
  const contextWindow =
    typeof params.contextWindow === "number" && Number.isFinite(params.contextWindow)
      ? Math.max(0, Math.floor(params.contextWindow))
      : 0;
  if (contextWindow <= 0) return undefined;
  const floor = Math.min(declared, MIN_REQUEST_OUTPUT_TOKENS);
  const room = contextWindow - Math.max(0, Math.floor(params.inputTokens));
  return Math.max(floor, Math.min(declared, room));
}
