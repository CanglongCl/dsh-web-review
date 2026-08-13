# dsh-web-review

[English](./README_en.md)

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

安装并启动：

```sh
dsh plugin --profile web add @canglongcl/dsh-web-review
dsh web
```

## 使用方法

1. 告诉启动要评审的前端页面，点击AI返回的地址页面。
   也可以切换到 DSH 的「网页预览」Tab，输入页面的绝对 HTTP(S) URL。
2. 点击批注按钮，再点击页面中的目标元素。
3. 填写修改意见；如需视觉调整，展开「调整」并修改属性。
4. 点击批注工具栏中的发送按钮；或在 DSH 的输入框中填写更多提示词，然后点击 DSH 发送按钮，注释会随着你的提示词一同发送。
5. Agent 修改源码后，刷新预览进行验收；不满意可以继续下一轮批注。

## 主要功能

### 网页预览

- 在 DSH 内打开 Agent 提供的链接页面

### 元素批注

- 悬停高亮并点选页面元素。
- 为多个目标添加批注。
- 自动附带选择器、文本、可访问名称和源码线索，帮助 Agent 找到对应实现。

### 实时视觉调整

- 修改文本、颜色、字体、字号、行高、尺寸和透明度。
- 调整间距、布局、边框、圆角和效果。
- 所有修改即时预览。

### AI 协作

- 批注会作为独立上下文随你的提示词注入。
- Agent 根据批注修改当前工作区源码，页面中的临时调整不会直接写入工程。

### UI 优化 Skills

插件内置了 [Jakub Krehel 的设计 Skills](https://github.com/jakubkrehel/skills)：

- `better-ui`
- `better-typography`
- `better-layout`
- `better-writing`
- `better-accessibility`
- `better-colors`
- `better-interface`
- `interface-review`

你可以通过斜杠命令调用 skill，也可以在批注编辑器中选择，让 Agent 在本轮修改中参考相应规则。

## 参与开发

开发环境、架构说明与验证流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
