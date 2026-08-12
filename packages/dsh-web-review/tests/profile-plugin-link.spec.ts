import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { OFFICIAL_PACKAGE_NAME } from '../../../scripts/development-entry.ts'
import { materializeProfilePluginLink } from '../../../scripts/profile-plugin-link.ts'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('profile-local development package link', () => {
  it('refuses to overlay a profile that already installs the official package', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-web-review-profile-link-'))
    roots.push(dshHome)
    const profile = join(dshHome, 'profiles', 'web')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), `${JSON.stringify({
      dependencies: { [OFFICIAL_PACKAGE_NAME]: '0.0.4-rc.1' },
      dsh: { profile: { bundles: [OFFICIAL_PACKAGE_NAME] } },
    })}\n`)

    expect(() => materializeProfilePluginLink(REPOSITORY_ROOT, dshHome)).toThrow(
      `${OFFICIAL_PACKAGE_NAME} is already installed`,
    )
  })
})
