import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const policy = loader.loadModule("src/lib/chat/compaction/policy.ts");

test("limits: inputCap / reserve / hard / soft per the W·O table", () => {
  // O 是「输出预留」= min(声明值, 8k)：声明值只是「最多能吐多少」，不是每次要留
  // 多少，所以前三行的 64k/128k 都收到 8k（线上 max_tokens 另行按当次输入动态给）。
  const rows = [
    [200_000, 64_000, { inputCap: 192_000, reserve: 10_000, hard: 182_000, soft: 160_000 }],
    [400_000, 128_000, { inputCap: 392_000, reserve: 20_000, hard: 372_000, soft: 320_000 }],
    // 默认 80% 触发线（800k）比安全线（956k）更早，所以 soft 取 800k。
    [1_000_000, 128_000, { inputCap: 992_000, reserve: 20_000, hard: 972_000, soft: 800_000 }],
    // 声明值比预留还小（8k 整）→ 按声明值扣；80% 的 128k = 102.4k，早于安全线 107.2k。
    [128_000, 8_000, { inputCap: 120_000, reserve: 6_400, hard: 113_600, soft: 102_400 }],
  ];
  for (const [contextWindow, maxOutputToken, expected] of rows) {
    assert.deepEqual(policy.resolveCompactionLimits({ contextWindow, maxOutputToken }), expected);
  }
  const limits = policy.resolveCompactionLimits({ contextWindow: 200_000, maxOutputToken: 64_000 });
  assert.equal(policy.forkFits(190_000, limits), true);
  assert.equal(policy.forkFits(190_001, limits), false);
});

test("a huge declared maxOutputToken no longer caps the configured line", () => {
  // deepseek-v4.1-flash 一类：1M 窗口 + 声明 384k 单次输出。声明值是「最多能吐
  // 多少」，整份当成预留会把输入预算砍到 63%（664,576），安全线把触发线压在窗口的
  // 60% 上下——设置里填 85% 也够不到，看起来就是「设置没生效」。
  const model = { contextWindow: 1_048_576, maxOutputToken: 384_000 };
  const at85 = policy.resolveCompactionLimits({ ...model, autoCompactThresholdPercent: 85 });
  assert.equal(at85.soft, 891_289);
  assert.ok(at85.soft / model.contextWindow > 0.84, "85% 必须真的落在窗口的 85% 附近");
  // 对照：整份预留时 soft 的物理上限（hard − 余量）只有 628,576，即窗口的 60%。
  const fullReservationCeiling = 1_048_576 - 384_000 - 20_000 - 16_000;
  assert.equal(fullReservationCeiling, 628_576);
  assert.ok(at85.soft > fullReservationCeiling);
});

test("soft follows system.autoCompactThresholdPercent but never passes the safety line", () => {
  // W=1M/O=128k（预留取 8k）：hard 972k，安全线 956k。
  const base = { contextWindow: 1_000_000, maxOutputToken: 128_000 };
  assert.equal(policy.resolveCompactionLimits(base).soft, 800_000);
  assert.equal(
    policy.resolveCompactionLimits({ ...base, autoCompactThresholdPercent: 50 }).soft,
    500_000,
  );
  // 95% → 950k 仍在安全线 956k 之下，原样生效。
  assert.equal(
    policy.resolveCompactionLimits({ ...base, autoCompactThresholdPercent: 95 }).soft,
    950_000,
  );
  // 越界与非数值都收敛（10 / 99 / 默认 80）。
  assert.equal(
    policy.resolveCompactionLimits({ ...base, autoCompactThresholdPercent: 0 }).soft,
    100_000,
  );
  // 99% → 990k 越过安全线，被钳到 956k：触发线只提前、不后移。
  assert.equal(
    policy.resolveCompactionLimits({ ...base, autoCompactThresholdPercent: 500 }).soft,
    956_000,
  );
  assert.equal(
    policy.resolveCompactionLimits({ ...base, autoCompactThresholdPercent: Number.NaN }).soft,
    800_000,
  );
});

const W200 = { contextWindow: 200_000, maxOutputToken: 64_000 }; // soft 160k / hard 182k

function next(overrides = {}) {
  return policy.decideCompaction({
    trigger: "pre-send",
    totalTokens: 0,
    fixedTokens: 10_000,
    modelConfig: W200,
    activeMessageCount: 10,
    inFlight: false,
    failureStreak: 0,
    thrashing: false,
    ...overrides,
  });
}

test("decideCompaction checks guards in order", () => {
  const huge = { totalTokens: 999_999 };
  assert.equal(next({ ...huge, modelConfig: undefined }).reason, "disabled");
  assert.equal(next({ ...huge, modelConfig: { contextWindow: 200_000, maxOutputToken: 0 } }).reason, "disabled");
  assert.equal(next({ ...huge, activeMessageCount: 0 }).reason, "no-active-messages");
  assert.equal(next({ ...huge, inFlight: true, trigger: "manual" }).reason, "in-flight");

  // manual：只看 60% 门槛，不受 soft / 熔断影响。
  assert.equal(next({ trigger: "manual", totalTokens: 119_999 }).reason, "below-manual-threshold");
  const manual = next({ trigger: "manual", totalTokens: 120_000, failureStreak: 9 });
  assert.equal(manual.shouldCompact, true);
  assert.equal(manual.mustProgress, false);
  assert.equal(manual.startAt, "fork");

  // overflow：同样的输入必然再溢出，从 transcript 开始且必须推进。
  const overflow = next({ trigger: "overflow", totalTokens: 50_000, thrashing: true });
  assert.deepEqual([overflow.shouldCompact, overflow.mustProgress, overflow.startAt], [true, true, "transcript"]);

  assert.equal(next({ totalTokens: 159_999 }).reason, "below-threshold");
  const soft = next({ totalTokens: 160_000 });
  assert.deepEqual([soft.shouldCompact, soft.mustProgress, soft.startAt], [true, false, "fork"]);
  assert.equal(soft.limits.soft, 160_000);
});

test("the configured threshold moves the automatic trigger line", () => {
  // W=1M/O=128k：默认 80% → soft 800k（安全线 836k 更高，不参与）。
  const wide = { modelConfig: { contextWindow: 1_000_000, maxOutputToken: 128_000 } };
  assert.equal(next({ ...wide, totalTokens: 799_999 }).reason, "below-threshold");
  assert.equal(next({ ...wide, totalTokens: 800_000 }).shouldCompact, true);
  // 调到 50% 后 600k 就触发。
  assert.equal(
    next({ ...wide, totalTokens: 600_000, autoCompactThresholdPercent: 50 }).shouldCompact,
    true,
  );
  assert.equal(
    next({ ...wide, totalTokens: 499_999, autoCompactThresholdPercent: 50 }).reason,
    "below-threshold",
  );
});

test("prefix-too-large: compaction cannot free room under a huge fixed prefix", () => {
  // W200：soft 160k，余量 min(20k, 160k/4) = 20k，只拦 [soft, hard)。
  assert.equal(next({ totalTokens: 165_000, fixedTokens: 140_000 }).reason, "prefix-too-large");
  assert.equal(next({ totalTokens: 165_000, fixedTokens: 139_999 }).shouldCompact, true);
  // ≥ hard：压缩仍能把上下文拉回 fixed + bridge，必须推进。
  const atHard = next({ totalTokens: 182_000, fixedTokens: 140_000 });
  assert.deepEqual([atHard.shouldCompact, atHard.mustProgress], [true, true]);
  // fixed 本身已 ≥ hard：压缩腾不出空间，让溢出自然暴露。
  assert.equal(next({ totalTokens: 182_000, fixedTokens: 182_000 }).reason, "prefix-too-large");
});

test("prefix-too-large headroom scales with soft on small windows", () => {
  // W=64k/O=32k（预留取 8k）：soft 49536 / hard 53536，余量 12384。
  const w64 = { modelConfig: { contextWindow: 65_536, maxOutputToken: 32_768 } };
  const w64Soft = next({ ...w64, totalTokens: 50_000, fixedTokens: 8_000 });
  assert.deepEqual([w64Soft.shouldCompact, w64Soft.mustProgress], [true, false]);
  assert.equal(next({ ...w64, totalTokens: 50_000, fixedTokens: 37_152 }).reason, "prefix-too-large");
  const w64Hard = next({ ...w64, totalTokens: 54_000, fixedTokens: 20_000 });
  assert.deepEqual([w64Hard.shouldCompact, w64Hard.mustProgress], [true, true]);

  // W=32k/O=4k：soft 20672 / hard 24672，余量 5168。
  const w32 = { modelConfig: { contextWindow: 32_768, maxOutputToken: 4_096 } };
  const w32Hard = next({ ...w32, totalTokens: 26_000, fixedTokens: 5_000 });
  assert.deepEqual([w32Hard.shouldCompact, w32Hard.mustProgress], [true, true]);
  assert.equal(next({ ...w32, totalTokens: 21_000, fixedTokens: 5_000 }).shouldCompact, true);
});

test("breaker and thrash guard only gate [soft, hard); ≥ hard always progresses", () => {
  for (const guard of [{ failureStreak: 2 }, { thrashing: true }]) {
    assert.equal(next({ totalTokens: 181_999, ...guard }).reason, "circuit-open");
    const atHard = next({ totalTokens: 182_000, ...guard });
    assert.equal(atHard.shouldCompact, true);
    assert.equal(atHard.mustProgress, true);
  }
  assert.equal(next({ totalTokens: 165_000, failureStreak: 1 }).shouldCompact, true);
  // forkFits：total + 2k ≤ inputCap(192k)，否则从 transcript 开始。
  assert.equal(next({ totalTokens: 190_000 }).startAt, "fork");
  assert.equal(next({ totalTokens: 190_001 }).startAt, "transcript");
});

test("retained budget, first-event budget and fatal classifier", () => {
  assert.equal(policy.retainedBudgetTokens(116_000, 10_000, 3_000, false), 20_000);
  assert.equal(policy.retainedBudgetTokens(40_000, 10_000, 3_000, false), 7_000);
  assert.equal(policy.retainedBudgetTokens(40_000, 30_000, 3_000, false), 0);
  assert.equal(policy.retainedBudgetTokens(116_000, 10_000, 3_000, true), 0);

  assert.equal(policy.firstEventBudgetMs(0, undefined), 60_000);
  assert.equal(policy.firstEventBudgetMs(100_000, "medium"), 90_000);
  assert.equal(policy.firstEventBudgetMs(100_001, "high"), 180_000);
  assert.equal(policy.firstEventBudgetMs(250_000, "xhigh"), 210_000);
  assert.equal(policy.firstEventBudgetMs(900_000, "high"), 300_000);

  assert.deepEqual(
    [policy.IDLE_TIMEOUT_MS, policy.DEADLINE_MANUAL_MS, policy.DEADLINE_AUTO_MS],
    [180_000, 270_000, 600_000],
  );
  assert.equal(policy.TRANSCRIPT_MIN_REMAINING_MS, 45_000);

  for (const fatal of [
    "401 Unauthorized",
    "HTTP 403 forbidden",
    "402 Payment Required",
    "Invalid API key provided",
    "insufficient_quota",
    "You exceeded your current quota exceeded",
    "billing hard limit reached",
  ]) {
    assert.equal(policy.isFatalProviderError(fatal), true, fatal);
  }
  for (const transient of ["502 bad gateway", "stream stalled: no events", "40100 tokens", undefined]) {
    assert.equal(policy.isFatalProviderError(transient), false, String(transient));
  }
});
