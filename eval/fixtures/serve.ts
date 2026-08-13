/**
 * Zero-dependency static server for a fixture directory (baseline, golden, or
 * a graded workspace). Serves exact files with a small MIME map; no SPA
 * fallback — static fixture pages load their assets by relative path.
 *
 * Usage: tsx eval/fixtures/serve.ts <dir> [port]
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.argv[2]
const port = Number(process.argv[3] ?? 0)
if (root === undefined) {
  console.error('usage: tsx eval/fixtures/serve.ts <dir> [port]')
  process.exit(2)
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
}

const absolute = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', root)

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  const file = join(absolute, pathname === '/' ? 'index.html' : pathname.replace(/^\//u, ''))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : port
  console.log(`fixture static server: http://127.0.0.1:${bound}/ (${root})`)
})
