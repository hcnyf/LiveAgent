import { invoke } from "@liveagent/app/shims/tauriCore";

/**
 * 运行中的 Bash 会话实时输出（只给界面看）。
 *
 * chat scope 下的 Bash 走 resumable 会话：命令还在跑，工具却要等 `yield_time_ms`
 * 才把结果交回来，于是「运行中」那一段界面上一片空白——用户看到的现象就是「长命令
 * 跑的时候不显示，跑完了才显示」。这里在**工具调用在飞的那段时间**里按游标轮询
 * `shell_session_wait`，把增量喂给界面，工具一返回就停：真正的结果仍然由工具负责，
 * 这里只是把同一段输出提前显示出来。
 *
 * 之所以走轮询而不是让 Rust 推事件：`shell_session_wait` 已经是游标式增量通道，
 * 复用它对会话本身零改动；代价是 WebUI 侧拿不到（它没有这个 command），那边只是
 * 不显示实时输出，不会退化。
 */

type ShellSessionOutput = { stream: string; text: string };
type ShellSessionWaitResponse = {
  status: string;
  session_id: string;
  cursor: number;
  output: ShellSessionOutput[];
};

/** 每次等待让服务端最多阻塞这么久，返回即代表「有新输出或超时」。 */
const POLL_YIELD_MS = 400;
/** 只留尾部：实时区是给人扫一眼的，没必要把整段构建日志都留在内存里。 */
const MAX_LIVE_CHARS = 20_000;

const liveText = new Map<string, string>();
const listeners = new Set<() => void>();
const stops = new Map<string, () => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** 某个工具调用当前累积到的实时输出；没有就返回 undefined（界面据此不渲染实时区）。 */
export function getLiveToolOutput(toolCallId: string): string | undefined {
  return liveText.get(toolCallId);
}

export function subscribeLiveToolOutput(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 工具调用开始等待会话时挂上轮询；重复挂会先停掉上一个。 */
export function startLiveShellOutput(params: { toolCallId: string; sessionId: string }) {
  const toolCallId = params.toolCallId?.trim();
  const sessionId = params.sessionId?.trim();
  if (!toolCallId || !sessionId) return;
  stopLiveShellOutput(toolCallId);

  let stopped = false;
  stops.set(toolCallId, () => {
    stopped = true;
  });

  void (async () => {
    let cursor: number | undefined;
    while (!stopped) {
      let response: ShellSessionWaitResponse;
      try {
        response = await invoke<ShellSessionWaitResponse>("shell_session_wait", {
          session_id: sessionId,
          cursor,
          yield_time_ms: POLL_YIELD_MS,
        });
      } catch {
        // 会话可能刚好结束/被停掉：实时输出是锦上添花，静默收场。
        break;
      }
      if (stopped) return;
      cursor = response.cursor;
      const chunk = response.output.map((part) => part.text).join("");
      if (chunk) {
        const next = (liveText.get(toolCallId) ?? "") + chunk;
        liveText.set(
          toolCallId,
          next.length > MAX_LIVE_CHARS ? next.slice(next.length - MAX_LIVE_CHARS) : next,
        );
        notify();
      }
      if (response.status !== "running") break;
    }
  })();
}

/** 工具调用返回（成功、失败、取消都算）时收尾并清掉实时文本。 */
export function stopLiveShellOutput(toolCallId: string) {
  stops.get(toolCallId)?.();
  stops.delete(toolCallId);
  if (liveText.delete(toolCallId)) notify();
}
