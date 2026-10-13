/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/react" />

declare const __LIVEAGENT_APP_VERSION__: string;
/** 应用显示名：构建期由 vite.config 从 tauri.conf.json 的 productName 注入。 */
declare const __LIVEAGENT_APP_NAME__: string;

declare module "~icons/*?raw" {
  const svg: string;
  export default svg;
}
