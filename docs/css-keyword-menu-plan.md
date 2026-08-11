# CSS 数值 / 关键字复合输入方案

## 目标

为既接受数值又接受 CSS 关键字的属性增加右侧下三角。用户仍可直接输入 `320px`、`50%`、`var(...)` 等任意有效值，也可以从紧凑下拉菜单选择 `auto`、`normal`、`none` 等常用关键字。

本次只增强现有属性编辑器的输入方式，不改变可编辑属性白名单、临时预览、回滚、批注快照、共享 store 或模型上下文格式。已经是纯枚举的 `display`、`position`、`overflow` 等控件继续使用现有 `OptionMenu`；纯数值属性不显示下三角。

## 控件交互

复合控件保持现有 126px 宽度，并分成三个区域：

1. 左侧 30px 拖动柄保持现有数值 scrub 行为。
2. 中间是可编辑文本输入，保留单位、CSS 函数、自定义属性引用和 Escape 回滚。
3. 右侧新增独立的下三角按钮；只有配置了关键字建议的数值控件才渲染。

点击下三角后，通过 DSH `Menu` 在宿主 `document.body` 中打开紧凑菜单并靠右对齐。选择关键字调用现有 `onChange`，因此继续走相同的 CSS 有效性检查、iframe 实时预览、changed 状态和逐项重置链路。当前值命中建议项时显示选择标记；当前值是数值或不在建议项中时不额外插入一条“当前值”菜单项。

键盘与焦点规则：

- 输入框的 ArrowUp / ArrowDown、Shift ×10、Alt ×0.1 和 Escape 行为不变。
- 下三角是可聚焦按钮，带 `aria-haspopup="menu"`、`aria-expanded` 和本地化名称。
- Escape、点外部或选择后关闭菜单；选择后焦点回到下三角。
- 关键字值仍可通过现有 fallback 开始拖动；第一次数值调整会把它转换成带单位的数值，不静默改写未操作的值。
- 菜单打开期间的 Escape 只关闭菜单，不取消整个批注事务。

## 关键字清单

清单覆盖当前 allowlist 中所有“数值控件 + 常用非数值 CSS 值”的属性。通用级联关键字 `inherit`、`initial`、`unset`、`revert`、`revert-layer` 不进入每个菜单；`calc(...)`、`clamp(...)`、`var(...)`、`fit-content(...)` 等参数化值继续通过输入框填写。

| 属性 | 下拉建议 |
| --- | --- |
| `font-size` | `xx-small`, `x-small`, `small`, `medium`, `large`, `x-large`, `xx-large`, `xxx-large`, `smaller`, `larger` |
| `line-height` | `normal` |
| `letter-spacing` | `normal` |
| `width`, `height` | `auto`, `min-content`, `max-content`, `fit-content` |
| `min-width`, `min-height` | `auto`, `min-content`, `max-content`, `fit-content` |
| `max-width`, `max-height` | `none`, `min-content`, `max-content`, `fit-content` |
| `top`, `right`, `bottom`, `left` | `auto` |
| `z-index` | `auto` |
| `gap`, `row-gap`, `column-gap` | `normal` |
| `margin-top`, `margin-right`, `margin-bottom`, `margin-left` | `auto` |
| `border-width` | `thin`, `medium`, `thick` |

以下数值控件不增加下拉：`opacity`、四边 `padding`、`border-radius`，以及阴影 / transform 复合控件内部的数值分量。它们在当前编辑模型中没有需要快捷选择的常用非数值值。纯枚举控件已经有下三角，无需迁移到复合输入。

关键字范围以 CSSWG 的 [CSS Sizing](https://drafts.csswg.org/css-sizing-3/)、[CSS Positioned Layout](https://drafts.csswg.org/css-position/)、[CSS Box Model](https://drafts.csswg.org/css-box-4/)、[CSS Box Alignment](https://drafts.csswg.org/css-align/)、[CSS Fonts](https://drafts.csswg.org/css-fonts/) 和 [CSS Backgrounds and Borders](https://drafts.csswg.org/css-backgrounds/) 语法为基线；菜单只提供稳定、常用且无参数的快捷项，输入框仍是完整 CSS 值的兜底入口。

## 需要改造的文件

### 产品代码

1. `src/client/property-editor-config.ts`
   - 让 `number(...)` 元数据接收关键字建议，并按上表配置所有复合属性。
   - 保持 `menu` 的有限枚举与 `number` 的关键字建议语义可区分，避免把纯枚举控件误渲染成文本输入。
   - 为尺寸、间距等复合控件提供同一份配置来源，禁止在组件内重复硬编码关键字。

2. `src/client/InspectorControls.tsx`
   - 扩展 `ScrubNumber`：新增可选建议项和本地化菜单按钮名称。
   - 在数值输入右侧增加 DSH `Menu` 触发按钮，处理 open、selectedId、关闭、焦点返回和 Escape 隔离。
   - 扩展 `BoxModelControl`，把 margin 的 `auto` 建议传到四个边输入；padding 不传建议。
   - 保留 `parseNumeric`、scrub fallback、invalid 和 focus-entry Escape 回滚逻辑。

3. `src/client/CompositeControls.tsx`
   - 让内部 `Cell` 与 `SizeControl` 透传关键字建议，使 W/H 两个输入都显示同一类尺寸关键字。
   - Radius、Shadow、Transform 的内部数值分量保持不变。

4. `src/client/AnnotationEditor.tsx`
   - `renderControl` 将数值属性元数据中的建议项传给 `ScrubNumber`。
   - Size、margin 等组合行从 property registry 读取建议并传给组合控件。
   - 选择关键字仍统一调用 `updateProperty`，不新增第二套预览或校验状态。

5. `src/client/InspectorControls.module.css`
   - 为右侧下三角预留 22–24px，调整输入框右 padding，同时保留左侧 30px scrub 区。
   - 增加触发按钮 hover、focus-visible、open 和 disabled 样式，全部使用现有 DSH token。
   - 覆盖普通行、窄容器、Size 双字段和 BoxModel 双轴布局，确保 320px 宽度下不溢出。

6. `src/client/locales.ts`
   - 增加“选择预设值”的中英文无障碍文案；可见菜单项继续使用 CSS 原值，不翻译关键字。

### 测试与视觉验证

7. `tests/property-editor-config.spec.ts`
   - 固定完整属性 → 关键字映射。
   - 断言纯数值属性没有建议、纯菜单属性仍保持原 kind。

8. `tests/inspector-controls.spec.tsx`
   - 覆盖有 / 无建议时的下三角渲染。
   - 覆盖数值当前值打开菜单、关键字选择、selected 状态、点选 / Escape 关闭和焦点返回。
   - 覆盖菜单 Escape 不冒泡到外层编辑器，以及关键字值继续通过 fallback scrub 转成数值。
   - 覆盖 BoxModel 四边的 `auto` 选择仍服从现有轴向 / 全部联动规则。

9. `tests/composite-controls.spec.tsx`
   - 覆盖 SizeControl 的 W/H 两个建议菜单和宽高联动后的值更新。

10. `tests/annotation-editor.spec.tsx`
    - 在真实 iframe 元素上选择 `width: auto`、`max-width: none` 或 `line-height: normal`，断言实时样式、changed / reset、Confirm diff 和 Cancel 精确回滚。
    - 断言纯数值属性没有下三角，纯枚举 `display` 仍是原有菜单。

11. `tests/webview.e2e.spec.ts` 与 `tests/visual-shot.ts`
    - E2E 打开真实属性编辑器，从右侧菜单选择一个关键字，确认页面预览和最终结构化变更一致。
    - 增加菜单打开态的宽屏与窄屏截图，验证 portal 菜单不被 editor overflow 裁切且不逃出视口。

### 文档

12. `docs/figma-property-editor-plan.md`、根 `README.md` 与 package README
    - 将原来“semantic presets”的设计意图更新为已经落地的复合输入行为，并说明手输 CSS 值始终保留。
    - 不修改 wire、模型上下文或已知限制文档，因为这些契约没有变化。

## 明确不改造的部分

- `annotation-properties.ts`：属性白名单不变。
- `live-patch.ts`：关键字与数值都继续作为字符串走现有预览 / 回滚账本。
- `stores.ts`、annotation contract、node route、context formatter：不增加状态或字段。
- iframe picker、元素层级选择、浮层定位：不参与本功能。
- Harness slot、store seat 和注入关系：不变；本次是宿主组件内的本地展示状态。

## 验收标准

- 只有支持建议关键字的数值型 CSS 控件显示右侧下三角。
- 用户可以在同一控件中自由切换手输数值 / CSS 文本与下拉关键字，原始字符串不被无操作归一化。
- 下拉选择立即预览、可逐项 reset、可 Cancel 精确回滚，并只在 Confirm 后进入现有结构化 diff。
- 纯枚举、纯数值和复合特效控件没有视觉或行为回归。
- 键盘、焦点、窄屏与 portaled menu 均可用；菜单 Escape 不会误取消批注。
- 实现后通过 `pnpm check` 与 `pnpm test:e2e`，并完成真实 DSH Preview 手工验收。

## 原型

- `docs/css-keyword-menu-prototype.svg`
