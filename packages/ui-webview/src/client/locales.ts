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
  'panel.pick': '选择元素',
  'panel.pick.off': '退出选择',
  'panel.pick.hint': '在页面中点击要修改的元素，输入注释后回车加入列表；Esc 退出。',
  'panel.send': '加入对话并发送',
  'panel.send.progress': '正在发送…',
  'panel.picks.empty': '尚未添加注释——点击「选择元素」，在页面中点击元素并输入注释。',
  'panel.picks.title': '注释',
  'panel.pick.remove': '移除该元素',
  'panel.comment.placeholder': '写下对该元素的修改需求，例如：按钮颜色太暗，间距不够…',
  'panel.comment.float': '注释，回车确认…',
  'panel.navFailed': '页面加载失败：{message}',
  'panel.noUrl': '请输入网址',
  'panel.error.send': '发送失败：{message}',
  'annotation.open': '<annotation hint="{hint}">',
  'annotation.hint': 'Annotations below were marked by the user in the right-side preview panel; each comment is the user\'s input — apply the requested changes to the corresponding elements',
  'annotation.page': '  <page url="{url}" title="{title}"/>',
  'annotation.pageWithQuery': '  <page url="{url}" query="{query}" title="{title}"/>',
  'annotation.element.anchor': '  <element index="{index}" text="{text}" source="{source}" component="{component}">',
  'annotation.element.open': '  <element index="{index}" text="{text}" classes="{classes}" path="{path}">',
  'annotation.element.close': '  </element>',
  'annotation.comment': '    <comment><![CDATA[{comment}]]></comment>',
  'annotation.close': '</annotation>',
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
  'panel.pick': 'Pick element',
  'panel.pick.off': 'Stop picking',
  'panel.pick.hint': 'Click an element in the page, type a comment and press Enter; Esc exits.',
  'panel.send': 'Add to chat and send',
  'panel.send.progress': 'Sending…',
  'panel.picks.empty': 'No comments yet — click "Pick element", then click an element and type a comment.',
  'panel.picks.title': 'Comments',
  'panel.pick.remove': 'Remove element',
  'panel.comment.placeholder': 'Describe the change, e.g. button color too dark, spacing too tight…',
  'panel.comment.float': 'Comment, Enter to confirm…',
  'panel.navFailed': 'Page failed to load: {message}',
  'panel.noUrl': 'Enter a URL first',
  'panel.error.send': 'Send failed: {message}',
  'annotation.open': '<annotation hint="{hint}">',
  'annotation.hint': 'Annotations below were marked by the user in the right-side preview panel; each comment is the user\'s input — apply the requested changes to the corresponding elements',
  'annotation.page': '  <page url="{url}" title="{title}"/>',
  'annotation.pageWithQuery': '  <page url="{url}" query="{query}" title="{title}"/>',
  'annotation.element.anchor': '  <element index="{index}" text="{text}" source="{source}" component="{component}">',
  'annotation.element.open': '  <element index="{index}" text="{text}" classes="{classes}" path="{path}">',
  'annotation.element.close': '  </element>',
  'annotation.comment': '    <comment><![CDATA[{comment}]]></comment>',
  'annotation.close': '</annotation>',
}

/** The `webview` namespace key union (zh is the key-set source of truth). */
export type WebviewKey = keyof typeof zh
