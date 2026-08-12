import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { relocateHarnessDeclarations } from '../../../scripts/relocate-harness-declarations.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function asLink(path: string): string {
  return `link:${path.replaceAll('\\', '/')}`
}

describe('CI Harness declaration relocation', () => {
  it('rewrites matching manifest and frozen-lockfile link entries only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-review-relocate-'))
    roots.push(root)
    const repository = join(root, 'plugin')
    const packageRoot = join(repository, 'packages', 'dsh-web-review')
    const declaredHarness = join(root, 'developer-harness')
    const ciHarness = join(root, 'checked-out-harness')
    const runtimeSuffix = join('packages', 'client', 'runtime')
    const cordisSuffix = join('vendor', 'cordis')
    await mkdir(packageRoot, { recursive: true })
    for (const directory of [ciHarness, join(ciHarness, runtimeSuffix), join(ciHarness, cordisSuffix)]) {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), '{}\n')
    }

    const manifest = {
      name: '@deepseek-ai/dsh-web-review',
      devDependencies: {
        '@deepseek-ai/cordis': asLink(join(declaredHarness, cordisSuffix)),
        '@deepseek-ai/dsh-client-runtime': asLink(join(declaredHarness, runtimeSuffix)),
        typescript: '^6.0.0',
      },
    }
    await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const linkRows = Object.entries(manifest.devDependencies)
      .filter(([, value]) => value.startsWith('link:'))
      .flatMap(([name, value], index) => {
        const target = value.slice('link:'.length)
        const staleVersion = index === 0
          ? asLink(join('..', '..', '..', 'unrelated-checkout', 'vendor', 'cordis'))
          : asLink(relative(packageRoot, target))
        return [
          `      '${name}':`,
          `        specifier: ${value}`,
          `        version: ${staleVersion}`,
        ]
      })
    await writeFile(join(repository, 'pnpm-lock.yaml'), [
      ...linkRows,
      '      typescript:',
      '        specifier: ^6.0.0',
      '        version: 6.0.3',
      '',
    ].join('\n'))

    relocateHarnessDeclarations(repository, ciHarness)

    const relocated = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    expect(relocated.devDependencies['@deepseek-ai/cordis']).toBe(asLink(join(ciHarness, cordisSuffix)))
    expect(relocated.devDependencies['@deepseek-ai/dsh-client-runtime']).toBe(
      asLink(join(ciHarness, runtimeSuffix)),
    )
    expect(relocated.devDependencies.typescript).toBe('^6.0.0')
    const lockfile = await readFile(join(repository, 'pnpm-lock.yaml'), 'utf8')
    expect(lockfile).not.toContain(declaredHarness)
    expect(lockfile).toContain(asLink(join(ciHarness, cordisSuffix)))
    expect(lockfile).toContain(asLink(relative(packageRoot, join(ciHarness, runtimeSuffix))))
    expect(lockfile).toContain('      typescript:\n        specifier: ^6.0.0\n        version: 6.0.3')
  })
})
