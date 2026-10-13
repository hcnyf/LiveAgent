// jsdom DOM-test environment for real React rendering of shared TS components.
//
// The default createTsModuleLoader mocks "react/jsx-runtime" with plain-object
// element factories (fine for model/source tests, useless for DOM assertions).
// This helper boots a jsdom window into the Node globals and returns a loader
// whose jsx-runtime mock is replaced by the real one, so components loaded
// through it render through the real react-dom pipeline.
//
// Usage:
//   const env = await createDomTestEnv();
//   const { PaneSurfaceLayer } = env.loadModule(
//     "@liveagent/ui/components/workbench/PaneSurfaceLayer.tsx",
//   );
//   ...render with env.React / env.createRoot, act() via env.act...
//   env.cleanup(); // restore globals
//
// The jsdom globals are installed for the lifetime of the env (node:test runs
// files in separate processes, so this cannot leak into other test files).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createTsModuleLoader } from "./load-ts-module.mjs";

const requireFromGui = createRequire(
  fileURLToPath(new URL("../../package.json", import.meta.url)),
);

// vite 的 `define` 常量在测试环境里不存在，而组件会直接引用它们
// （`__LIVEAGENT_APP_NAME__` / `__LIVEAGENT_APP_VERSION__`）——不注入就是
// ReferenceError。取值与 vite.config.ts 走同一条回退链（环境变量 → 配置文件 →
// 默认值），避免"测试里显示名与真实构建不一致"这种隐性偏差。
const tauriConf = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const BUILD_DEFINES = {
  __LIVEAGENT_APP_NAME__:
    process.env.LIVEAGENT_DISPLAY_NAME?.trim() || tauriConf.productName?.trim() || "LiveAgent",
  __LIVEAGENT_APP_VERSION__: process.env.LIVEAGENT_APP_VERSION?.trim() || "0.0.0",
};

const GLOBAL_KEYS = [
  ...Object.keys(BUILD_DEFINES),
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "CustomEvent",
  "Event",
  "MouseEvent",
  "PointerEvent",
  "KeyboardEvent",
  "SVGElement",
  "DocumentFragment",
  "MutationObserver",
  "ResizeObserver",
];

export async function createDomTestEnv(options = {}) {
  const { JSDOM } = requireFromGui("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  dom.window.scrollTo = () => {};

  const previous = new Map();
  for (const key of GLOBAL_KEYS) {
    previous.set(key, globalThis[key]);
  }

  // Node 22 exposes some of these (navigator) as getter-only globals; plain
  // assignment throws, so install every jsdom global via defineProperty.
  const setGlobal = (key, value) => {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  };

  setGlobal("window", dom.window);
  setGlobal("document", dom.window.document);
  for (const [key, value] of Object.entries(BUILD_DEFINES)) {
    setGlobal(key, value);
  }
  setGlobal("navigator", dom.window.navigator);
  setGlobal("HTMLElement", dom.window.HTMLElement);
  setGlobal("Element", dom.window.Element);
  setGlobal("Node", dom.window.Node);
  setGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  setGlobal(
    "requestAnimationFrame",
    dom.window.requestAnimationFrame?.bind(dom.window) ??
      ((callback) => setTimeout(() => callback(Date.now()), 0)),
  );
  setGlobal(
    "cancelAnimationFrame",
    dom.window.cancelAnimationFrame?.bind(dom.window) ?? clearTimeout,
  );
  setGlobal("CustomEvent", dom.window.CustomEvent);
  setGlobal("Event", dom.window.Event);
  setGlobal("MouseEvent", dom.window.MouseEvent);
  setGlobal("PointerEvent", dom.window.PointerEvent ?? dom.window.MouseEvent);
  setGlobal("KeyboardEvent", dom.window.KeyboardEvent);
  setGlobal("SVGElement", dom.window.SVGElement);
  setGlobal("DocumentFragment", dom.window.DocumentFragment);
  setGlobal("MutationObserver", dom.window.MutationObserver);
  // jsdom has no layout engine. Consumers that assert resizing supply their own
  // observer; ordinary component tests only need the subscription lifecycle.
  setGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });

  // React reads this to silence act() environment warnings in tests.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // Real React modules (hoisted workspace deps of agent-gui).
  const React = requireFromGui("react");
  const ReactDOMClient = requireFromGui("react-dom/client");
  const realJsxRuntime = requireFromGui("react/jsx-runtime");

  const loader = createTsModuleLoader({
    ...options,
    mocks: {
      // Replace the plain-object jsx factories with the real runtime so
      // loaded TS components produce genuine React elements. Loader merge
      // semantics: full replacement objects are fine here.
      "react/jsx-runtime": realJsxRuntime,
      react: React,
      "react-dom": requireFromGui("react-dom"),
      "react-dom/client": ReactDOMClient,
      ...(options.mocks ?? {}),
    },
  });

  const cleanup = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else setGlobal(key, value);
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  };

  return {
    dom,
    React,
    act: React.act,
    createRoot: ReactDOMClient.createRoot,
    loadModule: loader.loadModule,
    cleanup,
  };
}
