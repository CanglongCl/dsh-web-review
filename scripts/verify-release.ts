/** Verify the immutable identity and GitHub ref used by the npm release workflow. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version?: unknown
  packageManager?: unknown
}
const packageManifest = JSON.parse(readFileSync(
  join(root, 'packages', 'dsh-web-review', 'package.json'),
  'utf8',
)) as {
  name?: unknown
  version?: unknown
  private?: unknown
  publishConfig?: { access?: unknown; registry?: unknown }
  repository?: { type?: unknown; url?: unknown }
}

const EXPECTED_NAME = '@canglongcl/dsh-web-review'
const EXPECTED_REGISTRY = 'https://registry.npmjs.org/'
const EXPECTED_REPOSITORY = 'git+https://github.com/CanglongCl/dsh-web-review.git'
const EXPECTED_GITHUB_REPOSITORY = 'CanglongCl/dsh-web-review'
const EXPECTED_PACKAGE_MANAGER = 'pnpm@11.20.0'
const NPMRC = [
  '@deepseek-ai:registry=https://registry.npmjs.org/',
  '@canglongcl:registry=https://registry.npmjs.org/',
  '',
].join('\n')

function fail(message: string): never {
  throw new Error(`release verify: ${message}`)
}

const version = packageManifest.version
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  fail(`package version must be publishable semver, got ${String(version)}`)
}
if (repositoryManifest.version !== version) fail('root and package versions differ')
if (repositoryManifest.packageManager !== EXPECTED_PACKAGE_MANAGER) {
  fail(`packageManager must be pinned to ${EXPECTED_PACKAGE_MANAGER}`)
}
if (packageManifest.name !== EXPECTED_NAME) fail(`package name must be ${EXPECTED_NAME}`)
if (packageManifest.private !== true) fail('source package must remain private')
if (
  packageManifest.publishConfig?.access !== 'public'
  || packageManifest.publishConfig.registry !== EXPECTED_REGISTRY
) {
  fail('publishConfig must pin public access on the npmjs registry')
}
if (
  packageManifest.repository?.type !== 'git'
  || packageManifest.repository.url !== EXPECTED_REPOSITORY
) {
  fail(`repository metadata must be ${EXPECTED_REPOSITORY}`)
}
if (readFileSync(join(root, '.npmrc'), 'utf8') !== NPMRC) {
  fail('.npmrc must contain only the scoped registry; authentication belongs in trusted user/CI config')
}

const workflow = readFileSync(join(root, '.github', 'workflows', 'release-npm.yml'), 'utf8')
for (const required of [
  "NPM_VERSION: '11.19.0'",
  'run: pnpm check',
  'manifest.name !== "@canglongcl/dsh-web-review"',
  'npm publish "${{ steps.artifact.outputs.tarball }}"',
  '--access public',
  'id-token: write',
]) {
  if (!workflow.includes(required)) fail(`release workflow is missing ${required}`)
}

for (const forbidden of [
  'HARNESS_REPOSITORY',
  'HARNESS_REPO_TOKEN',
  'DSH_HARNESS',
  'relocate-harness-declarations',
  'pnpm check --e2e',
  '@deepseek-ai/dsh-web-review',
  'steps.registry.outputs',
  'npm view "$PACKAGE_IDENTITY"',
  'NPM_BOOTSTRAP_TOKEN',
  'NPM_PUBLISH_MODE',
  'NPM_READ_TOKEN',
  'NPM_PUBLISH_TOKEN',
  'NODE_AUTH_TOKEN',
  '--access restricted',
]) {
  if (workflow.includes(forbidden)) fail(`release workflow must not contain ${forbidden}`)
}
if (workflow.includes('pull_request_target')) fail('release workflow must never use pull_request_target')
if (workflow.includes('secrets.NPM_TOKEN')) fail('release workflow must not use a generic npm token')
const actionRefs = [...workflow.matchAll(/^\s*uses:\s+\S+@([^\s#]+)/gmu)].map(match => match[1])
if (actionRefs.length === 0 || actionRefs.some(ref => !/^[0-9a-f]{40}$/u.test(ref ?? ''))) {
  fail('every third-party action must be pinned to a full commit SHA')
}

const publishing = process.env.RELEASE_PUBLISH === 'true'
if (publishing) {
  const expectedRef = `refs/tags/v${version}`
  if (process.env.GITHUB_REF !== expectedRef) {
    fail(`publishing requires ${expectedRef}, got ${process.env.GITHUB_REF ?? '(unset)'}`)
  }
  if (process.env.GITHUB_REPOSITORY !== EXPECTED_GITHUB_REPOSITORY) {
    fail(
      `publishing requires GitHub repository ${EXPECTED_GITHUB_REPOSITORY}, got `
      + `${process.env.GITHUB_REPOSITORY ?? '(unset)'}`,
    )
  }
}

console.log(`release verify: ${EXPECTED_NAME}@${version}${publishing ? ', publish ref accepted' : ''}`)
