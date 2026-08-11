import { isLocalPreviewUrl } from '../proxy-url.ts'

/** Normalize an address-bar value into an absolute local-development URL. */
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
    // into a misleading local hostname. Scheme-less development hosts use
    // HTTP; explicit HTTPS remains supported for local TLS servers.
    if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^[^/:]+:\d+(?:[/?#]|$)/.test(input)) {
      return undefined
    }
    candidate = `http://${input}`
  }

  try {
    const url = new URL(candidate)
    return isLocalPreviewUrl(url.href) ? url.href : undefined
  } catch {
    return undefined
  }
}
