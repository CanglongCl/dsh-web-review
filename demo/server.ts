/**
 * Demo static server for end-to-end verification: serves ./demo on
 * http://localhost:5173 with an SPA-fallback (any path returns index.html),
 * so the proxied page behaves like a dev server.
 *
 * Usage: tsx demo/server.ts [port=5173]
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const port = Number(process.argv[2] ?? process.env.DEMO_PORT ?? 5173)

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const file = join(root, 'demo', pathname === '/' ? 'index.html' : pathname.slice(1))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    // SPA fallback: unknown paths serve the entry document.
    const body = await readFile(join(root, 'demo', 'index.html'))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(body)
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`demo server: http://localhost:${port}/`)
})
