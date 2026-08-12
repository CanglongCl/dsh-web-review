/** Cross-face URL codec for path-encoded isolated-preview routes. */

/** Path-encode a target URL: everything percent-encoded except `/`. */
export function encodeTarget(url: string): string {
  return encodeURIComponent(url).replace(/%2F/g, '/')
}

/** Reverse of {@link encodeTarget}. Throws on malformed percent sequences. */
export function decodeTarget(encoded: string): string {
  return decodeURIComponent(encoded)
}

/** Build a path-encoded route with exactly one prefix separator. */
export function proxyUrl(target: string, prefix: string): string {
  return `${prefix.endsWith('/') ? prefix : `${prefix}/`}${encodeTarget(target)}`
}

/** True when the value parses as an absolute http(s) URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Absolute HTTP(S) page URL accepted by the isolated preview transport. */
export function isPreviewableUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.username === ''
      && url.password === ''
  } catch {
    return false
  }
}
