/**
 * 记忆变更的进程内通知。
 *
 * 记忆的写入/审核都发生在渲染进程里（记忆面板、`MemoryManager` 工具、回合末的提取器
 * 都调 `lib/memory/api.ts` 里的命令），但没有任何事件总线把「变了」这件事告诉别的
 * 入口——于是「待审核」角标只能靠轮询，用户审核完还会看到它挂一会儿。
 *
 * 这里只在最贴近后端的那一层（api.ts 的变更类命令成功后）广播一次，读取方自行订阅，
 * 不引入全局 store：角标需要的数据很小，重取一次比维护缓存简单。
 */
const MEMORY_CHANGED_EVENT = "liveagent:memory-changed";

export function notifyMemoryChanged() {
  window.dispatchEvent(new Event(MEMORY_CHANGED_EVENT));
}

export function subscribeMemoryChanged(listener: () => void) {
  window.addEventListener(MEMORY_CHANGED_EVENT, listener);
  return () => window.removeEventListener(MEMORY_CHANGED_EVENT, listener);
}
