/**
 * 单次请求的输出预留上限。
 *
 * 模型的 `maxOutputToken` 描述的是「这个模型一次最多能吐多少」，目录里抓到的值
 * 常常远超单回合真实需要（1M 窗口的 deepseek-v4.1-flash 是 384k）。主请求会把它
 * 原样当作 `max_tokens` 发出去，而 provider 要求 `输入 + max_tokens ≤ 窗口`，
 * 于是整份预留把输入预算挤掉一大块：1,048,576 − 384,000 = 664,576，自动压缩的
 * 物理上限被压在窗口的 60% 上下——设置里填 85% 也够不到，看起来就像「设置没生效」。
 *
 * 单回合输出极少超过 32k（长文件也是分批写入），所以线上 `max_tokens` 与压缩策略
 * 的输入预算统一按这个上限取「有效最大输出」；模型声明的原始值仍用于设置界面展示
 * 与思考预算换算。压缩摘要请求本来就用同一量级的上限（`TRANSCRIPT_MAX_OUTPUT_TOKENS`）。
 */
export const REQUEST_MAX_OUTPUT_TOKENS = 32_000;

/**
 * 有效最大输出 = `min(声明值, REQUEST_MAX_OUTPUT_TOKENS)`。
 *
 * 声明值缺失或 ≤ 0 时原样返回 0：调用方用 0 表示「这个模型没配输出上限」，
 * 压缩策略据此把它判为 disabled，不能被这个上限悄悄救活。
 */
export function resolveEffectiveMaxOutputTokens(
  declaredMaxOutputTokens: number | undefined,
): number {
  const declared =
    typeof declaredMaxOutputTokens === "number" && Number.isFinite(declaredMaxOutputTokens)
      ? Math.max(0, Math.floor(declaredMaxOutputTokens))
      : 0;
  if (declared <= 0) return 0;
  return Math.min(declared, REQUEST_MAX_OUTPUT_TOKENS);
}
