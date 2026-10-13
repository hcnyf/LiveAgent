import { generateGeminiImages } from "./adapters/geminiImages";
import { editOpenAIImages, generateOpenAIImages } from "./adapters/openaiImages";
import type { GeneratedImage, GenerateImagesRequest } from "./types";

export { decodeBase64ToBytes, encodeBytesToBase64 } from "./base64";
export type { ImageGenerationTarget } from "./imageParams";
export {
  listImageGenerationTargets,
  resolveImageGenerationTarget,
  resolveTargetImageParams,
} from "./imageParams";
export type { GeneratedImage, GenerateImagesRequest } from "./types";

/**
 * 生图入口：按协议分派到各适配器。**两个值各一条真实实现**，没有默认分支
 * ——生图供应商的协议在写入时就被限制在 `codex` / `gemini`（见
 * `lib/settings/imageGeneration.ts`），出现第三种就是配置被手工改坏了，
 * 此时应当明确报错而不是猜一个协议去发请求。
 */
export async function generateImages(request: GenerateImagesRequest): Promise<GeneratedImage[]> {
  const referenceImages = request.referenceImages ?? [];
  const providerId = request.provider.type;
  if (providerId === "codex") {
    if (referenceImages.length > 0) {
      return editOpenAIImages({ ...request, referenceImages });
    }
    return generateOpenAIImages(request);
  }
  if (providerId === "gemini") {
    return generateGeminiImages({ ...request, referenceImages });
  }
  throw new Error(
    `供应商 ${request.provider.name} 的协议（${providerId}）不支持生图：只支持 codex 与 gemini`,
  );
}
