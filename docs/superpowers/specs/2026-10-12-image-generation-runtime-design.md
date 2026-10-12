# 生图运行时设计

日期：2026-10-12
状态：待复核

配套文件：`2026-10-12-settings-composer-model-config-design.md`（本文件依赖其 `kind` 字段与供应商分类 UI）

## 背景与目标

来源：需求清单中「供应商配置」一项的追加扩张——原定"生图只做分组与配置存储"，后决定**本期同时实现生图运行时**。

目标：让 LiveAgent 能用配置的供应商真正生成图片，并让生成结果进入会话可看、可复用、可留存。

这是**新子系统**，不是既有功能的延伸：仓库此前没有任何生图调用代码（见下「现状核实」）。

## 已确认的需求决策

| 决策 | 结论 |
|---|---|
| 触发方式 | **仅作为工具暴露给模型**（模型面向单一路径）。原「输入框独立按钮 + 弹窗」方案**经复核后作废** |
| 协议分派 | 按对话协议分派，但**子集收窄**（见下） |
| 生图协议子集 | **`codex` / `gemini`**。`claude_code` 与 `deepseek` 无生图 API（官方文档已证实）、`xai` 本期不做——三者均从选项里移除 |
| 图片存放 | 应用级临时根目录 |
| 清理策略 | 应用级临时根 + 启动时清理超期条目 + **「保存到工作区」手动转存**（入口在会话图片展示处） |
| 本期功能边界 | 文生图（单张）→ 多张（n>1）→ 图生图/编辑（带参考图） |
| 工具结果回传 | **只给文件路径**，模型需要时自行调用已有的 `read_image`；不把图片内容内联给模型 |
| 生图参数 | **模型配置里给默认值**（尺寸/质量/张数），调用时可临时覆盖 |
| 工具默认审批 | **`ask`**（生图有真实费用与外部副作用），可由 `toolPolicies` 覆盖为 `allow` |

## 现状核实

### 可复用（已存在）

| 能力 | 位置 |
|---|---|
| 图片**展示**契约 | `crates/agent-ui/src/contracts/builtinTools.ts:109-134` 的 `DisplayImageItemDetails` / `DisplayImageResultDetails`，每项支持 `sourceType: "path" \| "url" \| "base64" \| "auto"` 与 `renderMode: "inline" \| "proxy"` |
| 图片**渲染**组件 | `crates/agent-ui/src/components/chat/assistant-bubble/ToolImages.tsx`（含 `getBuiltinResultKind(result) !== "display_image"` 判定） |
| 上游图片读取与反代 | `read_image` 工具契约、`crates/agent-gui/src-tauri/src/services/proxy.rs`（图片 Accept 头） |
| 工具结果**上下文脱敏** | `crates/agent-gui/src/lib/chat/context/requestContextSanitizer.ts:57`（已对 `display_image` 做处理） |
| 工具注册点 | `crates/agent-gui/src/lib/tools/builtinRegistry.ts` + `builtinTypes.ts` |
| 工具审批策略 | `crates/agent-gui/src/lib/tools/toolPolicy.ts`、`toolApproval.ts`；`SystemSettings.toolPolicies?`（按工具名覆盖） |

### 需从零建（已确认不存在）

| 缺口 | 证据 |
|---|---|
| 生图 API 调用 | `images/generations`、`generateImage`、`generate_image`、`images/edits` 全库**零匹配** |
| 生图工具 | `builtinTools.ts` 只有 `read_image`（`ReadImageResultDetails`）与 `display_image`，无生图 |
| **应用级临时根目录** | Rust 侧只有零散的 `std::env::temp_dir().join(...)`（`commands/workspace/fs.rs:1245/4759` 等），**没有带生命周期管理的根目录**，也无清理调度。P=丙 的选择要求新建这一块 |
| Rust 侧 multipart | 全库 multipart 只出现在 **Go gateway**（`internal/handler/upload.go`、`import_directory.go`）。`images/edits` 的 multipart 链路是否会被本地反代破坏，**须实现时实测** |

### 协议查证结论（本 spec 的关键前提）

以官方文档为依据，五个对话协议中生图能力：

| 协议 | 生图 | 说明 |
|---|---|---|
| `codex`（OpenAI） | ✅ | `POST /v1/images/generations`；编辑走 `POST /v1/images/edits`（multipart） |
| `gemini`（Google） | ✅ | `generateContent` 的 `responseModalities: ["IMAGE"]`，请求/响应形状与 OpenAI 完全不同 |
| `xai` | ❌ 本期不做 | 原计划"实现时核实端点与型号"，**已决定本期不纳入**，直接从选项里移除 |
| `claude_code`（Anthropic） | ❌ | 官方 vision 文档 FAQ 原文：**"Can Claude generate or edit images? No, Claude is an image understanding model only. It can interpret and analyze images, but it cannot generate, produce, edit, manipulate, or create images."** |
| `deepseek` | ❌ | 官方 API 文档只列 `/chat/completions`、`/models` 与 Responses API；vision 指南只讲**图片输入**。模型 `deepseek-v4-flash` / `deepseek-v4-pro` / `deepseek-v4-flash-vision-exp` 均只吃图不出图 |

**处置（决策 M=丙）**：`claude_code` 与 `deepseek` **不显示**在生图供应商的协议选项中。不写空实现、不留注定 `400` 的选项。

## 架构

### 供应商与模型配置

- 沿用主 spec 的 `CustomProvider.kind: "chat" | "image"`；生图供应商 `kind = "image"`，`type ∈ {codex, gemini}`。
- **生图模型不适用对话模型的配置字段**：输入能力（`inputModalities`）、思考档位（`thinkingLevels` / `defaultThinkingLevel`）对生图模型无意义。生图分栏的模型配置面板显示的是**另一套字段**（生成参数默认值），不复用 `ProviderModalView` 的模型设置 `<aside>` 原样。
- 模型配置新增生图默认参数（决策 O=甲）：
  - `imageSize`（尺寸）
  - `imageQuality`（质量）
  - `imageCount`（张数，默认 1）
  - 具体枚举值依赖各协议能力，**须按协议给出各自的可选项**，不做跨协议统一枚举。
- 生图供应商的模型列表仍用 `activeModels`，但**必须排除出对话模型选择器**（主 spec ③-1 的 `buildModelOptions` 过滤为必改项）。

### 调用链路：两协议分派

新增共享模块（建议 `crates/agent-gui/src/lib/images/`）：

```
images/
├── generateImage.ts        # 入口：按 provider.type 分派
├── adapters/
│   ├── openaiImages.ts     # codex：POST /v1/images/generations（+ /v1/images/edits）
│   └── geminiImages.ts     # gemini：generateContent + responseModalities:["IMAGE"]
├── imageArtifacts.ts       # 落盘：应用级临时根、命名、引用
└── imageParams.ts          # 参数解析：调用参数 ?? 模型配置默认值
```

分派点：`switch (provider.type)`，两个值各一条真实实现。`codex` 走 OpenAI Images API；`gemini` 走 `generateContent` 的 IMAGE 模态。

### 触发路径：工具（唯一）

- 在 `builtinRegistry.ts` 注册新工具（如 `GenerateImage`），走既有工具审批策略与 transcript 渲染。
- **输出契约**：优先**复用 `display_image`**（`DisplayImageResultDetails`），而不是新增一套结果类型——这样 `ToolImages.tsx`、`requestContextSanitizer.ts`、`ToolCallItem.tsx` 的既有分支零改动即生效，落盘后的图片以 `sourceType: "path"` 引用。
- **审批默认策略（决策 S=甲）**：默认 `ask`（生图有真实费用与外部副作用，与"每次带副作用的工具调用都请求批准"一致）。沿用现有工具策略体系，可用 `SystemSettings.toolPolicies` 覆盖为 `allow`。
- **工具结果只给路径（决策 R=甲）**：结果不把图片内容内联给模型，只给文件路径；模型需要查看时自行调用已有的 `read_image`。与批③"附件不内联就退回 Read"同一思路，避免每次生图都为模型多付一张图的 token。
- 必须遵守 `MAX_DISPLAY_IMAGE_PATHS = 12`（`fsTools.ts:46`）：一次生图张数上限受此约束，`imageCount` 的允许范围须 ≤ 该值。

### 用户侧唯一交互：在展示处转存（决策 Q=甲）

生图**没有用户发起的入口**——用户只能通过自然语言请求模型，由模型调用工具（原「输入框独立按钮 + 弹窗」方案作废）。因此用户侧唯一的直接交互是：

- 在会话中已渲染的生成图上（`ToolImages.tsx` 渲染处）提供「保存到工作区」动作，把临时图复制到工作区。
- 转存后会话记录里的引用**必须从临时路径切到工作区路径**，否则历史记录仍指向会被清理的文件。
- 该动作按**结果契约**（`display_image`）分派，而非按工具名特判，因此对任意来源的 `display_image` 结果都可用。

**副作用（须在 UI 与文档上明确）**：用户无法绕过模型直接生图。若将来需要用户入口，属新增范围，须另开决策。

### 落盘：应用级临时根 + 手动转存（决策 P=丙）

- 新建应用级临时根（如 `<系统临时目录>/liveagent-images/`），由 Rust 侧统一创建与命名，文件名含内容 hash 以便去重（参照 `fs.rs:4759` 的 `liveagent-{name}-{suffix}` 既有做法）。
- **启动时清理超期条目**：阈值为 **30 天**。清理逻辑须为纯函数 + 单测。
- **「保存到工作区」手动转存（决策 Q=甲）**：入口在会话图片展示处（见上），把临时图复制到工作区（目录由用户选，或用既有工作区写入链路），并把会话记录里的引用从临时路径切到工作区路径。
- **风险须写进 UI 提示**：未转存的图在清理后失效，这是 P=丙 相对"写入工作区"的固有代价。

## 分阶段

按可验收边界分三段，串行推进：

| 阶段 | 内容 | 验收 |
|---|---|---|
| ⑤-1 | 文生图单张：供应商配置（`kind`+协议子集+生图参数默认值）、工具路径、应用级临时根、展示链路 | 配置一个 OpenAI 兼容供应商后，模型能通过工具生成 1 张图并在会话内看到 |
| ⑤-2 | 多张（`n>1`）：参数、网格布局、`MAX_DISPLAY_IMAGE_PATHS` 上限处理 | 一次生成多张并正确展示；超出上限时给出明确错误 |
| ⑤-3 | 图生图/编辑（参考图选取/上传、multipart 或 Gemini 的图像+文本形态）、展示处的「保存到工作区」动作 | 能带参考图编辑；可把结果转存到工作区并使其不再受临时目录清理影响 |

理由：⑤-3 的参考图上传与 multipart 链路是整个子系统里最不确定的一段（Rust 反代对 multipart 的影响未实测），把它放在最后可以避免它拖住"能出图"这个最小闭环。

## 风险与未决

| # | 风险 | 处置 |
|---|---|---|
| R9 | ~~与批②冲突：生图按钮要占 `composer-control-deck` 同一排，与"24px 是 WCAG 下限"相冲~~ | **已消解**：生图改为仅工具路径，不再侵占工具栏，批②的减 8px 可照原方案执行 |
| R10 | ~~`xai` 的生图端点与型号未核实~~ | **已消解**：本期不纳入 `xai`，生图协议子集收敛为 `codex` + `gemini` |
| R11 | Rust 本地反代可能破坏 `images/edits` 的 multipart body | ⑤-3 开始前先做一次最小实测；不通则改走 Gemini 的"图像+文本 → 图像"形态，或调整反代 |
| R12 | 临时目录被 OS 清理导致历史会话碎图 | 已用"应用级临时根 + 手动转存"缓解；UI 须明确提示未转存会失效 |
| R13 | 生图工具默认 `ask` 增加审批打断频次（现为唯一路径，模型中途生图每次都会弹） | 已确认接受（决策 S=甲）；可由 `toolPolicies` 覆盖为 `allow` |
| R14 | 生图模型与对话模型的配置字段不复用，`ProviderModalView` 会长出第二套模型设置面板 | 实现时明确分支条件（按 `kind`），避免两套字段互相污染 |
| R15 | 用户无法绕过模型直接生图（有意为之） | 已确认为本期取舍，须在 UI 与文档上明确；若后续需要用户入口，属新增范围 |
| R16 | 转存动作按 `display_image` 契约分派，会覆盖到非生图来源的图片 | 这是有意设计（任何会话内图片都可另存）；须确保工作区写入走既有安全链路，不绕过路径校验 |

## 验收标准

1. 生图供应商的协议选项里**没有** `claude_code`、`deepseek` 与 `xai`。
2. 生图供应商不出现在对话模型选择器中；对话供应商不出现在生图选择器中。
3. 生图模型的配置面板只显示生图参数（尺寸/质量/张数），不显示输入能力与思考档位。
4. 模型可通过工具生成图片，结果在会话内以图片形式渲染，并在后续请求中按既有规则脱敏；工具结果**只含文件路径、不含内联图片内容**。
5. 会话中已渲染的图片带「保存到工作区」动作；执行后引用切到工作区路径，该图不再受临时目录清理影响。
6. 一次生成多张时正确展示；请求张数超过上限时给出明确错误而非静默截断。
7. 生成图落在应用级临时根下；重启应用后超期条目被清理。
8. 带参考图的编辑在至少一条协议链路上可用（若 R11 受影响，须在验收时明确"哪条链路可用"）。
9. 未转存的临时图被清理后，会话中的表现是明确的失效提示，而不是碎图或崩溃。

## 后续步骤

与主 spec 一并复核（R9 已随"仅工具路径"的决定消解，无需再裁决）。复核通过后进入 writing-plans，将本 spec 作为批次 ⑤、按 ⑤-1/⑤-2/⑤-3 三段纳入实施计划。
