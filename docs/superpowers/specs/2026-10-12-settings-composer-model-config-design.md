# 设置、输入框与模型配置改造设计

日期：2026-10-12
状态：待复核

## 背景与目标

来源：需求清单 `v1.0.md`，共 14 项（优化项 7 条 + 新功能 7 条）。追加范围：需求方在讨论中扩大为**本期同时实现生图运行时**，该项体量与性质均不同于其余 14 项，另立 `2026-10-12-image-generation-runtime-design.md`。本文件覆盖原 14 项，并承载与其共享的供应商 `kind` 字段。

目标有两类，不要混为一谈：

1. **可用性优化**：窗口几何记忆、设置页布局、系统代理与通知、输入框视觉与模型选择可达性。
2. **能力扩展**：供应商按用途分类、模型配置的输入能力与思考档位可由用户声明，且思考档位从"仅目录决定"变为"用户可配"。

第 2 类的实质是**把两个原本由目录（models.dev 快照）单方面决定的真源，改为用户可覆盖**：输入模态门控与思考档位——这是本文件里具备架构风险的部分。生图运行时同样具备架构风险，但已在独立文件中处理。

## 已确认的需求决策

以下决策均经逐项确认，实施时不得偏离；如需变更须回到本文件修订。

### 范围与路径

| 决策 | 结论 |
|---|---|
| 供应商「对话/生图」两类 | **分组 + 配置存储 + 本期同时实现生图运行时**。运行时另见 `2026-10-12-image-generation-runtime-design.md`（此项已于追加讨论中扩大范围） |
| 思考档位真源 | **用户勾选即真源**，落地产层级采用**覆盖式**（有勾选用勾选，无勾选回落目录；请求期钳制保留） |
| 输入能力 PDF | **本期一并打通运行时** |
| 供应商分类数据模型 | 新增独立 `kind` 字段，**`type` 保持不动** |
| 生图供应商表单 | **仍选协议**（`type` 保持必填）。但生图协议子集收窄为 **`codex` / `gemini`**——`claude_code` 与 `deepseek` **无生图 API**（经官方文档查证），`xai` 本期不做；三者均从生图协议选项中**移除** |
| claude_code 输入能力 | **开放**，含 PDF（需让 Anthropic 附件路径开始读声明） |
| 落地批次 | 按子系统分 4 批（生图运行时为第 5 批，见独立文件） |

### 批①细节

| 决策 | 结论 |
|---|---|
| 窗口几何钳制阈值 | 与任一显示器工作区重叠 **≥ 80×80px** 即保留还原坐标，否则主显示器居中 |
| 通知设置模型 | 四项：`sessionComplete` / `sessionError` / `permissionRequest` / `notifyWhenFocused`，**默认全开** |
| `notifyWhenFocused=false` 语义 | 窗口有焦点时**一条都不发**（权限请求也不再例外） |
| 系统代理 PAC | 检测到自动配置脚本 → 提示 + 直连；**同时尊重 OS 的 `no_proxy` 例外列表**。**不解析 PAC 脚本本身**（`FindProxyForURL` 求值需嵌入 JS 引擎，属独立子项） |

### 批②细节

| 决策 | 结论 |
|---|---|
| 输入框圆角 | 两处一起降到 `rounded-2xl`（18px） |
| 底部工具条 | **减 8px（含子控件）**：40px → 32px |
| 当前模型置顶 | **列表内置顶一行**（含搜索豁免与键盘导航处理） |

### 批③细节

| 决策 | 结论 |
|---|---|
| 快捷填入数值口径 | **按文档字面**：`384K=384000` 走十进制，其余 `K=1024` |
| 思考档位 `off` | **参与勾选**（是一个普通可勾选项） |

### 批④细节

| 决策 | 结论 |
|---|---|
| 勾选超出目录支持的偏差 | **全可勾 + 标注提示**"目录未声明支持"，不阻断 |
| `defaultThinkingLevel` 优先级 | `reasoningByModel` → **`defaultThinkingLevel`** → `reasoningByProvider` → `reasoning`（**行为变更**，见风险 R3） |

## 范围与批次映射

| 批 | 子系统 | 项 |
|---|---|---|
| ① | 窗口 + 设置壳 + 系统设置 | 记住窗口大小位置／返回对话与已保存对调／应用代理支持系统代理／系统通知 |
| ② | 输入框视觉 | 圆角降低／工具条高度减少／当前模型置顶 |
| ③ | 供应商 + 模型配置表单 | 供应商两类／上下文快捷填入／最大输出快捷填入／输入能力多选（含 PDF）／思考等级选择项／默认思考等级项 |
| ④ | 思考档位端到端联动 | 会话输入框按设置项给档位、默认选中默认档、未设置时隐藏 |
| ⑤ | 生图运行时 | 独立 spec：`2026-10-12-image-generation-runtime-design.md`（**仅工具路径**、两协议分派 `codex`/`gemini`、应用级临时根、文生图/多张/编辑） |

依赖关系：③的思考档位字段是④的输入；④必须等③的 `ProviderModelConfig` 字段落地。⑤依赖③的 `kind` 字段与供应商分类 UI，但与④无依赖。①②与③④⑤无依赖，可并行。⑤原先与②存在工具栏尺寸冲突，已因生图改为**仅工具路径**而消解。

---

## 批① 窗口 + 设置壳 + 系统设置

### ①-1 窗口大小与位置记忆

设计锚点：`crates/agent-gui/src-tauri/src/lib.rs:21` 的
`WINDOW_STATE_FLAGS = SIZE | MAXIMIZED`（注释说明 POSITION 被有意排除）。

改动两段：

1. 把 `POSITION` 并入 `WINDOW_STATE_FLAGS`，交 `tauri-plugin-window-state` 持久化与还原。
2. **配套"可见性钳制"**：窗口创建后读取还原矩形，与 `available_monitors()` 的每个工作区求交；无任一交集达到 80×80px 则丢弃还原坐标、改为主显示器居中。

只做第 1 步就是原注释警告的回归：外接屏用户拔屏后重启，窗口落在已不存在的坐标上，表现为"启动但看不到窗口"。第 2 步是把它变成安全改动的前提。

- 影响文件：`lib.rs`（flags + setup 钩子）、新增 `window_geometry.rs`（纯函数钳制逻辑，便于单测）。
- `tauri.conf.json` 的 1400×800 语义变为"首启默认值"，不修改文件。
- 测试：钳制函数单测覆盖 —— 坐标在某显示器内／跨屏边界／坐标落在已拔掉的屏幕上（必须回退居中）／显示器列表为空。

### ①-2 设置页 [返回对话] 与 [已保存] 对调

设计锚点：`crates/agent-ui/src/pages/settings/SettingsShell.tsx`

**注意：不是整块对调**——左栏顶部块内还含搜索框，因此只互换"返回对话按钮"与"已保存指示器"两个元素，搜索框留在顶部。

| | 现状 | 改后 |
|---|---|---|
| 左栏顶部块（`:165-186`，`px-3 pb-2 pt-4`） | 返回对话按钮 + 搜索框（`mt-2.5`） | **已保存指示器** + 搜索框 |
| 左栏底部块（`:269-279`，`px-3 py-3`） | 已保存指示器 | **返回对话按钮**（保留 `w-full` 与 Esc `kbd`） |

- padding 按各自位置调整（顶部 `pt-4`、底部 `pb-3`），互换后须改回，否则顶／底留白不对。
- 搜索框的 `mt-2.5` 原相对返回对话按钮，互换后改为相对已保存指示器，间距需一并核。
- **两处均为桌面端专属**：顶部块带 `web:max-820:hidden`，已保存块为 `{!web && ...}`；Web 端窄屏分支（`:143-164`）与标题行右侧已保存（`:294-305`）**不动**。
- 测试：`crates/agent-gui/test/settings/settings-escape-to-close.test.mjs:147` 用 `.settings-back-button` 定位，类名保留；若其中断言"该按钮为首个可聚焦元素"或位置，须同步改。

### ①-3 应用代理支持「使用系统代理」

设计锚点：前端 `crates/agent-ui/src/lib/settings/types.ts:290` 的 `SystemProxyConfig`；Rust 侧镜像 `crates/agent-gui/src-tauri/src/services/system_proxy.rs:27`（shell env 注入与所有 reqwest 出网点的单一真源）。

**现成先例**：`system_proxy.rs` 顶部注释已记载 GitHub 更新链路走 `client_builder_with_os_proxy_fallback()`，即回退 reqwest 默认的 OS 代理探测。因此"跟随系统"在 reqwest 侧近乎零成本：不注入显式 proxy、也不调 `.no_proxy()` 收口。

- 数据模型：新增 `mode: "manual" | "system"`，与 `enabled` 并存（`enabled=false` 仍表示完全不代理）。旧存档缺 `mode` 归一化为 `"manual"` → 零迁移。
- Rust：`ProxyMode` 由 `Disabled | Enabled | Invalid` 扩为 `Disabled | System | Enabled | Invalid`；`System` 分支不产出 `proxy_url`。
- **真正的增量在 shell env 注入**：系统模式需按平台读 OS 代理（Windows 注册表 `Internet Settings`／macOS `SCDynamicStoreCopyProxies`／Linux `http_proxy` 系列 + gsettings），并对例外列表取「OS 列表 ∪ `NO_PROXY_DEFAULT`」。
- PAC：检测到自动配置脚本时提示并按直连处理，同时尊重 `no_proxy`。**不解析 PAC 脚本**。
- 连带必改（新增 `SystemSettings` 字段的固定成本）：`gateway_sync.rs:208` 的 systemProxy 密码脱敏、`backup_snapshot.rs:26` 白名单（systemProxy 继续排除）、`settings/tests.rs:1182` 的 `default_system_proxy_json()` 全量断言。

### ①-4 系统通知（会话完成／出错／权限请求）

设计锚点：`tauri_plugin_notification` 已在 `lib.rs:882` 注册，但前端**无任何会话类发送调用**；现有通知只有日历提醒走后端（`services/planning/mod.rs`，因后端无 UI locale）。

- 数据模型：`NotificationSettings = { sessionComplete, sessionError, permissionRequest, notifyWhenFocused }`，放入 `SystemSettings`（与 `systemProxy` 同级），默认全 `true`。
- **备份白名单**：通知偏好是机器无关偏好，须加入 `backup_snapshot.rs:29-34` 的 `SYSTEM_PORTABLE_BACKUP_KEYS`，否则换设备不跟随。`systemProxy` 保持排除。
- WebUI 无系统通知能力，该节在 Web 端隐藏。

三个触发点（均为已核实的现成信号）：

| 通知 | 挂点 | 信号 |
|---|---|---|
| 会话出错 | `crates/agent-gui/src/pages/chat/hooks/useNotifyToasts.ts` | `errorMessage` 非空（该 hook 已是 transition 驱动，在现有 `toast.error` 分支旁加一路） |
| 会话完成 | 同族的运行态转换 | "运行中 → 空闲"下降沿；**具体信号源须在实现时定位 `ChatPage` 的运行态来源，不得臆断** |
| 权限请求 | `crates/agent-ui/src/components/chat/ToolApprovalBar.tsx` | `pendingToolApprovals` 由空变非空；带 `deadlineAt`，超时未处理应补一条 |

- 过滤顺序：单项开关 → `notifyWhenFocused`（为 `false` 且窗口有焦点时全部拦截，含权限请求）。
- 点击通知：`show() + setFocus()`。
- 权限申请：首次发送前 `isPermissionGranted()` / `requestPermission()`；被拒后在设置项旁显示原因，不反复弹。
- 影响文件：`lib/settings/types.ts`、normalize、`SystemSettingsForm.tsx`、新增 `crates/agent-gui/src/lib/system/notifications.ts`、两处触发点、zh/en i18n，以及 Rust 侧全量断言同步。

---

## 批② 会话输入框

### ②-1 输入框圆角降低

两处 `rounded-4xl`（= `--radius` 10px + 16px = **26px**），必须**一起**改（内层圆角大于外层会露出角）：

| 位置 | 元素 |
|---|---|
| `crates/agent-ui/src/pages/chat/ChatComposerBar.tsx:1360` | 外层 `composer-glass-card` |
| `crates/agent-ui/src/pages/chat/ChatComposerBar.tsx:1420` | 内层 `composer-input-surface` |

统一改为 `rounded-2xl`（18px）。

连带影响（**覆盖层的圆角必须重算**——它们的值是按"卡片圆角 − inset"算出来的，不是随手取的）：

1. **三个拖放覆盖层**（原为 `rounded-3xl` = 22px = 卡片 26px − `inset-1` 的 4px）：`ChatComposerBar.tsx` 的 `inset-0` 工作区路径拖放层（`:1370`）改为 `rounded-2xl`（18px）；两个 `inset-1` 覆盖层（`:1384` 会话拖放引用、`:1404` 会话通知）改为 `rounded-xl`（14px = 18 − 4）。
2. **第四个覆盖层（设计阶段漏列，实现审查时发现）**：`crates/agent-ui/src/components/chat/FileDropOverlay.tsx:20` 在 `variant === "composer"` 下是 `absolute inset-0` + `rounded-3xl`，由 `ChatComposerBar.tsx` 渲染在卡片内部。卡片降到 18px 后，22px 会在角上留下约 1.5px 露出卡片底色的月牙区，改为 `rounded-2xl`。
3. **源码断言锁死**：`crates/agent-gui/test/chat/context-usage.test.mjs:122-134` 用正则匹配 `composer-glass-card[^\n]+rounded-4xl` 与 `composer-input-surface[^\n]+rounded-4xl`，两条同步改。
4. **毛玻璃裙边几何安全**：`ConversationStatsBar.tsx:392` 的 `-top-8`(32px) 上探在 `-z-10`、位于卡片之下，圆角变小只会多盖、不会露缺口，无需联动改。
5. **修既有错误注释（两处，不在同一文件）**：`ConversationStatsBar.tsx:386-389` 与 `crates/agent-gui/test/chat/conversation-stats-bar.test.mjs:316-318` 都声称"上探 2rem = 卡片 `rounded-4xl` 的半径"，但 2rem=32px 而 `--radius-4xl`=26px，本就不相等。两处均改为"上探量有意大于卡片圆角半径，留富余"。
6. **不碰 `tokens.css` 的 `--radius` 链**，避免波及全局组件。
7. 工具条内的控件用 `rounded-full`（药丸），与本次无关。

### ②-2 底部工具条减 8px

`composer-control-deck`（`ChatComposerBar.tsx:1750`）现状为 `min-h-9` + `py-1` + 子控件 `h-8`。

**关键认知：实际高度是 40px 而非 36px**——`min-h-9` 被内容撑破（`py-1` 8px + 子控件 32px = 40px）。因此只调 `min-h-9` 毫无效果。

**采纳方案（相对本节初稿有修正）**：只动 deck 自身，**不缩任何子控件**。

| 改动点 | 现值 → 新值 |
|---|---|
| `ChatComposerBar.tsx:1750` 的 `min-h-9` | → `min-h-8`（32px，收口值） |
| `ChatComposerBar.tsx:1751` 的 `py-1` | → 删除（`py-1` 8 + 子控件 32 → 0 + 32 = 32px，恰等于 `min-h-8`） |

`lib/chat/composerControlStyles.ts` 的 `h-8` 与 `components/chat/ContextUsageRing.tsx` 的 `size-8` **保持不动**。

**为什么否掉了初稿的"缩子控件"方案**：初稿要求把共享常量的 `h-8`→`h-6`、用量环 `size-8`→`size-6`。但用量环内是 `text-tiny` 的百分比文字：

- `--text-tiny` = 0.625rem = 10px，且 `base.css:41` 用 `--zone-font-scale` 重声明它（字号随可访问性缩放变大，而 `size-*`/`h-*` 走 `--spacing`、不随之缩放）。
- 环的 `viewBox="0 0 24 24"` 配 `size-8`(32px) ⇒ 缩放 4/3，故 `strokeWidth="2.25"`（**viewBox 单位**）实际渲染为 3px。
- 环内**净内径** = `2×(9.5 − 2.25/2)` = 16.75 单位 ⇒ 32px 环约 **22.3px**、24px 环约 **16.75px**。
- `"100%"` 在 10px tabular-nums 下约 24–27px 宽 ⇒ 24px 环下文字必然压过描边；更糟的是 `Meter` 与环容器都**没有 `overflow-hidden`**，文字不会被裁，而会溢出到相邻控件（deck `gap-2` = 8px）。

**一处数值修正**：初稿曾按 `尺寸 − 2×2.25` 得出 27.5px / 19.5px，那是把 viewBox 单位当成了 px，**数值错误**；按上述正确算法为 22.3px / 16.75px。修正后结论方向不变（24px 方案更不可取）。另需如实记录：32px 环的 22.3px 净内径相对 24–27px 的文字是**偏紧**的，即当前尺寸下文字本就贴近环线——属既有状态，本次不动，真伪需真实渲染确认。

**代价（须知晓）**：去掉 `py-1` 后 deck 内控件与卡片下缘齐平，形成"横向 12px、纵向 0px"的不对称留白。deck 的 `bg-muted` 与卡片同色，去掉的是空白而非可见色带；deck 无 `absolute` 子节点、无 `overflow-hidden`，无功能副作用。

**比初稿脆的一点**：deck 现由"子控件恰 32px"填满，而 `min-h-8` 只是**下限**——任何 deck 子控件长高（>32px）都会把 deck 顶回 36px+；初稿（24px 子控件 + 8px padding）有 8px 余量。**因此需要断言锁住"deck 无纵向 padding"与"共享触发器仍为 h-8"**，否则下一个人照初稿回改会把环缩到 24px 并重新引入压线问题。

测试：`context-usage.test.mjs:132` 锁 `min-h-9` → 改为 `min-h-8`，并新增上述两条不变式断言。

### ②-3 当前选中模型置顶（列表内置顶一行）

设计锚点：`crates/agent-ui/src/components/chat/ComposerModelControls.tsx:496-600`（`ScrollArea` 内按供应商分组、组头 `sticky top-0 z-10`），当前无任何"当前选中"展示。

实现要点：

- **搜索／筛选豁免**：置顶行渲染在 `filteredGroups` 计算**之外**（`:502-629` 的 IIFE 中，作为兄弟节点排在 groups 之前）。必须重构 `:518-523` 的 `if (!filteredGroups.length) return <p>无结果</p>` 提前返回为"先渲染置顶行，再渲染 groups 或空态"。
- **层序**：置顶行 `sticky top-0 z-20 bg-popover`（须压住 `z-10` 的组头，且底色实心）。
- **键盘导航**：弹出层上下键按 `button[data-model-option], button[data-model-group]` 顺序走（`:272-286`）。置顶行加 `data-model-option=""`，成为第一站——下行键先落在"当前模型"、回车即确认关闭。优于排除在顺序外（否则 Tab 能到而方向键到不了）。
- **当前模型不在列表内时**（供应商被删／模型下架）：置顶行的存在性由 `selectedValue` 决定（它源自 `activeSelectedModel`，不依赖 `modelOptions` 成员），标签回落 `currentModelLabel`、图标回落 `Layers`。**此时该行仍显示但不可点选**——`onSelectModel` 若拿到已停用的模型会触发下游 `resolveEffectiveChatModelSelection` 的失效选择校验；同时**不带 `data-model-option`**，避免方向键停在一个按了没反应的死站。
- **高度补偿**：置顶行约占 32px `ScrollArea`（`h-70`=280px）可视区，是否上调一档以补偿由 PR 的 before/after 截图定，不预先写死。

---

## 批③ 供应商分类 + 模型配置表单

### ③-1 供应商列表改「对话模型 / 生图模型」

设计锚点：`crates/agent-ui/src/pages/settings/ProvidersSection.tsx:1095-1142`（5 个协议 `Tabs`，标签文案「X 兼容」）。

**数据模型**：`CustomProvider`（`lib/settings/types.ts:618`）新增 `kind: "chat" | "image"`，默认 `"chat"` → 零迁移。`type`、`ProviderModal` 的 `providerType` 必填逻辑**均不动**（按"生图仍选协议"的决策）。

**Rust 侧无需迁移**（已核实）：`commands/config/settings/providers.rs:40-56` 的 `redact_provider_credential` 只摘 `apiKey` 与 `usageQuery` 密钥，**未知字段原样透传**；备份的 `providers` 域是整域搬运。故新增 `kind` 不涉及 Rust 归一化、白名单或 schema 版本。

**必须先处理的集成点**：

1. **`crates/agent-ui/src/lib/models/modelOptions.ts:105-129` 的 `buildModelOptions` 遍历全部 `customProviders`，不做任何过滤** → 生图供应商会立刻漏进对话模型选择器，并污染按 `providerType` 的排序分组。必须加 `kind !== "image"` 过滤。此为共享层，agent-gui 与该 gateway web 两端同源，改一处两端生效。
2. **其余消费点须逐个列全后再动手**（不得凭记忆）：至少包含用量查询、模型失败转移（`model_failover`）、设置页按 `providerType` 的分组排序。此项列入实现计划的第一个任务。
3. 列表 UI 从协议 `Tabs` 改为两类分栏；「添加供应商」的服务选择弹窗（`:1144-1177`）需增加类别维度。生图分栏的完整形态（协议子集、生图参数、运行时与两种触发路径）见 `2026-10-12-image-generation-runtime-design.md`。

**落地形态（已实现）**：

- 分栏 = 两段纵向堆叠（`ProviderKindSection`：类别标题 + 计数 + 该类别列表），滚动容器在分栏外层，列表自身不再滚动；排序维度同步由协议改为类别（重排只在同类内部生效）。协议分组不再出现在列表页，改由「自定义设置」弹窗内的协议下拉承担失败转移等按协议配置。
- 创建流程：服务选择弹窗顶部先选类别（`SettingsToggleGroup`），再列该类别可用的协议——生图类别只列 `codex`/`gemini`（决策 M=丙，`IMAGE_PROVIDER_TABS`）；`ProviderModal` 用 `initialData?.kind ?? providerKind ?? "chat"` 定类别并写进保存 payload。
- **R14 边界**：`kind === "image"` 时模型设置窄栏隐藏对话专用字段（输入能力、思考档位与默认档、codex 缓存提示覆盖），只留一行说明；生图自己的生成参数（质量/尺寸/张数）在 ⑤-1 落地。上下文/最大输出两项暂留（生图模型条目的占位限额），⑤-1 复核。
- **候选列表补漏**：`FailoverSettingsCard` 的 `vendorProviders` 过滤加了 `kind === "chat"`（P1 清单里"失败转移候选列表"一条的 UI 侧）。

### ③-2 / ③-3 上下文与最大输出快捷填入

设计锚点：模型设置面板是弹窗右侧**窄栏** `<aside>`（`ProviderModalView.tsx:710-713`）；两个输入框为 `Input variant="plain" className="h-8"`（`:732-749` 上下文、`:755-772` 最大输出）。`limitsSource` 语义见 `providerUtils.ts:30-46`（改过值即标 `user`，永不被自动覆盖）。

- 预设 chip 置于输入框**上方**（下方紧接下一个 `FormField`，插在中间会打乱"标签→输入→说明"节奏）。
- 点击即走现有 `onChange` 写入 → 自动获得 `limitsSource: "user"` 与既有校验红框，**无需新增保存动作**。
- 窄栏内 5–6 个 chip 会换行，用 `flex flex-wrap gap-1`；样式在 PR 内对截图定。
- 数值**按文档字面**，不做单位换算：

| 字段 | 预设 |
|---|---|
| 上下文窗口 | 128K=131072、256K=262144、512K=524288、1M=1000000、1M=1048576 |
| 最大输出 token | 32K=32768、64K=65536、128K=131072、256K=262144、384K=384000、512K=524288 |

（同一行内十进制与二进制并存是文档原意，已在决策中确认。）

### ③-4 输入能力改多选（自动／文本／图片／PDF）

**核心：两层语义必须分清，不得混同**

| 层 | 数据 | 用途 |
|---|---|---|
| 目录模态集合 | `CatalogInputModality[]`，**已含 pdf/audio/video** | **展示**：模型行右侧图标（`ProviderModalView.tsx:103-108`） |
| 用户 `inputModalities` 声明 | 本次扩为含 PDF 的四种形态 | **发送门控** |

`modelCatalog.ts:159-162` 原注释明确："覆盖只表达 text/image 门控，与目录的完整模态集合语义不同"。

本次是**扩展覆盖的值域至含 PDF**，**不是**把覆盖升级为完整模态声明——否则目录的 audio/video 信息会被一次勾选抹掉。

- 值域：缺失（=自动）｜`["text"]`｜`["text","image"]`｜`["text","pdf"]`｜`["text","image","pdf"]`。既有两种值仍合法 → **零迁移**。
- UI：由 `DropdownMenu` 单选（`:777-819`）改为 4 个 `Checkbox`（`components/ui/checkbox.tsx` 已存在）：`自动`／`文本`／`图片`／`PDF`；`自动` 与其余互斥（勾自动=删除字段），`文本` 恒勾选且禁用（聊天协议始终发送文本，normalizer 也会补齐）。
- **PDF 门控接上**：`crates/agent-gui/src/lib/providers/nativeResponsesAttachments.ts` 的 `supportsNativePdfInline(model, baseUrl)` 由"仅看主机名"改为两层：
  `有声明 → 声明里有 pdf`；`无声明（自动）→ 现主机名规则`；`声明里没有 pdf（含只勾文本）→ false`。
  与之配套，`gemini` 分支原先"PDF 还需要图片能力"的附加条件删除（否则勾了 PDF 却没勾图片时 PDF 反而内联不了）。
- **声明的承载**（实现细节）：pi-ai 的 `Model.input` 类型只接受 `"text" | "image"`，`"pdf"` 进不去。因此 `createModelFromConfig` 在装配结果上另挂仓库自有字段 `inputModalitiesOverride`（`runtime/modelInputModalitiesDeclaration.ts`，零依赖叶子模块）：`text/image` 照旧投影到 `model.input`（codex/xai/gemini/deepseek 分支），附件层读该字段决定 PDF（以及 anthropic 分支的图片）是否原生内联。缺失 = 自动。
- **开放 `claude_code`**（决策 H=甲）：`providerSupportsModelInputModalitiesOverride` 纳入 `claude_code`，并**让 Anthropic 附件路径开始读该声明**：图片按声明 `includes("image")` 门控、PDF 按 `includes("pdf")` 门控，自动态维持现状（图片照旧内联）。这**有意破掉** `settings/types.ts` 与 `modelFactory.ts` 原"anthropic 不读 `model.input`，以避免虚假能力声明"的防线（两处注释已改写说明新语义）；**边界**：工具结果图片的剥离口径不在本项内（`piAiAdapter` 的 anthropic 分支既不读 `model.input` 也不读本声明，保持不变）。
- 注意与 ④-4 的边界：本项只动**输入模态**这条线；**思考档位**仍保持目录派生，见 ④-4。
- **PDF 附件侧不需新做**：`PendingUploadedFile.kind` 已含 `"pdf"`（`lib/chat/uploadTypes.ts:1-8`）；三套专有结构已写好（OpenAI `input_file` `:31`／Anthropic `document` `:54`／Gemini `inlineData` `:63`），不内联时退回 Read 抽文本。

### ③-5 模型配置新增思考档位与默认档

`ProviderModelConfig`（`lib/settings/types.ts:457-476`）新增：

- `thinkingLevels?: ReasoningLevel[]` —— 用户勾选的可选档，含 `"off"`（决策 J=甲：`off` 参与勾选）。
- `defaultThinkingLevel?: ReasoningLevel` —— 默认档，必须属于 `thinkingLevels`；`thinkingLevels` 未设置时该项隐藏。

- 新建／编辑模型时字段缺失则**初始勾选 `low`/`high`/`max`**（只作展示默认值，**用户不动就不落库**——否则打开一次旧模型就会把"按目录推断"永久替换成三档，静默收窄批④的可用档位）。
- 取消到空集合 = 清空自定义：两个字段一起删除，回到"按目录推断"；`normalizeThinkingLevels` 对空数组同样返回 `undefined`，存储层不存在"有字段但空集合"的中间态。
- **默认档下拉只在已自定义勾选后出现**（"`thinkingLevels` 未设置时该项隐藏"的落地形态）。
- **偏差标注**（决策 K=甲）：7 档全部可勾；某档为目录**明确未声明支持**时，在该勾选项旁给出提示（"目录未声明支持"小字），**不阻断**。规则：仅当能力来自目录命中或运行期补充（`fromCatalog || fromLive`）才给提示——未被声明的档，加上思考不可关闭（`alwaysOn`，含 xai 的 wire 限制）时的 `off`；"目录判不出"（自定义／未收录模型，走兜底推断）一律不给提示。
- 规范顺序单一真源：`settings/index.ts` 导出 `REASONING_LEVEL_CHOICES`（`off` + 既有 6 档），归一化、表单勾选行、默认档下拉三处同序。

---

## 批④ 思考档位端到端联动

### ④-1 档位列表来源改为「用户勾选 ?? 目录」

**关键接口约束**：`getChatRuntimeReasoningLevelsForProvider(params)`（`crates/agent-ui/src/lib/settings/index.ts:512`）现收 `{ providerId, requestFormat, modelId }`，其中 `providerId` 是**协议类型**，**不区分具体供应商实例**；而 `thinkingLevels` 挂在 `ProviderModelConfig` 上（按实例 + 模型）。

因此必须新增可选覆盖参数，并把**具体供应商实例**接入调用点：

| # | 调用点 | 是否已持有 provider 实例 |
|---|---|---|
| 1 | `crates/agent-gui/src/pages/ChatPage.tsx:3403` | 是（`paneProvider`） |
| 2 | `crates/agent-gui/src/pages/chat/runtime/useChatModelSelection.ts:175` | 是（`currentChatProvider`） |
| 3 | `crates/agent-gui/src/lib/providers/runtime/providerRuntimeConfig.ts:25` | 是，且 `:43` 已在用 `findProviderModelConfig` |
| 4 | `crates/agent-gateway/web/src/app/hooks/useGatewayChatConfiguration.ts:73` | Web 端，实现时核 |
| 5 | `crates/agent-gateway/web/src/app/workbench/GatewayConversationPaneHost.tsx:496` | Web 端，实现时核 |
| 6 | `crates/agent-ui/src/pages/settings/CronTaskModal.tsx:133` | **定时任务的模型档位，最易漏** |

抽共享 helper（如 `resolveConfiguredThinkingLevels(provider, modelId)`）避免 6 处重复查找。

**注意**：此函数为 agent-gui 与 agent-gateway/web 共用，接口变更两端同时生效——这是本设计被判为架构级而非 bounded 的具体原因。

### ④-2 `defaultThinkingLevel` 接入解析链

`resolveChatRuntimeReasoning`（`settings/index.ts:481`）由
`reasoningByModel → reasoningByProvider → reasoning`
改为
`reasoningByModel → defaultThinkingLevel → reasoningByProvider → reasoning`。

**这是行为变更**，见风险 R3。

### ④-3 会话输入框按设置项给档位

`ComposerModelControls` 的 `effortChoices`（`:206-211`）已由「`reasoningOptions` ± `off`」派生；`off` 目前由 `thinkingAlwaysOn` 决定。

按决策 J：**`off` 是否出现，改由"勾选里是否含 `off`"决定**，不再由目录 `alwaysOn` 决定。

后果：`isThinkingAlwaysOnForModel`（`settings/index.ts:195` → 目录 `alwaysOn`）在存在用户勾选时**不再影响 UI**，但**请求期仍由目录钳制**（xai 的 `off` 被 `map.off = null` 屏蔽）→ 产生静默偏差。按决策 K，该偏差通过批③的"偏差标注"提示暴露。

### ④-4 请求期保持目录钳制

按决策 A（覆盖式）：`modelFactory.ts:353` 处的 `resolveModelThinking` 调用与 `:371` 处的 `resolveModelThinkingFields(thinking, wireValues)`（函数定义在 `:48`）**保持**从目录能力派生 `thinkingLevelMap`，不改为由勾选派生。即请求期钳制对象仍是目录，勾选超出目录的部分会在发送时被静默钳掉——这是**有意接受**的取舍（换取最小改动与不会发出上游 400 的请求）。

---

## 跨批横切事项

1. **源码断言测试**：`context-usage.test.mjs`（圆角、`min-h-9`）、`conversation-stats-bar.test.mjs`（裙边）、`settings-escape-to-close.test.mjs`（返回按钮定位）、`normalization.test.mjs`（`normalizeCustomProvider` 与档位解析，含 gateway 侧 `web-settings.test.mjs` 镜像）均会因本次改动失败，须同步更新。
2. **i18n**：全部新增标签／提示需 zh-CN 与 en-US 双份（`agent-ui/src/i18n/translations/`）。
3. **Rust 侧全量断言**：`commands/config/settings/tests.rs` 的 `default_system_proxy_json()` 等全量比对会因新增字段失败，必须同步——这是给 `SystemSettings` 加字段的固定成本。
4. **WebUI 分支**：设置页几乎所有改动都需明确"桌面端／Web 端"归属；通知与窗口几何为桌面端专属。
5. **UI 边界检查**：仓库有 `scripts/check-ui-boundaries.mjs`；新增共享代码放置须过该检查。

## 风险与未决

| # | 风险 | 处置 |
|---|---|---|
| R1 | 窗口 POSITION 在多显示器拔插后落到屏外 | 已用 80×80px 重叠钳制覆盖；方案 ii 单测必须包含该用例 |
| R2 | 工具条 24px 交互目标贴 WCAG 2.5.8 下限，无继续压缩空间 | 写死为边界，后续不得再压 |
| R3 | `defaultThinkingLevel` 会覆盖用户此前按"供应商"选过的档（行为变更） | 已确认接受；实现时需在 CHANGELOG／PR 描述中显式标注 |
| R4 | 覆盖式导致"界面能选、发送被钳"的静默偏差 | 以批③"偏差标注"暴露；**不阻断**是经确认的取舍 |
| R5 | 开放 `claude_code` 输入能力破掉既有"避免虚假能力声明"防线 | 有意为之，两处注释须同步改写 |
| R6 | 生图供应商可能漏进对话模型选择器等消费点 | 消费点清单列为实现计划首个任务；`buildModelOptions` 过滤为必改项 |
| R7 | PAC 脚本不解析 | 明确的范围边界；若需真解析须另立子项（需嵌入 JS 引擎） |
| R8 | 会话完成通知的确切信号源未定 | 实现时定位 `ChatPage` 运行态来源，不得臆断 |

## 验收标准

1. 关闭并重启应用，窗口大小与位置还原；拔掉外接屏后重启，窗口出现在主显示器且完全可见。
2. 设置页桌面端左栏顶部为"已保存"、底部为"返回对话"，搜索框位置与间距不变；Web 端布局无变化。
3. 应用代理可选"使用系统代理"；开启后 shell 命令与模型请求均走 OS 代理；存在 PAC 时给出提示并直连；OS 例外列表生效。
4. 通知四项均有开关；`notifyWhenFocused` 关闭时窗口有焦点则一条不发；点击通知聚焦窗口；换设备导入备份后通知偏好跟随。
5. 输入框两处圆角为 18px；底部工具条高度 32px；选择模型弹出层首行为当前模型，搜索与筛选不会使其消失，方向键可达。
6. 供应商列表分「对话模型／生图模型」两栏；生图供应商不出现在对话模型选择器中。
7. 上下文与最大输出输入框上方各有预设 chip，点击后写入对应字面数值并使 `limitsSource` 变为 `user`。
8. 输入能力为四选多选框，`自动` 与其余互斥；勾选 PDF 并在第三方中转上发送 PDF 附件时走原生内联。
9. 模型配置可勾选思考档位（含 `off`），可设置默认档；目录未声明支持的档位有提示但不阻断。
10. 会话输入框的思考档位与设置项一致；未单独选过时选中默认档；未设置档位时该控件隐藏。

## 后续步骤

两份 spec（本文件与 `2026-10-12-image-generation-runtime-design.md`）经复核通过后，调用 writing-plans 技能产出实施计划（按 5 批组织，生图消费点排查作为首个任务）。两份 spec 需一并复核，因为生图批依赖本文件的 `kind` 字段与供应商分类 UI。
