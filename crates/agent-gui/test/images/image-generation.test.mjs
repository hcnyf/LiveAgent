import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// 生图运行时（T5.2）的反漂移锁。重点不是"能出图"，而是这几条**不变量**：
// 1. 生图请求走与聊天同一条传输装配（本地反代 + 自定义头 + 应用代理标记），
//    自己拼一套 fetch 的后果是自定义头静默失效；
// 2. codex 的 /images/generations 是 JSON、/images/edits 是 multipart，
//    两条形状各自正确（edits 的 content-type 必须由 FormData 生成）；
// 3. gemini 的请求/响应形状与 OpenAI 完全不同，不得复用 codex 的解析；
// 4. 目标解析只认「生图类别 + 生图协议子集」，且必须确定性（不猜、不越界）；
// 5. 张数越界给明确错误而不是静默截断。

const PROXY_BASE = "http://127.0.0.1:18080";
const PROXY_TOKEN = "proxy-token-xyz";

function createLoader() {
  return createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        invoke: async (command, args) => {
          if (command === "proxy_get_server_info") {
            return { baseUrl: PROXY_BASE, token: PROXY_TOKEN };
          }
          if (command === "image_artifact_save") {
            return {
              path: `C:/Users/example/AppData/Local/Temp/liveagent-images/liveagent-deadbeef.png`,
              mimeType: args.mimeType,
              sizeBytes: 16,
              contentHash: "deadbeefdeadbeef",
              reused: false,
            };
          }
          if (command === "fs_read_image_source") {
            return { kind: "image", data: "cmVm", mimeType: "image/png" };
          }
          throw new Error(`unexpected command: ${command}`);
        },
      },
    },
  });
}

const loader = createLoader();
const imageParams = loader.loadModule("src/lib/images/imageParams.ts");
const generateImage = loader.loadModule("src/lib/images/generateImage.ts");
const geminiImages = loader.loadModule("src/lib/images/adapters/geminiImages.ts");
const imageTools = loader.loadModule("src/lib/tools/imageTools.ts");
const toolPolicy = loader.loadModule("src/lib/tools/toolPolicy.ts");
const catalog = loader.loadModule("@liveagent/ui/lib/tools/builtinToolCatalog.ts");
const requestContextSanitizer = loader.loadModule("src/lib/chat/context/requestContextSanitizer.ts");
const {
  IMAGE_TEMP_ARTIFACT_DIR_NAME,
  SESSION_IMAGE_TEMP_RETENTION_DAYS,
  looksLikeImageTempArtifact,
} = loader.loadModule("@liveagent/ui/contracts/sessionImageSave.ts");

const TEMP_ARTIFACT_PATH =
  "C:/Users/example/AppData/Local/Temp/liveagent-images/liveagent-deadbeef.png";

const CODEX_IMAGE_PROVIDER = {
  id: "prov-openai-img",
  name: "OpenAI Images",
  type: "codex",
  kind: "image",
  baseUrl: "https://api.openai.com/v1",
  isFullUrl: false,
  apiKey: "sk-test",
  models: [
    {
      id: "gpt-image-1",
      contextWindow: 4096,
      maxOutputToken: 1024,
      imageSize: "1024x1536",
      imageQuality: "high",
      imageCount: 2,
    },
  ],
  activeModels: ["gpt-image-1"],
  reasoning: "off",
  promptCachingEnabled: false,
  nativeWebSearchEnabled: false,
  useSystemProxy: false,
};

const GEMINI_IMAGE_PROVIDER = {
  id: "prov-gemini-img",
  name: "Gemini Images",
  type: "gemini",
  kind: "image",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  isFullUrl: false,
  apiKey: "goog-test",
  models: [{ id: "gemini-3-pro-image-preview", contextWindow: 4096, maxOutputToken: 1024 }],
  activeModels: ["gemini-3-pro-image-preview"],
  reasoning: "off",
  promptCachingEnabled: false,
  nativeWebSearchEnabled: false,
  useSystemProxy: false,
};

/** 聊天供应商用同一份协议：它绝不能被生图工具选中。 */
const CHAT_CODEX_PROVIDER = {
  ...CODEX_IMAGE_PROVIDER,
  id: "prov-openai-chat",
  name: "OpenAI Chat",
  kind: "chat",
};

/**
 * Agnes AI：自称 OpenAI 兼容，但请求体更严格（`size` 必填且只认档位/精确尺寸，
 * 没有 `quality`/`n`，图生图走同一个 /images/generations + extra_body.image）。
 * 默认值刻意留成我们 codex 协议的 `auto`——那正是发给它就会 400 的取值。
 */
const AGNES_IMAGE_PROVIDER = {
  ...CODEX_IMAGE_PROVIDER,
  id: "prov-agnes-img",
  name: "Agnes",
  baseUrl: "https://apihub.agnes-ai.com/v1",
  models: [
    {
      id: "agnes-image-2.1-flash",
      contextWindow: 4096,
      maxOutputToken: 1024,
      imageSize: "auto",
      imageQuality: "auto",
      imageCount: 1,
    },
  ],
  activeModels: ["agnes-image-2.1-flash"],
};

function withFetchStub(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

test("image targets only accept image-kind providers on an image protocol", () => {
  const targets = imageParams.listImageGenerationTargets([
    CHAT_CODEX_PROVIDER,
    CODEX_IMAGE_PROVIDER,
    GEMINI_IMAGE_PROVIDER,
  ]);
  assert.deepEqual(
    targets.map((target) => `${target.provider.id}/${target.model}`),
    ["prov-openai-img/gpt-image-1", "prov-gemini-img/gemini-3-pro-image-preview"],
  );

  // 生图类别但协议不在子集里（历史配置残留）：不成为候选。
  const stale = { ...CODEX_IMAGE_PROVIDER, id: "stale", type: "xai" };
  assert.deepEqual(
    imageParams
      .listImageGenerationTargets([stale])
      .map((target) => target.provider.id),
    [],
  );
});

test("target resolution is deterministic and never falls back to another provider", () => {
  const providers = [CODEX_IMAGE_PROVIDER, GEMINI_IMAGE_PROVIDER];
  assert.equal(imageParams.resolveImageGenerationTarget(providers)?.provider.id, "prov-openai-img");
  assert.equal(
    imageParams.resolveImageGenerationTarget(providers, { provider: "gemini images" })?.provider.id,
    "prov-gemini-img",
  );
  assert.equal(
    imageParams.resolveImageGenerationTarget(providers, { model: "gemini-3-pro-image-preview" })
      ?.provider.id,
    "prov-gemini-img",
  );
  // 没有可用目标：返回 null，由调用方给出明确报错，而不是悄悄换一家去花钱。
  assert.equal(imageParams.resolveImageGenerationTarget([]), null);
  assert.equal(imageParams.resolveImageGenerationTarget([CHAT_CODEX_PROVIDER]), null);
});

test("target params fall back from call override to model config to protocol default", () => {
  const [codex] = imageParams.listImageGenerationTargets([CODEX_IMAGE_PROVIDER]);
  assert.deepEqual(imageParams.resolveTargetImageParams(codex), {
    size: "1024x1536",
    quality: "high",
    count: 2,
  });
  assert.deepEqual(imageParams.resolveTargetImageParams(codex, { count: 5 }), {
    size: "1024x1536",
    quality: "high",
    count: 5,
  });
  const [gemini] = imageParams.listImageGenerationTargets([GEMINI_IMAGE_PROVIDER]);
  assert.deepEqual(imageParams.resolveTargetImageParams(gemini), {
    size: "1:1",
    quality: "1K",
    count: 1,
  });
});

test("codex text-to-image goes through the local proxy with the shared transport headers", async () => {
  const stub = withFetchStub(async () => jsonResponse({ data: [{ b64_json: "QUJD" }] }));
  try {
    const images = await generateImage.generateImages({
      provider: CODEX_IMAGE_PROVIDER,
      model: "gpt-image-1",
      prompt: "a red panda",
      size: "1024x1536",
      quality: "high",
      count: 2,
    });
    assert.deepEqual(images, [{ dataBase64: "QUJD", mimeType: "image/png" }]);

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.url, `${PROXY_BASE}/proxy/codex/v1/images/generations`);
    // 传输装配的三个关键头：反代 token、上游 origin、供应商鉴权。
    assert.equal(call.init.headers["x-liveagent-proxy-token"], PROXY_TOKEN);
    assert.equal(call.init.headers["x-liveagent-upstream-origin"], "https://api.openai.com");
    assert.equal(call.init.headers.Authorization, "Bearer sk-test");
    // 无状态请求不得携带 Codex CLI 的会话身份头。
    assert.equal(call.init.headers["session_id"], undefined);
    assert.equal(call.init.headers["x-client-request-id"], undefined);

    const body = JSON.parse(call.init.body);
    assert.deepEqual(body, {
      model: "gpt-image-1",
      prompt: "a red panda",
      n: 2,
      size: "1024x1536",
      quality: "high",
    });
    // gpt-image-1 拒绝 response_format，必须不发。
    assert.equal("response_format" in body, false);
  } finally {
    stub.restore();
  }
});

test("codex edits post a FormData body so fetch owns the multipart boundary", async () => {
  const stub = withFetchStub(async () => jsonResponse({ data: [{ b64_json: "QUJD" }] }));
  try {
    await generateImage.generateImages({
      provider: CODEX_IMAGE_PROVIDER,
      model: "gpt-image-1",
      prompt: "make it blue",
      size: "auto",
      quality: "auto",
      count: 1,
      referenceImages: [{ dataBase64: "cmVm", mimeType: "image/png" }],
    });
    const call = stub.calls[0];
    assert.equal(call.url, `${PROXY_BASE}/proxy/codex/v1/images/edits`);
    assert.ok(call.init.body instanceof FormData, "edits must send multipart FormData");
    // content-type 必须由 fetch 生成（含 boundary）；手写会丢掉 boundary。
    assert.equal(call.init.headers["content-type"], undefined);
    assert.equal(call.init.body.get("prompt"), "make it blue");
    assert.ok(call.init.body.get("image[]") instanceof Blob);
  } finally {
    stub.restore();
  }
});

test("agnes text-to-image sends its stricter body: tier size + ratio, no quality, no n", async () => {
  const stub = withFetchStub(async () => jsonResponse({ data: [{ b64_json: "QUJD" }] }));
  try {
    const images = await generateImage.generateImages({
      provider: AGNES_IMAGE_PROVIDER,
      model: "agnes-image-2.1-flash",
      prompt: "a red panda",
      size: "auto",
      quality: "auto",
      count: 1,
    });
    assert.deepEqual(images, [{ dataBase64: "QUJD", mimeType: "image/png" }]);
    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.url, `${PROXY_BASE}/proxy/codex/v1/images/generations`);
    const body = JSON.parse(call.init.body);
    // `auto` 不是 Agnes 的合法取值：size 落到档位（auto→2K），ratio 落到它的默认 1:1。
    assert.equal(body.size, "2K");
    assert.equal(body.ratio, "1:1");
    // 它的参数表里没有 quality / n，发了就是 400。
    assert.equal("quality" in body, false);
    assert.equal("n" in body, false);
    assert.equal(body.return_base64, true);
  } finally {
    stub.restore();
  }
});

test("agnes translates the codex size vocabulary into its tier + ratio and asks N times", async () => {
  const stub = withFetchStub(async () => jsonResponse({ data: [{ b64_json: "QUJD" }] }));
  try {
    const images = await generateImage.generateImages({
      provider: AGNES_IMAGE_PROVIDER,
      model: "agnes-image-2.1-flash",
      prompt: "a red panda",
      size: "1536x1024",
      quality: "medium",
      count: 3,
    });
    assert.equal(images.length, 3);
    assert.equal(stub.calls.length, 3);
    for (const call of stub.calls) {
      const body = JSON.parse(call.init.body);
      // codex 的精确尺寸按真实比例翻成 Agnes 的宽高比；质量就是它的分辨率档。
      assert.equal(body.size, "2K");
      assert.equal(body.ratio, "3:2");
    }
  } finally {
    stub.restore();
  }
});

test("agnes passes its own vocabulary straight through (official 2K + 16:9 shape)", async () => {
  const stub = withFetchStub(async () => jsonResponse({ data: [{ b64_json: "QUJD" }] }));
  try {
    await generateImage.generateImages({
      provider: AGNES_IMAGE_PROVIDER,
      model: "agnes-image-2.5-flash",
      prompt: "cinematic wallpaper",
      size: "16:9",
      quality: "2K",
      count: 1,
    });
    const body = JSON.parse(stub.calls[0].init.body);
    assert.equal(body.size, "2K");
    assert.equal(body.ratio, "16:9");
  } finally {
    stub.restore();
  }
});

test("agnes image-to-image reuses /images/generations instead of the edits multipart", async () => {
  const stub = withFetchStub(async () => jsonResponse({ data: [{ b64_json: "QUJD" }] }));
  try {
    await generateImage.generateImages({
      provider: AGNES_IMAGE_PROVIDER,
      model: "agnes-image-2.1-flash",
      prompt: "make it blue",
      size: "auto",
      quality: "auto",
      count: 1,
      referenceImages: [{ dataBase64: "cmVm", mimeType: "image/png" }],
    });
    const call = stub.calls[0];
    assert.equal(call.url, `${PROXY_BASE}/proxy/codex/v1/images/generations`);
    assert.equal(typeof call.init.body, "string", "agnes edits must be JSON, not multipart");
    const body = JSON.parse(call.init.body);
    // 官方示例与「重要说明」一致：输入图只放 extra_body.image，
    // base64 输出用 extra_body.response_format；顶层不能放 response_format。
    assert.equal("image" in body, false);
    assert.deepEqual(body.extra_body.image, ["data:image/png;base64,cmVm"]);
    assert.equal(body.extra_body.response_format, "b64_json");
    assert.equal("response_format" in body, false);
  } finally {
    stub.restore();
  }
});

test("codex downloads url-shaped results through the hub proxy", async () => {
  const stub = withFetchStub(async (url) => {
    if (url.includes("/images/generations")) {
      return jsonResponse({ data: [{ url: "https://cdn.example.com/a.png" }] });
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      text: async () => "",
      json: async () => ({}),
    };
  });
  try {
    const images = await generateImage.generateImages({
      provider: CODEX_IMAGE_PROVIDER,
      model: "gpt-image-1",
      prompt: "a cat",
      size: "auto",
      quality: "auto",
      count: 1,
    });
    assert.equal(images.length, 1);
    assert.equal(images[0].mimeType, "image/png");
    assert.equal(images[0].dataBase64, "AQID");
    assert.match(stub.calls[1].url, /\/proxy\/hub\/a\.png$/);
    assert.equal(stub.calls[1].init.headers["x-liveagent-upstream-origin"], "https://cdn.example.com");
  } finally {
    stub.restore();
  }
});

test("gemini uses its own request/response shape and repeats for n>1", async () => {
  const stub = withFetchStub(async () =>
    jsonResponse({
      candidates: [
        { content: { parts: [{ inlineData: { mimeType: "image/png", data: "R0VN" } }] } },
      ],
    }),
  );
  try {
    const images = await generateImage.generateImages({
      provider: GEMINI_IMAGE_PROVIDER,
      model: "gemini-3-pro-image-preview",
      prompt: "a lighthouse",
      size: "16:9",
      quality: "2K",
      count: 3,
    });
    assert.equal(images.length, 3);
    assert.deepEqual(images[0], { dataBase64: "R0VN", mimeType: "image/png" });
    // 协议没有批量参数：按次数串行重复请求。
    assert.equal(stub.calls.length, 3);

    const call = stub.calls[0];
    assert.equal(
      call.url,
      `${PROXY_BASE}/proxy/gemini/v1beta/models/gemini-3-pro-image-preview:generateContent`,
    );
    assert.equal(call.init.headers["x-goog-api-key"], "goog-test");
    const body = JSON.parse(call.init.body);
    assert.deepEqual(body.contents[0].parts, [{ text: "a lighthouse" }]);
    assert.deepEqual(body.generationConfig.responseModalities, ["IMAGE"]);
    assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio: "16:9", imageSize: "2K" });
  } finally {
    stub.restore();
  }
});

test("gemini imageSize is only sent for Gemini 3 image models", () => {
  assert.equal(geminiImages.supportsGeminiImageSize("gemini-3-pro-image-preview"), true);
  assert.equal(geminiImages.supportsGeminiImageSize("gemini-2.5-flash-image"), false);
  const legacy = geminiImages.buildGeminiImagePayload({
    prompt: "x",
    size: "1:1",
    quality: "1K",
    model: "gemini-2.5-flash-image",
  });
  assert.deepEqual(legacy.generationConfig.imageConfig, { aspectRatio: "1:1" });
  const modern = geminiImages.buildGeminiImagePayload({
    prompt: "x",
    size: "1:1",
    quality: "2K",
    model: "gemini-3-pro-image-preview",
  });
  assert.deepEqual(modern.generationConfig.imageConfig, { aspectRatio: "1:1", imageSize: "2K" });
  // 参考图作为 inlineData part 追加在文本之后。
  const withRef = geminiImages.buildGeminiImagePayload({
    prompt: "x",
    size: "1:1",
    quality: "1K",
    model: "gemini-3-pro-image-preview",
    referenceImages: [{ dataBase64: "cmVm", mimeType: "image/png" }],
  });
  assert.deepEqual(withRef.contents[0].parts, [
    { text: "x" },
    { inlineData: { mimeType: "image/png", data: "cmVm" } },
  ]);
});

test("upstream failures surface the provider message instead of a bare status", async () => {
  const stub = withFetchStub(async () =>
    jsonResponse({ error: { message: "Billing hard limit has been reached" } }, 400),
  );
  try {
    await assert.rejects(
      () =>
        generateImage.generateImages({
          provider: CODEX_IMAGE_PROVIDER,
          model: "gpt-image-1",
          prompt: "x",
          size: "auto",
          quality: "auto",
          count: 1,
        }),
      /HTTP 400: Billing hard limit has been reached/,
    );
  } finally {
    stub.restore();
  }
});

test("unsupported protocols are rejected instead of guessed", async () => {
  await assert.rejects(
    () =>
      generateImage.generateImages({
        provider: { ...CODEX_IMAGE_PROVIDER, type: "claude_code" },
        model: "claude-x",
        prompt: "x",
        size: "auto",
        quality: "auto",
        count: 1,
      }),
    /只支持 codex 与 gemini/,
  );
});

test("GenerateImage defaults to ask and declares the same default in the shared catalog", () => {
  const registryEntry = catalog.BUILTIN_TOOL_CATALOG.find(
    (entry) => entry.toolName === "GenerateImage",
  );
  assert.ok(registryEntry, "GenerateImage must be listed in the shared tool catalog");
  assert.equal(registryEntry.defaultPolicy, "ask");
  assert.equal(registryEntry.isReadOnly, false);

  // 运行时解析：无显式配置时取 metadata.defaultPolicy；用户显式配置优先。
  const metadata = new Map([
    [
      "GenerateImage",
      { groupId: "system", kind: "image", isReadOnly: false, displayCategory: "other", defaultPolicy: "ask" },
    ],
  ]);
  assert.equal(toolPolicy.resolveToolPolicy("GenerateImage", metadata.get("GenerateImage"), {}), "ask");
  assert.equal(
    toolPolicy.resolveToolPolicy("GenerateImage", metadata.get("GenerateImage"), {
      GenerateImage: "allow",
    }),
    "allow",
  );
  assert.equal(
    toolPolicy.resolveToolPolicy("GenerateImage", metadata.get("GenerateImage"), {
      GenerateImage: "deny",
    }),
    "deny",
  );
});

function createToolCall(args) {
  return { id: "call-1", name: "GenerateImage", arguments: args };
}

test("GenerateImage reports a missing provider instead of failing opaquely", async () => {
  const bundle = imageTools.createImageTools({
    workdir: "C:/work",
    getImageProviders: () => [],
  });
  const result = await bundle.executeToolCall(createToolCall({ prompt: "a cat" }));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /没有可用的生图供应商/);
});

test("GenerateImage rejects an over-limit count with an explicit error", async () => {
  const bundle = imageTools.createImageTools({
    workdir: "C:/work",
    getImageProviders: () => [CODEX_IMAGE_PROVIDER],
  });
  const result = await bundle.executeToolCall(createToolCall({ prompt: "a cat", count: 20 }));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /一次最多生成 12 张/);
});

test("GenerateImage saves artifacts and returns a display_image result with paths only", async () => {
  const stub = withFetchStub(async () => jsonResponse({ data: [{ b64_json: "QUJD" }] }));
  try {
    const bundle = imageTools.createImageTools({
      workdir: "C:/work",
      getImageProviders: () => [CODEX_IMAGE_PROVIDER],
    });
    const result = await bundle.executeToolCall(createToolCall({ prompt: "a cat" }));
    assert.equal(result.isError, false);
    assert.equal(result.details.kind, "display_image");
    assert.equal(result.details.images.length, 1);
    const [image] = result.details.images;
    assert.match(image.path, /liveagent-images/);
    assert.equal(image.sourceType, "path");
    assert.equal(image.renderMode, "inline");
    // 内联块供 UI 渲染（请求上下文里会被既有脱敏器整段替换为路径文本）。
    assert.equal(result.content[0].type, "text");
    assert.match(result.content[0].text, /Generated 1 image\(s\)/);
    assert.equal(result.content[1].type, "image");
    // 模型侧只看到路径：摘要里必须带上文件路径。
    assert.match(result.content[0].text, /liveagent-images/);
  } finally {
    stub.restore();
  }
});

test("GenerateImage reads reference images before editing", async () => {
  const stub = withFetchStub(async () => jsonResponse({ data: [{ b64_json: "QUJD" }] }));
  try {
    const bundle = imageTools.createImageTools({
      workdir: "C:/work",
      getImageProviders: () => [CODEX_IMAGE_PROVIDER],
    });
    const result = await bundle.executeToolCall(
      createToolCall({ prompt: "make it blue", reference_images: ["C:/work/a.png"] }),
    );
    assert.equal(result.isError, false);
    // 带参考图 → 走 edits（multipart）。
    assert.match(stub.calls[0].url, /\/images\/edits$/);
    assert.ok(stub.calls[0].init.body instanceof FormData);
  } finally {
    stub.restore();
  }
});

test("the model context never carries the generated image bytes, only paths (acceptance 4)", () => {
  // 决策 R 的落地方式是**既有的 display_image 脱敏**，不是"结果里不放图"：
  // 内联块是 UI 渲染所需，模型侧由 requestContextSanitizer 整段替换为路径文本。
  // 这条断言把该不变量锁住——它是"每次生图不必为模型多付一张图 token"的唯一保障。
  const result = {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "GenerateImage",
    content: [
      { type: "text", text: "Generated 1 image(s) with OpenAI Images / gpt-image-1." },
      { type: "image", data: "QUJD", mimeType: "image/png" },
    ],
    details: {
      kind: "display_image",
      loadMode: "inline",
      path: TEMP_ARTIFACT_PATH,
      mimeType: "image/png",
      images: [
        {
          path: TEMP_ARTIFACT_PATH,
          sourceType: "path",
          renderMode: "inline",
          mimeType: "image/png",
          sizeBytes: 3,
        },
      ],
    },
    isError: false,
    timestamp: 1,
  };
  const context = requestContextSanitizer.sanitizeContextForModelRequest({ messages: [result] });
  const [message] = context.messages;
  assert.equal(
    message.content.some((block) => block.type === "image"),
    false,
    "inline image bytes must be stripped from the model request",
  );
  assert.equal(JSON.stringify(message.content).includes("QUJD"), false);
  assert.equal(message.content[0].type, "text");
  assert.match(message.content[0].text, /liveagent-images/);
});

test("shared UI constants stay in sync with the Rust temp-root source", () => {
  // 共享 UI 用这两个常量决定"要不要提示这张图会被清理"，真源在 Rust 侧。
  // 两边分叉的后果是提示与真实保留期不一致（用户按错误的天数做决定）。
  const rustSource = readFileSync(
    fileURLToPath(new URL("../../src-tauri/src/services/image_artifacts.rs", import.meta.url)),
    "utf8",
  );
  assert.match(rustSource, new RegExp(`IMAGE_ARTIFACT_DIR_NAME: &str = "${IMAGE_TEMP_ARTIFACT_DIR_NAME}"`));
  assert.match(rustSource, /30 \* 24 \* 60 \* 60/);
  assert.equal(SESSION_IMAGE_TEMP_RETENTION_DAYS, 30);
  // 路径判定用同一份目录名。
  assert.equal(looksLikeImageTempArtifact(TEMP_ARTIFACT_PATH), true);
  assert.equal(looksLikeImageTempArtifact("C:\\work\\images\\a.png"), false);
  assert.equal(
    looksLikeImageTempArtifact(
      "C:\\Users\\x\\AppData\\Local\\Temp\\liveagent-images\\liveagent-abc.png",
    ),
    true,
  );
});
