import type { Api, Model } from "@earendil-works/pi-ai";

/**
 * 用户显式声明的输入模态原文（含 "pdf"）挂在运行时模型上的附属字段。
 *
 * 为什么另挂字段而不用 `Model.input`：pi-ai 的 `Model.input` 类型只接受
 * "text" | "image"，而用户声明可含 "pdf"（决定 PDF 是否原生内联），
 * 见 nativeResponsesAttachments 的 supportsNativePdfInline。
 *
 * 语义：缺失 = 自动（走各 provider 的内置推断与官方端点主机名规则）；
 * 存在 = 用户显式勾选（含仅 ["text"] 这种"仅文本"的显式否定）。
 * 值由设置侧 normalizeInputModalities 归一化（规范顺序 text → image → pdf、
 * 恒含 text），此处不再重复校验。
 *
 * 本模块刻意零运行期依赖：附件模块由 node 测试用 esbuild loader 直接加载，
 * 引任何重模块都会把 pi-ai 子路径拖进所有附件测试。
 * KEEP IN SYNC: modelFactory.createModelFromConfig（唯一写入点）。
 */
export type ModelInputModalitiesCarrier = {
  inputModalitiesOverride?: readonly string[];
};

export function withInputModalitiesDeclaration<T extends Model<Api>>(
  model: T,
  declared: readonly string[] | undefined,
): T {
  if (!declared || declared.length === 0) return model;
  return { ...model, inputModalitiesOverride: declared } as T;
}

export function readInputModalitiesDeclaration(
  model: Model<Api> | undefined,
): readonly string[] | undefined {
  const declared = (model as (Model<Api> & ModelInputModalitiesCarrier) | undefined)
    ?.inputModalitiesOverride;
  return Array.isArray(declared) && declared.length > 0 ? declared : undefined;
}

/** 是否显式勾选了某个模态；自动态（无声明）恒为 false。 */
export function declaresInputModality(model: Model<Api> | undefined, modality: string): boolean {
  return readInputModalitiesDeclaration(model)?.includes(modality) ?? false;
}
