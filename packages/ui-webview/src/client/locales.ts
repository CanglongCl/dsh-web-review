/**
 * `webview` namespace dictionaries. These strings are UI-only; the stable
 * English model-facing context is node-owned in annotation-context.ts.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.tab': '预览',
  'dock.count': '{count} 条注释',
  'dock.details': '注释上下文',
  'dock.focus': '定位第 {index} 条注释：{target}',
  'dock.clear': '清除所有注释',
  'dock.noComment': '未填写注释',
  'dock.syncing': '正在同步',
  'dock.synced': '已同步',
  'dock.sync.failed': '同步失败',
  'dock.sync.error': '注释上下文同步失败，请重试',
  'dock.sync.retry': '同步失败，点击重试',
  'dock.clearing': '正在清除注释',
  'panel.urlPlaceholder': '输入网址，回车打开（如 http://localhost:5173）',
  'panel.refresh': '刷新',
  'panel.external': '在新标签页打开',
  'panel.pick': '选择元素',
  'panel.pick.off': '退出选择',
  'panel.pick.hint': '在页面中点击要修改的元素，输入注释后回车加入列表；Esc 退出。',
  'panel.pick.remove': '移除该元素',
  'panel.pick.limit': '每个页面最多保留 {count} 条注释',
  'panel.comment.float': '注释，回车确认…',
  'panel.noUrl': '请输入网址',
  'panel.frame': '网页预览',
} as const

/** English dictionary (same keys as {@link zh}). */
export const en: Record<WebviewKey, string> = {
  'view.tab': 'Preview',
  'dock.count': '{count} comments',
  'dock.details': 'Comment context',
  'dock.focus': 'Locate comment {index}: {target}',
  'dock.clear': 'Clear all comments',
  'dock.noComment': 'No comment supplied',
  'dock.syncing': 'Syncing',
  'dock.synced': 'Synced',
  'dock.sync.failed': 'Sync failed',
  'dock.sync.error': 'Could not sync browser comments. Try again.',
  'dock.sync.retry': 'Sync failed; click to retry',
  'dock.clearing': 'Clearing comments',
  'panel.urlPlaceholder': 'Enter a URL and press Enter (e.g. http://localhost:5173)',
  'panel.refresh': 'Refresh',
  'panel.external': 'Open in new tab',
  'panel.pick': 'Pick element',
  'panel.pick.off': 'Stop picking',
  'panel.pick.hint': 'Click an element in the page, type a comment and press Enter; Esc exits.',
  'panel.pick.remove': 'Remove element',
  'panel.pick.limit': 'Keep at most {count} comments per page',
  'panel.comment.float': 'Comment, Enter to confirm…',
  'panel.noUrl': 'Enter a URL first',
  'panel.frame': 'Web preview',
}

/** The `webview` namespace key union (zh is the key-set source of truth). */
export type WebviewKey = keyof typeof zh
