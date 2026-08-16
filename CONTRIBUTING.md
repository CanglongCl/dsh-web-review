# 参与开发

本文面向 `dsh-web-review` 的维护者和贡献者，介绍本地开发、技术架构、验证与公开发布流程。普通用户请阅读 [README.md](./README.md)。

## 发布边界

- 源码包保持 `private: true`。
- npm 包名保持 `@canglongcl/dsh-web-review`，正式 tarball 的发布访问级别必须为 `public`。
- 不要在仓库文件、命令参数、日志或截图中写入真实令牌和 provider 凭据。

完整且具有约束力的工程规则见 [AGENTS.md](./AGENTS.md)。修改协议、加载方式或安全边界前必须先阅读该文件。

## 环境准备

### 1. 安装依赖

直接从公共 npm registry 安装依赖，无需配置 `@deepseek-ai` 只读令牌：

```sh
pnpm install
```

安装过程会配置仓库的 pre-commit hook。普通的类型检查、构建、单元测试、打包和 npm 发布使用锁定的公共 npm 依赖，不要求本地存在 Harness checkout。

### 2. 准备 Harness

开发、手动验收和 E2E 需要外部 DeepSeek Harness checkout。当前兼容基线是：

```text
snapshot-20260812T172954Z-final-unwatermarked-5fa48343c7
7b9644f2b664e46c9518506035aa6c8d5af4d8e8
```

Harness 必须位于本仓库之外，不要为本插件修改 Harness 源码：

```sh
export DSH_HARNESS='/绝对路径/deepseek-harness'
pnpm setup:harness
```

`setup:harness` 会检查目标 commit、构建状态和必需产物，并生成本机专用、已被 gitignore 的 `cordis.yml` 与 `packages/dsh-web-review/entry-name.json`。

## 开发流程

启动完整开发环境：

```sh
pnpm dev
```

它会同时启动 Harness Web profile 和本包的客户端 bundle watch。浏览器端修改可通过刷新应用，Node 端修改需要重启 Web 进程。

启动演示页面：

```sh
pnpm demo
```

演示页默认地址为 `http://127.0.0.1:5173`。

需要可重复的隔离验收环境时运行：

```sh
pnpm dev:acceptance
```

该命令使用 `.artifacts/acceptance/` 下的独立 profile、固定端口和持久测试会话，不修改日常 DSH profile。测试凭据不会进入日志或版本库。

## 技术架构

插件由一个双面 package 和一个隔离 frame artifact 组成：

| 部分 | 主要职责 |
|---|---|
| Node 端 | 创建和撤销预览会话、运行 loopback 代理、校验批注快照、准备 Agent 上下文 |
| DSH 浏览器端 | 注册网页预览标签、宿主层编辑器、批注胶囊和发送确认 |
| 隔离 frame bridge | 在预览页面内执行元素选择、序列化 DOM 信息、临时样式预览与精确回滚 |
| Agent 协作 | 在 `agent/pre-step` 中追加独立的 Browser Comments 消息，使用现有工作区工具修改源码 |

### 加载方式

- 开发环境通过 profile-local alias `@dsh-web-review-dev/plugin` 加载外部 checkout。
- `scripts/profile-plugin-link.ts` 在 Web profile 下维护对应 symlink；非 symlink 占用该路径时会失败，不会覆盖。
- `cordis.yml` 只通过 `dsh web --patch` 增加本插件，不修改 Harness profile 或源码。
- 开发 bundle 和正式 bundle 使用不同的 loader ID，不能混用。
- Node bundle 必须自包含，运行时不能依赖本 checkout 的 `node_modules`。

### 预览隔离

- DSH host 只提供预览会话控制接口，不在宿主 Origin 返回目标页面内容。
- 每个顶层目标使用随机、短生命周期的 `*.localhost` Preview Origin。
- 会话绑定目标 Origin，并固定首次 DNS 解析，防止 rebinding。
- 代理只转发受支持的方法与有界请求，绝不转发浏览器 Cookie 或 Authorization。
- HTML 使用解析器改写，并在页面脚本之前注入 `<base>`、bridge 配置与 bridge bundle。
- Host 与 frame 只通过严格校验的 `postMessage` 协议通信；生产代码不得直接读取 iframe DOM。

### 元素选择与临时编辑

- bridge 独占页面中的实时元素引用和回滚记录，React store 只保存可序列化快照。
- 元素快照、选择器、页面 URL 和 framework anchor 都是不可信页面证据。
- 评论、请求的样式值和文本替换属于用户输入，但仍需通过长度、数量和属性白名单校验。
- 临时样式修改前必须记录精确的原始 inline value 与 priority。
- 重置、取消、移除、清空、发送成功、导航和卸载都必须恢复页面原状。

### 批注与发送

- 浏览器发送结构化 `{ sessionId, page, comments[] }`，不在客户端拼接模型提示词。
- Node 端严格校验后生成稳定的 `# Browser comments` 上下文。
- 批注以独立的 plugin-sourced user message 追加，不得改写用户输入框原文。
- 只有带有匹配 `snapshotId` 的持久 Context 记录才能清除胶囊，失败或被拒绝的发送必须保留批注以供重试。
- 插件不注册新的模型工具；Agent 使用会话已有的文件和 Shell 工具修改工作区。

## 代码约定

- 仓库全部使用 TypeScript，包括 `scripts/`、`demo/` 与测试。
- 产品文案使用中文；代码注释、JSDoc 和协议上下文使用英文。
- 业务状态放在 `createWebviewStore()` 中，组件只通过 props 接收数据。
- 生产 host 代码不得保存 iframe 内的 `Element`，也不得调用页面函数。
- HTML 改写必须使用 `parse5`，不得用正则表达式处理 HTML。
- `cordis.yml`、`entry-name.json`、`lib/`、`dist/` 和测试产物均为生成文件，不得提交。
- 提交信息遵循仓库现有风格。

## 验证

提交前至少运行：

```sh
pnpm check
```

涉及 UI、预览代理、bridge 或批注发送链路时，还需运行：

```sh
DSH_HARNESS='/绝对路径/deepseek-harness' pnpm test:e2e
```

也可以执行完整门禁：

```sh
DSH_HARNESS='/绝对路径/deepseek-harness' pnpm check:e2e
```

主要命令：

| 命令 | 用途 |
|---|---|
| `pnpm typecheck` | TypeScript 项目检查 |
| `pnpm test` | 构建并运行 Vitest |
| `pnpm check` | 类型、测试、配置契约、bundle 与包白名单门禁 |
| `pnpm test:e2e` | 真实 DSH GUI、隔离 Origin、点选与发送链路 |
| `pnpm package:official` | 生成正式安装包 |
| `pnpm release:verify` | 校验待发布产物 |

pre-commit hook 会运行快速门禁，不包含需要启动服务和 provider 配置的浏览器 E2E。

## 打包与发布

构建正式安装包：

```sh
pnpm package:official
```

产物位于 `dist/`，仅包含白名单内的 manifest、自包含 bundles、bridge、Skills、README 和演示资源。

正式 npm 发布只通过 `.github/workflows/release-npm.yml`：

1. PR 与 `main` 运行 npm-only 质量门禁。
2. 与 `package.json` 版本完全一致的 `v*` tag 才能触发发布。
3. 发布 Job 使用前一 Job 已校验的 tarball，不重新构建。
4. 发布 Job 通过 npm Trusted Publishing 使用短期 GitHub OIDC 身份，并显式保持 `public`。

dist-tag 规则：`x.y.z-beta.N` 发布到 `beta`，其他候选版本（如 `-rc`）发布到 `next`，稳定版本发布到 `latest`。创建 tag 前必须单独完成显式 Harness E2E：

```sh
DSH_HARNESS='/绝对路径/deepseek-harness' pnpm check:e2e
git tag -a v<version> -m "dsh-web-review v<version>"
git push personal v<version>
```

### Beta 渠道

`pnpm release:beta [基础版本] [--dry-run]` 完成 beta 发布的本地前置步骤：

- 校验两份 manifest 版本一致且为合法 semver，工作区干净；
- 计算下一个 beta 版本：当前是 `x.y.z-beta.N` 时递增为 `x.y.z-beta.(N+1)`；否则从当前稳定版本的下一个 minor（或显式给出的基础版本）开始，即 `x.y.z-beta.0`；
- 校验新版本高于 npm 上已发布的 `beta` / `latest`；
- 写入两份 manifest，运行 `pnpm release:verify`，提交 `release: bump <version>`，打 `v<version>` 注释 tag 并推送到 origin。

tag 推送后 CI 自动打包并发布到 `beta` dist-tag，用户可用 `npm i @canglongcl/dsh-web-review@beta` 安装。`--dry-run` 只打印计划，不修改任何文件。

Trusted Publisher 与 CI 边界的详细配置以 [AGENTS.md](./AGENTS.md) 为准。发布 workflow 不保存 npm 写令牌。

## 提交变更

提交前确认：

1. 改动未突破 Preview Origin、消息信任边界或公开发布约束。
2. 没有提交生成文件、凭据、日志、截图或构建产物。
3. `pnpm check` 通过；相关 UI 或发送路径的 E2E 也已通过。
4. 用户可见行为和限制已同步更新到 [README.md](./README.md)。
