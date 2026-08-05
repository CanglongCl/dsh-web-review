/**
 * `webview` namespace dictionaries. The annotation message template lives in
 * format.ts and reads these strings — product copy is pinned here, never
 * restated in components.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'header.action': '网页预览',
  'panel.title': '网页预览',
  'panel.close': '关闭面板',
  'panel.urlPlaceholder': '输入网址，回车打开（如 http://localhost:5173）',
  'panel.open': '打开',
  'panel.refresh': '刷新',
  'panel.external': '在新标签页打开',
  'panel.mode.proxy': '代理模式',
  'panel.mode.direct': '直接打开',
  'panel.mode.group': '打开方式',
  'panel.pick': '选择元素',
  'panel.pick.off': '退出选择',
  'panel.pick.hint': '在页面中悬停高亮元素，点击选中；Esc 退出。',
  'panel.pick.unavailable': '直接打开模式下无法选择元素（跨域限制），只能整页评论。',
  'panel.send': '加入对话并发送',
  'panel.send.progress': '正在发送…',
  'panel.picks.empty': '尚未选择元素——开启「选择元素」后在页面中点击要修改的元素。',
  'panel.picks.title': '已选元素',
  'panel.pick.remove': '移除该元素',
  'panel.comment.placeholder': '写下对该元素的修改需求，例如：按钮颜色太暗，间距不够…',
  'panel.navFailed': '页面加载失败：{message}',
  'panel.noUrl': '请输入网址',
  'panel.directHint': '当前为直接打开模式：页面跨域，无法选择元素。',
  'panel.error.send': '发送失败：{message}',
  'annotation.header': '【网页修改请求】',
  'annotation.page': '目标页面：{title}（{url}）',
  'annotation.entry.title': '{index}. 选中的元素',
  'annotation.entry.selector': 'CSS 选择器：{selector}',
  'annotation.entry.element': '元素：{tag}{id}{classes}（{width}×{height}，位于 ({x}, {y})）',
  'annotation.entry.snapshot': '元素快照：\n{html}',
  'annotation.entry.comment': '修改需求（你的评论）：{comment}',
  'annotation.entry.noComment': '修改需求：（无评论，请检查该元素是否有问题）',
  'annotation.instruction': '请根据以上选中的元素与修改需求，在当前工作区中定位并修改对应的前端源码（优先找到产生该元素的组件与样式文件）。修改完成后，请简要说明修改了哪些文件以及为什么。',
} as const

/** English dictionary (same keys as {@link zh}). */
export const en: Record<WebviewKey, string> = {
  'header.action': 'Web preview',
  'panel.title': 'Web preview',
  'panel.close': 'Close panel',
  'panel.urlPlaceholder': 'Enter a URL and press Enter (e.g. http://localhost:5173)',
  'panel.open': 'Open',
  'panel.refresh': 'Refresh',
  'panel.external': 'Open in new tab',
  'panel.mode.proxy': 'Proxy',
  'panel.mode.direct': 'Direct',
  'panel.mode.group': 'Open mode',
  'panel.pick': 'Pick element',
  'panel.pick.off': 'Stop picking',
  'panel.pick.hint': 'Hover to highlight, click to pick, Esc to exit.',
  'panel.pick.unavailable': 'Element picking is unavailable in direct mode (cross-origin); only a whole-page comment is offered.',
  'panel.send': 'Add to chat and send',
  'panel.send.progress': 'Sending…',
  'panel.picks.empty': 'No elements picked yet — turn on "Pick element" and click the element to change.',
  'panel.picks.title': 'Selected elements',
  'panel.pick.remove': 'Remove element',
  'panel.comment.placeholder': 'Describe the change, e.g. button color too dark, spacing too tight…',
  'panel.navFailed': 'Page failed to load: {message}',
  'panel.noUrl': 'Enter a URL first',
  'panel.directHint': 'Direct mode: the page is cross-origin, element picking is unavailable.',
  'panel.error.send': 'Send failed: {message}',
  'annotation.header': '[Page change request]',
  'annotation.page': 'Target page: {title} ({url})',
  'annotation.entry.title': '{index}. Selected element',
  'annotation.entry.selector': 'CSS selector: {selector}',
  'annotation.entry.element': 'Element: {tag}{id}{classes} ({width}×{height} at ({x}, {y}))',
  'annotation.entry.snapshot': 'Element snapshot:\n{html}',
  'annotation.entry.comment': 'Change request (your comment): {comment}',
  'annotation.entry.noComment': 'Change request: (no comment — please inspect this element)',
  'annotation.instruction': 'Based on the selected elements and change requests above, locate and modify the corresponding frontend source in the current workspace (prefer the component and style files that produce the elements). When done, briefly state which files you changed and why.',
}

/** The `webview` namespace key union (zh is the key-set source of truth). */
export type WebviewKey = keyof typeof zh
