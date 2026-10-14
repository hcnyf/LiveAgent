import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const roundContentSource = readSource(
  "../../../agent-ui/src/components/chat/assistant-bubble/RoundContent.tsx",
);
const disclosureSource = readSource(
  "../../../agent-ui/src/components/chat/assistant-bubble/ThinkingDisclosure.tsx",
);
const toolTraceSource = readSource(
  "../../../agent-ui/src/components/chat/assistant-bubble/ToolTraceGroup.tsx",
);
const workTraceSource = readSource("../../../agent-ui/src/components/chat/AssistantWorkTrace.tsx");
const guiBubbleSource = readSource("../../src/pages/chat/components/AssistantBubble.tsx");
const activityRowSource = readSource("../../src/pages/chat/transcript/AssistantActivityRow.tsx");
const rowModelSource = readSource("../../src/pages/chat/transcript/rowModel.ts");
const renderUnitSource = readSource("../../src/pages/chat/transcript/AssistantRenderUnit.tsx");
const utilsSource = readSource(
  "../../../agent-ui/src/components/chat/assistant-bubble/assistantBubbleUtils.ts",
);
const previewArtifactsSource = readSource(
  "../../../agent-ui/src/components/chat/PreviewArtifactsRow.tsx",
);

test("reasoning renders as expandable disclosures instead of vanishing status text", () => {
  assert.match(roundContentSource, /<ThinkingDisclosure/);
  assert.match(roundContentSource, /resolveActiveThinkingEntryKey/);
  assert.doesNotMatch(roundContentSource, /ThinkingActivity/);
  assert.doesNotMatch(guiBubbleSource, /ThinkingActivity/);

  assert.match(disclosureSource, /data-thinking-disclosure/);
  assert.match(disclosureSource, /<Markdown/);
  assert.match(disclosureSource, /resolveThinkingDurationMs/);
  assert.match(disclosureSource, /chat\.thoughtFor/);
  assert.match(disclosureSource, /chat\.thinkingProcess/);
});

test("collapsing the live work trace re-homes the active block below the header", () => {
  assert.match(workTraceSource, /collapsedTail\?: ReactNode/);
  assert.match(workTraceSource, /running && hasDetails && !expanded && collapsedTail/);
  assert.match(workTraceSource, /data-chat-work-collapsed-tail/);

  assert.match(roundContentSource, /resolveActiveWorkEntry/);
  assert.match(
    roundContentSource,
    /collapsedTail=\{collapsedTailEntry \? renderEntry\(collapsedTailEntry, true\) : null\}/,
  );
  assert.match(guiBubbleSource, /resolveActiveWorkEntry/);
  assert.match(
    guiBubbleSource,
    /collapsedTail=\{collapsedTailEntry \? renderWorkEntry\(collapsedTailEntry\) : null\}/,
  );
});

test("one persistent sparkle marks the live turn; textual fillers are gone", () => {
  assert.match(
    roundContentSource,
    /\{running \? <LiveSparkle paused=\{attentionRequired\} \/> : null\}/,
  );
  assert.match(activityRowSource, /\{row\.live \? <LiveSparkle/);
  // The latest tool batch no longer fakes a "思考中" phase while idle — a real
  // reasoning segment shows its own row and the sparkle covers gaps.
  assert.doesNotMatch(toolTraceSource, /t\("chat\.thinking"\)/);
});

test("a turn waiting on the user freezes its progress indicators", () => {
  assert.match(workTraceSource, /<WorkPixelGrid active=\{!awaitingDecision\} \/>/);
  assert.match(workTraceSource, /running && !awaitingDecision \? "shimmer"/);
  assert.match(
    activityRowSource,
    /hasPendingToolApproval \|\| hasPendingInteractionCard\(row\.units\)/,
  );
  assert.match(activityRowSource, /paused=\{awaitingDecision\}/);
  assert.match(guiBubbleSource, /awaitingDecision=\{awaitingDecision\}/);
});

test("a settled turn with a final answer collapses its work trace on both surfaces", () => {
  // Shared AssistantTurnContent (WebUI path) and the GUI's own bubble unit
  // bypass each other, so the auto-collapse wiring must exist in both.
  assert.match(workTraceSource, /if \(!running && !attentionRequired && collapseAfterAnswer\)/);
  assert.match(roundContentSource, /collapseAfterAnswer=\{layout\.answer\.length > 0\}/);
  assert.match(guiBubbleSource, /collapseAfterAnswer=\{unit\.hasAnswer\}/);
  assert.match(rowModelSource, /hasAnswer: layout\.answer\.length > 0/);
});

test("a settled turn re-homes image previews into an artifact row instead of staying expanded", () => {
  // 思考过程照旧收起（见上一条断言）；可预览产物改由答案下方独立一行承载，
  // 否则收起会把图片连同预览灯箱一起卸载。
  assert.match(utilsSource, /export function collectWorkPreviewItems\(/);
  assert.match(utilsSource, /getBuiltinResultKind\(item\.toolResult\) === "display_image"/);
  assert.match(previewArtifactsSource, /export const PreviewArtifactsRow = memo\(/);
  assert.match(previewArtifactsSource, /<NativeDisplayImageBlock/);
  // 两个表面都要挂上这一行：共享面（RoundContent）+ GUI 自有面（footer unit）。
  assert.match(
    roundContentSource,
    /const settledWithAnswer = !running && layout\.answer\.length > 0/,
  );
  assert.match(
    roundContentSource,
    /<PreviewArtifactsRow items=\{previewArtifacts\} readOnly=\{readOnly\} \/>/,
  );
  assert.match(rowModelSource, /hasPreviewableArtifactCandidate: previewArtifactCandidate/);
  assert.match(rowModelSource, /PREVIEW_ARTIFACTS_ROW_ESTIMATE_PX/);
  assert.match(renderUnitSource, /<PreviewArtifactsRow items=\{previewArtifacts\} \/>/);
});

test("GUI transcript keeps live interaction content outside the work trace", () => {
  assert.match(
    roundContentSource,
    /layout\.interaction\.map\(\(entry\) => renderEntry\(entry, false, true\)\)/,
  );
  assert.match(roundContentSource, /isLive=\{running && \(insideWorkTrace \|\| liveInteraction\)\}/);
  assert.match(roundContentSource, /attentionRequired=\{attentionRequired\}/);
  assert.match(
    roundContentSource,
    /hasInteractionRequiringAttention\(\[\.\.\.layout\.work, \.\.\.layout\.interaction\]\)/,
  );
  assert.match(roundContentSource, /showTurnStatus=\{insideWorkTrace && running/);
});
