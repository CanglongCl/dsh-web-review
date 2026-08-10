# 批注编辑器聚焦与临时隐藏方案

## 目标

解决属性编辑器遮挡被检查页面的问题，同时保持现有批注事务、实时预览、回滚和发送链路不变。

本次只调整宿主侧 `AnnotationEditor` 浮层。iframe 内的选中框与编号标记、顶部批注工具栏、底部批注胶囊不随编辑器隐藏，避免改变现有批注状态机。

## 交互状态

### 1. 正常态 `visible`

- 编辑器完整显示。
- 在编辑器右上区域增加“暂时隐藏编辑器”眼睛按钮。
- 数值属性仍通过现有拖动柄水平拖动。

### 2. 拖动聚焦态 `scrubbing`

- pointer 移动超过现有 3px 阈值后进入，pointer up / cancel / 丢失捕获后退出。
- 当前被拖动的 `ScrubNumber` 保持 100% 不透明，尺寸、颜色和位置不变。
- 编辑器内其余区域立即完全隐藏；它们在拖动期间不响应指针，避免误触。
- 编辑器白色背板、边框与阴影在拖动时必须完全消失；检查器、顶部输入区和底部操作区不得残留或叠加白底，确保能直接看见后方页面。
- 拖动聚焦状态立即进入和退出，不播放隐藏或恢复动画。
- pointer cancel 继续遵循现有规则：恢复拖动开始时的属性值。

### 3. 临时隐藏态 `hidden`

- 点击眼睛按钮后，编辑器卡片立即收起。
- 仅保留一个 36×36px 的白色圆形眼睛按钮，靠近编辑器原锚点并钳制在预览边界内。
- 再次点击后原位展开；评论、属性草稿、滚动位置、dirty/invalid 状态和临时页面预览均保留。
- 隐藏不等于 Cancel，不回滚、不确认、不清空批注。
- `Escape` 在隐藏态仍取消整个编辑事务，行为与当前一致。

## 组件改动

1. `ScrubNumber`
   - 新增可选 `onScrubChange(active: boolean)`。
   - 只在超过 3px 阈值后上报 `true`；所有结束路径统一上报 `false`。
   - 用稳定的属性名标识当前拖动控件，避免多个数值控件状态冲突。

2. `AnnotationEditor`
   - 增加本地展示状态：`visibility: 'visible' | 'hidden'` 与 `activeScrub: EditableStyleProperty | null`。
   - 给活动属性行和数值控件增加稳定的 `data-*` 标记。
   - 用同一状态驱动视觉降噪、pointer-events、眼睛按钮和无障碍属性。
   - 隐藏圆钮复用现有编辑器定位结果，不把展示状态写入共享 store。

3. 样式
   - 拖动时用一条统一规则隐藏 `.editor` 的全部后代，再让 `[data-scrub-active]` 行及其后代覆盖继承的 `visibility`。这同时覆盖 section divider、检查器边框和滚动条，无需维护逐项 dimmable 清单。
   - 根编辑器的背景、边框和阴影独立清空；活动行保留原有尺寸、颜色和位置。
   - 拖动聚焦与眼睛折叠均立即切换；普通 hover/展开动效仍遵循 `prefers-reduced-motion`。

## 无障碍与边界行为

- 眼睛按钮使用 `aria-pressed`，可见态文案“暂时隐藏编辑器”，隐藏态文案“显示编辑器”。
- 拖动聚焦态仅是瞬时展示状态，不发送到模型、不进入批注快照。
- 隐藏后圆钮保持键盘可聚焦，focus ring 不被裁切。
- unmount、Cancel、Confirm 和换页时确保清理 active scrub；不得残留隐藏状态。

## 验证计划

- `inspector-controls.spec.tsx`：3px 阈值、pointer up、pointer cancel、lost pointer capture 均产生正确的开始/结束通知。
- `annotation-editor.spec.tsx`：拖动时活动控件为 100%，其他区域完全隐藏，结束后恢复；隐藏/显示保留草稿和临时样式；Escape 仍回滚。
- `panel.spec.tsx`：隐藏态不改变 pick、comment、send 状态。
- 浏览器 E2E：真实拖动属性，断言只有活动行可见、divider/滚动容器不可见、圆钮恢复和 Cancel 精确回滚。
- 最终运行 `pnpm check`；由于是可见 UI 改动，再运行 `pnpm test:e2e`。

## 原型对应

SVG 原型分为正常态、拖动聚焦态、临时隐藏态三幅画板：

- `docs/annotation-editor-visibility-prototype.svg`
