import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// 供应商两类分栏（对话模型／生图模型）的反漂移锁：
// 1. 类别 → 可选协议子集（生图只留 codex/gemini，决策 M=丙）；
// 2. 列表按 kind 分栏与排序、生图供应商不进对话侧候选（失败转移队列）；
// 3. 创建流程把类别带进保存 payload；生图类别不显示对话专用模型字段。
const loader = createTsModuleLoader();
const presentation = loader.loadModule("@liveagent/ui/pages/settings/ProviderPresentation.tsx");

const readShared = (relativePath) =>
  readFileSync(new URL(`../../../agent-ui/src/pages/settings/${relativePath}`, import.meta.url), "utf8");

const providersSectionSource = readShared("ProvidersSection.tsx");
const providerModalSource = readShared("ProviderModal.tsx");
const providerModalViewSource = readShared("ProviderModalView.tsx");

test("image category only offers providers with an image API", () => {
  assert.deepEqual(presentation.providerTabsForKind("chat"), [
    "claude_code",
    "codex",
    "gemini",
    "xai",
    "deepseek",
  ]);
  assert.deepEqual(presentation.providerTabsForKind("image"), ["codex", "gemini"]);
  // claude_code / deepseek 无生图 API、xai 本期不做：不得出现在生图类别里。
  for (const unsupported of ["claude_code", "deepseek", "xai"]) {
    assert.equal(presentation.providerTabsForKind("image").includes(unsupported), false);
  }
});

test("provider list is split into chat and image sections keyed by kind", () => {
  assert.match(providersSectionSource, /const PROVIDER_KIND_SECTIONS: readonly ProviderKind\[\] = \[\s*"chat",\s*"image",?\s*\]/);
  assert.match(providersSectionSource, /PROVIDER_KIND_SECTIONS\.map\(\(kind\) => \(/);
  // 列表与排序的筛选维度是 kind，不再是协议 type。
  assert.match(providersSectionSource, /providers\.filter\(\(provider\) => providerListKind\(provider\) === kind\)/);
  assert.match(providersSectionSource, /function handleProviderReorder\(kind: ProviderKind, nextIds: string\[\]\)/);
  assert.doesNotMatch(providersSectionSource, /type: ProviderId \| "all"/);
});

test("creating a provider carries the chosen category into the save payload", () => {
  assert.match(providersSectionSource, /providerTabsForKind\(activeKind\)\.map\(\(type\) => \(/);
  assert.match(providersSectionSource, /providerKind=\{activeKind\}/);
  assert.match(providersSectionSource, /function openAdd\(kind: ProviderKind = activeKind\)/);
  assert.match(providerModalSource, /const providerKind: ProviderKind = initialData\?\.kind \?\? defaultProviderKind \?\? "chat"/);
  assert.match(providerModalSource, /onSave\(\{[\s\S]{0,200}?kind: providerKind,/);
});

test("chat-only model settings stay hidden for image providers", () => {
  assert.match(providerModalSource, /providerKind !== "image" && providerSupportsModelInputModalitiesOverride\(providerType\)/);
  assert.match(providerModalViewSource, /providerKind !== "image" \? \(/);
  assert.match(providerModalViewSource, /providerType === "codex" && providerKind !== "image" \? \(/);
});

test("image providers never enter the chat-side failover candidate list", () => {
  assert.match(
    providersSectionSource,
    /vendorProviders[\s\S]{0,400}?provider\.type === providerType && providerListKind\(provider\) === "chat"/,
  );
});
