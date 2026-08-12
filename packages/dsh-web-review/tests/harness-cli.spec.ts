import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { harnessWebLaunch } from '../../../scripts/harness-cli.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('0811 Harness Web launch contract', () => {
  it('uses the native-ESM built CLI with launcher flags before app flags', async () => {
    const harness = await mkdtemp(join(tmpdir(), 'dsh-harness-cli-'))
    roots.push(harness)
    await mkdir(join(harness, 'apps', 'cli', 'lib'), { recursive: true })
    await writeFile(join(harness, 'apps', 'cli', 'lib', 'bin.js'), '')
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
