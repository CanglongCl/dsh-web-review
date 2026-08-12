/** Small DOM equivalents for browser-only UI primitives in npm-only tests. */
import {
  cloneElement,
  forwardRef,
  type InputHTMLAttributes,
  type ReactElement,
  type SVGProps,
} from 'react'

export interface MenuEntry {
  id: string
  label: string
  disabled?: boolean
}

export function Menu({ open, anchor, items, selectedId, onSelect }: {
  open: boolean
  anchor: ReactElement
  items: readonly MenuEntry[]
  selectedId?: string
  onSelect: (id: string) => void
  onClose: () => void
  compact?: boolean
  portal?: boolean
  align?: string
}) {
  return (
    <>
      {cloneElement(anchor)}
      {open && (
        <div role="menu">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={item.id === selectedId ? 'selected' : ''}
              disabled={item.disabled}
              onClick={() => { onSelect(item.id) }}
            >{item.label}</button>
          ))}
        </div>
      )}
    </>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TestInput(properties, ref) {
    return <input ref={ref} {...properties} />
  },
)

type IconProperties = SVGProps<SVGSVGElement> & { size?: number }
function icon(name: string) {
  return function TestIcon({ size = 16, ...properties }: IconProperties) {
    return <svg aria-hidden="true" data-test-icon={name} width={size} height={size} {...properties} />
  }
}

export const IconCheckOutline16 = icon('check')
export const IconChevronDownOutline14 = icon('chevron-down')
export const IconChevronLeftOutline14 = icon('chevron-left')
export const IconChevronRightOutline14 = icon('chevron-right')
export const IconCloseOutline16 = icon('close')
export const IconLinkOutline14 = icon('link')
export const IconLoadingOutline16 = icon('loading')
export const IconNewChatOutline16 = icon('new-chat')
export const IconQueueOutline14 = icon('queue')
export const IconRefreshOutline14 = icon('refresh')
export const IconRefreshOutline16 = icon('refresh')
export const IconRightUpOutline16 = icon('right-up')
export const IconSendOutline16 = icon('send')
export const IconTrashOutline16 = icon('trash')
export const IconWarningOutline16 = icon('warning')
