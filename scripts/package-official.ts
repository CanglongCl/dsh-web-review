/** Assemble a prebuilt bundle tarball and checksum for DSH's official profile installer. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'packages', 'dsh-web-review')
const output = join(root, 'dist')
const staging = join(output, 'package')
const sourceManifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
  name: string
  version: string
  description: string
  publishConfig: { access: string; registry: string }
  repository: { type: string; url: string }
  dsh: { client: unknown }
}

rmSync(staging, { recursive: true, force: true })
mkdirSync(join(staging, 'lib'), { recursive: true })
mkdirSync(join(staging, 'docs', 'assets'), { recursive: true })

const manifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  description: sourceManifest.description,
  publishConfig: sourceManifest.publishConfig,
  repository: sourceManifest.repository,
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
for (const file of ['web-review-demo.gif', 'web-review-preview.jpg', 'web-review-annotation-editor.jpg']) {
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
const packedPath = packed.stdout.trim().split(/\r?\n/).at(-1)
if (packedPath === undefined || packedPath === '') {
  console.error('package-official: pnpm pack did not report the package filename')
  process.exit(1)
}
const packageName = basename(packedPath)
const packagePath = join(output, packageName)
const checksum = createHash('sha256').update(readFileSync(packagePath)).digest('hex')
writeFileSync(join(output, 'SHA256SUMS'), `${checksum}  ${packageName}\n`)
console.log(`package-official: ${packageName}`)
console.log('package-official: SHA256SUMS')
