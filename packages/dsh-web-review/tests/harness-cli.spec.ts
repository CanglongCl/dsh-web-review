import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { harnessWebLaunch } from '../../../scripts/harness-cli.ts'
import { resolveHarnessRoot } from '../../../scripts/harness-path.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

describe('0811 Harness Web launch contract', () => {
  it('uses the native-ESM built CLI with launcher flags before app flags', () => {
    const harness = resolveHarnessRoot(REPO_ROOT)
    const overlay = join(REPO_ROOT, 'cordis.yml')
    const launch = harnessWebLaunch(harness, overlay, '127.0.0.1', 3090, {})

    expect(launch.command).toBe(process.execPath)
    expect(launch.args).toEqual([
      join(harness, 'apps', 'cli', 'lib', 'bin.js'),
      'web',
      '--patch', overlay,
      '--host', '127.0.0.1',
      '--port', '3090',
    ])
    expect(launch.args).not.toContain('--dev')
    expect(launch.args).not.toContain('--import')
    expect(launch.env).toEqual({})
  })
})
