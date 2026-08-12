import { isPreviewableUrl } from '../proxy-url.ts'

/** Normalize an address-bar value into an absolute HTTP(S) preview URL. */
export function normalizePreviewUrl(value: string): string | undefined {
  const input = value.trim()
  if (input === '') return undefined

  let candidate: string
  if (/^https?:\/\//i.test(input)) {
    candidate = input
  } else if (/^\/\//.test(input)) {
    candidate = `http:${input}`
  } else {
    // Reject explicit non-HTTP schemes instead of turning e.g. `ftp://...`
    // into a misleading hostname. Scheme-less addresses use HTTP; explicit
    // HTTPS remains available for public and local pages.
    if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^[^/:]+:\d+(?:[/?#]|$)/.test(input)) {
      return undefined
    }
    candidate = `http://${input}`
  }

  try {
    const url = new URL(candidate)
    return isPreviewableUrl(url.href) ? url.href : undefined
  } catch {
    return undefined
  }
}
