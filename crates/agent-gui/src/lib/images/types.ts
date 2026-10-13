import type { CustomProvider } from "@liveagent/app/lib/settings";

/** 一张生成出来的图片：仍是 base64，落盘与转存由上层决定。 */
export type GeneratedImage = {
  dataBase64: string;
  mimeType: string;
};

/** 一次生图调用的全部输入（已解析过目标与参数）。 */
export type GenerateImagesRequest = {
  provider: CustomProvider;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
  /** 参考图（图生图/编辑）。空数组 = 纯文生图。 */
  referenceImages?: readonly GeneratedImage[];
  signal?: AbortSignal;
};
