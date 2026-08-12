/**
 * Directory-import entry test: the Loader's resolution path for the
 * external package, exercised in a real tsx subprocess (the same hooks
 * `dsh web` runs with). Node/tsx ESM has no directory resolution, so the
 * package root's `index.ts` re-export is what makes
 * `import('<package dir>')` work; this test pins that contract (see
 * AGENTS.md "Loading model"). Requires the built node half (lib/index.js —
 * `pnpm test` builds first).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PKG_DIR = join(REPO_ROOT, 'packages', 'dsh-web-review')

describe('package directory import (Loader resolution path)', () => {
  it('imports the package directory through the root index.ts re-export', () => {
    if (!existsSync(join(PKG_DIR, 'lib', 'index.js'))) {
      throw new Error('lib/index.js missing — run `pnpm build` before `pnpm test`')
    }
    const script = [
      `const m = await import(${JSON.stringify(PKG_DIR)})`,
      'console.log(JSON.stringify({ name: m.name, inject: m.inject, hasApply: typeof m.apply === "function" }))',
    ].join('; ')
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as {
      name: string
      inject: string[]
      hasApply: boolean
    }
    expect(parsed.name).toBe('dsh-web-review')
    expect(parsed.inject).toEqual(['httpServer', 'agents', 'systemPrompt', 'skills'])
    expect(parsed.hasApply).toBe(true)
  })
})
