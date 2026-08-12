import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { UI_SKILLS, type UiSkillName } from '../ui-skills.ts'
import type { WebviewKey } from './locales.ts'
import css from './UiSkillSelector.module.css'

const DESCRIPTION_KEYS: Record<UiSkillName, WebviewKey> = {
  'better-ui': 'editor.skills.betterUi',
  'better-typography': 'editor.skills.betterTypography',
  'better-layout': 'editor.skills.betterLayout',
  'better-writing': 'editor.skills.betterWriting',
  'better-accessibility': 'editor.skills.betterAccessibility',
  'better-colors': 'editor.skills.betterColors',
  'better-interface': 'editor.skills.betterInterface',
  'interface-review': 'editor.skills.interfaceReview',
}

/** Compact, annotation-batch Skill disclosure rendered first in Adjust mode. */
export function UiSkillSelector({ selected, t, onToggle }: {
  selected: readonly UiSkillName[]
  t: Translate<WebviewKey>
  onToggle: (name: UiSkillName) => void
}) {
  const [sectionOpen, setSectionOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [placement, setPlacement] = useState<CSSProperties | null>(null)
  const bodyId = useId()
  const listId = useId()
  const rootRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const selectedSet = new Set(selected)

  useEffect(() => {
    if (!menuOpen) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  useLayoutEffect(() => {
    if (!menuOpen) {
      setPlacement(null)
      return
    }
    const place = () => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (trigger === null || panel === null) return
      const anchor = trigger.getBoundingClientRect()
      const margin = 12
      const gap = 4
      const width = Math.min(anchor.width, 360)
      panel.style.width = `${width}px`
      const height = panel.offsetHeight
      const left = Math.min(Math.max(anchor.left, margin), window.innerWidth - width - margin)
      const below = anchor.bottom + gap
      const top = below + height <= window.innerHeight - margin
        ? below
        : Math.max(margin, anchor.top - height - gap)
      setPlacement({ left, top, width })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [menuOpen])

  return (
    <section ref={rootRef} className={css.root} data-webview-ui-skills="">
      <button
        type="button"
        className={css.trigger}
        aria-expanded={sectionOpen}
        aria-controls={bodyId}
        onClick={() => {
          setSectionOpen(value => {
            if (value) setMenuOpen(false)
            return !value
          })
        }}
      >
        <span className={css.title}>{t('editor.skills.title')}</span>
        <IconChevronDownOutline14 className={sectionOpen ? css.chevronOpen : css.chevron} />
      </button>
      {sectionOpen && (
        <div id={bodyId} className={css.sectionBody}>
          <button
            ref={triggerRef}
            type="button"
            className={css.field}
            aria-label={t('editor.skills.field')}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls={listId}
            onClick={() => { setMenuOpen(value => !value) }}
          >
            <span className={css.fieldValue}>
              {selected.length === 0 ? t('editor.skills.field') : selected.join(', ')}
            </span>
            <span className={css.count}>{t('editor.skills.count', { count: String(selected.length) })}</span>
            <IconChevronDownOutline14 className={menuOpen ? css.fieldChevronOpen : css.fieldChevron} />
          </button>
          <p className={css.command}>{t('editor.skills.command')}</p>
        </div>
      )}
      {menuOpen && createPortal((
        <div
          ref={panelRef}
          id={listId}
          className={css.panel}
          role="dialog"
          aria-label={t('editor.skills.title')}
          data-webview-ui-skill-popover=""
          style={placement ?? { visibility: 'hidden', left: 0, top: 0 }}
        >
          <div className={css.list}>
            {UI_SKILLS.map(skill => (
              <label key={skill.name} className={css.option}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(skill.name)}
                  onChange={() => { onToggle(skill.name) }}
                />
                <span className={css.optionText}>
                  <span className={css.optionName}>{skill.name}</span>
                  <span className={css.optionDescription}>{t(DESCRIPTION_KEYS[skill.name])}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ), document.body)}
    </section>
  )
}
