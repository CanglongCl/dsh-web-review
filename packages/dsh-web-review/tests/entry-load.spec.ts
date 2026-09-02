/**
 * Native-ESM entry test: Harness alpha.5 resolves the profile-local source
 * package row (real npm name, per DSH-0.1.2-A1-26) and imports its package `main`. This subprocess uses
 * plain Node, matching the built app-owned CLI rather than tsx source hooks.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { materializeProfilePluginLink } from '../../../scripts/profile-plugin-link.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PKG_DIR = join(REPO_ROOT, 'packages', 'dsh-web-review')

describe('source package row import (alpha.5 Loader resolution path)', () => {
  it('imports the profile-local source package under plain Node', async () => {
    if (!existsSync(join(PKG_DIR, 'lib', 'index.js'))) {
      throw new Error('lib/index.js missing — run `pnpm build` before `pnpm test`')
    }
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-web-review-entry-load-'))
    materializeProfilePluginLink(REPO_ROOT, dshHome)
    const profile = join(dshHome, 'profiles', 'web')
    const script = [
      'const m = await import("@canglongcl/dsh-web-review")',
      'console.log(JSON.stringify({ name: m.name, inject: m.inject, hasApply: typeof m.apply === "function" }))',
    ].join('; ')
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: profile,
      encoding: 'utf8',
    })
    await rm(dshHome, { recursive: true, force: true })
    expect(result.status, result.stderr).toBe(0)
    const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as {
      name: string
      inject: string[]
      hasApply: boolean
    }
    expect(parsed.name).toBe('dsh-web-review')
    expect(parsed.inject).toEqual(['webServer', 'agents', 'systemPrompt', 'skills'])
    expect(parsed.hasApply).toBe(true)
  })
})
