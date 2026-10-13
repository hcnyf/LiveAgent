import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { IMAGE_COUNT_MAX, IMAGE_COUNT_MIN } from "@liveagent/app/lib/settings";
import { invoke } from "@tauri-apps/api/core";
import { Type } from "typebox";
import { generateImages } from "../images/generateImage";
import { saveImageArtifact } from "../images/imageArtifacts";
import {
  listImageGenerationTargets,
  resolveImageGenerationTarget,
  resolveTargetImageParams,
} from "../images/imageParams";
import type { GeneratedImage } from "../images/types";
import type { CustomProvider } from "../settings";
import type { DisplayImageItemDetails, DisplayImageResultDetails } from "./builtinTypes";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";

/**
 * `GenerateImage`：把"用配置好的供应商生成图片"作为**唯一入口**暴露给模型
 * （spec 决策：不做输入框按钮与弹窗，模型面向单一路径）。
 *
 * 三条硬约束（都在 spec 里定死）：
 * 1. **结果复用 `display_image` 契约**，不新增结果类型——`ToolImages.tsx`、
 *    `requestContextSanitizer.ts`、`ToolCallItem.tsx` 的既有分支零改动即生效；
 * 2. **模型只看到路径**：内联图片字节在请求上下文里被既有脱敏器整段替换为
 *    路径文本（`requestContextSanitizer` 对 `details.kind === "display_image"` 的
 *    结果做处理），因此这里照 `Image` 工具的既有做法带上内联块供 UI 渲染；
 * 3. **默认审批 `ask`**：生图有真实费用与外部副作用（见 metadata.defaultPolicy
 *    与 `lib/tools/toolPolicy.ts`），可由 `SystemSettings.toolPolicies` 覆盖。
 */

const TOOL_NAME = "GenerateImage";

/** 与 `fsTools.ts` 的 `MAX_DISPLAY_IMAGE_PATHS` 同口径：超出就没有地方展示。 */
const MAX_DISPLAY_IMAGE_PATHS = 12;

type ReadImageSourceResponse = {
  kind?: string;
  data?: string;
  mimeType?: string;
  path?: string;
  sizeBytes?: number;
  contentHash?: string;
  mtimeMs?: number;
};

function asToolArgs(toolCall: ToolCall): Record<string, unknown> {
  const args = toolCall.arguments;
  return args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

function errorResult(toolCall: ToolCall, message: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text: message }],
    details: {},
    isError: true,
    timestamp: Date.now(),
  };
}

export function createImageTools(params: {
  workdir: string;
  /** 实时读取权威供应商配置（不是 turn 级快照），与 getToolPolicies 同策略。 */
  getImageProviders: () => readonly CustomProvider[] | undefined;
}): BuiltinToolBundle {
  const tools = [
    {
      name: TOOL_NAME,
      description: [
        "Generate one or more images from a text prompt using the user's configured image-generation provider.",
        "Returns the generated image file paths; the images are shown in the chat automatically.",
        "The result contains only file paths — call Image (or Read) on a returned path if you need to look at the bytes yourself.",
        "Pass reference_images (local image paths) to edit an existing image instead of generating from scratch.",
        "Generating images costs the user real money, so only call this when the user actually asked for an image.",
      ].join(" "),
      parameters: Type.Object({
        prompt: Type.String(),
        provider: Type.Optional(Type.String()),
        model: Type.Optional(Type.String()),
        size: Type.Optional(Type.String()),
        quality: Type.Optional(Type.String()),
        count: Type.Optional(Type.Number()),
        reference_images: Type.Optional(Type.Array(Type.String())),
      }),
    },
  ];

  async function readReferenceImage(source: string): Promise<GeneratedImage> {
    const response = await invoke<ReadImageSourceResponse>("fs_read_image_source", {
      workdir: params.workdir,
      source,
      source_type: "path",
      mime_type: null,
    });
    if (response.kind !== "image" || typeof response.data !== "string" || !response.data) {
      throw new Error(`${source} 不是可用的图片文件`);
    }
    return {
      dataBase64: response.data,
      mimeType: response.mimeType?.trim() || "image/png",
    };
  }

  async function executeToolCall(
    toolCall: ToolCall,
    signal?: AbortSignal,
  ): Promise<ToolResultMessage> {
    const args = asToolArgs(toolCall);
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    if (!prompt) return errorResult(toolCall, "GenerateImage requires a non-empty prompt.");

    const providers = params.getImageProviders();
    const available = listImageGenerationTargets(providers);
    if (available.length === 0) {
      return errorResult(
        toolCall,
        "没有可用的生图供应商：请在设置 → 供应商里添加一个「生图模型」类别的供应商（协议只支持 codex / gemini）并勾选至少一个模型。",
      );
    }
    const target = resolveImageGenerationTarget(providers, args);
    if (!target) {
      return errorResult(
        toolCall,
        "指定的生图供应商或模型不在已配置的可用生图目标里；请省略 provider/model 参数使用默认目标。",
      );
    }

    const resolved = resolveTargetImageParams(target, {
      size: args.size,
      quality: args.quality,
      count: args.count,
    });
    // 越界必须明确报错而不是静默截断（spec 验收 6）。注意判定必须落在**原始入参**
    // 上：`resolveImageGenerationParams` 对非法值一律当"未传"（那对落库配置是正确
    // 语义），若在这里才发现，count=20 会静默回落到模型默认张数——正是要禁止的行为。
    const rawCount = args.count;
    if (rawCount !== undefined && rawCount !== null) {
      const requested = typeof rawCount === "number" ? rawCount : Number(rawCount);
      if (
        !Number.isInteger(requested) ||
        requested < IMAGE_COUNT_MIN ||
        requested > MAX_DISPLAY_IMAGE_PATHS
      ) {
        return errorResult(
          toolCall,
          `一次最多生成 ${MAX_DISPLAY_IMAGE_PATHS} 张（收到 count=${String(rawCount)}）；请把张数降到 ${IMAGE_COUNT_MIN}-${IMAGE_COUNT_MAX} 之间后重试。`,
        );
      }
    }
    // 防御性兜底：模型配置的默认张数在落库时已被归一化到同一区间，走到这里说明
    // 归一化被绕过，同样按明确错误处理。
    if (resolved.count > MAX_DISPLAY_IMAGE_PATHS) {
      return errorResult(
        toolCall,
        `一次最多生成 ${MAX_DISPLAY_IMAGE_PATHS} 张（解析后 count=${resolved.count}）；请把张数降到 ${IMAGE_COUNT_MIN}-${IMAGE_COUNT_MAX} 之间后重试。`,
      );
    }

    const referencePaths = Array.isArray(args.reference_images)
      ? args.reference_images.filter(
          (item): item is string => typeof item === "string" && !!item.trim(),
        )
      : [];

    try {
      const referenceImages: GeneratedImage[] = [];
      for (const reference of referencePaths) {
        referenceImages.push(await readReferenceImage(reference.trim()));
      }

      const generated = await generateImages({
        provider: target.provider,
        model: target.model,
        prompt,
        size: resolved.size,
        quality: resolved.quality,
        count: resolved.count,
        referenceImages,
        ...(signal ? { signal } : {}),
      });

      const details: DisplayImageItemDetails[] = [];
      const inlineBlocks: Array<{ type: "image"; data: string; mimeType: string }> = [];
      for (const image of generated) {
        const saved = await saveImageArtifact({
          dataBase64: image.dataBase64,
          mimeType: image.mimeType,
        });
        details.push({
          path: saved.path,
          absolutePath: saved.path,
          displayPath: saved.path,
          sourceType: "path",
          renderMode: "inline",
          mimeType: saved.mimeType,
          sizeBytes: saved.sizeBytes,
          contentHash: saved.contentHash,
        });
        inlineBlocks.push({
          type: "image",
          data: image.dataBase64,
          mimeType: image.mimeType,
        });
      }

      const resultDetails: DisplayImageResultDetails = {
        kind: "display_image",
        images: details,
        loadMode: "inline",
        path: details[0]?.path,
        mimeType: details[0]?.mimeType,
        sizeBytes: details[0]?.sizeBytes,
        contentHash: details[0]?.contentHash,
      };
      const text = [
        `Generated ${details.length} image(s) with ${target.provider.name} / ${target.model}.`,
        `size=${resolved.size} quality=${resolved.quality} count=${resolved.count}`,
        ...details.map((image, index) => `${index + 1}. ${image.path}`),
        "The images are shown in the chat; these files live in the app's image temp directory and expire after 30 days unless saved to the workspace.",
      ].join("\n");

      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text }, ...inlineBlocks],
        details: resultDetails,
        isError: false,
        timestamp: Date.now(),
      };
    } catch (error) {
      return errorResult(
        toolCall,
        `生图失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    groupId: "system",
    tools,
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        TOOL_NAME,
        {
          groupId: "system",
          kind: "image",
          isReadOnly: false,
          displayCategory: "other",
          // 生图有真实费用与外部副作用：缺省必须过一次用户审批。
          defaultPolicy: "ask",
        },
      ],
    ]),
  };
}
