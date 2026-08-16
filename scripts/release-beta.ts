/** Bump both manifests to the next beta version, verify the release identity,
 * then commit, tag, and push. The pushed `v<version>` tag makes CI publish the
 * exact checked tarball to the `beta` dist-tag (see release-npm.yml).
 *
 * Usage:
 *   pnpm release:beta                continue the current beta series, or start
 *                                    the next minor beta from a stable version
 *   pnpm release:beta 0.3.0          start (or continue) the 0.3.0 beta series
 *   pnpm release:beta --dry-run      print the plan without writing anything
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_NAME = '@canglongcl/dsh-web-review'
const MANIFESTS: [string, string] = [
  join(root, 'package.json'),
  join(root, 'packages', 'dsh-web-review', 'package.json'),
]
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u
const BETA_SERIES = /^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/u

interface ParsedVersion {
  core: [number, number, number]
  prerelease: string[]
}

function fail(message: string): never {
  throw new Error(`release:beta: ${message}`)
}

/** Run one command from the repo root; non-zero exits fail the whole script. */
function run(command: string, args: readonly string[], stream = false): string {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: stream ? 'inherit' : 'pipe',
  })
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .filter((chunk): chunk is string => typeof chunk === 'string')
      .join('').trim()
    fail(`${command} ${args.join(' ')} exited ${String(result.status)}${detail === '' ? '' : `: ${detail}`}`)
  }
  return typeof result.stdout === 'string' ? result.stdout : ''
}

function parse(version: string): ParsedVersion {
  const match = SEMVER.exec(version)
  if (match === null) fail(`invalid semver ${JSON.stringify(version)}`)
  const [major, minor, patch] = [match[1], match[2], match[3]]
  if (major === undefined || minor === undefined || patch === undefined) {
    fail(`invalid semver ${JSON.stringify(version)}`)
  }
  return {
    core: [Number(major), Number(minor), Number(patch)],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Semver compare: 1 when a > b, -1 when a < b, 0 when equal. */
function compare(a: string, b: string): number {
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return (left.core[i] ?? 0) > (right.core[i] ?? 0) ? 1 : -1
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let i = 0; i < length; i += 1) {
    const leftPart = left.prerelease[i]
    const rightPart = right.prerelease[i]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumeric = /^\d+$/u.test(leftPart)
    const rightNumeric = /^\d+$/u.test(rightPart)
    if (leftNumeric && rightNumeric) {
      if (Number(leftPart) !== Number(rightPart)) return Number(leftPart) > Number(rightPart) ? 1 : -1
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1
    } else if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1
    }
  }
  return 0
}

function readVersion(file: string): string {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') fail(`${file} has no version string`)
  return manifest.version
}

function writeVersion(file: string, from: string, to: string): void {
  const source = readFileSync(file, 'utf8')
  const needle = `"version": ${JSON.stringify(from)},`
  if (!source.includes(needle)) fail(`${file} does not contain ${needle}`)
  writeFileSync(file, source.replace(needle, `"version": ${JSON.stringify(to)},`))
}

const positionals = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const dryRun = process.argv.includes('--dry-run')
if (positionals.length > 1) fail('usage: pnpm release:beta [base-version] [--dry-run]')
const explicitBase = positionals[0]

const current = readVersion(MANIFESTS[0])
if (readVersion(MANIFESTS[1]) !== current) fail('root and package versions differ')

// Compute the next beta version.
let next: string
const series = BETA_SERIES.exec(current)
if (series !== null) {
  const [major, minor, patch, number] = [series[1], series[2], series[3], series[4]]
  if (major === undefined || minor === undefined || patch === undefined || number === undefined) {
    fail(`invalid beta version ${JSON.stringify(current)}`)
  }
  const base = `${major}.${minor}.${patch}`
  if (explicitBase !== undefined && explicitBase !== base) {
    fail(`the current beta series is ${base}, not ${explicitBase}`)
  }
  next = `${base}-beta.${Number(number) + 1}`
} else {
  let base: string
  if (explicitBase !== undefined) {
    if (explicitBase.includes('-') || SEMVER.exec(explicitBase) === null) {
      fail(`base version must be plain x.y.z, got ${JSON.stringify(explicitBase)}`)
    }
    base = explicitBase
  } else {
    const parsed = parse(current)
    base = `${parsed.core[0]}.${parsed.core[1] + 1}.0`
  }
  next = `${base}-beta.0`
}
if (compare(next, current) <= 0) fail(`${next} must be greater than the current version ${current}`)

// The next beta must be ahead of everything already published on npm.
const npm = spawnSync('npm', ['view', PACKAGE_NAME, 'dist-tags', '--json'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'pipe',
})
if (npm.status === 0) {
  try {
    // `npm view <pkg> dist-tags --json` prints the dist-tags map itself; some
    // npm versions wrap it under a dist-tags key when combined with --json.
    const parsed: unknown = JSON.parse(npm.stdout)
    let distTags: unknown = null
    if (typeof parsed === 'object' && parsed !== null && 'dist-tags' in parsed) {
      distTags = (parsed as Record<string, unknown>)['dist-tags']
    } else if (typeof parsed === 'object' && parsed !== null) {
      distTags = parsed
    }
    if (typeof distTags === 'object' && distTags !== null) {
      for (const tag of ['beta', 'latest'] as const) {
        const published = (distTags as Record<string, unknown>)[tag]
        if (typeof published === 'string' && compare(next, published) <= 0) {
          fail(`${next} must be greater than the published ${tag} version ${published}`)
        }
      }
    } else {
      console.warn('release:beta: unexpected npm dist-tags shape; skipping the published-version check')
    }
  } catch {
    console.warn('release:beta: could not parse npm dist-tags; skipping the published-version check')
  }
} else {
  console.warn('release:beta: npm registry unreachable; skipping the published-version check')
}

console.log(`release:beta: ${current} -> ${next}${dryRun ? ' (dry run)' : ''}`)

if (dryRun) {
  const status = run('git', ['status', '--porcelain'])
  if (status.trim() !== '') console.warn('release:beta: the working tree is dirty; a real run would abort')
  console.log('release:beta: dry run — no files, commits, tags, or pushes were made')
  process.exit(0)
}

// A real bump must start from a clean tree.
const status = run('git', ['status', '--porcelain'])
if (status.trim() !== '') fail('the working tree is dirty; commit or stash changes first')

writeVersion(MANIFESTS[0], current, next)
writeVersion(MANIFESTS[1], current, next)

// The bumped manifests must still satisfy the release identity gate.
run(process.execPath, ['--import', 'tsx', join(root, 'scripts', 'verify-release.ts')], true)

run('git', ['add', MANIFESTS[0], MANIFESTS[1]])
run('git', ['commit', '-m', `release: bump ${next}`])
run('git', ['tag', '-a', `v${next}`, '-m', `dsh-web-review v${next}`])
run('git', ['push', 'origin', 'HEAD'])
run('git', ['push', 'origin', `v${next}`], true)
console.log(`release:beta: pushed ${next}; CI publishes the checked tarball to the beta dist-tag (${PACKAGE_NAME}@beta)`)
