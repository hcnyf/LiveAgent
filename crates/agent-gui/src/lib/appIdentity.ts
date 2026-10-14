/**
 * 应用显示名的前端单点真源。
 *
 * 真源是 `src-tauri/tauri.conf.json` 的 `productName`：`vite.config.ts` 读它注入
 * `__LIVEAGENT_APP_NAME__`。但该标识符并非处处存在——纯 TS 模块加载（部分测试的
 * loader 不注入 define）下它是未声明的自由标识符，直接引用会抛 ReferenceError，
 * 所以这里必须用 `typeof` 守卫（对未声明标识符做 `typeof` 是安全的）。
 *
 * 任何用户可见的位置都从这里取名字，不要再硬编码字面量：同一份代码要能打出
 * 并存的两个包（如 `LiveAgent` 与 `LiveAgent N`）。
 */
export const APP_DISPLAY_NAME: string =
  typeof __LIVEAGENT_APP_NAME__ === "string" && __LIVEAGENT_APP_NAME__.trim().length > 0
    ? __LIVEAGENT_APP_NAME__
    : "LiveAgent";
