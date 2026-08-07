/**
 * `webview` namespace dictionaries. The annotation message template lives in
 * format.ts and reads these strings — product copy is pinned here, never
 * restated in components.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.tab': '预览',
  'dock.label': '注释',
  'panel.urlPlaceholder': '输入网址，回车打开（如 http://localhost:5173）',
  'panel.refresh': '刷新',
  'panel.external': '在新标签页打开',
  'panel.pick': '选择元素',
  'panel.pick.off': '退出选择',
  'panel.pick.hint': '在页面中点击要修改的元素，输入注释后回车加入列表；Esc 退出。',
  'panel.pick.remove': '移除该元素',
  'panel.comment.float': '注释，回车确认…',
  'panel.noUrl': '请输入网址',
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
  'view.tab': 'Preview',
  'dock.label': 'Comments',
  'panel.urlPlaceholder': 'Enter a URL and press Enter (e.g. http://localhost:5173)',
  'panel.refresh': 'Refresh',
  'panel.external': 'Open in new tab',
  'panel.pick': 'Pick element',
  'panel.pick.off': 'Stop picking',
  'panel.pick.hint': 'Click an element in the page, type a comment and press Enter; Esc exits.',
  'panel.pick.remove': 'Remove element',
  'panel.comment.float': 'Comment, Enter to confirm…',
  'panel.noUrl': 'Enter a URL first',
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
