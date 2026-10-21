import { listInvocableModels } from "@liveagent/ui/lib/models/invocableModels";
import type { CustomProvider } from "@liveagent/ui/lib/settings";
import { createProviderRuntimeConfig } from "../providers/runtime/providerRuntimeConfig";
import type { SubagentModelCandidate } from "./agentTool";

/**
 * 把设置里的「允许模型调用」勾选翻成子代理可用的候选（含每个候选自己的 runtime）。
 *
 * 换模型必须连带换 runtime：协议、端点、鉴权都挂在 `ProviderRuntimeConfig` 上，只换
 * model 字符串等于拿 A 家的密钥去请求 B 家。
 *
 * 一个都没勾（或 provider 列表拿不到）时返回空数组 —— 子代理照旧用当前会话模型，
 * 与引入本功能之前完全一致。
 */
export function buildSubagentModelCandidates(
  providers: readonly CustomProvider[] | undefined,
): SubagentModelCandidate[] {
  if (!providers || providers.length === 0) return [];
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const candidates: SubagentModelCandidate[] = [];
  for (const ref of listInvocableModels({ customProviders: providers })) {
    const provider = byId.get(ref.customProviderId);
    if (!provider) continue;
    candidates.push({
      providerId: provider.type,
      model: ref.model,
      // 候选模型不继承会话的档位控件：失败重选只关心"这个模型能不能把活干完"。
      runtime: createProviderRuntimeConfig(provider, ref.model, undefined),
    });
  }
  return candidates;
}
