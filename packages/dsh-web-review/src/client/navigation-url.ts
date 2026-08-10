/** Normalize an address-bar value into an absolute preview URL. */
export function normalizePreviewUrl(value: string): string | undefined {
  const input = value.trim()
  if (input === '') return undefined

  let candidate: string
  if (/^https?:\/\//i.test(input)) {
    candidate = input
  } else if (/^\/\//.test(input)) {
    candidate = `https:${input}`
  } else {
    // Reject explicit non-HTTP schemes instead of turning e.g. `ftp://...`
    // into a misleading HTTPS hostname. Scheme-less local development hosts
    // default to HTTP; public hosts default to HTTPS.
    if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^[^/:]+:\d+(?:[/?#]|$)/.test(input)) {
      return undefined
    }
    const local = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(input)
    candidate = `${local ? 'http' : 'https'}://${input}`
  }

  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}
