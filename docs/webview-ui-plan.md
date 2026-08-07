# 网页预览 UI 改造 Plan（参考 dsh-ui-progress / review-panel）

> 状态：**已定稿**。参考仓库：[dsh-ui-progress](https://github.com/dsh-external/dsh-ui-progress)、[review-panel](https://github.com/dsh-external/review-panel)。
> 本文档是改造的设计基线；实施以 AGENTS.md 的仓库约定为准。
> 决策记录：~~右栏可拖双栏~~ → 已拍板：**tab 全宽面板，不做可伸缩分栏**（dsh 布局的 details 右栏为 single slot 且被占用，外部插件不可用；用户确认不需要自建可伸缩栏）。

## 1. 参考实现结论（已读源码）

| 参考 | 模式 | 可复用点 |
| --- | --- | --- |
| review-panel | 注册 `conversation.view` **tab**（`id:'review', label:'审阅', order:20`），激活时对话视图区显示面板；composer 输入框在 tab 切换时**常驻**（`ConversationRoot` 的 `composerSeat` 与 view 区并列） | ① tab 入口注册方式 ② 布局内显示（非浮层覆盖） |
| dsh-ui-progress | 纯 client 插件，注册进现有 slot（`conversation.input.dock` 等），零核心改动 | ③ 纯 slot 集成原则 |
| harness `ui-conversation` | `ctx.conversation.input.for(scopeCtx).setDraft(text)`（`SessionInput.setDraft` 是唯一 draft 写路径）；`conversation.input.dock` 是 list slot（GoalBar 也注册在这里） | ④ 写入 dsh 原生输入框 draft 的官方 API ⑤ 输入框上方叠加条的注册位 |
| harness `ui-goal` | GoalBar 注册 `conversation.input.dock`，叠加在输入框上方的常驻条 | ⑥ 「叠加」形态的现成范式 |
| harness `ui-conversation` apply | `store: chatStore` 传**共享实例**给多个 slot 注册 | ⑦ 预览 tab 与叠加条可共享同一份注释状态 |
| harness `core/agent` + agent-loop | **`agent/prompt-submit` waterfall**（事件目录 `agent/*`）：「Allow, rewrite, or block one claimed prompt before it becomes a user message or opens a turn」。返回 `{ kind:'allow', content }` 时 `freezeMessage({ ...message, content })` —— **重写后的消息保留原 identity/source，仍是一条用户消息**；`next()` 原样放行 | ⑧ **「发送时在前面加一段 user 内容」的官方机制**：node half 注册监听，把注释 XML 拼到用户消息 content 前 |

约束：dsh 布局的 `details` 右栏是 `kind:'single'` slot 且已被 ui-conversation 的 DetailsPanel 独占，零修改原则下外部插件无法占用；因此预览面板以 **view tab 全宽**形态落地（与 review-panel 完全一致）。

## 2. 目标交互

### 2.1 入口（与 review-panel 同款）
对话顶部 tab 栏从 `[对话]` 变为 `[对话] [预览]`。点「预览」→ view 区全宽显示预览面板（布局内替换，非浮层覆盖）；点「对话」切回消息列表。原 header「网页预览」按钮移除。

### 2.2 预览面板（tab 内全宽，固定布局）

```
┌ 对话页头（crumbs + 会话操作） ──────────────────────────────┐
│ [对话] [预览] ← tab 栏（预览高亮）                            │
├────────────────────────────────────────────────────────────┤
│ [URL行:  http://localhost:5173/     [刷新][外部][🎯选择元素]]│
│ ┌────────────────────────────────────────────────────────┐ │
│ │                     iframe 预览                        │ │
│ │          （占满剩余空间，序号圆圈回显）                   │ │
│ └────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│ 【注释叠加条】① button "提交" ② div.card …   ← 常驻，类似 GoalBar │
│ 对话输入框（dsh 原生 composer，常驻，用户自由输入）：           │
│                                                    [发送 ↗] │
└────────────────────────────────────────────────────────────┘
```

布局说明：预览 tab 内 **URL 行 + iframe 占满**（无注释 chips 区——注释列表由下方叠加条承担，避免重复展示）；点击叠加条 chip 在预览中定位元素。**无任何拖拽分栏/可伸缩交互**。

### 2.3 注释 → 发送（需求 2，agent/prompt-submit 版）

**结论（探索确认，cordis 事件目录 + agent-loop 源码）**：client 发送管线无发送前 hook（conversation service 无事件）；**官方「发送前改写用户消息」机制是 host 侧 `agent/prompt-submit` waterfall**：

- 事件：`'agent/prompt-submit'(this: Scoped<Agent>, agent, message: UserMessage, signal, next) => Promise<PromptDecision>`
- `PromptDecision = { kind:'allow'; content?: ContentBlock[]; additionalContexts?: UserMessage[] } | { kind:'block'; reason }`
- agent-loop 实现：`allow.content` 存在时 `freezeMessage({ ...message, content })` —— **消息 identity/source 不变，仍是一条用户消息**；无注释时 `next()` 原样放行，零开销
- scope-filtered（agent），`agent.sessionId` 区分会话

**设计**：

- **移除**插件自有的「加入对话并发送」按钮、`sending` 状态、sendText 注入（发送走 dsh 原生按钮，输入框完全干净）。
- **node half（host）**：新增 `/webview-annotations` route（`ctx.httpServer.register`，POST 接收 `{sessionId, xml}`，内存 `Map<sessionId, xml>`）+ 注册 `agent/prompt-submit` 监听：`xml = map.get(agent.sessionId)`，非空则返回 `{ kind:'allow', content: [text: xml + '\n' + 原消息文本] }`——**发送时注释 XML 作为 user 内容前缀**（XML 协议与之前完全一致，AI 收到的格式不变，对话里是一条普通用户消息）。`additionalContexts`/`block` 不使用。
- **client（浏览器）**：注释提交/变更/删除后组装 XML，同源 fetch POST 同步到 node half（节流；注释清空同步空串 → 放行原样）。
- **叠加显示（类似 goal/task progress）**：注册 `conversation.input.dock` 的「注释」条，常驻输入框上方（GoalBar 同款位置与形态）：显示序号圆圈 + 元素标识 + 注释摘要的紧凑 chips（样式复用现有注释小条）。注释变更实时同步；点击 chip 若预览 tab 已激活则定位元素（描边 + 注释框重开），未激活时高亮提示（自动切 tab 依赖 harness 渠道，实施时评估，不可达则退化）。
- 注释状态共享：apply 内创建 `webviewStore` 实例，`conversation.view` 与 `conversation.input.dock` 两个注册共用（`store:` 传实例，同 ui-conversation chatStore 做法）。

### 2.4 保留的现有交互（不动）
- iframe 内拾取：hover 描边、点击元素 → 元素旁悬浮注释框 → Enter 提交 / Esc 取消
- 选中元素持续描边、序号圆圈回显、点击小条/圆圈重开注释框
- 注释 chips（序号 + 元素标识 + 注释摘要 + 悬停删除）——仅存于**下方叠加条**（input.dock），预览 tab 内不再重复
- 链接拦截器（面板内点击 http 链接在预览中打开）

## 3. 改造清单

| 文件 | 改动 |
| --- | --- |
| `src/index.ts`（node half） | 新增 `/webview-annotations` route（POST 存 `Map<sessionId, xml>`）；注册 `agent/prompt-submit` 监听（type-only 导入 `@deepseek-ai/dsh-agent`，保持 runtime-import-free），发送时将注释 XML 拼为 user 消息前缀 |
| `src/client/index.ts` | 注册 `conversation.view` tab（`id:'webview', label:'预览'`）+ `conversation.input.dock` 注释叠加条，共享 store 实例；inject face 提供 `syncAnnotations(xml)`（同源 fetch POST 到 node half，节流） |
| `src/client/stores.ts` | 移除 `open`（tab 激活代替）、`sending`、`split`（无分栏）；新增 `focusPickId`（叠加条 → 预览定位信号） |
| `src/client/WebviewPanel.tsx` | 去掉 fixed 定位、关闭按钮、发送 footer、split 拖拽、底部注释 chips 区；改为 tab 视图组件：URL 行 + iframe 占满；注释提交后组装 XML 并调 `syncAnnotations` |
| `src/client/DraftOverlayBar.tsx`（新） | input.dock 注释叠加条组件（GoalBar 形态，共享 store 的 picks） |
| `src/client/styles.ts` | 面板改 tab 内布局（static、无阴影/边框左）；新增叠加条样式；移除 split/分栏相关样式 |
| `src/client/locales.ts` | tab 标签「预览」；移除 `panel.send*`/`panel.close` 等不再用的键 |
| `src/client/format.ts` | 复用现有 `formatAnnotation`（XML 协议不变，发送注入与单测断言均基于它） |
| `src/client/picker.ts` | **不变**（marker/悬浮注释/描边全保留） |
| 测试 | stores/panel spec 更新；e2e：tab 切换、注释后 draft 含 XML 断言、叠加条 chips 断言、发送闭环走原生输入框 |

## 4. 文本交互原型

### 原型 1：整体布局与 tab 入口（全宽预览面板）

```
┌──────────────────────────────────────────────────────────────────────┐
│ 对话页头（会话名 / 操作）                                              │
├──────────────────────────────────────────────────────────────────────┤
│ [ 对话 ] [ 预览* ]          ← tab 栏（预览高亮，review-panel 同款入口）│
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ URL 行: http://localhost:5173/        [刷新] [外部] [🎯选择元素]  │ │
│ │ ┌────────────────────────────────────────────────────────────┐  │ │
│ │ │                     iframe 预览                            │  │ │
│ │ │             （占满剩余空间，序号圆圈回显 ① ②）               │  │ │
│ │ └────────────────────────────────────────────────────────────┘  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────┤
│ 注释 [① button "提交"：按钮颜色太暗] [② div.card：标题字号调大] …      │
│        ↑ 注释叠加条（input.dock，GoalBar 同款位置，常驻）              │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ 对话输入框（dsh 原生 composer，用户自由输入，干净）      [ 发送 ↗ ] │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
        （发送 = 用户输入；注释 XML 由 node half 经 agent/prompt-submit
          重写为 user 消息前缀，输入框与对话区均无注释文本）
```

### 原型 2：注释交互序列（点元素 → 悬浮框 → 回车 → 叠加条 + 发送注入）

```
 ① 点击 🎯 + 页面元素              ② 元素旁悬浮注释框                ③ 发送（复用 dsh 发送按钮）
┌────────────────────┐      ┌────────────────────┐      ┌────────────────────┐
│ ┌────────────────┐ │      │  ┌────────────────┐ │      │ 注释叠加条:         │
│ │ button "提交"   │ │      │  │注释，回车确认… │ │      │ [①button][②div.card]│
│ │    （描边选中）  │ │      │  └────────────────┘ │      ├────────────────────┤
│ └────────────────┘ │      │  ↑ 悬浮在元素旁      │      │ 输入框: 用户内容…    │
│                    │      │  Enter → 注释 chips +│      │          [发送 ↗]   │
│                    │      │  序号圆圈 + 叠加条更新│      │          ↓          │
└────────────────────┘      └────────────────────┘      │ host: agent/        │
                                                       │ prompt-submit 重写  │
                                                       │ = XML 注释 + 用户内容│
                                                       └────────────────────┘
```

### 原型 3：点击小条/圆圈 → 元素重新描边 + 注释框重开（保留现有回显交互）

```
┌──────────────────────┐      ┌──────────────────────────┐
│ 注释叠加条（或预览内序号圆圈）│      │ 预览 iframe                │
│ [② div.card] ← 点击   │ ───► │  ┌────────────────────┐  │
└──────────────────────┘      │  │ div.card            │  │
                              │  │   （重新描边）②      │  │
                              │  └────────────────────┘  │
                              │  ┌────────────────────┐  │
                              │  │ 注释框重新展开       │  │
                              │  │ （带原内容，可编辑）  │  │
                              │  └────────────────────┘  │
                              └──────────────────────────┘
```

## 4.5 探索与决策记录（发送机制）

调研路径（按时间）：client 发送管线 → slash reference codec → 输入框 token UI → host 注入（systemPrompt/agent.inject）→ **cordis 事件目录 + agent-loop 源码**。

| 候选机制 | 结论 | 排除原因 |
| --- | --- | --- |
| client 发送前 hook（InputBar → `conversation.send`） | ❌ 不存在 | conversation service 无事件（invariant 明示）；draft 是发送内容唯一来源；无任何发送前文本变换扩展点 |
| slash `ReferenceCodec`（输入框 chip，发送时序列化） | ❌ 形态不符 | 机制可行（官方 §3.12 prompt serialization），但占位符必然渲染为输入框 chip；用户要求输入框干净 |
| draft 直接注入 XML（`setDraft`） | ❌ 显示不符 | 发送内容正确（XML + 用户内容），但 XML 在输入框可见；用户要求注释不显示在输入框 |
| `systemPrompt.section`（plan-mode 同款） | ❌ 语义不符 | 注入系统提示词（模型视作指令），不是 user 内容；且常驻 |
| `systemPrompt.context`（context injection / 「上下文注入」disclosure） | ❌ 语义不符 | 物化为 plugin-source 的 user-role 快照（source.kind='plugin'），不是用户自己发的内容 |
| `agent.inject`（goal 状态同款） | ❌ 语义不符 | 追加非用户消息到回合开始（round-zero goal-sourced），不是用户消息的一部分 |
| **`agent/prompt-submit` waterfall（最终选择）** | ✅ 官方最佳实践 | 「Allow, rewrite, or block one claimed prompt before it becomes a user message」；`allow.content` → `freezeMessage({ ...message, content })` 保留 identity/source——**重写后仍是一条用户消息**，注释即用户内容前缀；`next()` 无注释放行，零开销；host 侧注册，browser 通过插件自有 HTTP route 同步状态 |

机制地图（避免重复调研，已写入 AGENTS.md）：**要「发送时把内容变成用户消息的一部分」→ `agent/prompt-submit`；要「系统提示词段落」→ `systemPrompt.section`；要「运行时上下文快照（UI 显示「上下文注入」）」→ `systemPrompt.context`；要「回合前追加非用户上下文」→ `agent.inject`。**

## 5. 风险与待确认

1. ~~双栏可伸缩~~ 已定稿：tab 全宽固定布局，无分栏交互。
2. **注入时机 = 发送那一刻**：`agent/prompt-submit` 在 prompt 成为 user message 之前触发，重写后即普通用户消息；无注释时 `next()` 原样放行，零开销。
3. **client → host 同步时序**：注释提交 → POST `/webview-annotations` → 用户点发送 → waterfall 读到；时序天然满足（POST 先于发送）。
4. **picks 生命周期**：发送后插件 picks 保留（chips/叠加条仍在，可手动删除）；注释变更即重新同步 XML。
5. **node half 依赖**：事件注册用 cordis 核心 `ctx.on`（waterfall），无需服务注入；`httpServer` 为既有服务。node half 保持 runtime-import-free（仅 type-only 导入类型）。

## 6. 实施顺序

1. node half：/webview-annotations route + agent/prompt-submit 重写注入（含单测：route 存取、waterfall 前缀拼装、无注释放行）
2. store：移除 open/sending/split，新增 focusPickId；共享实例化
3. index.ts：conversation.view tab + input.dock 叠加条双注册、syncAnnotations inject
4. WebviewPanel.tsx 改 tab 视图（URL 行 + iframe + 底部注释 chips）+ 注释变更同步 XML
5. DraftOverlayBar.tsx 叠加条组件
6. styles/locales/format 配套
7. 单测 + e2e 更新（tab 切换、注释同步 POST 断言、叠加条 chips、真实发送后注入内容出现在会话日志）
8. `pnpm check` + `pnpm check --e2e`
