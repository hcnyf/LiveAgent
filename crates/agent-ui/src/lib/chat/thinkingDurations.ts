// Reasoning blocks carry no timing metadata from providers, so "思考了 Xs" is
// measured client-side while a segment streams. State lives at module scope,
// keyed by the transcript entry key, so it survives virtualization unmounts
// mid-run; after an app reload the header simply falls back to the untimed
// "思考过程" label. Both maps are idempotent per key, which lets renderers
// call resolveThinkingDurationMs during render (StrictMode double-render safe).

const MAX_TRACKED_SEGMENTS = 512;

const startedAt = new Map<string, number>();
const settledDurations = new Map<string, number>();

function trimOldest(map: Map<string, number>) {
  while (map.size > MAX_TRACKED_SEGMENTS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

/**
 * Reads the settled duration for a reasoning segment, advancing the tracker
 * as a side effect: an active segment starts (or keeps) its clock and reports
 * null; an inactive segment settles a pending clock exactly once. A segment
 * that was never observed streaming (history reload) always reports null.
 */
export function resolveThinkingDurationMs(
  key: string,
  active: boolean,
  now = Date.now(),
): number | null {
  if (active) {
    // 键会被**跨轮复用**：回合键按轮计数，于是每一轮的第一段思考都叫同一个名字
    // （如 `r1:thinking-1`）。若该键上一轮已经结算过，必须先丢掉那个陈旧值再重新
    // 起表——否则这一轮的首次思考不会重新计时，结算时会直接把上一轮测出来的用时
    // 当成这一轮的（表现为每轮首次思考固定显示同一个错误时长）。
    // 重起表仍然只在「未在计时」时发生，所以同一次渲染内的重复调用依旧幂等。
    settledDurations.delete(key);
    if (!startedAt.has(key)) {
      startedAt.set(key, now);
      trimOldest(startedAt);
    }
    return null;
  }

  const start = startedAt.get(key);
  if (start !== undefined) {
    startedAt.delete(key);
    settledDurations.set(key, Math.max(0, now - start));
    trimOldest(settledDurations);
  }
  return settledDurations.get(key) ?? null;
}
