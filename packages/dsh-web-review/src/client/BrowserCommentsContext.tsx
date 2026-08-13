import { useState } from 'react'
import { DisclosureRow, IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserCommentsContextSource, BrowserCommentsPresentationComment } from '../browser-comments-context.ts'
import css from './BrowserCommentsContext.module.css'

/** Specialized Context-chain props after the source selector accepts the node. */
export type BrowserCommentsContextProps =
  & PropsRuntime<'conversation.chat.contextview'>
  & PropsLocale<'webview'>
  & { readonly matched: BrowserCommentsContextSource }

function pageLabel(source: BrowserCommentsContextSource): string {
  const title = source.presentation.page.title.trim()
  if (title !== '') return title
  const url = new URL(source.presentation.page.url)
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
}

function targetContent(comment: BrowserCommentsPresentationComment): string {
  return comment.label.trim() || comment.textContent.trim() || comment.role.trim()
}

function sourceLabel(comment: BrowserCommentsPresentationComment): string | undefined {
  if (comment.anchor === null) return undefined
  const location = comment.anchor.line === undefined
    ? comment.anchor.file
    : `${comment.anchor.file}:${comment.anchor.line}`
  return comment.anchor.component.trim() === '' ? location : `${comment.anchor.component} · ${location}`
}

/** Native DSH disclosure for one durable Browser Comments snapshot. */
export function BrowserCommentsContext({ matched, t }: BrowserCommentsContextProps) {
  const [open, setOpen] = useState(false)
  const { page, comments } = matched.presentation
  const styleCount = comments.reduce((total, comment) => total + comment.changes.length, 0)
  const textCount = comments.reduce((total, comment) => total + (comment.textChange === null ? 0 : 1), 0)
  const label = pageLabel(matched)

  return (
    <DisclosureRow
      className={css.root}
      icon={<IconBrowseOutline16 size={14} />}
      chevronClassName={css.chevron}
      title={t('context.title')}
      collapsedContent={(
        <>
          <span className={css.sep} aria-hidden />
          <span className={css.pageName}>{label}</span>
          <span className={css.sep} aria-hidden />
          <span className={css.count}>{t('context.commentCount', { count: comments.length })}</span>
        </>
      )}
      keepContentWhenOpen
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
    >
      <section className={css.body} data-browser-comments-context>
        <header className={css.pageHeader}>
          <div className={css.pageIdentity}>
            <strong className={css.pageTitle}>{label}</strong>
            <span className={css.pageUrl}>{page.url}</span>
          </div>
          {(styleCount > 0 || textCount > 0) && (
            <div className={css.metrics} aria-label={t('context.changeSummary')}>
              {styleCount > 0 && <span>{t('context.styleCount', { count: styleCount })}</span>}
              {textCount > 0 && <span>{t('context.textCount', { count: textCount })}</span>}
            </div>
          )}
        </header>

        <ol className={css.comments}>
          {comments.map((comment, index) => {
            const source = sourceLabel(comment)
            const content = targetContent(comment)
            const tag = comment.tagName.toLowerCase()
            return (
              <li className={css.comment} key={comment.id}>
                <span className={css.index} aria-hidden>{index + 1}</span>
                <div className={css.commentBody}>
                  <div className={css.targetRow} aria-label={content === '' ? tag : `${tag} ${content}`}>
                    <code className={css.targetTag} data-browser-comment-tag>&lt;{tag}&gt;</code>
                    {content !== '' && <strong className={css.targetContent} data-browser-comment-content>{content}</strong>}
                    {source !== undefined && <span className={css.source}>{source}</span>}
                  </div>
                  {comment.comment.trim() !== '' && (
                    <div className={css.intent}>
                      <span className={css.intentSource}>{t('context.userInput')}</span>
                      <p className={css.intentText}>{comment.comment}</p>
                    </div>
                  )}
                  {(comment.changes.length > 0 || comment.textChange !== null) && (
                    <div className={css.diffs}>
                      {comment.changes.map(change => (
                        <div className={css.diff} key={change.property}>
                          <code className={css.property}>{change.property}</code>
                          <span className={css.before}>{change.before}</span>
                          <span className={css.arrow} aria-hidden>→</span>
                          <span className={css.after}>{change.after}</span>
                        </div>
                      ))}
                      {comment.textChange !== null && (
                        <div className={css.diff}>
                          <span className={css.property}>{t('context.text')}</span>
                          <span className={css.before}>{comment.textChange.before}</span>
                          <span className={css.arrow} aria-hidden>→</span>
                          <span className={css.after}>{comment.textChange.after}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </section>
    </DisclosureRow>
  )
}
