/** Cross-face URL codec for the path-encoded preview proxy. */

/** Route prefix this package registers on the web server. */
export const PROXY_PREFIX = '/webview-proxy'

/** Path-encode a target URL: everything percent-encoded except `/`. */
export function encodeTarget(url: string): string {
  return encodeURIComponent(url).replace(/%2F/g, '/')
}

/** Reverse of {@link encodeTarget}. Throws on malformed percent sequences. */
export function decodeTarget(encoded: string): string {
  return decodeURIComponent(encoded)
}

/** Build the same-origin proxy URL for a target URL. */
export function proxyUrl(target: string, prefix = PROXY_PREFIX): string {
  return `${prefix}/${encodeTarget(target)}`
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

/**
 * True only for loopback/wildcard development hosts on this machine.
 * Deliberately excludes LAN names, public hosts and DNS-based allowlists.
 */
export function isLocalPreviewUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (url.username !== '' || url.password !== '') return false
    const hostname = url.hostname.toLowerCase()
    return hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '0.0.0.0'
      || hostname === '[::]'
      || hostname === '[::1]'
      || /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  } catch {
    return false
  }
}
