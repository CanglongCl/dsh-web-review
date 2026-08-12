import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureAcceptanceHistory } from '../../../scripts/acceptance-history.ts'
import { resolveHarnessRoot } from '../../../scripts/harness-path.ts'

const roots: string[] = []
const repoRoot = join(import.meta.dirname, '../../..')

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('persistent acceptance history', () => {
  it('creates one provider-free settled session and reuses it idempotently', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-web-review-acceptance-history-'))
    roots.push(dshHome)
    const options = {
      harness: resolveHarnessRoot(repoRoot),
      dshHome,
      cwd: repoRoot,
      demoUrl: 'http://127.0.0.1:5173/',
    }

    await expect(ensureAcceptanceHistory(options)).resolves.toBe(true)
    await expect(ensureAcceptanceHistory(options)).resolves.toBe(false)
  })
})
