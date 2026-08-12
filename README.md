# dsh-web-review

在内置浏览器中，像使用设计工具一样选择页面元素、填写修改意见，并临时调整文本、颜色、字体、尺寸、间距、边框与效果。确认发送后，Agent 会结合页面批注修改当前工作区中的源码。

<p align="center">
  <img width="100%" alt="dsh-web-review 网页预览、元素批注与视觉调整演示" src="./docs/assets/web-review-demo.gif" />
</p>

<p align="center">
  <img width="49%" alt="dsh-web-review 网页预览" src="./docs/assets/web-review-preview.jpg" />
  <img width="49%" alt="dsh-web-review 元素批注与属性调整器" src="./docs/assets/web-review-annotation-editor.jpg" />
</p>

> 如果你用过 v0、Codex 等 Coding Agent 应用的内置浏览器，你应该对此会很熟悉。

## 安装

### 前置条件

- `dsh`

安装并启动：

```sh
dsh plugin --profile web add @canglongcl/dsh-web-review
dsh web
```

更新时重新执行安装命令；卸载使用：

```sh
dsh plugin --profile web remove @canglongcl/dsh-web-review
```

## 使用方法

1. 启动要评审的前端页面，例如 `http://localhost:5173`，并将对应工程连接为当前 DSH 工作区。
2. 打开 DSH 会话中的「网页预览」，输入页面的绝对 HTTP(S) URL。
3. 点击批注按钮，再点击页面中的目标元素。
4. 填写修改意见；如需视觉调整，展开「调整」并修改属性。
5. 确认批注，等待输入框上方显示“发送时注入”。
6. 发送原有需求，或点击批注工具栏中的发送按钮。
7. Agent 修改源码后，刷新预览进行验收；不满意可以继续下一轮批注。

## 主要功能

### 网页预览

- 预览公网、局域网和本机的绝对 HTTP(S) 页面。
- 支持前进、后退、刷新和在外部浏览器打开。
- 点击 Agent 回复中的网页链接，可直接在「网页预览」中打开。

### 元素批注

- 悬停高亮并点选页面元素。
- 为多个目标添加编号批注，并随时重新定位或编辑。
- 自动附带选择器、文本、可访问名称和源码线索，帮助 Agent 找到对应实现。

### 视觉调整

- 修改文本、颜色、字体、字号、行高、尺寸和透明度。
- 调整间距、布局、边框、圆角和效果。
- 所有修改即时预览，支持逐项重置或整体取消。

### AI 协作

- 批注会作为独立上下文随下一条消息发送，不会改写输入框中的原始内容。
- 发送失败时保留批注，方便重试。
- Agent 根据批注修改当前工作区源码，页面中的临时调整不会直接写入工程。

<details>
<summary><strong>UI 优化 Skills</strong></summary>

插件提供以下可选 Skills：

- `better-ui`
- `better-typography`
- `better-layout`
- `better-writing`
- `better-accessibility`
- `better-colors`
- `better-interface`
- `interface-review`

你可以通过斜杠命令调用，也可以在批注编辑器中选择，让 Agent 在本轮修改中参考相应规则。默认自动加载 `better-ui`、`better-typography`、`better-layout` 和 `better-writing`。

</details>

<details>
<summary><strong>已知限制</strong></summary>

- 只接受不含账号密码的绝对 HTTP(S) URL。
- 预览不会携带浏览器 Cookie，需要登录、客户端证书或反自动化验证的页面可能无法完整显示。
- 脚本中硬编码的绝对 API URL 与 WebSocket 不会被代理，开发服务器的 HMR WebSocket 不可用。
- 动态跨站跳转可能离开安全预览环境，此时元素批注会停止工作。
- 一次只评审一个页面；打开新 URL 或发生跨站导航会清空当前批注。
- Agent 修改源码后，需要手动刷新页面查看结果。
- 文本预览仅支持包含一个安全直接文本节点的元素。

预览页面运行在独立的随机 Origin 中，不能同源访问 DSH 宿主。页面提供的 DOM 信息会作为不可信页面证据处理，不会被当成用户指令。

</details>

## 参与开发

开发环境、架构说明与验证流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
