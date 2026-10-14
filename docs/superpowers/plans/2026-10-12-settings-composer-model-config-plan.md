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

**结论（2026-10-13 实测）：通。** 证据是一份**进程内端到端**测试，不是读代码推断：

- 落点 `crates/agent-gui/src-tauri/src/services/proxy.rs` → `tests::forwards_multipart_body_verbatim`（`#[tokio::test]`）。
- 做法：进程内起两个 axum 实例——假上游（`POST /v1/images/edits`，把**收到的原始字节与 content-type** 记进 sink）与真实生产路由表（为此把路由组装抽出成 `build_proxy_router(state)`，`start_proxy_server` 与测试共用同一份，避免测试复制一份永不偏离的路由定义）；客户端按生产调用方式（`x-liveagent-proxy-token` + `x-liveagent-upstream-origin` + `content-type: multipart/form-data; boundary=…`）打一次转发。
- 断言：body **逐字节相等**（探针故意含 `\r\n`、`0x00`、`0xff` 等二进制与换行字节，任何"按行重编码/先解析再重组"的实现都会露馅）；`content-type` 连 boundary **原样到达上游**。
- 实测结果：`21 passed; 0 failed`（本模块 21 例全绿，`forwards_multipart_body_verbatim ... ok`），`cargo test` 仅 3 条既有警告。
- 机理（与实测一致）：`handle_proxy` 用 `to_bytes(body, usize::MAX)` 把请求体收成字节后 `client.request(method, url).body(body_bytes)` 原样发出；`build_upstream_request_headers` 只丢 `host` / `content-length` / hop-by-hop / `x-liveagent-*`，`content-type` 在放行之列，`content-length` 由 reqwest 按新 body 重算（这正是正确行为）。
- **对 ⑤-3 的含义**：`codex` 走 `POST /v1/images/edits` 的 multipart 链路**不需要绕道**；spec 风险 R11 解除，"至少一条协议链路可用带参考图的编辑"由 codex 与 gemini 两条都能满足。

## 批次总览

| 批 | 子系统 | 任务数 | 依赖 |
|---|---|---|---|
| ① | 窗口 + 设置壳 + 系统设置 | 4 | 无 |
| ② | 输入框视觉 | 3 | 无 |
| ③ | 供应商 + 模型配置表单 | 4 | P1 |
| ④ | 思考档位端到端联动 | 3 | ③-4 |
| ⑤ | 生图运行时 | 5 | ③-1、P1、P2（仅 ⑤-5） |

①②可立即并行。③④⑤串行。

**进度**（截至 2026-10-13）：

| 任务 | 状态 |
|---|---|
| P1 生图消费点排查 | ✅ 已完成并落地（`144c7d23`、`fa7010f0`） |
| P2 本地反代 multipart 实测 | ✅ 已完成：通（见上「P2」结论，`forwards_multipart_body_verbatim`） |
| 批① 窗口 + 设置壳 | ⏳ 未开始 |
| 批② 输入框视觉 | ✅ 已提交（`34177787`） |
| T3.1 `kind` 数据层 + P1 落地 | ✅ 已提交（`144c7d23`、`fa7010f0`） |
| T3.1 的 UI 两类分栏 | ✅ 本次完成（见该节「落地记录」） |
| T3.2 上下文/最大输出快捷填入 | ✅ 已提交（`7ae221fa`） |
| T3.3 输入能力多选（含 PDF 运行时） | ✅ 已完成（`e51f2266`） |
| T3.4 思考档位字段 + 表单 | ✅ 已完成（`a4629a8d`） |
| T4.1 档位解析接口加覆盖参数 + 9 个调用点 | ✅ 已完成（`57261791`） |
| T4.2 `defaultThinkingLevel` 接入解析链 | ✅ 本次完成（行为变更 R3） |
| T4.3 `off` 由勾选决定 | ✅ 本次完成 |
| 批① 窗口 + 设置壳 + 系统设置 | ✅ 已完成（T1.1 / T1.2 / T1.3 / T1.4） |
| 批⑤ 生图运行时 | ✅ 已完成（T5.1 / T5.2 / T5.3 / T5.4 / T5.5） |

环境前置见附录 B（BuildTools 现落在 `D:\BuildTools`）。

---

## 批① 窗口 + 设置壳 + 系统设置

### T1.1 窗口大小与位置记忆 —— ✅ 已完成

- **文件**：`crates/agent-gui/src-tauri/src/lib.rs`（`WINDOW_STATE_FLAGS` + setup 钩子）、新增 `crates/agent-gui/src-tauri/src/window_geometry.rs`
- **做什么**：`POSITION` 并入 flags；新增可见性钳制——与任一显示器工作区重叠 ≥ 80×80px 才保留还原坐标，否则主显示器居中
- **验收**：钳制函数单测 4 例（在某显示器内 / 跨屏边界 / 坐标落在已拔掉的屏幕上 → 回退居中 / 显示器列表为空）
- **验证**：Rust 侧 `cargo test`
- **坑**：只加 `POSITION` 不写钳制就是原注释警告的回归（拔屏后窗口不可见）

**落地记录**：

1. `POSITION` 已并入 `WINDOW_STATE_FLAGS`；插件自带的"与任一显示器有交集才 set_position"（1px 也算）先兜一层，`window_geometry` 再按 80×80 收紧。
2. **顺序即正确性**：插件默认在 `on_window_ready` 里还原，而 `setup()` 跑在它之前——照原样加 `POSITION` 的话我们的钳制会读到一个尚未还原的坐标。因此给插件加了 `.skip_initial_state(MAIN_WINDOW_LABEL)`，改由 `clamp_restored_window_geometry()` 在 `setup()` 里显式"先还原、再钳制"（互斥锁与缓存都由插件自己的 `restore_state` 处理，不重复实现）。`skip_initial_state` 只跳过还原，保存链路照旧。
3. **钳制判据**：`overlap_size` 两轴都 ≥ 80px 才算可见；命中任一显示器即原样保留；不可见则主显示器**工作区**居中（`work_area`，避开任务栏），窗口比显示器还大时退回显示器原点；显示器列表为空或拿不到主显示器时不下发坐标（交给系统）。最大化/全屏直接跳过（由系统摆放，改坐标会与还原的 `prev_*` 打架）。
4. **单测 7 例**（计划的 4 例 + 边界补充）：完全落在显示器内、跨屏两轴都够、只在边缘探出 40px（不足 80）→ 居中、落在已拔掉的屏幕上 → 居中、显示器列表为空 → 不动、拿不到主显示器 → 不动、窗口比显示器大 → 退回原点。
5. **验证**：`cargo test -p liveagent window_geometry` → 7 passed / 0 failed（EXIT=0）。

### T1.2 设置页两元素对调 —— ✅ 已完成

- **文件**：`crates/agent-ui/src/pages/settings/SettingsShell.tsx`
- **做什么**：只互换"返回对话按钮"与"已保存指示器"，**搜索框留在顶部**；padding 按新位置改回（顶部 `pt-4`、底部 `pb-3`）；搜索框 `mt-2.5` 的参照物变了，间距要核
- **验收**：桌面端左栏顶部＝已保存、底部＝返回对话；Web 端窄屏分支与标题行右侧已保存**零变化**
- **验证**：`pnpm test:gui`（`test/settings/settings-escape-to-close.test.mjs:147` 用 `.settings-back-button` 定位，类名保留；若断言了位置则同步改）

**落地记录**：顶部块（`px-3 pb-2 pt-4`）改为"已保存指示器 + 搜索框"（指示器在搜索之上，即原返回按钮的位置），底部新增返回对话块（`px-3 pb-3 pt-2`，保留 `.settings-back-button` 类名与 `aria-keyshortcuts`，Esc 行为不变）；导航列表的 `pb-6` 收成 `pb-3`（底部不再需要它让位）。Web 端两处零变化：窄屏首行返回按钮与标题行右侧指示器都未动，且桌面顶部块/底部块都带 `web:max-820:hidden`。新增 `test/settings/settings-shell-rail-order.test.mjs` 锁住"顶部=已保存+搜索、底部=返回对话"的源码顺序与 padding。

### T1.3 应用代理支持「使用系统代理」—— ✅ 已完成

- **文件**：`crates/agent-ui/src/lib/settings/types.ts`、`crates/agent-ui/src/lib/settings/index.ts`（归一化）、`crates/agent-ui/src/pages/settings/SystemSettingsForm.tsx`、`crates/agent-gui/src-tauri/src/services/system_proxy.rs`、`crates/agent-gui/src-tauri/src/commands/config/settings/system.rs`、`.../gateway_sync.rs`、`.../backup_snapshot.rs`、`.../tests.rs`
- **做什么**：新增 `mode: "manual" | "system"`（旧存档缺 → `manual`）；Rust `ProxyMode` 扩 `System` 分支且不产出 `proxy_url`；系统模式按平台读 OS 代理；例外列表取「OS ∪ `NO_PROXY_DEFAULT`」；PAC 检测 → 提示 + 直连（**不解析脚本**）
- **验收**：system 模式下 shell env 与 reqwest 均走 OS 代理；PAC 存在时给出提示；`default_system_proxy_json()` 全量断言同步（这是加字段的固定成本）
- **验证**：`cargo test` + `pnpm test:gui`

#### 落地记录

1. **platform 策略（经确认：方案 A）**：Windows 读注册表 `Internet Settings`（`ProxyEnable` / `ProxyServer` / `ProxyOverride` / `AutoConfigURL`，用已在依赖树且已开 `Win32_System_Registry` 特性的 `windows-sys`）；Linux 走 `gsettings`（`mode=manual` 读 http/https/socks host+port，`mode=auto` 按 PAC 处理，schema 不可用则回落进程环境变量）；**macOS 只读进程环境变量**——本机没有 macOS 编译环境，盲写 CoreFoundation/SCDynamicStore 无法验证，会在文档与设置页文案里写明这一限制。所有解析（`ProxyServer` 两种形态、`ProxyOverride` 的 `<local>`、gsettings 列表、`no_proxy` 并集、PAC 优先）都是纯函数，**7 例单测在本机可验证**。
2. **reqwest 侧**：`System` 模式不调 `.no_proxy()`，改用 reqwest 默认的 OS 代理探测（`async/blocking/os_proxy_fallback` 三个 builder 同步处理）；`current_config()` / `current_proxy_url()` 对 System 返回 `None`（自建 TCP 隧道与 updater 走各自的默认探测，需要显式 URL 的路径仍只认手动配置）。
3. **读数缓存**：OS 代理读数按 30s 缓存（shell 每执行一条命令都会问一次代理，不能每次都读注册表/起进程）；`set_config` 一旦切模式立即失效缓存，用户刚改过系统代理也能马上生效。
4. **UI**：对话框顶部加来源开关；跟随系统时隐藏手填四字段并显示读到的代理 / PAC 提示 / "系统未配代理" 三态；护栏 A（host/port 无效禁止开启）改为只在手动模式生效。OS 读数经新命令 `system_proxy_os_status` 取，**仅桌面端请求**（WebUI 的浏览器进程读不到宿主 OS 代理）。
5. **连带必改**：`normalize_system_proxy_value` 是白名单 → 补 `mode`（否则存档里的 system 会被静默抹成 manual）；`default_system_proxy_json()` 加 `"mode": "manual"`；`gateway_sync.rs` 的密码脱敏与 `backup_snapshot.rs` 把 systemProxy 排除出可移植键的行为**不变**。
6. **测试**：Rust `system_proxy` 模块 17/17（含本次新增的 7 例）；TS 侧 `normalization.test.mjs` 的 systemProxy 全量断言补 `mode` 与三态语义，新增 `test/settings/system-proxy-mode.test.mjs` 锁 UI/桌面端分工。

### T1.4 系统通知（四项设置 + 三个触发点）—— ✅ 已完成

- **文件**：`types.ts`、`SystemSettingsForm.tsx`、新增 `crates/agent-gui/src/lib/system/notifications.ts`、`crates/agent-gui/src/pages/chat/hooks/useNotifyToasts.ts`、工具审批宿主、`backup_snapshot.rs`（白名单）、zh/en i18n
- **做什么**：`{sessionComplete, sessionError, permissionRequest, notifyWhenFocused}` 默认全 `true`；通知偏好加入 `SYSTEM_PORTABLE_BACKUP_KEYS`；三个触发点接入；权限申请与拒绝后的提示
- **验收**：`notifyWhenFocused=false` 且窗口有焦点时**一条都不发**（含权限请求）；点击通知聚焦窗口
- **待定项**：**会话完成的信号源须在实现时定位 `ChatPage` 的运行态来源**，spec 已明确不得臆断
- **验证**：`pnpm test:gui`

#### 落地记录

1. **信号源（按 spec 要求先定位再实现）**：`ChatPage` 的运行态真源是 `runningConversationIds`（`useState<ReadonlySet<string>>`，由侧栏 running patch 同一份数据驱动）→ "会话完成"= `runningConversationIds.has(currentConversationId)` 的**下降沿**；出错信号沿用 `useNotifyToasts` 已有的 `errorMessage`；审批信号用 `getPendingToolApprovalsSnapshot(conversationId)` + `subscribeToolApprovalsForConversation`（与 `PendingToolApprovalBar` 同一份 store）。
2. **触发点放在 `useNotifyToasts` 而非 `ToolApprovalBar`**（与本计划初稿的差异）：该 hook 本就在 agent-gui、且已持有会话级错误与压缩态；把审批也接到这里可以避免为"共享 UI 调桌面实现"再引一套 adapter（`kernel` 侧还需要一份 web 空实现）。信号点、过滤顺序、通知内容与 spec 一致。
3. **发送面**：新增 Rust 命令 `send_system_notification` / `notification_permission_state` / `request_notification_permission`，包住 `tauri_plugin_notification` 的 desktop API。**不直接 invoke 插件的 `plugin:notification|*`**：JS 侧插件包 `@tauri-apps/plugin-notification` 本仓库并未安装，走自家命令既不用新增 npm 依赖，参数形状与错误信息也都在 Rust 里受编译期约束。
4. **过滤顺序**（`lib/system/notifications.ts`，唯一实现）：单项开关 → `notifyWhenFocused`（为 false 且窗口有焦点 → 全拦，含权限请求；窗口状态拿不到时按"有焦点"处理，宁可少发）→ 权限（prompt 时**只自动申请一次**，被拒后仅记录原因、不再弹）。发送失败一律静默降级。
5. **审批超时提醒**：一批待审批"空 → 非空"时通知一次，并在该批最早 `deadlineAt` 前 60s 补一条（同一批内不重复报；pending 清空即取消定时器）。超时后审批按拒绝处理（`toolApproval.ts` 既有语义），所以提醒是"即将自动拒绝"。
6. **权限被拒的提示**：设置页挂载时查询一次权限态；非 granted 时在通知分节下方显示原因并提供"申请权限"入口（手动，不自动反复弹）。
7. **WebUI**：整个通知分节在 `isGatewayWebuiRuntime()` 时为 null；另补了一份 `crates/agent-gateway/web/src/lib/system/notifications.ts` 空实现（共享 UI 经 `@liveagent/app/lib/system/notifications` 引用，Web 侧必须是 no-op 而不是缺失文件）。
8. **连带必改**：`normalize_notification_settings_value`（Rust 白名单归一，默认全 true）+ `normalizeNotificationSettings`（TS 同语义）；`SYSTEM_PORTABLE_BACKUP_KEYS` 加入 `notifications`（机器无关偏好，换设备跟随；`systemProxy` 继续排除）；`commands::config::settings::tests` 的 `row_count` 15→16、键列表加 `SYSTEM_NOTIFICATIONS_KEY`、四处全量 system payload 断言加 `notifications`。
9. **测试**：`test/system/notifications.test.mjs`（4 例：单项开关、有焦点全拦、prompt 只申请一次且被拒后停止、授权后按本地化载荷发送）、`test/system/notification-triggers.test.mjs`（5 例：三触发点、ChatPage 接线、设置页四开关与 Web 门控、过滤规则归属、Rust 命令名与注册一致）、`normalization.test.mjs` 新增通知偏好默认/归一断言。

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

### T3.1 供应商 `kind` 字段 + 两类分栏 —— ✅ 已完成

- **文件**：`crates/agent-ui/src/lib/settings/types.ts:618`、`crates/agent-ui/src/lib/settings/index.ts`（`normalizeCustomProvider`）、`crates/agent-ui/src/pages/settings/ProvidersSection.tsx:1095-1142`、`ProviderModal.tsx` / `ProviderModalView.tsx`、`crates/agent-ui/src/lib/models/modelOptions.ts:105-129`、`crates/agent-gui/src/agent-ui-adapters/providerSettings.tsx:210`、`crates/agent-gui/test/settings/normalization.test.mjs`、`crates/agent-gateway/test/webui/web-settings.test.mjs`
- **做什么**：新增 `kind: "chat" | "image"` 默认 `"chat"`；列表从协议 `Tabs` 改两类分栏；`buildModelOptions` 加 `kind !== "image"` 过滤；创建流程增加类别维度；落地 P1 清单的每一条
- **验收**：生图供应商不出现在对话模型选择器；既有存档零迁移；Rust 侧无需改动（`redact_provider_credential` 透传未知字段）
- **验证**：`pnpm test:gui`（3437/3437）+ `pnpm test:webui` + `pnpm check:ui-boundaries`

#### 落地记录（两段：数据层 `144c7d23`/`fa7010f0`，UI 本次）

1. **分栏与排序的维度从协议改成类别**：`ProviderList` 的入参由 `type: ProviderId | "all"` 改为 `kind: ProviderKind`，`handleProviderReorder(kind, nextIds)` 同维度重排（重排只在同类别内部生效，跨类别相对顺序不变）；新增 `ProviderKindSection`（标题 + 计数 + 列表），滚动容器下移到分栏外层，列表自身不再滚动（避免嵌套滚动区）。
2. **创建流程的类别维度**：服务选择弹窗顶部加「对话模型／生图模型」`SettingsToggleGroup`，协议列表由 `providerTabsForKind(kind)` 给出——生图类别只列 `codex`/`gemini`（决策 M=丙，`IMAGE_PROVIDER_TABS`）。`ProviderModal` 新增 `providerKind` 入参，控制器用 `initialData?.kind ?? providerKind ?? "chat"` 定类别并写进保存 payload（编辑时以存档为准）。
3. **R14 边界（两套字段不互相污染）**：`kind === "image"` 时模型设置窄栏隐藏对话专用字段——输入能力（`canOverrideModelInputModalities` 同时要求非 image）、思考档位与默认档、codex 的缓存提示覆盖，改为一行说明文案 `settings.imageProviderModelHint`。生图自己的生成参数（质量/尺寸/张数）属 ⑤-1，未提前落地；上下文/最大输出两项暂留（生图模型条目需要的占位限额，⑤-1 一并复核）。
4. **P1 候选列表补漏**：`FailoverSettingsCard` 的 `vendorProviders` 原本只按协议过滤，生图供应商会出现在失败转移候选里；已加 `providerListKind(provider) === "chat"`。
5. **测试**：新增 `crates/agent-gui/test/settings/provider-kind-sections.test.mjs`（协议子集、分栏/排序维度、创建流程带 `kind`、对话专用字段门控、失败转移候选排除）；同步改写 `crates/agent-gateway/web/test/mobile-settings-layout.test.mjs` 的旧工具栏断言（它原来锁的是"tabs 与动作组换行"，现锁"动作组在上 + 分栏 + 外层滚动 + 无 TabsList"）。

### T3.2 上下文与最大输出快捷填入

- **文件**：`crates/agent-ui/src/pages/settings/ProviderModalView.tsx:732-773`、zh/en i18n
- **做什么**：每个输入框**上方**加预设 chip 行（`flex flex-wrap gap-1`）；点击写入现有 `onChange` 路径（自动获得 `limitsSource: "user"` 与校验），不需要新的保存动作
- **数值（按文档字面）**：上下文 `128K=131072` / `256K=262144` / `512K=524288` / `1M=1000000` / `1M=1048576`；最大输出 `32K=32768` / `64K=65536` / `128K=131072` / `256K=262144` / `384K=384000` / `512K=524288`
- **坑**：同一行内十进制与二进制并存是文档原意，不要"顺手统一"
- **验收**：点击后写入正确字面值且 `limitsSource` 变为 `user`

### T3.3 输入能力改多选（含 PDF 运行时）—— ✅ 已完成

- **文件**：`crates/agent-ui/src/lib/settings/types.ts:446-476`、`index.ts`（`normalizeInputModalities`）、`crates/agent-ui/src/pages/settings/providerUtils.ts:48-78`、`ProviderModalView.tsx:774-824`、`ProviderModal.tsx:568`、`crates/agent-gui/src/lib/providers/nativeResponsesAttachments.ts:159`、`crates/agent-gui/src/lib/providers/runtime/modelFactory.ts:354-360`、`crates/agent-ui/src/lib/models/modelCatalog.ts:159-162`
- **做什么**：值域扩为 `缺失(=自动) | ["text"] | ["text","image"] | ["text","pdf"] | ["text","image","pdf"]`；UI 改 4 个 `Checkbox`（`自动` 与其余互斥）；`supportsNativePdfInline` 改为 `有声明 → 声明里有 pdf；自动 → 主机名规则；声明里没有 pdf → false`；`providerSupportsModelInputModalitiesOverride` 纳入 `claude_code`
- **验收**：既有两种存档值仍合法（零迁移）；勾选 PDF 后在第三方中转上走原生内联
- **坑**：这是**有意破掉**"anthropic 不读 `model.input`"的防线（spec R5），`settings/types.ts:470-472` 与 `modelFactory.ts:354-360` 两处注释须同步改写说明新语义。**不要**把覆盖升级成"完整模态声明"——目录的 audio/video 会被抹掉
- **验证**：`pnpm test:gui`（3424/3424）+ `pnpm test:webui`（全绿）+ `pnpm typecheck:ui` / `typecheck:gui` + `pnpm check:ui-boundaries`

#### 落地记录（与初稿的差异，均已回写 spec ③-4）

1. **声明的承载**：pi-ai 的 `Model.input` 类型只接受 `"text" | "image"`，`"pdf"` 进不去 → 新增零依赖叶子模块 `runtime/modelInputModalitiesDeclaration.ts`，`createModelFromConfig` 改为"装配 + 挂 `inputModalitiesOverride`"两层（装配体改名 `buildModelFromConfig`，仍是唯一装配点）。`text/image` 照旧投影进 `model.input`（局部量 `wireInput`），附件层读声明字段决定 PDF 是否内联。
2. **UI 形态**：4 个 `Checkbox` 里 `文本` 恒勾选且禁用（聊天协议始终发送文本，normalizer 也会补齐）；`自动` 勾选即删除字段。`ModelInputModalitiesMode`（三值字符串）改为 `ModelInputModalitiesSelection = "auto" | ModelInputModalitiesOverride`，配套 `get/apply/has/toggle` 四个纯函数。
3. **gemini 的 PDF 附加条件删除**：原 `buildGeminiNativeAttachmentContentPart` 要求 PDF 还需通过图片能力门控，会导致"勾了 PDF 没勾图片 → PDF 内联不了"，与 T3.3 目标直接冲突，故删除该条件（PDF 候选资格统一由 `isNativeInlineCandidate → supportsNativePdfInline` 决定）。
4. **anthropic 图片门控**：`modelSupportsImageInput` 由"读 `model.input`"改为"有声明按声明，无声明 anthropic 维持内联、其余分支读 `model.input`"——否则 `claude_code` 开放后图片勾选框会变成静默空操作（`k3`/`glm` 等非目录模型的 `input` 是硬编码占位值）。工具结果图片不在本项内（`piAiAdapter` 不变），已在注释里写明边界。
5. **Rust 侧无需改动**：`sanitize_provider_summary` 把 `models` 整段透传，模型级字段（含 `inputModalities` 新值）不受白名单影响。

### T3.4 思考档位与默认档字段 + 表单 —— ✅ 已完成

- **文件**：`crates/agent-ui/src/lib/settings/types.ts:457-476`、`index.ts`（归一化）、`ProviderModalView.tsx`、zh/en i18n
- **做什么**：新增 `thinkingLevels?: ReasoningLevel[]`（含 `"off"`）与 `defaultThinkingLevel?: ReasoningLevel`（须属于前者，后者未设置时该项隐藏）；新建/编辑模型时缺失则初始勾选 `low`/`high`/`max`；**偏差标注**——7 档全可勾，目录明确未声明支持的档位旁加提示且**不阻断**
- **验收**：字段归一化对旧存档零影响；偏差提示只在目录判得出"不支持"时出现
- **验证**：`pnpm test:gui`（3432/3432，含新 `test/settings/thinking-levels.test.mjs` 8 例）+ `pnpm test:webui` + `pnpm typecheck:ui` / `typecheck:gui` + `pnpm check:ui-boundaries`

#### 落地记录（与初稿的差异，均已回写 spec ③-5）

1. **"缺失 = 初始勾选 low/high/max" 只作展示，不落库**：勾选集合未自定义时表单显示 `low`/`high`/`max`（`DEFAULT_MODEL_THINKING_LEVELS`），但**只有用户真的勾选/取消才写字段**。否则打开一次旧模型就会把"目录推断"永久替换成三档勾选，静默收窄批④的可用档位——与"旧存档零影响"直接冲突。提示文案已写明"未自定义时按模型目录推断"。
2. **取消到空集合 = 清空自定义**：两个字段一起删除，回到"按目录推断"；默认档被取消勾选时一并清掉（维持"默认档 ∈ 勾选集合"的不变量）。`normalizeThinkingLevels` 对空数组同样返回 `undefined`，所以存储层不存在"有字段但空集合"的中间态。
3. **默认档下拉只在已自定义勾选后出现**（`editingModelHasCustomThinkingLevels`），对应"`thinkingLevels` 未设置时该项隐藏"。
4. **偏差标注的取值规则**（`resolveUnsupportedThinkingLevels`）：`fromCatalog || fromLive` 才给提示——未被目录声明的档 + 思考不可关闭（`alwaysOn`，含 xai 的 wire 限制）时的 `off`；兜底推断（自定义/未收录模型）一律不给提示（方向单一）。
5. **规范顺序单一真源**：`settings/index.ts` 导出 `REASONING_LEVEL_CHOICES`（`off` + 既有 6 档），归一化、表单勾选行、默认档下拉三处同序。

---

## 批④ 思考档位端到端联动

### T4.1 档位解析接口加覆盖参数 + 6 个调用点 —— ✅ 已完成

- **文件**：`crates/agent-ui/src/lib/settings/index.ts:512`、新增共享 helper（建议放 `lib/models` 或 `lib/settings`）、以及调用点：`crates/agent-gui/src/pages/ChatPage.tsx:3403`、`crates/agent-gui/src/pages/chat/runtime/useChatModelSelection.ts:175`、`crates/agent-gui/src/lib/providers/runtime/providerRuntimeConfig.ts:25`、`crates/agent-gateway/web/src/app/hooks/useGatewayChatConfiguration.ts:73`、`crates/agent-gateway/web/src/app/workbench/GatewayConversationPaneHost.tsx:496`、`crates/agent-ui/src/pages/settings/CronTaskModal.tsx:133`
- **做什么**：接口加可选覆盖参数（读档位时"有勾选用勾选，无勾选回落目录"）；用 helper 避免 6 处重复查找
- **验收**：6 处全部接入；**`CronTaskModal` 最易漏，单独确认**
- **坑**：这是 agent-gui 与 agent-gateway/web 的共享层，接口变更两端同时生效

#### 落地记录

1. **共享 helper**：`resolveConfiguredThinkingLevels(provider, modelId)` 与 `ChatRuntimeReasoningParams`（`provider?: ReasoningLevelsProvider`）落在 `lib/settings/index.ts`。`ReasoningLevelsProvider` 只要求 `{ type, models?: { id, thinkingLevels }[] }`——WebUI 的 `ModelProviderSource` 是窄 Pick（不带 `models`），运行时缺 `models` 时按"未自定义"回落目录而不是抛错。
2. **实际接入 9 处**（比初稿的 6 处多，凡是同时调 `normalize/update…ForProvider` 的地方都必须同源，否则"读的档位"与"钳的档位"会分叉）：
   - 初稿 6 处：`ChatPage`（背景 Pane）、`useChatModelSelection`、`providerRuntimeConfig`、`useGatewayChatConfiguration`、`GatewayConversationPaneHost`、`CronTaskModal`；
   - 追加 3 处：`useSendChatTurn`（本轮实际下发的档位钳制，`:503`）、`gatewayChatCommandActions.resolveConversationRuntimeControls`、`clarifyPromptTurn`。
   - `useChatModelSelection` / `useGatewayChatConfiguration` 顺带把 `chatRuntimeReasoningParams`（memo）复用到 `updateChatRuntimeControlsForProvider`，写入路径与读取路径同参数。
3. **内存化依赖**：WebUI 两个 hook 的 memo 依赖补上 `currentChatProvider` / `selectedProvider`（provider 对象随 settings 更新换代，档位勾选变化必须触发重算）。
4. **向后兼容**：不传 `provider` 时行为与改前逐字一致（纯目录），既有测试与调用方零改动。

### T4.2 `defaultThinkingLevel` 接入解析链 —— ✅ 已完成

- **文件**：`crates/agent-ui/src/lib/settings/index.ts:481`（`resolveChatRuntimeReasoning`）
- **做什么**：链改为 `reasoningByModel → defaultThinkingLevel → reasoningByProvider → reasoning`
- **验收**：未单独选过档位的模型会选中其默认档
- **坑**：**这是行为变更**（spec R3）——用户此前按"供应商"选过的档会被该模型的默认档覆盖。**必须在 PR 描述里显式标注**

**落地记录**：链的插入点在 `resolveChatRuntimeReasoning` 的第 4 个可选参数上，由 `normalizeChatRuntimeControlsForProvider` 用 `resolveConfiguredDefaultThinkingLevel(params.provider, params.modelId)` 喂入。默认档只在"模型桶没有该模型的显式选择"时生效（会话里选过就听会话的）；读侧再按档位集合钳制一次。**行为变更（R3）已在本条与提交信息中标注**：此前按供应商选的档会被该模型的默认档顶掉——这是 spec 确认接受的取舍。

### T4.3 `off` 由勾选决定 —— ✅ 已完成

- **文件**：`crates/agent-ui/src/components/chat/ComposerModelControls.tsx:206-211`、`crates/agent-ui/src/lib/settings/index.ts:195`
- **做什么**：`off` 是否出现在会话里，改由"勾选里是否含 `off`"决定，不再由目录 `alwaysOn` 决定
- **验收**：勾了 `off` 的模型在会话里能选"关闭思考"
- **坑**：请求期仍由目录钳制（xai 的 `off` 被 `map.off = null` 屏蔽）→ 静默偏差存在，由批③的偏差标注暴露，**这是经确认的取舍，不要顺手改成替换式**

**落地记录**：新增 `resolveConfiguredThinkingAlwaysOn(providerId, provider, modelId)`——**有勾选 → `!levels.includes("off")`；无勾选 → 目录 `alwaysOn`**。`isThinkingAlwaysOnForModel`（纯目录）保留为回落实现，既有测试不改。`ComposerModelControls` 的 `effortChoices` 无需改动：它已按 `thinkingAlwaysOn ? filter(!= off) : ["off", ...filter(!= off)]` 派生，档位集合里含 `off` 时自然出现在首位、不含时自然消失。5 个生产调用点全部改走新解析器（`ChatPage` 背景 Pane、`useChatModelSelection`、`CronTaskModal`、`useGatewayChatConfiguration`、`GatewayConversationPaneHost`），都把供应商实例一并传入。请求期目录钳制**未动**（④-4 的取舍）。

---

## 批⑤ 生图运行时

按 spec 的三段推进，串行。

### T5.1 生图供应商配置

- **文件**：`crates/agent-ui/src/lib/settings/types.ts`、`ProviderModalView.tsx`（按 `kind` 分支出第二套模型设置面板）、`ProvidersSection.tsx`、i18n
- **做什么**：`kind = "image"` 的供应商协议选项仅 `codex` / `gemini`（`claude_code`/`deepseek`/`xai` 均不显示）；生图模型配置显示尺寸/质量/张数默认值，**不显示**输入能力与思考档位
- **验收**：协议选项里没有那三者；两套模型设置面板不互相污染（spec R14）
- **段**：⑤-1

**落地记录**：

- 协议子集与两套面板的分支**已在 T3.1 的 UI 分栏中落地**（`providerTabsForKind` 把 image 的协议选项收窄为 codex/gemini；`ProviderModal` 对 image 关掉输入能力覆盖；`ProviderModalView` 按 `providerKind` 分支）。本次补齐的是**生图模型的默认生成参数**。
- 新增共享模块 `crates/agent-ui/src/lib/settings/imageGeneration.ts`（唯一判定点）：`IMAGE_GENERATION_PROVIDER_IDS = ["codex","gemini"]`、按协议各自的取值表（codex：`CODEX_IMAGE_SIZES` 的 `WxH` + `CODEX_IMAGE_QUALITIES`；gemini：`GEMINI_IMAGE_ASPECT_RATIOS` + `GEMINI_IMAGE_RESOLUTIONS`）、`IMAGE_COUNT_MIN/MAX = 1/12`、协议默认值（codex 用上游自己的 `auto` 语义，不替用户猜尺寸）、`normalizeImageSize/Quality/Count`、`resolveImageGenerationParams`。
- **不做跨协议统一枚举**（spec 明文要求）落到可执行层面：`normalizeImageSize("gemini","1024x1024")` 与 `normalizeImageSize("codex","16:9")` 都返回 `undefined`——两套取值互不承认。
- `ProviderModelConfig` 加 `imageSize?` / `imageQuality?` / `imageCount?`；`normalizeProviderModelConfig` 增**可选**第三参 `kind`（缺省 `"chat"`，既有两参调用点与测试语义不变），只有 `kind === "image"` 且协议属生图子集时才保留这三个字段——**这是本批最易踩的坑（字段白名单）**：不加这一处，字段会在第一次 load/save 往返后被静默丢弃。
- 越界值**丢弃而非钳制**（`imageCount: 99` → 未配置）：静默纠正会掩盖配置错误；调用期越界另有明确报错（验收 6）。
- 生图模型面板（`ProviderModalView`）在 image 分支下新增三个字段（尺寸/质量/张数），沿用 `promptCacheHintMode` 的既有写法直接改 `setEditingModel` 的草稿，**不新增 viewModel 字段**；尺寸/宽高比是自描述取值直接显示原值，质量档走 i18n（`settings.imageQuality.*`，未知值原样显示）。
- 测试：`crates/agent-gui/test/settings/image-generation-params.test.mjs` 6 例（协议子集 / 两套枚举互不承认 / kind 门控 / 旧存档零迁移 / 越界丢弃 / 解析回落顺序 / kind 透传）。
- 验证：`pnpm typecheck:ui`、`typecheck:gui`、`check:ui-boundaries`、`lint` 全通过；`pnpm test:gui` 全绿（含新增 6 例）。

### T5.2 `GenerateImage` 工具 + codex 适配器 + 应用级临时根

- **文件**：新增 `crates/agent-gui/src/lib/images/{generateImage,imageArtifacts,imageParams}.ts` 与 `adapters/openaiImages.ts`、`crates/agent-gui/src/lib/tools/builtinRegistry.ts`、`builtinTypes.ts`、`crates/agent-ui/src/contracts/builtinTools.ts`（复用 `display_image`，**不新增结果类型**）、Rust 侧新增临时根与启动清理
- **做什么**：注册工具；`switch (provider.type)` 分派；`codex` 走 `POST /v1/images/generations`；落盘到应用级临时根；工具结果**只给文件路径**（决策 R）；默认审批 `ask`（决策 S）
- **验收**：模型能通过工具生成 1 张图并在会话内渲染；后续请求按既有规则脱敏；清理阈值 **30 天**（决策确认）
- **坑**：张数上限受 `MAX_DISPLAY_IMAGE_PATHS = 12` 约束
- **段**：⑤-1

**落地记录（T5.2 / T5.3 / T5.4 一起落地）**：三者的代码互相咬合（入口要同时分派两条适配器、工具要处理张数与越界），故合并为一次提交。

Rust 侧：
- 新增 `services/image_artifacts.rs`：应用级临时根 `<系统临时目录>/liveagent-images/`、**内容寻址命名** `liveagent-<fnv1a64>.<ext>`（同内容复用同一文件，命中时只刷新 mtime，保证"最近还被用到"的图不被清理）、`extension_for_mime` 白名单、单张 64 MB 防御上限、纯函数 `is_expired` 与 `prune_expired_artifacts`（只删普通文件、跳过子目录、目录不存在不算错）、启动清理（`prune_expired_artifacts_on_startup`，与上传暂存区 GC 同策略：失败只记录不阻断启动）。
  - 内容哈希**刻意与 `commands/workspace/fs.rs::hash_bytes` 同算法**（FNV-1a 64）：全仓 `contentHash` 吃同一份口径，单测用空输入/`"a"` 的已知值把这条钉死。
  - 清理阈值 **30 天**（spec 决策）。
- 新增命令 `image_artifact_info` / `image_artifact_save` / `image_artifact_prune`（`commands/app/images.rs`，只做 IPC 边界，规则全在服务层）。

前端：
- `lib/images/`：`base64.ts`（分块，避免大图爆栈）、`types.ts`、`providerRequest.ts`（**复用 `createProviderRuntimeConfig` + `prepareProviderRequest`** 这一份唯一装配，并新增 `stateless: true` 选项——生图是无状态端点，不该带 Codex CLI 的会话身份头）、`imageParams.ts`（目标解析）、`generateImage.ts`（按协议分派）、`adapters/openaiImages.ts`、`adapters/geminiImages.ts`、`imageArtifacts.ts`。
- codex：文生图 `POST /images/generations`（**不发 `response_format`**：gpt-image-1 只回 b64_json 且拒绝该字段，dall-e 默认回 url；两种形状都解析，url 形状经 hub 反代取回字节）。
- gemini：`POST /models/{model}:generateContent` + `responseModalities: ["IMAGE"]`，**独立解析**（`candidates[0].content.parts[].inlineData`）；`imageConfig.imageSize` 只在 Gemini 3 图像模型上发送（2.5 代不认这个字段，多送会 400）；`n>1` 靠串行重复请求（协议没有批量参数）。
- 工具 `GenerateImage`（`lib/tools/imageTools.ts`）：注册进 registry；结果**复用 `display_image` 契约**（不新增结果类型），带内联图块供 UI 渲染——模型侧仍只看到路径，因为 `requestContextSanitizer` 对 `details.kind === "display_image"` 的结果会把 content 整段替换为路径文本（与 `Image` 工具同一条既有链路）。
- 审批缺省 `ask`：契约新增 `BuiltinToolMetadata.defaultPolicy`，`resolveToolPolicy` 在 serverPolicyDefault 之后、组缺省之前消费它；`builtinToolCatalog` 同步声明 `defaultPolicy: "ask"` 并提供三条 i18n 文案（两者必须同步，测试锁定）。
- 张数越界**在原始入参上判定**：`resolveImageGenerationParams` 对非法值一律当"未传"（对落库配置是正确语义），若在解析后才判定，`count=20` 会静默回落到模型默认张数——正是 spec 验收 6 禁止的行为。
- 供应商实时读取沿 `getToolPolicies` 同一条链（App → ChatPage → useSendChatTurn → runAgentConversationTurn → registry），缺省不注册生图工具。

测试：`crates/agent-gui/test/images/image-generation.test.mjs` 15 例（目标解析 / 传输头 / JSON 与 multipart 两条形状 / url 形状经 hub 反代 / gemini 独立形状与串行多张 / 上游错误透出 / 未知协议拒绝 / 审批缺省与 catalog 同步 / 缺供应商与越界报错 / 结果契约 / 参考图走 edits）；Rust `services::image_artifacts` 6 例。
验证：`typecheck:ui|gui|webui`、`check:ui-boundaries`、`lint` 全通过；`test:gui` 3479 全绿（含新增 15 例）、`test:webui` 734 全绿；`cargo check --tests` 仅 3 条既有警告，`cargo test --lib services::image_artifacts` 6 passed / 0 failed。

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

**落地记录**：

- 参考图编辑（前半）：工具参数 `reference_images`（本地图片路径）→ `fs_read_image_source` 读成 base64 → codex 走 `POST /images/edits`（multipart，P2 已实测逐字节转发）、gemini 作为 `inlineData` part 与文本一起送。生图**没有用户发起的入口**（spec 决策 Q=甲），因此参考图由模型从会话里已有的图片路径给出，不新增上传 UI。
- 转存（后半）：
  - Rust 新增命令 `fs_save_image_to_workdir`（`commands/workspace/fs.rs`）。既有写入链路**没有任何命令能接收工作区之外的源**，所以必须新增；但路径校验、文件名消毒（`sanitize_rel_path_core`）、去重命名、`fs::copy` 全部复用既有实现。源侧白名单只有两项、且都用 `fs::canonicalize` 后比较（Windows verbatim 路径陷阱）：①已在工作区内（不复制，原样返回）；②应用生图临时根之内。其余外部绝对路径一律拒绝——那会凭空开出一条"任意读 + 写工作区"的通道，而本期需要它的唯一场景已被 ② 覆盖（**这是对 spec R16"任意来源图片都可另存"的有意收窄，已在此记录**）。同名不覆盖（`name-2.ext` 递延），并捕获 checkpoint 前像以便 rewind 能撤销这次复制。
  - 引用改写：`lib/images/rewriteDisplayImagePaths.ts`（纯函数）。**必须产生新的 message 对象**——共享 UI 的 `displayImagePayloadCache` 按 `ToolResultMessage` 的**对象引用**缓存，原地 mutate 会继续渲染旧路径与旧文件名；改写走 `replaceActiveSegmentMessages`（仓库里"改写 active segment 既有消息"的既有写法，见 compaction/controller.ts），并同步首图相关的顶层冗余字段与文本块里的路径。
  - 宿主接线：`pages/chat/runtime/useSessionImageTransfer.ts` 注册模块级槽位（`lib/images/sessionImageTransfer.ts`），改写后经 `updateConversationRuntimeEntry` + `persistConversation` 落盘（先落运行时缓存让 UI 立刻刷新，写库成功后必须再落**带 revision** 的那份状态，否则 CAS 令牌会被清空）。
  - 共享 UI：`ToolImages.tsx` 的图片右键菜单新增「保存到工作区」，按 `display_image` 契约分派（不按工具名特判），远端图（url / proxy 渲染）不提供该动作。跨宿主走新 adapter `@liveagent/adapters/sessionImageSave`（桌面实现真实动作，WebUI 声明不支持 → 菜单项不出现）。
  - 目标工作区取**当前聚焦会话**的工作区：用户是对着眼前那张图点的动作。
- 测试：`crates/agent-gui/test/images/session-image-transfer.test.mjs` 8 例（新对象与字段同步 / 路径归一化比较 / 无关结果零改写 / 空路径与非法 kind 的 no-op / 转存后回调改写 / 无工作区 / 已在工作区不重复改写 / 桌面 adapter 声明支持）。
- 验证：`typecheck:ui|gui|webui`、`check:ui-boundaries`、`lint` 全通过；`test:gui` 3487 全绿（含新增 8 例）、`test:webui` 734 全绿。

---

## 批⑤ 遗留与已知限制（独立审查产出，2026-10-13）

批⑤ 完成后派了独立只读子代理逐条核对 spec 的 9 条验收标准。**已修**：

- `ProviderModal` 打开供应商时用两参调用 `normalizeProviderModelConfigs` → `kind` 默认 `"chat"` → **生图三个字段在"打开并保存"往返中被静默清空**（T5.1 功能性失效，与 `kind` 当初的白名单陷阱同型）。已改为传 `providerKind`。
- 「保存到工作区」在共享 UI 侧取 `detail.path`，而**工作区内的图片 `path` 是相对路径**（displayPath），Rust 侧要求绝对路径 → 对这类图恒报错。已改为优先 `absolutePath`。
- `fs_save_image_to_workdir` 原先**先写盘再校验**目标是否在工作区内；已把包含性校验挪到复制之前。
- `unique_copy_target` 在 10000 个同名文件后**静默覆盖**（与"同名不覆盖"的注释相悖）；已改为明确报错。
- 验收 4（只给路径）此前**零测试锁定**：内联块剥离完全依赖 `requestContextSanitizer`，而测试只断言内联块存在。已补一条断言"模型上下文里不含内联字节、只含路径"。
- spec 决策 P=丙 / 风险 R12 要求的"UI 须提示未转存会失效"此前**完全没落地**（`image_artifact_info` 无调用方）。已在图片右键菜单对临时图补提示行，并加一条测试锁住共享 UI 常量与 Rust 真源一致。

**未修，作为已知限制记录**（都不影响验收 1–8 的主路径）：

| # | 限制 | 影响 | 为什么先不修 |
|---|---|---|---|
| L1 | 转存目标取"当前聚焦会话"（模块级单槽位） | 多栏时在**后台栏**点转存，文件会落进聚焦会话的工作区；后台会话自己的引用不会被改写（改写不到就不持久化，不会写坏数据） | 需要把 conversationId 从 pane 上下文一路传到共享 UI 菜单项；属接线改造，与本期"能出图 + 能转存"的最小闭环无关 |
| L2 | `isFullUrl` 供应商的生图端点不可达 | 这类供应商的 baseUrl 是某个具体端点，完整 URL 模式下不追加协议路径 → 生图请求打到聊天端点并失败（错误信息来自上游） | 需要在供应商表单上为生图单独约束/提示 baseUrl 语义；本期未做 |
| L3 | checkpoint 前像实际未生效 | 前端唯一调用点传 `checkpoint: null` → rewind 无法撤销这次复制（复制本身无副作用，图仍在工作区） | 传 checkpoint 需要把 turn 的 checkpointTurnId 接到图片菜单，属接线改造 |
| L4 | 复用判定只比文件长度 | 文件名即内容哈希，长度相同才会命中；FNV-1a 64 真碰撞（≈2⁻⁶⁴）时可能复用错文件 | 改成逐字节比对会给每次落盘加一次读盘；概率与代价不成比例 |
| L5 | `isError` 的 `display_image` 结果不脱敏 | 今天不构成泄漏（错误结果只放文本），但防线是条件式的 | 需要在脱敏器上放开 `!isError` 限制；改动面涉及既有 Image 工具行为，留待单独评估 |
| L6 | 临时图被清理后，会话里的缩略图仍显示 | 缩略图走会话内联字节，不会碎图；失效只体现在模型后续 `read_image` 与"再次保存到工作区" | 这是"内联渲染"的固有结果；已用 UI 提示覆盖用户侧决策点 |

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

## 附录 C：并存安装（`LiveAgent N`）——部署形态变更（2026-10-13）

**需求**：把本工作区打出的包装成**另一个应用**（与机器上已装的 `LiveAgent 1.3.7` 并存），但**共用数据目录**。

**最终取值**（`crates/agent-gui/src-tauri/tauri.conf.json`）：

```json
"productName": "LiveAgent N",
"identifier": "com.noongyf.liveagent"
```

> 旧值（已装 1.3.7）是 `productName: LiveAgent` + `identifier: com.xiaofei.liveagent`。identifier 与旧值不同 = 不同应用身份 = 并存；productName 决定安装目录/开始菜单/卸载项与应用内显示名。
>
> ⚠️ **`com.noongyf.liveagent` 从命名上看像"正式的 LiveAgent"**：将来若要再出一个 productName 为 `LiveAgent` 的正式版，**不能复用这个 identifier**——同 identifier = 同 UpgradeCode = 会**替换**本 N 版而不是并存，且单实例锁相同导致两者不能同时运行。正式版需另起（如 `com.noongyf.liveagent.desktop`）。

**identifier 不需要在代码里跟着改**（已核实）：全仓生产代码没有硬编码 identifier，唯一读它的地方是 CUA「已安装应用」列表剔除自身——`services/gateway/envelope_handler.rs:1045` 的 `self.app_handle.config().identifier.clone()`，**运行时取自 tauri 配置**，改配置即自动跟随。`cua_driver/installed_apps.rs:709` 里那处 `com.xiaofei.liveagent` 是 Windows 单测值，而该参数在 Windows 上不参与逻辑（宿主按当前 exe 路径剔除，见该函数文档注释）。

### 机制（逐条实测/查证）

| 层面 | 由什么决定 | 改 productName + identifier 后 |
|---|---|---|
| 数据目录 | `~/.{CARGO_PKG_NAME}`（`history_db.rs:9-11`、`sandbox.rs:424`、`managed_process.rs:196`） | **不变 → 两应用天然共用** |
| MSI 升级链 | UpgradeCode（identifier 的函数） | 变成新链 → **并存安装**，不替换 1.3.7 |
| 单实例锁 | bundle identifier（`tauri-plugin-single-instance-2.4.3` 源码注释） | 各自独立锁 → **可同时运行** |
| 本地反代 | 随机端口（`bind(..., 0)`） | 无冲突 |
| 远程网关 | 连出去的 443（非本地监听） | 无冲突 |
| WebView2 数据目录 | identifier | 变新目录 → 应用内 localStorage 不共享（可接受） |

**铁律**：不要改 `crates/agent-gui/src-tauri/Cargo.toml` 的 `name = "liveagent"`——数据目录就是拿它拼的，改包名 = 数据目录变成 `~/.<新名>`，共用立刻失效。**只改 `tauri.conf.json` 即可**（平台覆盖配置 `tauri.{macos,windows,linux}*.conf.json` 都没有覆盖 productName/identifier，已核实）。

### 显示名单点真源

应用名不再硬编码：**真源 = `tauri.conf.json` 的 `productName`**，两条注入链都与现有 `LIVEAGENT_APP_VERSION` 同构：

- Rust：`build.rs` 读 `tauri.conf.json` → `cargo:rustc-env=LIVEAGENT_DISPLAY_NAME` → `tray.rs` 的 `APP_DISPLAY_NAME`（托盘 tooltip、状态行）+ `lib.rs` 的托盘图标 tooltip。
- 前端：`vite.config.ts` 读同一个文件 → `define __LIVEAGENT_APP_NAME__`（标题栏 `WindowsTitleBar`、更新公告 `ReleaseAnnouncementDialog`）+ `transformIndexHtml` 替换 `index.html` 的 `%APP_NAME%`（`<title>` 与启动屏 aria-label，首屏在 JS 之前就要正确）。
- 两者都支持 `LIVEAGENT_DISPLAY_NAME` 环境变量显式覆盖。
- 不变量由测试锁定：`services::tray` 的 `app_display_name_follows_the_configured_product_name`（实跑证明注入值 == 配置值）、`app_display_name_is_injected_and_non_empty`。
- 测试环境需注入这些构建期常量（`test/helpers/dom-test-env.mjs`），否则渲染到它们的组件会 `ReferenceError`。
- **i18n 的 `app.name` 保留原值不动**：标题栏改用注入值后它成为遗留键（仍被 `translations.test.mjs` 断言为 `"LiveAgent"`）。设置页描述性文案里的 "LiveAgent" 也未改——**它们指的是产品/生态（浏览器扩展名、`~/.liveagent` 路径），不属于应用显示名**。若要让设置页文案也跟随，属新增范围。

### 共用数据目录的风险（使用约定）

1. **同时改设置会丢更新**：设置按域整表替换（`DELETE FROM <域>; INSERT`，`settings/mod.rs:87-101`），两个应用同时改同一域时后写覆盖先写（不同域互不影响）。
2. **同时操作同一会话会互相覆盖**：历史库是 WAL（多进程安全），但两个进程各持运行时状态。
3. **旧应用会静默抹掉新应用的设置字段**：旧版归一化是字段白名单，不认识新版新增字段（`kind`、生图参数、通知四项、代理 mode、思考档位）。
4. **长期结构性风险**：历史库有 `HISTORY_DB_SCHEMA_VERSION` 且**拒绝打开更高版本**（`history_db.rs:75-77`）。当前两边都是 4，安全；但新应用一旦升 schema，旧应用就再也打不开历史库——共用数据 = 两应用绑在同一条 schema 时间线上，旧应用实质是只读保底。

**约定**：新应用当实验版、旧应用保底；不要两边同时改设置；不要在同一个会话里两边同时发消息；升 schema 前先决定旧应用是否还要用。

### 打包与安装注意

**版本号必须是纯数字（MSI 硬约束，实测踩过）**：`crates/agent-gui/package.json` 的 `version` 就是 MSI 版本（`tauri.conf.json` 的 `version: "../package.json"`）。原先的 `1.3.0-dev.0` 会让 **msi 打包直接失败**：

```
failed to bundle project: `optional pre-release identifier in app version must be numeric-only
and cannot be greater than 65535 for msi target`
```

WiX 要求 pre-release 段纯数字且 ≤ 65535，而 `dev.0` 含字母。**NSIS 不受影响**（它把版本当字符串），所以现象是"nsis 包出来了、msi 没有"——很容易误判成别的失败。已改为 `1.3.8`（`package.json` 与 `src-tauri/Cargo.toml` 同步）。

**实测结论（2026-10-13 实跑 `pnpm tauri build`）**：打包成功，产物

| 产物 | 值 |
|---|---|
| `D:\cargo-target\release\bundle\msi\LiveAgent N_1.3.8_x64_en-US.msi` | 28 MB |
| `D:\cargo-target\release\bundle\nsis\LiveAgent N_1.3.8_x64-setup.exe` | 21.8 MB（不要用） |

MSI 元数据实测：`ProductName = LiveAgent N`、`ProductVersion = 1.3.8`、`Manufacturer = noongyf`（由 identifier 第二段派生）、`UpgradeCode = {2C0C8FBA-A571-5466-868C-211CF25026F5}`。

**与已装 1.3.7 对比：UpgradeCode 不同**（1.3.7 是 `{D5650E3D-9962-4539-1A67-C8101FB21AA9}`）→ **确认是并存安装，不会替换 1.3.7**。此前这条只能靠"UpgradeCode 是 identifier 的函数"推断，现已实测坐实。

其余安装注意：

- **只用 MSI 包**（NSIS 默认装到 `%LOCALAPPDATA%` 并与 MSI 并存出两套卸载项）。
- MSI 默认路径是 `C:\Program Files\LiveAgent N`（C 盘）→ 安装时手动改到 D 盘。
- 装前退出正在运行的 1.3.7（它独占 `config.sqlite`，实测读文件头被拒）。
- 首次打包需联网下载 WiX/NSIS（本机已缓存于 `%LOCALAPPDATA%\tauri`，后续离线可打）。

---

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

### 磁盘与 cargo 目标目录（2026-10-13 增补）

C 盘一度 **0 字节可用**，`cargo test` 直接以 `rustc-LLVM ERROR: IO failure on output stream: no space on device` 失败。处置：

- `CARGO_TARGET_DIR=D:\cargo-target`（`setx` 持久化，机器级用户变量）——所有 cargo 产物（含 `tauri build` 的安装包输出目录）落在 D 盘。
- 工作区原 `target/`（10.5 GB，纯 debug）已清理，C 盘回到约 10 GB 可用。
- 影响：打包产物路径随之变为 `D:\cargo-target\release\bundle\...`（此前是 `<repo>\target\release\bundle\...`）。

### Rust 测试基线（2026-10-13 实测）

`cargo test -p liveagent --lib` = **1062 passed / 20 failed / 4 ignored**，20 个失败全部是本机环境造成、与本仓改动无关（不要当回归）：

| 组 | 数量 | 症状 |
|---|---|---|
| `runtime::shell_session::*` | 5 | 测试跑 POSIX 命令（`printf`/`sleep`），本机无 Git Bash → 状态 `Failed` |
| `runtime::sandbox::tests::resolve_program_*` / `resolve_bwrap_*` | 4 | 断言 POSIX 路径（`/bin/sh`、`/opt/nix/bin/bwrap`） |
| `commands::workspace_commands::git::tests::git_*worktree*` | 10 | `git worktree add` 的 verbatim 路径 `//?/C:/Users/.../Temp/...` 被本机 git 拒绝 |
| `runtime::terminal::tests::canonicalize_workdir_within_*` | 1 | 断言 `/etc` 为绝对路径 |

因此 Rust 侧门禁仍是 `cargo check --tests`（不新增警告，基线 3 条）＋按模块跑目标测试；全量 `cargo test --lib` 只作参考。

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

### `CARGO_TARGET_DIR` 已持久化（2026-10-13 更新，取代早前"有意不持久化"的结论）

C 盘一度 **0 字节可用**（`cargo test` 直接以 `rustc-LLVM ERROR: IO failure on output stream: no space on device` 失败），因此改为持久化到 D 盘：

```
setx CARGO_TARGET_DIR "D:\cargo-target"    # 机器级用户变量，新开的 shell 生效
```

- 代价是"影响机器上所有 Rust 项目"，但在 C 盘 0 字节的现实面前，显式不持久化已不可行。
- 若在**当前会话**里需要显式指定，仍可用 `$env:CARGO_TARGET_DIR="D:\cargo-target"` 覆盖。

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

---

## 附录 D：v1.1 优化落点（2026-10-14）

### D-1 平台覆盖配置的 RFC 7396「数组整体替换」陷阱（启动白屏根因）

`tauri.windows.conf.json` / `tauri.windows.release.conf.json` 各自带一份 `app.windows`
数组。Tauri 按 RFC 7396 合并配置，**数组是整体替换、不与基础配置逐元素合并**，所以基础
`tauri.conf.json` 里的 `"visible": false` 在 Windows 上被静默丢掉：主窗口创建瞬间即
可见，先以未渲染的白色 WebView2 出现在系统默认位置，随后 `setup()` 的
`restore_state` / `clamp_window_to_visible_monitor` 在**已经可见**的窗口上执行，形成
「白屏 + 跳到记忆位置」。macOS 覆盖配置自带 `visible:false`，所以只有 Windows 复现。

**凡是平台覆盖配置里出现的 `app.windows[0]`，都必须自带 `visible:false`。**
`crates/agent-gui/test/chat/workbench-window-session.test.mjs` 已把该断言扩展到两个
Windows 配置。

配套兜底：`spawn_frontend_ready_watchdog`（`src-tauri/src/lib.rs`）。窗口显形的唯一
正常通道是前端骨架调用 `app_frontend_ready`；前端异常时窗口会永久隐藏，用户会以为
应用没启动。15s 超时后无条件 `show()`。

### D-2 显示名单点真源（全链路）

真源只有一处：`crates/agent-gui/src-tauri/tauri.conf.json` 的 `productName`。

| 消费方 | 取值方式 |
|---|---|
| Rust（托盘 tooltip / 状态行 / 窗口标题 / 通知 / 错误文案） | `build.rs` 注入 `LIVEAGENT_DISPLAY_NAME` → `src-tauri/src/app_identity.rs::APP_DISPLAY_NAME`（`services/tray.rs` 转发导出，兼容既有调用点） |
| 必须保持 `const` 的 Rust 字符串 | `concat!(..., env!("LIVEAGENT_DISPLAY_NAME"), ...)` |
| 桌面前端（托盘 tooltip、关于页、CUA 自指拒绝文案等） | `vite.config.ts` 注入 `__LIVEAGENT_APP_NAME__` → `src/lib/appIdentity.ts::APP_DISPLAY_NAME`（`typeof` 守卫：纯模块加载下该标识符不存在，直接引用会 ReferenceError） |
| GUI i18n 覆盖表 | `src/i18n/config.ts`：自有条目用模板字面量；共享文案（agent-ui）里带产品名的条目用 `withAppName()` 替换通用名——共享文案由桌面端与 WebUI 共用，**不能**直接改 agent-ui 的字面量 |
| 任务管理器进程 / exe 名 | `tauri.conf.json` 顶层 `"mainBinaryName": "LiveAgent N"`（与 Cargo 包名解耦，不影响 `~/.liveagent` 数据目录） |
| 任务栏 / Alt-Tab 名称 | `setup()` 里 `apply_main_window_title` 用 `APP_DISPLAY_NAME` 调 `set_title`；平台配置里的 `title` 留空，避免第二处硬编码 |

**CI 耦合**：`.github/workflows/desktop-release.yml` 的便携包步骤原先把
`liveagent.exe` / `dist/portable/LiveAgent` 写死，改 `mainBinaryName` 后 `find` 会落空、
`test -n "$portable_exe_path"` 直接让整条 Windows 发版失败。现已改为从
`tauri.conf.json` 的 `productName` 推导。

**不要改**：Cargo 包名 `liveagent`（数据目录 `~/.{CARGO_PKG_NAME}`）、`~/.liveagent`
路径文案、localStorage 键、`data-liveagent-*`、`liveagent-file:` 协议、`@liveagent/*`
包路径、CSS 类名、浏览器扩展名、`LIVEAGENT_UPDATE_REPOSITORY` 与 updater User-Agent。
WebUI（`crates/agent-gateway/web`）的 `LiveAgent Gateway` 是另一个产品面，未改。


