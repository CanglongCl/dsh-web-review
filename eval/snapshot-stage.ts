/**
 * Snapshot-arm staging: reproduce the production archive layout for one eval
 * run so the model reads the same files (page.html / page.png / manifest.json)
 * that the real plugin writes. Frozen page artifacts come from eval:capture;
 * directories land under the production OS temp root and are removed after
 * the run.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { frozenStem } from './tasks/frozen.ts'
import { REPO_ROOT } from './runner/runner.ts'
import type { LoadedEvalTask } from './types.ts'

/** Production archive root (pageSnapshotEnabled path). */
export const SNAPSHOT_STAGE_ROOT = join(tmpdir(), 'dsh-web-review', 'snapshots')

/** Frozen page artifacts written by eval/capture.ts beside the snapshots. */
export function frozenPagePath(taskId: string, round: number, suffix: 'page.html' | 'page.png'): string {
  return join(REPO_ROOT, 'eval', 'tasks', 'frozen', frozenStem(taskId, round) + '.' + suffix)
}

/** Read width/height from a PNG header (IHDR big-endian dimensions). */
function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('staged page.png is not a valid PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/** Production-shape manifest.json for one staged round (pure for tests). */
export function snapshotManifestOf(
  round: LoadedEvalTask['rounds'][number],
  htmlBytes: number,
  png: Buffer,
  snapshotId: string,
  capturedAt: string,
): string {
  const page = (round.snapshot as { page: { url: string; title: string } }).page
  const size = pngSize(png)
  return JSON.stringify({
    format: 'dsh-web-review-page-snapshot',
    version: 1,
    snapshotId,
    capturedAt,
    page: { url: page.url, title: page.title },
    viewport: round.captureMeta?.viewport ?? { width: 1680, height: 1000 },
    scroll: { x: 0, y: 0 },
    html: { file: 'page.html', bytes: htmlBytes, truncated: false },
    screenshot: { file: 'page.png', width: size.width, height: size.height, truncated: false },
  }, null, 2) + '\n'
}

/** Stage one round's production-layout snapshot archive and return its dir. */
export function stageRoundSnapshot(task: LoadedEvalTask, roundIndex: number): string {
  const round = task.rounds[roundIndex]
  if (round === undefined || round.snapshot === undefined) {
    throw new Error('task ' + task.id + ' round ' + String(roundIndex + 1) + ': snapshot arm needs a frozen snapshot')
  }
  const roundNumber = roundIndex + 1
  for (const suffix of ['page.html', 'page.png'] as const) {
    if (!existsSync(frozenPagePath(task.id, roundNumber, suffix))) {
      throw new Error('task ' + task.id + ' round ' + String(roundNumber)
        + ': missing frozen ' + suffix + '; run pnpm eval:capture first')
    }
  }
  const date = new Date()
  const pad = (value: number, length: number): string => String(value).padStart(length, '0')
  const stamp = String(date.getFullYear())
    + pad(date.getMonth() + 1, 2) + pad(date.getDate(), 2) + '-'
    + pad(date.getHours(), 2) + pad(date.getMinutes(), 2) + pad(date.getSeconds(), 2)
    + pad(date.getMilliseconds(), 3)
  const dir = join(SNAPSHOT_STAGE_ROOT, stamp + '-' + randomBytes(2).toString('hex'))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const htmlPath = frozenPagePath(task.id, roundNumber, 'page.html')
  const pngPath = frozenPagePath(task.id, roundNumber, 'page.png')
  copyFileSync(htmlPath, join(dir, 'page.html'))
  copyFileSync(pngPath, join(dir, 'page.png'))
  const html = readFileSync(htmlPath, 'utf8')
  const png = readFileSync(pngPath)
  writeFileSync(
    join(dir, 'manifest.json'),
    snapshotManifestOf(round, Buffer.byteLength(html, 'utf8'), png, randomUUID(), new Date().toISOString()),
    'utf8',
  )
  return dir
}

/** Remove staged archive directories after the run settles. */
export function cleanupStagedSnapshotDirs(dirs: readonly string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
}
