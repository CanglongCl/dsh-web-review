import { describe, expect, it } from 'vitest'
import { normalizePreviewUrl } from '../src/client/navigation-url.ts'

describe('normalizePreviewUrl', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['example.com/docs?q=1', 'https://example.com/docs?q=1'],
    ['//example.com/docs', 'https://example.com/docs'],
    ['http://example.com', 'http://example.com/'],
    ['localhost:5173', 'http://localhost:5173/'],
    ['127.0.0.1:3000/app', 'http://127.0.0.1:3000/app'],
    ['[::1]:4173', 'http://[::1]:4173/'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePreviewUrl(input)).toBe(expected)
  })

  it.each(['', '   ', 'ftp://example.com', 'mailto:user@example.com', 'not a host'])('rejects %s', (input) => {
    expect(normalizePreviewUrl(input)).toBeUndefined()
  })
})
