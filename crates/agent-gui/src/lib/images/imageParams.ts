import type { CustomProvider, ProviderModelConfig } from "@liveagent/app/lib/settings";
import {
  findProviderModelConfig,
  isImageGenerationProviderId,
  type ResolvedImageGenerationParams,
  resolveImageGenerationParams,
} from "@liveagent/app/lib/settings";

/**
 * 一次生图调用的目标：用哪个供应商实例的哪个模型。
 *
 * 生图**没有用户发起的入口**（spec 决策 Q=甲）：模型只能通过工具请求生图，
 * 因此"用哪个供应商"必须有一条确定性规则，而不是弹窗问用户。
 */
export type ImageGenerationTarget = {
  provider: CustomProvider;
  model: string;
  modelConfig: ProviderModelConfig;
};

/** 全部可用目标：生图类别 + 生图协议子集 + 已启用的模型，按设置里的顺序。 */
export function listImageGenerationTargets(
  providers: readonly CustomProvider[] | undefined,
): ImageGenerationTarget[] {
  const targets: ImageGenerationTarget[] = [];
  for (const provider of providers ?? []) {
    if (provider.kind !== "image") continue;
    if (!isImageGenerationProviderId(provider.type)) continue;
    for (const model of provider.activeModels) {
      targets.push({ provider, model, modelConfig: findProviderModelConfig(provider, model) });
    }
  }
  return targets;
}

/**
 * 解析本次调用该用哪个目标。优先级（每一级都要求命中已配置的生图目标）：
 * 1. `model` 参数精确匹配模型 id（多供应商同名模型时取设置顺序里第一个）；
 * 2. `provider` 参数匹配供应商 id 或名称（大小写不敏感）；
 * 3. 第一个可用目标。
 *
 * 都不匹配时返回 `null`——调用方据此给出"没有配置生图供应商"的明确报错，
 * 而不是悄悄换一个供应商去花用户的钱。
 */
export function resolveImageGenerationTarget(
  providers: readonly CustomProvider[] | undefined,
  args?: { provider?: unknown; model?: unknown },
): ImageGenerationTarget | null {
  const targets = listImageGenerationTargets(providers);
  if (targets.length === 0) return null;

  const modelArg = typeof args?.model === "string" ? args.model.trim() : "";
  if (modelArg) {
    const byModel = targets.find((target) => target.model === modelArg);
    if (byModel) return byModel;
  }

  const providerArg = typeof args?.provider === "string" ? args.provider.trim().toLowerCase() : "";
  if (providerArg) {
    const byProvider = targets.find(
      (target) =>
        target.provider.id.toLowerCase() === providerArg ||
        target.provider.name.trim().toLowerCase() === providerArg,
    );
    if (byProvider) return byProvider;
  }

  return targets[0] ?? null;
}

/** 参数解析：调用参数 ?? 模型配置默认值 ?? 协议默认值（规则在共享模块里）。
 *
 * 注意：非法取值在这里一律按"未传"处理（对落库配置是正确语义）。**调用参数**的
 * 越界不能靠这里发现——那会静默回落到默认值；调用方必须在原始入参上先校验
 * （见 `lib/tools/imageTools.ts` 的张数校验）。 */
export function resolveTargetImageParams(
  target: ImageGenerationTarget,
  callOverrides?: { size?: unknown; quality?: unknown; count?: unknown },
): ResolvedImageGenerationParams {
  return resolveImageGenerationParams(
    target.provider.type as Parameters<typeof resolveImageGenerationParams>[0],
    target.modelConfig,
    callOverrides,
    target.provider.baseUrl,
  );
}
