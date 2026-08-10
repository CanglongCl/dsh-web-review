/** Assemble a prebuilt bundle tarball for DSH's official profile installer. */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'packages', 'dsh-web-review')
const output = join(root, 'dist')
const staging = join(output, 'package')
const sourceManifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
  name: string
  version: string
  description: string
  dsh: { client: unknown }
}

rmSync(staging, { recursive: true, force: true })
mkdirSync(join(staging, 'lib'), { recursive: true })
mkdirSync(join(staging, 'docs', 'assets'), { recursive: true })

const manifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  description: sourceManifest.description,
  type: 'module',
  main: './lib/index.js',
  exports: {
    '.': './lib/index.js',
    './client': './lib/client-official.js',
    './package.json': './package.json',
  },
  files: ['lib', 'docs/assets', 'cordis.patch.yml', 'README.md'],
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    client: sourceManifest.dsh.client,
  },
}

writeFileSync(join(staging, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(staging, 'cordis.patch.yml'), [
  '# Official DSH profile bundle layer.',
  '- insert:',
  '    - id: dsh-web-review',
  `      name: ${JSON.stringify(sourceManifest.name)}`,
  '',
].join('\n'))
cpSync(join(root, 'README.md'), join(staging, 'README.md'))
for (const file of ['web-review-preview.jpg', 'web-review-annotation-editor.jpg']) {
  cpSync(join(root, 'docs', 'assets', file), join(staging, 'docs', 'assets', file))
}
for (const file of ['index.js', 'client-official.js', 'client-official.js.map']) {
  cpSync(join(source, 'lib', file), join(staging, 'lib', file))
}

const packed = spawnSync('pnpm', ['pack', '--pack-destination', output], {
  cwd: staging,
  encoding: 'utf8',
  stdio: 'pipe',
})
if (packed.status !== 0) {
  if (packed.stdout !== '') process.stdout.write(packed.stdout)
  if (packed.stderr !== '') process.stderr.write(packed.stderr)
  process.exit(packed.status ?? 1)
}
console.log(`package-official: ${packed.stdout.trim()}`)
