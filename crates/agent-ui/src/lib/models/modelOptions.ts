import { findCatalogModelAcrossProviders } from "./modelCatalog";
import { toModelValue } from "./modelValue";

export type SharedModelOption<TProviderType extends string = string> = {
  value: string;
  label: string;
  providerId: string;
  providerName: string;
  providerType: TProviderType;
  model: string;
  reasoning?: boolean;
  vision?: boolean;
  contextWindow?: number;
};

export type ModelOptionGroup<TProviderType extends string = string> = {
  id: string;
  name: string;
  providerType: TProviderType;
  opts: SharedModelOption<TProviderType>[];
};

export type ModelOptionsSettings<TProviderType extends string = string> = {
  customProviders: readonly {
    id: string;
    name: string;
    type: TProviderType;
    /** 用途分类。`"image"` 的供应商不产生对话模型选项；缺省视为 `chat`。 */
    kind?: string;
    activeModels: readonly string[];
    models?: readonly {
      id: string;
      displayName?: string;
      contextWindow: number;
      limitsSource?: string;
      inputModalities?: readonly string[];
    }[];
  }[];
  selectedModel?: {
    customProviderId: string;
    model: string;
  } | null;
};

export function groupModelOptionsByProvider<TProviderType extends string>(
  modelOptions: readonly SharedModelOption<TProviderType>[],
) {
  const groups: ModelOptionGroup<TProviderType>[] = [];
  const groupMap = new Map<string, ModelOptionGroup<TProviderType>>();
  for (const option of modelOptions) {
    const existing = groupMap.get(option.providerId);
    if (existing) {
      existing.opts.push(option);
      continue;
    }
    const group: ModelOptionGroup<TProviderType> = {
      id: option.providerId,
      name: option.providerName,
      providerType: option.providerType,
      opts: [option],
    };
    groupMap.set(option.providerId, group);
    groups.push(group);
  }
  return groups;
}

export type ProviderSortMode = "type" | "alpha";

const PROVIDER_SORT_MODE_STORAGE_KEY = "chatModelPickerProviderSort";

export function readStoredProviderSortMode(): ProviderSortMode {
  try {
    return localStorage.getItem(PROVIDER_SORT_MODE_STORAGE_KEY) === "alpha" ? "alpha" : "type";
  } catch {
    return "type";
  }
}

export function persistProviderSortMode(mode: ProviderSortMode): void {
  try {
    localStorage.setItem(PROVIDER_SORT_MODE_STORAGE_KEY, mode);
  } catch {
    return;
  }
}

export function sortModelOptionGroups<TProviderType extends string>(
  groups: readonly ModelOptionGroup<TProviderType>[],
  mode: ProviderSortMode,
): ModelOptionGroup<TProviderType>[] {
  if (mode === "alpha") {
    return [...groups].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }),
    );
  }
  const typeOrder = new Map<string, number>();
  for (const group of groups) {
    if (!typeOrder.has(group.providerType)) typeOrder.set(group.providerType, typeOrder.size);
  }
  return [...groups].sort(
    (left, right) =>
      (typeOrder.get(left.providerType) ?? 0) - (typeOrder.get(right.providerType) ?? 0),
  );
}

export function buildModelOptions<TProviderType extends string>(
  settings: ModelOptionsSettings<TProviderType>,
  options?: { floatSelectedFirst?: boolean },
): SharedModelOption<TProviderType>[] {
  const modelOptions: SharedModelOption<TProviderType>[] = [];
  for (const provider of settings.customProviders) {
    // 生图供应商绝不进入对话模型列表。这是 agent-gui 与 agent-gateway/web 共用的
    // 消费点：漏掉会让生图模型出现在所有模型选择器里，并污染按 providerType 的分组排序。
    if (provider.kind === "image") continue;
    for (const model of provider.activeModels) {
      const configured = provider.models?.find((item) => item.id === model);
      const catalog = findCatalogModelAcrossProviders(model);
      modelOptions.push({
        providerType: provider.type,
        providerId: provider.id,
        providerName: provider.name,
        model,
        value: toModelValue(provider.id, model),
        label: configured?.displayName?.trim() || model,
        reasoning: Boolean(catalog?.thinking),
        vision: (configured?.inputModalities ?? catalog?.inputModalities)?.includes("image"),
        contextWindow:
          configured?.limitsSource === "fallback"
            ? catalog?.contextWindow
            : (configured?.contextWindow ?? catalog?.contextWindow),
      });
    }
  }
  if (!settings.selectedModel || options?.floatSelectedFirst === false) return modelOptions;

  const selectedValue = toModelValue(
    settings.selectedModel.customProviderId,
    settings.selectedModel.model,
  );
  const selectedIndex = modelOptions.findIndex((option) => option.value === selectedValue);
  if (selectedIndex <= 0) return modelOptions;

  const [selectedOption] = modelOptions.splice(selectedIndex, 1);
  modelOptions.unshift(selectedOption);
  return modelOptions;
}
