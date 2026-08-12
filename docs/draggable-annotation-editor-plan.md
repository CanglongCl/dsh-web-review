# 批注编辑器拖拽与缩放方案

## 目标

在批注编辑器展开态的顶栏增加一个 `:::` 拖拽把手，并允许从四边或四角调整浮窗尺寸，让用户在编辑器遮挡页面内容时可以主动整理工作区，同时保留现有自动避让、临时隐藏、属性拖调、元素切换、回滚和发送行为。

本次改动只影响宿主侧 `AnnotationEditor` 的位置交互；iframe 内选中框、编号标记、批注数据和模型上下文不变。

## 调研结论

- 把手采用 34×34px 的真实按钮，超过 WCAG 2.2 [Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) 的 24×24 CSS px 最低尺寸，并沿用现有顶栏按钮间距。
- 拖动期间使用 Pointer Events，并在 `pointerdown` 后调用 [`setPointerCapture()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)，确保指针离开把手或浮窗后仍能可靠收到 move/up；`pointercancel` 和 `lostpointercapture` 都按取消路径收口。
- 只有把手设置 `touch-action: none`、`cursor: grab/grabbing` 和临时禁选文本。整张卡片不作为拖动区域，避免评论输入、选择/调整按钮、滚动条和数值拖调发生冲突。
- 缩放采用四边加四角八个连续空间命中区：四角为 24×24px；边缘在细指针下为 12px、粗指针下扩大到 20px。WCAG 2.2 把按空间位置选值的连续区域视为一个目标，边缘因此不拆成密集的小按钮。

## 顶栏方案

- 仅在 `mode !== 'collapsed'` 的展开态显示 `:::`，放在评论输入框与眼睛按钮之间。
- 按钮视觉尺寸 34×34px，图形为 2×3 六点把手；语义文案为“移动编辑器”。
- 默认状态使用 `grab`；有效拖动中使用 `grabbing`，按钮进入业务蓝浅底，浮窗阴影略收紧，不播放位移动画。
- 单击或移动未超过 3px 时不改变位置，也不打开附加面板。

## 位置状态

编辑会话持有以下纯 UI 状态，不写入共享 store，也不进入批注快照：

```ts
type EditorPosition = { left: number; top: number } | null
type EditorSize = { width: number; height: number } | null
```

- `null` 表示自动模式，继续使用 `placeFloatingEditor()` 的目标避让结果。
- 拖动超过 3px 后记录手动坐标；移动值以预览画布坐标记录。
- 手动位置在“选择 / 调整”切换、目标层级切换、临时隐藏与恢复之间保留；关闭编辑事务、确认、取消或换页后重置。
- 用户手动定位后，目标元素滚动不再把编辑器拉回目标旁边；预览尺寸变化和编辑器高度变化只做边界钳制。
- `EditorSize` 只在展开态生效；Select 与 Adjust 切换、目标切换、隐藏和恢复均保留尺寸。松手后的偏好宽高写入浏览器 profile，关闭再开或刷新后恢复；位置仍随编辑事务释放。
- 小画布只钳制当前渲染尺寸，不覆盖已保存的偏好尺寸；画布恢复后继续使用用户选择的宽高。

## 边缘缩放

1. 展开态提供 `n / ne / e / se / s / sw / w / nw` 八个命中区；折叠态不缩放，避免与紧凑胶囊操作冲突。
2. 沿西边或北边缩放时固定对边，同步修改 `left` / `top`，不会在跨过最小值后反向跳动。
3. 宽度最小 320px；Select 高度最小 260px；Adjust 高度最小 300px。画布更小时，最小值退让为画布尺寸减去两侧 8px。
4. 内部检查器使用剩余高度滚动；顶栏、底栏与评论草稿不会因缩放丢失。
5. 缩放同样使用 3px 启动阈值、Pointer Capture 和取消回滚；不提供点击缩放、键盘缩放、惯性或吸附。

## 指针交互

1. 仅响应主按钮 `pointerdown`，记录指针起点与浮窗起点，并捕获当前 pointer。
2. 移动距离超过 3px 后进入 `dragging`，实时更新经过边界钳制的浮窗坐标。
3. 每一帧把位置限制在预览画布内：四边至少保留 8px，完整顶栏始终可见。
4. `pointerup` 提交最终坐标；`pointercancel` 和 `lostpointercapture` 恢复拖动起点。
5. 未越过阈值的 `pointerup` 不执行任何动作。

## 组件改动

1. `floating-position.ts`
   - 提取 `clampFloatingEditorPosition()`，统一处理手动坐标、编辑器尺寸变化和预览 resize。
   - 保留 `placeFloatingEditor()` 作为自动模式，不把用户偏移混入目标避让算法。

2. `AnnotationEditor.tsx`
   - 新增 `DragHandleIcon`、把手按钮和 pointer capture 生命周期。
   - 接收当前 `EditorPosition` 与更新回调，使目标切换导致组件换 key 时仍保留手动位置。
   - 接收 `EditorSize`，渲染八方向缩放层，并把西/北方向的位置变化与尺寸变化一起提交。
   - 拖动时暂停自动 reposition；隐藏眼睛 FAB 使用最终手动位置的右上角锚点。

3. `WebviewView.tsx`
   - 把 `EditorPosition` 放入现有本地 `EditorSession`，切换目标时沿用，关闭事务时自然释放。
   - `EditorSize` 不进入共享 store 或批注 wire；只在缩放提交点写入防御性校验的 profile 本地偏好。
   - 不新增 store action，不改变批注 wire 数据。

4. 键盘与层级选择
   - 元素树为指针选择器，不建立 treeitem 键盘焦点，也不显示 `focus-visible` 高亮。
   - 父级、子级、上一个、下一个快捷键由浮窗画布统一捕获；可编辑输入仍保留原生文本键盘行为。
   - iframe 页面控件在拾取时释放焦点，避免其原生按键动作和焦点环干扰层级快捷键。

5. 浮层分离
   - 使用稳定的三层投影增强浅色页面上的边界辨识度。
   - 不使用 `clip-path` 裁卡片，因为它会同时裁掉外部阴影；内容继续由 `overflow: hidden` 与 18px 圆角裁切。
6. `AnnotationEditor.module.css` / `locales.ts`
   - 增加把手、缩放命中区、拖动态与投影样式，并移除编辑器键盘焦点高亮。
   - 增加中文产品文案和对应英文 locale；代码注释继续使用英文。

## 边界规则

- 安全边距沿用现有浮窗定位的 8px；任一时刻 `left >= 8`、`top >= 8`，且右边与底边不越界。
- 当浮窗比可用画布更大时，优先保证完整顶栏可见，并允许现有检查器滚动区域继续缩高；不能通过拖动把关闭/隐藏/移动控件送出画布。
- 拖动浮窗时不改变选中元素、临时样式、评论草稿和编辑器滚动位置。
- 属性数值拖调优先于浮窗拖动；两个 pointer capture 生命周期互不共享状态。
- `prefers-reduced-motion` 下不增加吸附、回弹或惯性；普通模式也不使用惯性，以免浮窗越过用户预期落点。

## 验证计划

- `floating-position.spec.ts`：手动位置四边钳制、编辑器尺寸变化、窄画布和超高编辑器。
- `annotation-editor.spec.tsx`：展开态才显示把手和八个缩放区；3px 阈值；pointer capture；拖动/缩放提交；cancel/lost capture 回滚；隐藏后按手动几何恢复。
- `panel.spec.tsx`：切换目标、选择/调整模式和临时隐藏时保留位置；确认、取消和换页重置；共享批注状态无变化。
- `webview.e2e.spec.ts`：在真实预览中拖至不同位置、从角落缩放、验证最小值与边界，且属性控件仍可拖调。
- 实现后运行 `pnpm check` 与 `pnpm test:e2e`，再启动真实 DSH 预览做手动验收。

## 原型

- `docs/draggable-annotation-editor-prototype.svg`
