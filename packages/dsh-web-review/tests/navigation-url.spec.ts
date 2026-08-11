import { describe, expect, it } from 'vitest'
import { normalizePreviewUrl } from '../src/client/navigation-url.ts'

describe('normalizePreviewUrl', () => {
  it.each([
    ['localhost:5173', 'http://localhost:5173/'],
    ['//localhost:5173/docs', 'http://localhost:5173/docs'],
    ['https://app.localhost/docs?q=1', 'https://app.localhost/docs?q=1'],
    ['127.0.0.1:3000/app', 'http://127.0.0.1:3000/app'],
    ['0.0.0.0:8080', 'http://0.0.0.0:8080/'],
    ['[::1]:4173', 'http://[::1]:4173/'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePreviewUrl(input)).toBe(expected)
  })

  it.each([
    '', '   ', 'example.com', 'https://example.com', '192.168.1.10:5173',
    'ftp://localhost', 'mailto:user@example.com', 'not a host',
  ])('rejects %s', (input) => {
    expect(normalizePreviewUrl(input)).toBeUndefined()
  })
})
