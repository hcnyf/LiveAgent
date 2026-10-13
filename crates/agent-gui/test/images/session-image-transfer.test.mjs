import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// 「保存到工作区」的反漂移锁。两条最容易被写错、也最容易被"看起来能用"掩盖的点：
// 1. 改写引用必须产生**新的 message 对象**——共享 UI 的 displayImagePayloadCache
//    按对象引用缓存，原地 mutate 会继续渲染旧路径与旧文件名；
// 2. 改写后必须能持久化（走宿主注册的 handler），否则重开会话又是临时路径。

const loader = createTsModuleLoader({
  mocks: {
    "@tauri-apps/api/core": {
      invoke: async (command, args) => {
        if (command === "fs_save_image_to_workdir") {
          return {
            path: "images/liveagent-deadbeef.png",
            absolutePath: `C:/work/images/liveagent-deadbeef.png`,
            displayPath: "images/liveagent-deadbeef.png",
            fileName: "liveagent-deadbeef.png",
            mimeType: "image/png",
            sizeBytes: 12,
            mtimeMs: 1,
            contentHash: "deadbeefdeadbeef",
            fileId: "file-1",
            alreadyInsideWorkdir: args.source_path.includes("/work/"),
          };
        }
        throw new Error(`unexpected command: ${command}`);
      },
    },
  },
});

const conversationState = loader.loadModule("src/lib/chat/conversation/conversationState.ts");
const rewrite = loader.loadModule("src/lib/images/rewriteDisplayImagePaths.ts");
const transfer = loader.loadModule("src/lib/images/sessionImageTransfer.ts");
const desktopAdapter = loader.loadModule("src/agent-ui-adapters/sessionImageSave.ts");

const TEMP_PATH = "C:/Users/example/AppData/Local/Temp/liveagent-images/liveagent-deadbeef.png";
const WORKSPACE_PATH = "C:/work/images/liveagent-deadbeef.png";

function displayImageResult(path) {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "GenerateImage",
    content: [
      { type: "text", text: `Generated 1 image(s).\n1. ${path}` },
      { type: "image", data: "QUJD", mimeType: "image/png" },
    ],
    details: {
      kind: "display_image",
      loadMode: "inline",
      path,
      mimeType: "image/png",
      sizeBytes: 3,
      contentHash: "oldhash",
      images: [
        {
          path,
          absolutePath: path,
          displayPath: path,
          sourceType: "path",
          renderMode: "inline",
          mimeType: "image/png",
          sizeBytes: 3,
          contentHash: "oldhash",
        },
      ],
    },
    isError: false,
    timestamp: 1,
  };
}

function buildState(messages) {
  const state = conversationState.createConversationStateFromContext({
    systemPrompt: "BASE",
    messages,
  });
  return state;
}

test("rewriting a display_image path replaces the object and reports the count", () => {
  const state = buildState([displayImageResult(TEMP_PATH)]);
  const before = state.segments[state.meta.activeSegmentIndex].messages[0];

  const result = rewrite.rewriteDisplayImagePaths(state, TEMP_PATH, {
    path: WORKSPACE_PATH,
    displayPath: "images/liveagent-deadbeef.png",
    absolutePath: WORKSPACE_PATH,
    mimeType: "image/png",
    sizeBytes: 12,
    contentHash: "newhash",
    fileId: "file-1",
  });
  assert.equal(result.rewritten, 1);

  const after = result.state.segments[result.state.meta.activeSegmentIndex].messages[0];
  // 必须是新对象：按引用缓存的 payload 才会失效并重渲染。
  assert.notEqual(after, before);
  assert.equal(after.details.images[0].path, WORKSPACE_PATH);
  assert.equal(after.details.images[0].displayPath, "images/liveagent-deadbeef.png");
  assert.equal(after.details.images[0].contentHash, "newhash");
  assert.equal(after.details.images[0].fileId, "file-1");
  // 顶层冗余字段与首图同步，契约保持自洽。
  assert.equal(after.details.path, WORKSPACE_PATH);
  assert.equal(after.details.contentHash, "newhash");
  // 文本块里的路径也换掉（那是落盘内容，模型侧另有 details 重建）。
  assert.equal(after.content[0].text.includes(TEMP_PATH), false);
  assert.match(after.content[0].text, /images\/liveagent-deadbeef\.png/);
  // 原状态不被就地修改。
  assert.equal(before.details.images[0].path, TEMP_PATH);
});

test("path matching tolerates slash direction and case, and matches absolute/display paths", () => {
  const state = buildState([
    {
      ...displayImageResult(TEMP_PATH),
      details: {
        ...displayImageResult(TEMP_PATH).details,
        images: [
          {
            path: "C:\\Users\\Example\\AppData\\Local\\Temp\\liveagent-images\\liveagent-deadbeef.png",
            sourceType: "path",
            renderMode: "inline",
          },
        ],
      },
    },
  ]);
  const result = rewrite.rewriteDisplayImagePaths(state, TEMP_PATH, { path: WORKSPACE_PATH });
  assert.equal(result.rewritten, 1);
});

test("unrelated results are left untouched and report zero rewrites", () => {
  const other = displayImageResult("C:/other/photo.png");
  const state = buildState([other]);
  const result = rewrite.rewriteDisplayImagePaths(state, TEMP_PATH, { path: WORKSPACE_PATH });
  assert.equal(result.rewritten, 0);
  assert.equal(result.state, state);
});

test("blank target paths and non display_image results are no-ops", () => {
  const plain = {
    role: "toolResult",
    toolCallId: "call-2",
    toolName: "Read",
    content: [{ type: "text", text: TEMP_PATH }],
    details: { kind: "read_text" },
    isError: false,
    timestamp: 1,
  };
  const state = buildState([plain]);
  assert.equal(rewrite.rewriteDisplayImagePaths(state, TEMP_PATH, { path: WORKSPACE_PATH }).rewritten, 0);
  assert.equal(rewrite.rewriteDisplayImagePaths(state, "   ", { path: WORKSPACE_PATH }).rewritten, 0);
});

test("the transfer saves the file and hands the new path to the rewrite handler", async () => {
  transfer.resetSessionImageTransferForTests();
  const calls = [];
  transfer.setSessionImageRewriteHandler(async (request) => {
    calls.push(request);
    return 1;
  });
  transfer.setSessionImageTransferContext({ conversationId: "conv-1", workdir: "C:/work" });

  const outcome = await transfer.saveSessionImageToWorkspace(TEMP_PATH);
  assert.equal(outcome.status, "saved");
  assert.equal(outcome.rewritten, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].oldPath, TEMP_PATH);
  assert.equal(calls[0].saved.path, "images/liveagent-deadbeef.png");

  transfer.resetSessionImageTransferForTests();
});

test("the transfer reports a missing workspace instead of throwing", async () => {
  transfer.resetSessionImageTransferForTests();
  transfer.setSessionImageTransferContext({ conversationId: "conv-1", workdir: "" });
  const outcome = await transfer.saveSessionImageToWorkspace(TEMP_PATH);
  assert.deepEqual(outcome, { status: "no-workspace" });
  transfer.resetSessionImageTransferForTests();
});

test("a file already inside the workspace is not rewritten", async () => {
  transfer.resetSessionImageTransferForTests();
  let rewrites = 0;
  transfer.setSessionImageRewriteHandler(async () => {
    rewrites += 1;
    return 1;
  });
  transfer.setSessionImageTransferContext({ conversationId: "conv-1", workdir: "C:/work" });
  const outcome = await transfer.saveSessionImageToWorkspace("C:/work/images/existing.png");
  assert.equal(outcome.status, "saved");
  assert.equal(outcome.saved.alreadyInsideWorkdir, true);
  assert.equal(rewrites, 0);
  transfer.resetSessionImageTransferForTests();
});

test("the desktop adapter advertises support", () => {
  assert.equal(desktopAdapter.supportsSessionImageSaveToWorkspace, true);
});
