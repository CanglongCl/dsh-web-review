/**
 * Media-run cursor HUD: a DOM cursor plus a click ripple injected into the
 * page so the recorded GIF shows the pointer and click feedback. Playwright
 * video recording never renders the real OS cursor, so the drive updates this
 * overlay from its own viewport coordinates — including over the cross-Origin
 * Preview iframe, which a page-event-following cursor could not cover.
 *
 * The cursor is signal red so it reads clearly on the demo page and in the
 * DSH chrome, and it is only installed for GIF runs: screenshot-only runs use
 * the no-op implementation so the product shots stay clean.
 */
import type { Page } from 'playwright'

export interface CursorHud {
  /** Move the overlay cursor to viewport coordinates. */
  move: (x: number, y: number) => Promise<void>
  /** Press the cursor and spawn the click ripple at viewport coordinates. */
  down: (x: number, y: number) => Promise<void>
  /** Release the pressed cursor state. */
  up: () => Promise<void>
  /** Show or hide the overlay (screenshots must not include it). */
  setVisible: (visible: boolean) => Promise<void>
}

/** Cursor HUD for runs that do not record a GIF. */
export function noopCursorHud(): CursorHud {
  return {
    move: async () => {},
    down: async () => {},
    up: async () => {},
    setVisible: async () => {},
  }
}

/** Inject the HUD DOM into the page's current document (survives until the next navigation). */
export async function installCursorHudDom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = [
      '#media-cursor { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none; }',
      '#media-cursor svg { position: absolute; left: 0; top: 0; filter: drop-shadow(0 1.5px 2px rgba(0, 0, 0, 0.45)); transition: transform 90ms ease; }',
      '#media-cursor.media-press svg { transform: scale(0.78); }',
      '.media-ripple { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 3px solid rgba(255, 59, 48, 0.95); background: rgba(255, 59, 48, 0.24); z-index: 2147483646; pointer-events: none; animation: media-ripple 600ms ease-out forwards; }',
      '@keyframes media-ripple { 0% { transform: scale(0.4); opacity: 1; } 100% { transform: scale(9); opacity: 0; } }',
    ].join('\n')
    document.head.appendChild(style)
    const cursor = document.createElement('div')
    cursor.id = 'media-cursor'
    cursor.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l7.4 17.4 2.2-7.2 7.2-2.2z" fill="#FF3B30" stroke="#ffffff" stroke-width="1.7" stroke-linejoin="round"/></svg>'
    cursor.style.transform = 'translate(-100px, -100px)'
    document.documentElement.appendChild(cursor)
  })
}

/**
 * HUD controls bound to a page. They look the overlay up on every call, so the
 * controller survives navigations — re-run {@link installCursorHudDom} after
 * each `goto` to keep the overlay present.
 */
export function cursorHudControls(page: Page): CursorHud {
  return {
    move: async (x, y) => {
      await page.evaluate((pos: { x: number; y: number }) => {
        const cursor = document.getElementById('media-cursor')
        if (cursor !== null) cursor.style.transform = 'translate(' + pos.x + 'px, ' + pos.y + 'px)'
      }, { x, y })
    },
    down: async (x, y) => {
      await page.evaluate((pos: { x: number; y: number }) => {
        const cursor = document.getElementById('media-cursor')
        if (cursor !== null) {
          cursor.style.transform = 'translate(' + pos.x + 'px, ' + pos.y + 'px)'
          cursor.classList.add('media-press')
        }
        const ripple = document.createElement('div')
        ripple.className = 'media-ripple'
        ripple.style.left = pos.x + 'px'
        ripple.style.top = pos.y + 'px'
        document.documentElement.appendChild(ripple)
        window.setTimeout(() => { ripple.remove() }, 700)
      }, { x, y })
    },
    up: async () => {
      await page.evaluate(() => {
        document.getElementById('media-cursor')?.classList.remove('media-press')
      })
    },
    setVisible: async visible => {
      await page.evaluate((show: boolean) => {
        const cursor = document.getElementById('media-cursor')
        if (cursor !== null) cursor.style.display = show ? '' : 'none'
      }, visible)
    },
  }
}

/** Inject the HUD into the page's current document and return its controls. */
export async function installCursorHud(page: Page): Promise<CursorHud> {
  await installCursorHudDom(page)
  return cursorHudControls(page)
}
