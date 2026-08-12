# dsh-web-review

> 为 DeepSeek Harness Web GUI 增加原生的「网页预览 + 元素批注 + AI 改代码」评审闭环。

把正在开发的网页直接放进 DSH 对话：浏览页面、点选任意元素、写下修改意见，或像设计工具一样临时调整文本、颜色、字体、尺寸、间距、边框与效果。发送后，批注会作为独立的结构化上下文交给当前 Agent，由它修改已连接工作区中的前端源码。

<p align="center">
  <img width="100%" alt="dsh-web-review 网页预览、元素批注与视觉调整演示" src="./docs/assets/web-review-demo.gif" />
</p>

<p align="center">
  <img width="49%" alt="dsh-web-review 网页预览" src="./docs/assets/web-review-preview.jpg" />
  <img width="49%" alt="dsh-web-review 元素批注与属性调整器" src="./docs/assets/web-review-annotation-editor.jpg" />
</p>

## 为什么用它

- **所见即所改**：不用反复描述“右上角第二个按钮”，直接点选页面元素并留下意见。
- **设计与代码同屏闭环**：样式和文本可先在页面中预览，确认后再让 Agent 落到真实源码。
- **不打断对话工作流**：复用 DSH 原生会话标签、输入框和发送流程，不需要额外的模型工具。
- **批注信息更准确**：自动携带选择器、可访问名称、语义类名、框架源码锚点和变更前后值，减少 Agent 猜测。
- **改动可回滚**：页面里的临时预览在取消、清空、移除、发送成功、导航或卸载时恢复原值。

## 功能一览

### 网页预览

- 在会话顶部注册原生「网页预览」标签，支持输入 URL、前进、后退、刷新和外部打开。
- 支持任意无凭据的绝对 HTTP(S) URL：公网、局域网和本机页面都可在预览标签中打开；Agent 回复中的这类链接也会直接进入 Preview。
- 每次页面会话使用随机 `*.localhost` 独立 Origin，由受控的版本化 `postMessage` bridge 执行点选、属性预览和回滚；页面脚本不再与 DSH 宿主同源。
- 隔离代理自动处理 HTML 相对资源、根路径属性、同 Origin 表单与 SPA fallback；跨站跳转会切换到新的随机 Origin。
- 与当前会话、当前工作区绑定；Agent 修改源码后可手动刷新查看结果。

### 元素点选与批注

- 开启批注模式后，悬停高亮页面元素，点击即可打开宿主层编辑器。
- 自动生成最短唯一 CSS 选择器，并捕获标签、文本、ARIA 信息、稳定类名及 React / Vue / Svelte 源码锚点。
- 每条批注在页面中显示编号标记；点击标记或批注列表可重新定位并编辑。
- 输入框上方只保留一个紧凑批注胶囊，可查看同步状态、全部目标与评论。

### Figma 风格属性调整器

- 支持安全的直接文本修改。
- 支持文本色、背景、透明度、字体、字重、字号、行高、字间距、对齐和文本装饰。
- 支持宽高、显示与定位、Margin、Padding、边框、圆角、约束和效果。
- 对同时接受数值与 CSS 关键字的属性保留自由输入，并在右侧下拉中提供 `auto`、`normal`、`none` 等常用值。
- 修改即时预览；每个已变更字段都能单独重置，取消时恢复精确的原始内联值与优先级。

### UI 优化 Skill

插件随包提供 `better-ui`、`better-typography`、`better-layout`、`better-writing`、`better-accessibility`、`better-colors`、`better-interface` 和 `interface-review`，均可由用户通过斜杠命令调用。

模型目录的自动加载由 Cordis 插件参数 `autoLoadSkills` 独立控制，默认加载 `better-ui`、`better-typography`、`better-layout` 和 `better-writing`。批注中勾选的 Skill 只对本批 Browser Comments 生效：当前模型可见上下文尚无完整规则时注入规则全文，已经存在时只追加使用提醒。

### AI 协作闭环

- 浏览器只发送有界、严格校验的结构化快照，不直接拼接模型提示词。
- 批注准备完成后，在 `agent/pre-step` 阶段追加一条独立的插件来源消息，不改写用户原始输入。
- 有输入草稿时沿用 DSH 原生发送机；没有草稿时发送固定请求“请根据页面批注修改前端实现。”。
- 发送失败时批注保持可见并可重试；确认进入会话后才清空批注和临时页面改动。

## 安装与启动

### 前置条件

- 支持官方 profile 插件机制的 DeepSeek Harness；已验证基线为 `snapshot-20260811T152241Z-da262ec14c`
- 已安装 `dsh` 与 pnpm

### 从私有 npm 安装

这是保密项目，包只发布为 npmjs 上的私有 restricted 包
`@canglongcl/dsh-web-review`，不得公开发布或分发 tarball。仓库内的
`.npmrc` 只固定 registry；认证插值必须放在可信的用户级 `~/.npmrc`：

```ini
@deepseek-ai:registry=https://registry.npmjs.org/
@canglongcl:registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

仅在当前 Shell 导出具备读取 `@canglongcl` 私有包权限的短期令牌，然后安装候选版本：

```sh
export NPM_TOKEN='你的只读令牌'
dsh plugin --profile web add @canglongcl/dsh-web-review@0.0.4-rc.3
unset NPM_TOKEN
```

安装命令会把插件加入 `web` profile 的依赖，并根据包内 `dsh.bundle.patch` 声明自动启用配置层。可先检查最终配置，再启动 DSH：

```sh
dsh --profile web --dump-config
dsh web
```

稳定版发布后可省略版本；更新和卸载仍由 DSH profile 插件命令管理：

```sh
dsh plugin --profile web add @canglongcl/dsh-web-review
dsh plugin --profile web remove @canglongcl/dsh-web-review
```

### 从源码生成官方安装包

如果没有现成的 Release 包，可使用具备 `@deepseek-ai/*` 私有依赖读取权限的令牌，从源码构建同样的 bundle tarball：

```sh
git clone https://github.com/dsh-external/dsh-web-review.git
cd dsh-web-review
export NPM_TOKEN='你的只读令牌'
pnpm install
pnpm package:official
unset NPM_TOKEN
```

产物位于 `dist/canglongcl-dsh-web-review-<版本>.tgz`。其中只包含自包含的 Node bundle、使用稳定包名注册的浏览器 bundle、隔离 frame bridge bundle、随包 Skill、官方 `cordis.patch.yml` 和 README，不包含源码、本机 `node_modules`、认证配置或开发用 profile 链接。该产物属于保密材料，不得上传到公开 Release 或公共文件服务。

### 维护者通过 GitHub Actions 发布

`.github/workflows/release-npm.yml` 是唯一正式发布入口：PR 与 `main` 使用固定版本的私有 npm 开发包运行类型检查、构建、单元/组件测试、包白名单和校验和门禁；与 `package.json` 精确匹配的 `v*` Tag 才能进入受保护的 `npm-publish` Environment。发布 Job 只下载前一 Job 的 tarball，不重新构建。浏览器 E2E 仍需显式的 0811 Harness checkout，应在打 Tag 前单独运行。

私有仓库需要配置：

- Secret `NPM_READ_TOKEN`：私有 `@deepseek-ai` 包只读权限。
- Environment `npm-publish`：required reviewers，且只允许受保护的 `v*` Tag。
- Variable `NPM_PUBLISH_MODE`：首次设为 `bootstrap`，完成后设为 `trusted`。
- Secret `NPM_BOOTSTRAP_TOKEN`：只在首次 bootstrap 存在，必须是 `@canglongcl` scope 的短期、最小权限、Read and write 且允许非交互发布的 granular token。

首次 bootstrap 后，在 npm 包 Settings 中把私有 GitHub 仓库、Workflow 文件名
`release-npm.yml` 和 Environment `npm-publish` 注册为 Trusted Publisher，并明确允许
`npm publish`；随后删除 bootstrap token 并改用 `NPM_PUBLISH_MODE=trusted`。常规发布只使用 OIDC。

发布前运行完整本地门禁：

```sh
DSH_HARNESS=/绝对路径/deepseek-harness pnpm check --e2e
```

候选版本自动发布到私有 `next` dist-tag，稳定版本发布到私有 `latest`：

```sh
git tag -a v0.0.4-rc.3 -m "dsh-web-review v0.0.4-rc.3"
git push origin v0.0.4-rc.3
```

## 使用方法

1. 准备要评审的绝对 HTTP(S) URL（如 `http://localhost:5173` 或 `https://example.com`）。要让 Agent 修改源码时，同时将对应工程连接为当前 DSH 工作区。
2. 打开 DSH 会话中的「网页预览」，输入 URL 并回车。
3. 点击右上角批注按钮，再点击页面中的目标元素。
4. 写评论；如需视觉调整，展开「调整」并修改属性。
5. 确认批注，等待输入框上方显示“发送时注入”。
6. 直接发送原有需求，或使用批注栏中的计数发送按钮。
7. Agent 修改工作区源码后，刷新预览验收；不满意可继续批注下一轮。

## 工作原理

| 部分 | 职责 |
|---|---|
| Node 端 | 会话控制端点、独立 loopback 预览服务、目标 Origin/DNS 固定、有界转发、批注校验与待发送状态 |
| 隔离 frame | 在随机 Preview Origin 内运行页面与 picker，通过带版本、channel、精确 source/Origin 校验的 bridge 交换有界结构化数据 |
| DSH 浏览器端 | 预览标签、宿主层属性编辑器、批注胶囊与发送确认；不读取 iframe DOM |
| AI 协作 | 按需追加所选 Skill、Browser Comments 与已加载 Skill 提醒；Agent 使用现有工作区文件和 Shell 工具改源码 |

插件不会注册新的模型工具，也不会把截图、完整 `outerHTML`、全量计算样式或编辑器内部状态发给模型。页面证据与用户意见在上下文中明确区分，字段数量、长度和允许的视觉属性均有硬限制。

## 已知限制与安全说明

- 公网、局域网与本机的绝对 HTTP(S) 页面都可预览和批注；不接受带 `username:password@` 的 URL，也不支持 HTTP(S) 以外的协议。
- 页面脚本在随机 Preview Origin 中执行，不能同源访问 DSH 宿主。Bridge 会把 DOM 元数据视为不可信页面证据，不会把它当成用户指令。
- 服务端代理不携带浏览器 Cookie，因此需要已登录会话、强制原站 Origin 或反自动化验证的页面可能不能完整渲染。
- HTML 中的同站 URL 会被改写，普通相对 URL 和脚本中的根路径请求会经隔离代理；脚本里硬编码的绝对 API URL 与 WebSocket 不会改写，开发服务器 HMR WebSocket 不可用。
- 初始 HTML 中的跨 Origin 链接与服务端重定向会安全换用新的 Preview Origin；动态生成的链接、脚本直接修改 `location` 或跨 Origin POST 表单可能脱离 bridge/不受支持，此时面板会明确显示预览不可用。
- 源码修改后需要手动刷新预览。
- 一次只评审一个页面；显式输入新 URL 或跨 Origin 导航会清空当前批注。
- 文本预览只支持拥有一个安全直接文本节点的元素。

更完整的代理、批注协议、同步语义和边界说明见 [package README](./packages/dsh-web-review/README.md) 与 [AGENTS.md](./AGENTS.md)。

## 开发与验证

```sh
pnpm check          # 类型检查、单元/组合测试、配置契约、bundle 构建
pnpm package:official # 构建 DSH 官方 profile bundle 安装包
pnpm test:e2e       # 真实 GUI + 隔离 Origin/bridge + 点选 + 批注发送链路
pnpm check:e2e      # 两者一起运行
pnpm demo           # 启动仓库内置演示页，默认 http://127.0.0.1:5173
pnpm dev:acceptance # 专用隔离 profile + 持久对话历史 + demo + bundle watch
```

`dev:acceptance` 将测试 profile 固定保存在 `.artifacts/acceptance/dsh-home`。
启动时会通过 Harness 自己的会话持久化接口创建或复用“网页批注验收”mock 历史，不调用模型。打开该会话并点击其中的 Demo 链接即可进入 Preview；停止、重启仍会保留工作区与其他历史。它不会读取或修改日常使用的 DSH profile。首次选择的空闲端口保存在 `.artifacts/acceptance/ports.json`，后续重启保持 URL 不变；也可通过 `DSH_WEB_PORT`、`DEMO_PORT` 临时覆盖。
若环境变量中没有 provider key，首次初始化会从默认 DSH profile 复制已有凭据到该隔离目录，并将权限设为 `0600`；凭据内容不会进入日志或版本库。
