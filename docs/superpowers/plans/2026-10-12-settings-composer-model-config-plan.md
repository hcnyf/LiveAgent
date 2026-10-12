# 实施计划：设置、输入框、模型配置改造 + 生图运行时

日期：2026-10-12
状态：待确认执行方式

配套 spec（均已提交）：

- `docs/superpowers/specs/2026-10-12-settings-composer-model-config-design.md` —— 批①～④
- `docs/superpowers/specs/2026-10-12-image-generation-runtime-design.md` —— 批⑤

## 关于本文件的产生方式

按 brainstorming 技能的架构级路径，spec 通过后应调用 `writing-plans` 技能产出实施计划。**该技能不在本会话启用的技能列表中**，因此本文件为手工产出：结构对齐"任务分解 + 依赖 + 验收 + 验证命令 + 风险回滚"，但**未经过该技能的格式规范与自检流程**。若需走正式流程，请在技能选择器里启用 `writing-plans` 后重跑，本文件可直接作为其输入。

## 执行前置（阻塞项，必须先做）

### P1 生图消费点排查 —— 阻塞批③与批⑤

**为什么前置**：主 spec 的 `kind` 字段一旦落地，生图供应商会流进所有读 `customProviders` 的路径。事后补会返工，且容易漏。

**做什么**：产出**全部**消费点的清单，逐条判定"是否需要排除 `kind === "image"`"，并写明理由。

**已知必改**（已在 spec 中核实）：`crates/agent-ui/src/lib/models/modelOptions.ts:105-129` 的 `buildModelOptions` 遍历全部 `customProviders`，无任何过滤。

**已知需核**（不得凭记忆，须逐个打开确认）：用量查询、模型失败转移（`model_failover`）、设置页按 `providerType` 的分组排序、备份采集与应用（`backup_snapshot.rs`）、网关同步脱敏（`gateway_sync.rs`）、定时任务（`CronTaskModal`）、以及任何按 `providerType` switch 的运行时分支。

**验收**：清单写入本文件附录 A，每条给出「排除 / 不排除 + 理由 + 改动位置」。

### P2 本地反代 multipart 实测 —— 阻塞批⑤-3

**为什么前置**：`POST /v1/images/edits` 是 multipart，而全库 multipart 只出现在 Go gateway（`internal/handler/upload.go`、`import_directory.go`），Rust 侧无先例。本地反代是否破坏 body 未知（spec 风险 R11）。

**做什么**：写一个最小探针，经本地反代发一次 multipart 请求，确认 body 完整性。

**验收**：一份结论（通 / 不通 + 证据）。不通则 ⑤-3 改走 Gemini 的"图像 + 文本 → 图像"形态，或先调整反代。

## 批次总览

| 批 | 子系统 | 任务数 | 依赖 |
|---|---|---|---|
| ① | 窗口 + 设置壳 + 系统设置 | 4 | 无 |
| ② | 输入框视觉 | 3 | 无 |
| ③ | 供应商 + 模型配置表单 | 4 | P1 |
| ④ | 思考档位端到端联动 | 3 | ③-4 |
| ⑤ | 生图运行时 | 5 | ③-1、P1、P2（仅 ⑤-5） |

①②可立即并行。③④⑤串行。

---

## 批① 窗口 + 设置壳 + 系统设置

### T1.1 窗口大小与位置记忆

- **文件**：`crates/agent-gui/src-tauri/src/lib.rs`（`WINDOW_STATE_FLAGS` + setup 钩子）、新增 `crates/agent-gui/src-tauri/src/window_geometry.rs`
- **做什么**：`POSITION` 并入 flags；新增可见性钳制——与任一显示器工作区重叠 ≥ 80×80px 才保留还原坐标，否则主显示器居中
- **验收**：钳制函数单测 4 例（在某显示器内 / 跨屏边界 / 坐标落在已拔掉的屏幕上 → 回退居中 / 显示器列表为空）
- **验证**：Rust 侧 `cargo test`
- **坑**：只加 `POSITION` 不写钳制就是原注释警告的回归（拔屏后窗口不可见）

### T1.2 设置页两元素对调

- **文件**：`crates/agent-ui/src/pages/settings/SettingsShell.tsx`
- **做什么**：只互换"返回对话按钮"与"已保存指示器"，**搜索框留在顶部**；padding 按新位置改回（顶部 `pt-4`、底部 `pb-3`）；搜索框 `mt-2.5` 的参照物变了，间距要核
- **验收**：桌面端左栏顶部＝已保存、底部＝返回对话；Web 端窄屏分支与标题行右侧已保存**零变化**
- **验证**：`pnpm test:gui`（`test/settings/settings-escape-to-close.test.mjs:147` 用 `.settings-back-button` 定位，类名保留；若断言了位置则同步改）

### T1.3 应用代理支持「使用系统代理」

- **文件**：`crates/agent-ui/src/lib/settings/types.ts`、`crates/agent-ui/src/lib/settings/index.ts`（归一化）、`crates/agent-ui/src/pages/settings/SystemSettingsForm.tsx`、`crates/agent-gui/src-tauri/src/services/system_proxy.rs`、`crates/agent-gui/src-tauri/src/commands/config/settings/system.rs`、`.../gateway_sync.rs`、`.../backup_snapshot.rs`、`.../tests.rs`
- **做什么**：新增 `mode: "manual" | "system"`（旧存档缺 → `manual`）；Rust `ProxyMode` 扩 `System` 分支且不产出 `proxy_url`；系统模式按平台读 OS 代理；例外列表取「OS ∪ `NO_PROXY_DEFAULT`」；PAC 检测 → 提示 + 直连（**不解析脚本**）
- **验收**：system 模式下 shell env 与 reqwest 均走 OS 代理；PAC 存在时给出提示；`default_system_proxy_json()` 全量断言同步（这是加字段的固定成本）
- **验证**：`cargo test` + `pnpm test:gui`

### T1.4 系统通知（四项设置 + 三个触发点）

- **文件**：`types.ts`、`SystemSettingsForm.tsx`、新增 `crates/agent-gui/src/lib/system/notifications.ts`、`crates/agent-gui/src/pages/chat/hooks/useNotifyToasts.ts`、工具审批宿主、`backup_snapshot.rs`（白名单）、zh/en i18n
- **做什么**：`{sessionComplete, sessionError, permissionRequest, notifyWhenFocused}` 默认全 `true`；通知偏好加入 `SYSTEM_PORTABLE_BACKUP_KEYS`；三个触发点接入；权限申请与拒绝后的提示
- **验收**：`notifyWhenFocused=false` 且窗口有焦点时**一条都不发**（含权限请求）；点击通知聚焦窗口
- **待定项**：**会话完成的信号源须在实现时定位 `ChatPage` 的运行态来源**，spec 已明确不得臆断
- **验证**：`pnpm test:gui`

---

## 批② 输入框视觉

### T2.1 输入框圆角 → 18px

- **文件**：`crates/agent-ui/src/pages/chat/ChatComposerBar.tsx:1360`（`composer-glass-card`）、`:1420`（`composer-input-surface`）、`crates/agent-gui/test/chat/context-usage.test.mjs:122-134`、`crates/agent-ui/src/components/chat/ConversationStatsBar.tsx:388`（注释）
- **做什么**：两处一起 `rounded-4xl` → `rounded-2xl`；改两条锁 `rounded-4xl` 的正则断言；修正"上探 2rem = 卡片圆角半径"的错误注释
- **验收**：两处均为 18px；裙边无缺口；`tokens.css` 未改
- **验证**：`pnpm test:gui`

### T2.2 底部工具条 40px → 32px

- **文件**：`ChatComposerBar.tsx:1750-1751`（`min-h-9` → `min-h-8`；删除 `py-1`）、`crates/agent-gui/test/chat/context-usage.test.mjs:132`
- **做什么**：**只动 deck 自身，不缩任何子控件**（`composerControlStyles.ts` 的 `h-8`、`ContextUsageRing.tsx` 的 `size-8` 保持不动）。算术：`py-1` 8px + 子控件 32px = 40px → 0 + 32 = 32px，恰等于 `min-h-8`
- **验收**：工具条实测 32px；子控件仍 32px；用量环内的百分比文字不变形
- **坑（重要，与原 spec 初稿不同）**：初稿要求缩子控件（共享常量 `h-8`→`h-6`、环 `size-8`→`size-6`），**已否掉**——环内 `text-tiny` 的 `"100%"` 约 24–27px 宽，而 24px 环的净内径仅 16.75px，且环无 `overflow-hidden`，文字会压过描边并溢出到相邻控件（`gap-2` = 8px）。算式见 spec ②-2。**不要照初稿回改。**
- **代价**：deck 控件与卡片下缘齐平，形成"横向 12px、纵向 0px"的不对称留白
- **需补断言**：`composer-control-deck` 无纵向 `py-*`、共享触发器仍为 `h-8`（否则该偏离无自动化保护）
- **验证**：`pnpm test:gui`

### T2.3 当前选中模型置顶行

- **文件**：`crates/agent-ui/src/components/chat/ComposerModelControls.tsx`
- **做什么**：在 `ScrollArea` 内、`filteredGroups` 计算**之外**加置顶行；重构 `:518-523` 的提前返回为"先渲染置顶行，再渲染 groups 或空态"；`sticky top-0 z-20 bg-popover`；加 `data-model-option=""` 使其成为方向键第一站；依据 `currentModelLabel` 渲染（不依赖列表成员）
- **验收**：搜索与供应商筛选都不会让置顶行消失；键盘可达；当前模型不在列表里时仍显示
- **待定项**：`ScrollArea` 的 `h-70` 是否上调一档补偿约 32px，用 PR 的 before/after 截图定
- **验证**：`pnpm test:gui`

---

## 批③ 供应商 + 模型配置表单

### T3.1 供应商 `kind` 字段 + 两类分栏

- **文件**：`crates/agent-ui/src/lib/settings/types.ts:618`、`crates/agent-ui/src/lib/settings/index.ts`（`normalizeCustomProvider`）、`crates/agent-ui/src/pages/settings/ProvidersSection.tsx:1095-1142`、`ProviderModal.tsx` / `ProviderModalView.tsx`、`crates/agent-ui/src/lib/models/modelOptions.ts:105-129`、`crates/agent-gui/src/agent-ui-adapters/providerSettings.tsx:210`、`crates/agent-gui/test/settings/normalization.test.mjs`、`crates/agent-gateway/test/webui/web-settings.test.mjs`
- **做什么**：新增 `kind: "chat" | "image"` 默认 `"chat"`；列表从协议 `Tabs` 改两类分栏；`buildModelOptions` 加 `kind !== "image"` 过滤；创建流程增加类别维度；落地 P1 清单的每一条
- **验收**：生图供应商不出现在对话模型选择器；既有存档零迁移；Rust 侧无需改动（`redact_provider_credential` 透传未知字段）
- **验证**：`pnpm test:gui` + `pnpm test:webui` + `pnpm check:ui-boundaries`

### T3.2 上下文与最大输出快捷填入

- **文件**：`crates/agent-ui/src/pages/settings/ProviderModalView.tsx:732-773`、zh/en i18n
- **做什么**：每个输入框**上方**加预设 chip 行（`flex flex-wrap gap-1`）；点击写入现有 `onChange` 路径（自动获得 `limitsSource: "user"` 与校验），不需要新的保存动作
- **数值（按文档字面）**：上下文 `128K=131072` / `256K=262144` / `512K=524288` / `1M=1000000` / `1M=1048576`；最大输出 `32K=32768` / `64K=65536` / `128K=131072` / `256K=262144` / `384K=384000` / `512K=524288`
- **坑**：同一行内十进制与二进制并存是文档原意，不要"顺手统一"
- **验收**：点击后写入正确字面值且 `limitsSource` 变为 `user`

### T3.3 输入能力改多选（含 PDF 运行时）

- **文件**：`crates/agent-ui/src/lib/settings/types.ts:446-476`、`index.ts`（`normalizeInputModalities`）、`crates/agent-ui/src/pages/settings/providerUtils.ts:48-78`、`ProviderModalView.tsx:774-824`、`ProviderModal.tsx:568`、`crates/agent-gui/src/lib/providers/nativeResponsesAttachments.ts:159`、`crates/agent-gui/src/lib/providers/runtime/modelFactory.ts:354-360`、`crates/agent-ui/src/lib/models/modelCatalog.ts:159-162`
- **做什么**：值域扩为 `缺失(=自动) | ["text"] | ["text","image"] | ["text","pdf"] | ["text","image","pdf"]`；UI 改 4 个 `Checkbox`（`自动` 与其余互斥）；`supportsNativePdfInline` 改为 `勾了 pdf → true；自动 → 主机名规则；都没勾 → false`；`providerSupportsModelInputModalitiesOverride` 纳入 `claude_code`
- **验收**：既有两种存档值仍合法（零迁移）；勾选 PDF 后在第三方中转上走原生内联
- **坑**：这是**有意破掉**"anthropic 不读 `model.input`"的防线（spec R5），`settings/types.ts:470-472` 与 `modelFactory.ts:354-360` 两处注释须同步改写说明新语义。**不要**把覆盖升级成"完整模态声明"——目录的 audio/video 会被抹掉
- **验证**：`pnpm test:gui` + `cargo test`

### T3.4 思考档位与默认档字段 + 表单

- **文件**：`crates/agent-ui/src/lib/settings/types.ts:457-476`、`index.ts`（归一化）、`ProviderModalView.tsx`、zh/en i18n
- **做什么**：新增 `thinkingLevels?: ReasoningLevel[]`（含 `"off"`）与 `defaultThinkingLevel?: ReasoningLevel`（须属于前者，后者未设置时该项隐藏）；新建/编辑模型时缺失则初始勾选 `low`/`high`/`max`；**偏差标注**——7 档全可勾，目录明确未声明支持的档位旁加提示且**不阻断**
- **验收**：字段归一化对旧存档零影响；偏差提示只在目录判得出"不支持"时出现

---

## 批④ 思考档位端到端联动

### T4.1 档位解析接口加覆盖参数 + 6 个调用点

- **文件**：`crates/agent-ui/src/lib/settings/index.ts:512`、新增共享 helper（建议放 `lib/models` 或 `lib/settings`）、以及调用点：`crates/agent-gui/src/pages/ChatPage.tsx:3403`、`crates/agent-gui/src/pages/chat/runtime/useChatModelSelection.ts:175`、`crates/agent-gui/src/lib/providers/runtime/providerRuntimeConfig.ts:25`、`crates/agent-gateway/web/src/app/hooks/useGatewayChatConfiguration.ts:73`、`crates/agent-gateway/web/src/app/workbench/GatewayConversationPaneHost.tsx:496`、`crates/agent-ui/src/pages/settings/CronTaskModal.tsx:133`
- **做什么**：接口加可选覆盖参数（读档位时"有勾选用勾选，无勾选回落目录"）；用 helper 避免 6 处重复查找
- **验收**：6 处全部接入；**`CronTaskModal` 最易漏，单独确认**
- **坑**：这是 agent-gui 与 agent-gateway/web 的共享层，接口变更两端同时生效

### T4.2 `defaultThinkingLevel` 接入解析链

- **文件**：`crates/agent-ui/src/lib/settings/index.ts:481`（`resolveChatRuntimeReasoning`）
- **做什么**：链改为 `reasoningByModel → defaultThinkingLevel → reasoningByProvider → reasoning`
- **验收**：未单独选过档位的模型会选中其默认档
- **坑**：**这是行为变更**（spec R3）——用户此前按"供应商"选过的档会被该模型的默认档覆盖。**必须在 PR 描述里显式标注**

### T4.3 `off` 由勾选决定

- **文件**：`crates/agent-ui/src/components/chat/ComposerModelControls.tsx:206-211`、`crates/agent-ui/src/lib/settings/index.ts:195`
- **做什么**：`off` 是否出现在会话里，改由"勾选里是否含 `off`"决定，不再由目录 `alwaysOn` 决定
- **验收**：勾了 `off` 的模型在会话里能选"关闭思考"
- **坑**：请求期仍由目录钳制（xai 的 `off` 被 `map.off = null` 屏蔽）→ 静默偏差存在，由批③的偏差标注暴露，**这是经确认的取舍，不要顺手改成替换式**

---

## 批⑤ 生图运行时

按 spec 的三段推进，串行。

### T5.1 生图供应商配置

- **文件**：`crates/agent-ui/src/lib/settings/types.ts`、`ProviderModalView.tsx`（按 `kind` 分支出第二套模型设置面板）、`ProvidersSection.tsx`、i18n
- **做什么**：`kind = "image"` 的供应商协议选项仅 `codex` / `gemini`（`claude_code`/`deepseek`/`xai` 均不显示）；生图模型配置显示尺寸/质量/张数默认值，**不显示**输入能力与思考档位
- **验收**：协议选项里没有那三者；两套模型设置面板不互相污染（spec R14）
- **段**：⑤-1

### T5.2 `GenerateImage` 工具 + codex 适配器 + 应用级临时根

- **文件**：新增 `crates/agent-gui/src/lib/images/{generateImage,imageArtifacts,imageParams}.ts` 与 `adapters/openaiImages.ts`、`crates/agent-gui/src/lib/tools/builtinRegistry.ts`、`builtinTypes.ts`、`crates/agent-ui/src/contracts/builtinTools.ts`（复用 `display_image`，**不新增结果类型**）、Rust 侧新增临时根与启动清理
- **做什么**：注册工具；`switch (provider.type)` 分派；`codex` 走 `POST /v1/images/generations`；落盘到应用级临时根；工具结果**只给文件路径**（决策 R）；默认审批 `ask`（决策 S）
- **验收**：模型能通过工具生成 1 张图并在会话内渲染；后续请求按既有规则脱敏；清理阈值 **30 天**（决策确认）
- **坑**：张数上限受 `MAX_DISPLAY_IMAGE_PATHS = 12` 约束
- **段**：⑤-1

### T5.3 Gemini 适配器

- **文件**：`adapters/geminiImages.ts`
- **做什么**：`generateContent` + `responseModalities: ["IMAGE"]`；请求与响应形状与 OpenAI 完全不同，**不得复用 codex 的解析逻辑**
- **验收**：Gemini 供应商能出图
- **段**：⑤-2 前置

### T5.4 多张（`n>1`）

- **做什么**：参数支持多张；`display_image` 的 `images[]` 天然支持；超上限给明确错误而非静默截断
- **验收**：多张正确展示；越界报错清晰
- **段**：⑤-2

### T5.5 图生图/编辑 + 展示处转存动作

- **文件**：`crates/agent-ui/src/components/chat/assistant-bubble/ToolImages.tsx`（转存动作）、参考图选取、适配器的 edits 分支
- **做什么**：参考图选取/上传；`codex` 走 `/v1/images/edits`（multipart，**受 P2 结论约束**）；`gemini` 走图像+文本→图像；展示处加「保存到工作区」，转存后**会话引用从临时路径切到工作区路径**
- **验收**：能带参考图编辑；转存后不受清理影响；未转存的图被清理后表现为明确失效提示而非碎图
- **坑**：转存动作按 `display_image` **契约**分派（任意来源图片都可另存，spec R16），工作区写入必须走既有路径校验链路
- **段**：⑤-3

---

## 全局验收门禁

每个任务提交前至少跑：

```
pnpm format && pnpm lint
pnpm typecheck:ui && pnpm typecheck:gui && pnpm typecheck:webui
pnpm test:gui && pnpm test:webui
pnpm check:ui-boundaries
pnpm check:fast
```

Rust 改动（批①的 T1.1/T1.3、批③的 T3.3、批⑤的 T5.2）额外跑 `cargo test` 与 clippy；具体命令以 `Makefile` 与 `docs/operations/development.md` 为准。

### ⚠️ 本机 `pnpm test:gui` 曾是**被截断**的门禁（2026-10-12 已修）

`scripts/run-node-tests.mjs:109-115` 按 Windows 命令行长度上限把 391 个测试文件**分批**执行，但**第一个失败的批次会中止整个运行**：

```js
for (const batch of splitTestFilesIntoBatches(files)) {
  const exitCode = await runTestBatch(batch);
  if (exitCode !== 0) return exitCode;   // ← 后续批次全部不执行
}
```

叠加 6 个测试文件在 Windows 上用 `.pathname` 而非 `fileURLToPath`（得到 `/C:/...`，被 `path.isAbsolute` 判为绝对路径后抛 `Cannot resolve module path`），当时的表象是：

| | 测试数 | 结果 |
|---|---|---|
| 修复前 | 671 | 669 通过 / **2 失败** —— 但其实只有 ~20% 的套件执行过，排在失败批次之后的**全部未跑** |
| **修复后（真实全量）** | **3420** | **3420 通过 / 0 失败** |

修复：`crates/agent-gui/test/` 下 `chat/{floor-nav-scroll,standard-overlays,conversation-search}`、`settings/{style-token-contract,popup-transition-properties,style-theme}` 六个文件改用 `fileURLToPath`（提交 `40d34601`）。这批修复属**范围外但必要**——没有它，本节所有验收结论都只建立在一个被截断的切片上。

**由此作废的判定标准**：先前用的"不新增失败"（因为存在 2 个"既有失败"）不再适用。修复后套件是全量执行的，门禁应为 **`test:gui` 全绿**。当前实测：`test:gui` **3420/3420**、`test:webui` **734/734**。

**会因本次改动而需要同步更新的既有测试**（spec 已列，避免惊吓）：

- `crates/agent-gui/test/chat/context-usage.test.mjs`（圆角、`min-h-9`）
- `crates/agent-gui/test/chat/conversation-stats-bar.test.mjs`（裙边）
- `crates/agent-gui/test/settings/settings-escape-to-close.test.mjs`（返回按钮定位）
- `crates/agent-gui/test/settings/normalization.test.mjs` 与 `crates/agent-gateway/test/webui/web-settings.test.mjs`（归一化与档位解析，两端镜像）
- `crates/agent-gui/src-tauri/src/commands/config/settings/tests.rs`（`default_system_proxy_json()` 全量断言）

## 风险与回滚

| 风险 | 回滚方式 |
|---|---|
| T1.1 窗口几何导致"启动看不见窗口" | 从 `WINDOW_STATE_FLAGS` 移除 `POSITION` 即回到今天的行为，钳制代码可留着 |
| T1.3 系统代理读不到 OS 代理导致出网全挂 | `mode` 回 `manual`；`enabled=false` 完全绕过 |
| T2.2 控件 24px 触达性下降 | 回滚 `composerControlStyles.ts` 一个常量即可整体复原 |
| T3.1 生图供应商漏进某条消费路径 | 消费点在 P1 已列全；最坏情况是 `kind` 默认值改回全按 `chat` 处理 |
| T3.3 开放 claude_code 后中转拒收 PDF | 用户把该模型输入能力改回"自动"即回到主机名规则 |
| T4.2 行为变更引发档位"被重置"的投诉 | 回退解析链中 `defaultThinkingLevel` 的位置即可 |
| T5.x 生图链路不可用 | 与其余四批完全解耦，可整批不发布 |

## 执行方式（待你选择）

按 brainstorming 的架构级路径，spec 与计划都通过后需由你选择执行方式。三个可选：

- **甲・逐批 PR**：每批一个 PR，批内任务顺序提交。回归面最小，评审最容易，但周期长。
- **乙・按子系统分支并行**：①与②并行、③④串行、⑤独立分支。最快，但三处同时改动 `agent-ui` 共享层，合并冲突与交叉回归风险上升。
- **丙・逐批实现 + 子代理审查**：我逐批实现，每批完成后派一个只读子代理做独立审查（重点查 spec 的验收标准是否真的满足，而不是查代码风格）。速度居中，多一道独立校验。

## 附录 A：生图消费点清单（P1 已产出）

排查范围：`crates/agent-ui`（共享 UI）、`crates/agent-gui`（前端 + `src-tauri` Rust）、`crates/agent-gateway`（Go 网关 + `web/` 前端）。结论：**必改 3 + 强建议 6 + 防御性 7 + 待口径确认 6 + 已确认无需改动 40 余处**。

### A-1 必改（3）

| 消费点 | 文件:行 | 是否排除 image | 改动落点 |
|---|---|---|---|
| `CustomProvider` 类型 | `crates/agent-ui/src/lib/settings/types.ts:618-645` | 新增字段 | 在 `usageQuery` 附近加 `kind?: "chat" \| "image"`。**建议可选而非必填**：必填会连锁触发多处 TS 报错（见 A-3） |
| **`normalizeCustomProvider`** | `crates/agent-ui/src/lib/settings/index.ts:1212-1277` | **必改（关键陷阱）** | `:1236` 的 return 对象内加 `kind: obj.kind === "image" ? "image" : "chat"` |
| `buildModelOptions` | `crates/agent-ui/src/lib/models/modelOptions.ts:110-129` | 是 | `:110` 加 `if (provider.kind === "image") continue;`；同时 `:23-41` 的 `ModelOptionsSettings` 加 `kind?: string` |

> **最高风险项（不是那 3 条"必改"里的类型定义，而是第 2 条）**：`normalizeCustomProvider` 是**字段白名单**——它逐字段重建对象，未知字段一律丢弃。`load → normalizeSettings → normalizeCustomProvider`、`updateCustomProviders`、`save` 全走它。**只加类型不修这个函数，`kind` 会在第一次读写后被静默抹回默认值**，表现为"功能时好时坏"。这是本批最容易踩、也最难查的坑。

### A-2 强建议改（6）—— 不改会真出问题

| 消费点 | 文件:行 | 理由 | 落点 |
|---|---|---|---|
| `normalizeProviderFailoverSettings` | `crates/agent-ui/src/lib/settings/modelFailover.ts:70-71` | 注释说"按 vendor 过滤"，但 image/chat 可以是**同一 vendor**（如 codex / gemini）⇒ 生图 provider 的 id 会被合法保留进 failover 队列 | 加 `provider.kind !== "image"` |
| `buildModelFailoverPlan` | `crates/agent-gui/src/pages/chat/runtime/providerRuntimeConfig.ts:156-166` | 失败转移只换 provider 保 model，生图 provider 永远不是对话端点 | `:159-166` 加同一条件 |
| `CronPromptRunner.executeCronPromptRun` | `crates/agent-gui/src/components/cron/CronPromptRunner.tsx:147-158` | **非 UI 入口**（CronTaskManager 工具 / 远程 / 备份导入写 `selectedModel` 不经对话框）⇒ 漏掉会真向生图端点发对话请求 | `:147-150` 加类别校验并报错 |
| `resolveOrganizerProvider` | `crates/agent-gui/src/lib/memory/organizer/service.ts:114-135` | 记忆整理**真发请求** | `:124-134` |
| `sanitize_provider_summary`（Rust） | `crates/agent-gui/src-tauri/src/commands/config/settings/`（网关同步侧） | Rust 侧同样存在**白名单式**字段处理，需核实 `kind` 是否被保留 | 加白名单项（核实后定） |
| `ProviderModal` 保存 payload | `crates/agent-ui/src/pages/settings/ProviderModal.tsx:717-757` | 保存时**逐字段构造** `Omit<CustomProvider,"id">`；编辑路径经 `ProvidersSection.tsx:1050` 的 `{...provider, ...data}` 会保住 kind，但**新建时产生不出 kind** | 加类别控件（属 spec ③-1） |

### A-3 防御性改（7）—— 按 `customProviderId` 找 provider 的对话运行路径

`normalizeSelectedModelForProviders`（`index.ts:1715-1720`）、`resolvePromptClarifyModel`（`index.ts:2244-2247`）、`resolveEffectiveChatModelSelection`（`modelSelection.ts:42-47` / `:69-81`）、`resolveMemorySummaryModelSelection`（`providerRuntimeConfig.ts:19-24`）、`resolveConversationTitleModelSelection`（`:43-46`）、`resolveCommitMessageModelSelection`（`:67-72`）、`resolvePromptClarifyModelSelection`（`:86-99`）。

这些只校验 `provider.activeModels.includes(model)`，不校验类别，是"生图 provider 被写进 selectedModel"的系统边界。不改大概率无害（由 A-2 兜住），改了更稳。

若把 `kind` 定为**必填**，还会额外连带：`getBuiltinCustomProviders`（`index.ts:258-340`，5 个内置项各加 `kind: "chat"`）、`providerFromCcs`（`providerSettings.tsx:120-147`）、`providerFromCherry`（`:180-207`）。

### A-4 已确认无需改动（40 余处，抽样）

`modelPicker.tsx`（只吃 `options` prop）、`groupModelOptionsByProvider` / `sortModelOptionGroups`（输入已过滤）、`ComposerModelControls`（只吃 prop）、`CronSection` / `MemoryPanel` / WebUI `useGatewayChatConfiguration`（均经 `buildModelOptions` 自动生效）、`chatPageHelpers`（纯 re-export）、`MemorySettingsDrawer` / `CronTaskViewModal`（只展示字符串）、`CronTaskModal.getCronReasoningLevels`（入参已过滤）。

### A-5 待产品/口径确认（6）

设置页分栏形态、用量查询是否含生图、仪表盘统计口径、备份的 provider id 指纹是否纳入 `kind`、Cherry/CCS 导入是否产生 image kind、以及 A-3 是否本轮全做。

### A-6 对两处既有结论的核实

- `redact_provider_credential`（`crates/agent-gui/src-tauri/src/commands/config/settings/providers.rs:40-56`）**确为透传未知字段**，只摘 `apiKey` 与 `usageQuery` 密钥 ✅（本次新增 `kind` 不触发 Rust 迁移）
- 备份的 `providers` 域**确为整域搬运** ✅ —— 但注意 A-2 第 5 条的 `sanitize_provider_summary` 是**另一个**白名单，不能据此推断所有 Rust 侧处理都透传

---

## 附录 B：本机环境前置（2026-10-12 实测）

### Rust 工具链

| 项 | 值 |
|---|---|
| 工具链 | `rustc 1.99.0 (b940084d7)` / `stable-x86_64-pc-windows-msvc` |
| `RUSTUP_HOME` | `D:\rust\rustup`（已 `setx` 持久化） |
| `CARGO_HOME` | `D:\rust\cargo`（已 `setx` 持久化） |
| MSVC BuildTools | `D:\BuildTools`（`link.exe` / `cl.exe` 在 `VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64`） |
| Windows SDK | `C:\Program Files (x86)\Windows Kits\10`（**固定在此，安装器无参数可改**） |

**三条踩过的坑（重装时务必记住）**

1. **`--installPath` 只在没有已注册 VS 实例时生效**。若机器上已有 `Microsoft.VisualStudio.Product.BuildTools` 实例，安装器会**静默沿用原路径并忽略 `--installPath`**。要搬家必须先完整卸载（`winget uninstall --id Microsoft.VisualStudio.2022.BuildTools -e --silent`），确认 `vswhere -products * -property installationPath` 为空后再装。
2. **`Microsoft.VisualStudio.Component.VC.Tools.x86.x64`（编译器本体）是 VCTools 工作负载的 *recommended* 组件，不是必需组件**。不带 `--includeRecommended` 时，安装器只装外壳（`VC.CoreBuildTools` / `VC.Redist.14.Latest` / `VC.CoreIde` / `NativeDesktop.Core`），**并会把 `VC.Tools.x86.x64` 从缓存中移除**——表现为"报成功但找不到 `link.exe`"。

3. **绝不能删除 `C:\ProgramData\Microsoft\VisualStudio\Packages` 整个目录。** VS 2017+ 把**实例注册状态**放在 `Packages\_Instances\`（以及 `_bootstrapper\`），`vswhere` 和 rustc 的 MSVC 链接器发现都读它。删掉之后的现象极具误导性：
   - 工具链文件**完好无损**（`link.exe` / `cl.exe` 都在）
   - `vswhere` 返回**空**，注册表 `Setup\Instances` 也不存在
   - **`cargo check` 依然通过**（它不链接），但 `cargo build` / `cargo test` 报 `linker link.exe not found`
   - 更糟的是**无法原地恢复**：重装时目标目录非空会被直接拒绝（`Visual Studio 无法安装到非空目录"..."`），而该目录的 ACL 又阻止非提权删除（`Remove-Item` 对每个文件报"对路径的访问被拒绝"），形成死锁。本机最终是**改装到新路径 `D:\BuildTools`** 才解决的。
   - **正确做法：`Packages` 下只有下载负载可删，`_Instances` / `_bootstrapper` 必须保留。**



### 项目额外前置（**不在 `mise.toml` 中，但 `cargo check` 必需**）

| 前置 | 为什么需要 | 本机做法 |
|---|---|---|
| **libclang** | `rquickjs-sys` 的 build script 用 bindgen，需要 `libclang.dll` | `pip install libclang`，`LIBCLANG_PATH` = `<site-packages>\clang\native`（已 `setx` 持久化）。注意该包提供的模块名是 **`clang`**，`import libclang` 必然失败——不需要导入，路径对即可 |
| **protoc** | `crates/agent-gui/src-tauri/build.rs:44` 编译 gateway proto | `mise.toml` 钉 34.0；本机用 winget `Google.Protobuf` **36.0**，`PROTOC` 指向完整路径（已 `setx` 持久化）。**与 mise.toml 存在版本偏差，需知悉** |
| `LIVEAGENT_APP_VERSION` | `build.rs` 读取（有回退） | 显式设为 `1.3.0-dev.0` |

### 必须注意：`CARGO_TARGET_DIR` 未持久化

Tauri 的 `target/` 是数 GB 级，而 C 盘只剩约 9.6 GB。因此 **`CARGO_TARGET_DIR` 有意不 `setx` 持久化**（持久化会影响机器上所有 Rust 项目），每条 cargo 命令都要显式带上：

```
$env:CARGO_TARGET_DIR="D:\rust\target\liveagent"
```

### 实测基线

`cargo check --manifest-path crates/agent-gui/src-tauri/Cargo.toml --tests` **通过**（51.09s），**3 条既有警告**：`src/runtime/shell_runner.rs:1203/1204` 未使用 import ×2、`src/runtime/managed_process.rs:482` 从未使用的关联函数 ×1。**判定标准：不新增警告。**

（`docs/worklog/live-transcript-jitter.md:185` 记录 2026-08 时为 5 条同类警告；与当前 HEAD 的 3 条不同，**以当前 HEAD 实测为准**。）

### 磁盘现状

| 位置 | 占用 | 说明 |
|---|---|---|
| `D:\BuildTools` | 3431 MB | **当前生效的 BuildTools**（已注册） |
| `D:\VSBuildTools` | 3431 MB | **孤儿目录**：注册丢失后无法原地恢复，被 ACL 锁住，只能提权删除 |
| `D:\rust`（rustup + cargo + target） | 5306 MB+ | 含 `target\liveagent` 的构建缓存 |
| libclang（`D:\Python\...\clang`） | 80 MB | |
| Windows SDK（C） | 1716 MB | **不可搬**，安装器无参数可改 |
| `C:\ProgramData\Microsoft\VisualStudio\Packages` | 1220 MB | **含 `_Instances` 注册，不可删**（见坑 3） |

C 盘可用 **9.7 GB**，D 盘可用 **208.5 GB**。

**待清理的孤儿目录**（需要**管理员**终端；`D:\VSBuildTools` 与 `ProgramData` 下的 VS 目录都被安装器设了受限 ACL，非提权删不掉）：

```powershell
Remove-Item -Path "D:\VSBuildTools" -Recurse -Force
```

> 注意：**不要再删 `C:\ProgramData\Microsoft\VisualStudio\Packages`**（见坑 3）。若要回收它的空间，只删其中的下载负载子目录，保留 `_Instances` 与 `_bootstrapper`。

