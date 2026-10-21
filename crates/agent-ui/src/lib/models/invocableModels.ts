import type { CustomProvider, ProviderId } from "@liveagent/app/lib/settings";

/**
 * 后台任务（启动子代理、代码审查…）挑模型的候选列表。
 *
 * 用户在「模型配置」里给模型勾了「允许模型调用」才进列表（且必须处于启用状态）；
 * 一个都没勾时，这类任务回落到**当前会话模型**（调用方自己兜底，见
 * `pickInvocableModelOrCurrent`）。
 *
 * 这里只做纯挑选：不碰运行态、不认识「谁在跑」。失败重选由调用方拿着 `exclude`
 * 逐个试——每次失败把用过的模型加进 `exclude`，自然就轮到下一个。
 */
export type InvocableModelRef = {
  customProviderId: string;
  model: string;
  /** 供应商协议类型：请求期决定 wire 用哪套能力。 */
  providerType: ProviderId;
};

/** 候选模型的稳定键（`供应商::模型`），用于去重与 `exclude`。 */
export function invocableModelKey(ref: { customProviderId: string; model: string }): string {
  return `${ref.customProviderId}::${ref.model}`;
}

/** 只要求带供应商列表：WebUI 的窄视图类型与桌面端 AppSettings 都能直接传。 */
type InvocableSettings = { customProviders: readonly CustomProvider[] };

/**
 * 所有可被自动调用的模型，按设置里的供应商顺序、再按模型顺序排列（顺序即优先序）。
 * 只收「启用 + 显式勾选允许调用」的组合：勾了但没启用的模型不该被选中。
 */
export function listInvocableModels(settings: InvocableSettings): InvocableModelRef[] {
  const out: InvocableModelRef[] = [];
  for (const provider of settings.customProviders) {
    const active = new Set(provider.activeModels);
    for (const config of provider.models) {
      if (!config.allowModelInvocation) continue;
      if (!active.has(config.id)) continue;
      out.push({
        customProviderId: provider.id,
        model: config.id,
        providerType: provider.type,
      });
    }
  }
  return out;
}

/**
 * 挑下一个候选：跳过 `exclude` 里已经试过的。没有候选时返回 undefined（调用方回落到
 * 当前会话模型）。
 *
 * `offset` 用来在同一轮里轮流起头，避免所有任务总落在同一个模型上（模型越靠前越容易
 * 被压满）。
 */
export function pickInvocableModel(
  settings: InvocableSettings,
  options: { exclude?: ReadonlySet<string>; offset?: number } = {},
): InvocableModelRef | undefined {
  const candidates = listInvocableModels(settings);
  if (candidates.length === 0) return undefined;
  const exclude = options.exclude ?? new Set<string>();
  const start = Math.abs(Math.floor(options.offset ?? 0)) % candidates.length;
  for (let step = 0; step < candidates.length; step += 1) {
    const candidate = candidates[(start + step) % candidates.length];
    if (!candidate) continue;
    if (exclude.has(invocableModelKey(candidate))) continue;
    return candidate;
  }
  return undefined;
}

/** 同上，但没有候选（或全试过了）时回落到调用方给的当前会话模型。 */
export function pickInvocableModelOrCurrent(
  settings: InvocableSettings,
  current: InvocableModelRef,
  options: { exclude?: ReadonlySet<string>; offset?: number } = {},
): InvocableModelRef {
  return pickInvocableModel(settings, options) ?? current;
}
