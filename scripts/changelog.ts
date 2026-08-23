/**
 * Changelog generator: Keep a Changelog + Conventional Commits.
 *
 * CHANGELOG.md and per-version release notes are both rendered from git tags
 * and commit messages, so the GitHub release body always matches the committed
 * changelog without manual editing.
 *
 * Commit conventions (this repository):
 *   - feat -> Added, fix -> Fixed
 *   - perf / refactor / revert and the repo-specific ui-webview type -> Changed
 *   - every other type (ci, docs, eval, e2e, media, manifest, ...) -> Internal
 *   - 'release:' commits and merge commits never appear
 *   - breaking changes ('type!' or a BREAKING CHANGE footer) are listed first
 *     in a dedicated 'Breaking changes' subsection
 *
 * Usage:
 *   pnpm changelog                  rewrite CHANGELOG.md from the v* tags
 *   pnpm changelog --next 0.5.0     prepend a section for the upcoming version
 *   pnpm changelog --version 0.5.0  print release notes for one version (CI)
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const REPOSITORY = 'CanglongCl/dsh-web-review'
const CHANGELOG_PATH = join(root, 'CHANGELOG.md')

export const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u
const CONVENTIONAL = /^(?<type>[a-z][a-z0-9-]*)(?:\((?<scope>[^()\s]+)\))?(?<bang>!)?:\s+(?<subject>.+)$/u
const BREAKING_FOOTER = /^BREAKING(?: CHANGE)?:\s/mu

export interface SectionGroups {
  Added: ParsedCommit[]
  Changed: ParsedCommit[]
  Deprecated: ParsedCommit[]
  Removed: ParsedCommit[]
  Fixed: ParsedCommit[]
  Security: ParsedCommit[]
  Internal: ParsedCommit[]
}
export type Section = keyof SectionGroups

const SECTION_ORDER: readonly Section[] = [
  'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security', 'Internal',
]
const TYPE_TO_SECTION: Readonly<Record<string, Section>> = {
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Changed',
  refactor: 'Changed',
  revert: 'Changed',
  'ui-webview': 'Changed',
}

function emptyGroups(): SectionGroups {
  return {
    Added: [], Changed: [], Deprecated: [], Removed: [], Fixed: [], Security: [], Internal: [],
  }
}

export interface ParsedCommit {
  hash: string
  type: string | null
  scope: string | null
  breaking: boolean
  subject: string
}

/** Parse one raw commit message; null means the commit never enters the changelog. */
export function parseCommit(hash: string, message: string): ParsedCommit | null {
  const subject = message.split('\n')[0]?.trim() ?? ''
  if (subject === '' || /^Merge\b/u.test(subject)) return null
  const match = CONVENTIONAL.exec(subject)
  if (match === null) {
    // Non-conventional subject: keep the raw text under Internal.
    return { hash, type: null, scope: null, breaking: false, subject }
  }
  const type = match.groups?.type ?? null
  if (type === 'release') return null
  const body = message.split('\n').slice(1).join('\n')
  return {
    hash,
    type,
    scope: match.groups?.scope ?? null,
    breaking: match.groups?.bang === '!' || BREAKING_FOOTER.test(body),
    subject: match.groups?.subject ?? subject,
  }
}

/** Split parsed commits into the version's sections; breaking commits move to their own list. */
export function groupCommits(
  commits: readonly ParsedCommit[],
): { breaking: ParsedCommit[]; groups: SectionGroups } {
  const breaking: ParsedCommit[] = []
  const groups = emptyGroups()
  for (const commit of commits) {
    if (commit.breaking) {
      breaking.push(commit)
      continue
    }
    const section: Section = commit.type === null ? 'Internal' : (TYPE_TO_SECTION[commit.type] ?? 'Internal')
    groups[section].push(commit)
  }
  return { breaking, groups }
}

export function renderBullet(commit: ParsedCommit): string {
  const scope = commit.scope === null ? '' : `**${commit.scope}:** `
  return `- ${scope}${commit.subject}`
}

export interface VersionEntry {
  version: string
  date: string
  /** Chronologically previous version, for the compare link. */
  previous?: string
  commits: ParsedCommit[]
}

/** Render one version block; without the heading it is the GitHub release body. */
export function renderVersionSection(entry: VersionEntry, withHeading = true): string {
  const { breaking, groups } = groupCommits(entry.commits)
  const lines: string[] = []
  if (withHeading) lines.push(`## [${entry.version}] - ${entry.date}`, '')
  if (breaking.length > 0) {
    lines.push('### Breaking changes', '', ...breaking.map(renderBullet), '')
  }
  for (const section of SECTION_ORDER) {
    const commits = groups[section]
    if (commits.length === 0) continue
    lines.push(`### ${section}`, '', ...commits.map(renderBullet), '')
  }
  return lines.join('\n').replace(/\s+$/u, '')
}

function compareLink(entry: VersionEntry): string {
  return entry.previous === undefined
    ? `[${entry.version}]: https://github.com/${REPOSITORY}/commits/v${entry.version}`
    : `[${entry.version}]: https://github.com/${REPOSITORY}/compare/v${entry.previous}...v${entry.version}`
}

export function renderChangelog(versions: readonly VersionEntry[]): string {
  const header = [
    '# Changelog',
    '',
    'All notable changes to `dsh-web-review` are documented in this file.',
    '',
    'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),',
    'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
  ].join('\n')
  const sections = versions.map(version => renderVersionSection(version, true)).join('\n\n')
  const footer = versions.map(compareLink).join('\n')
  return `${header}\n\n${sections}\n\n${footer}\n`
}

export function renderReleaseNotes(entry: VersionEntry): string {
  return renderVersionSection(entry, false)
}

interface TagInfo {
  name: string
  version: string
  timestamp: string
  date: string
}

function git(args: readonly string[], cwd = root): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .filter((chunk): chunk is string => typeof chunk === 'string')
      .join('').trim()
    throw new Error(`git ${args.join(' ')} failed${detail === '' ? '' : `: ${detail}`}`)
  }
  return result.stdout
}

/** All v<semver> tags in chronological order (by tag commit timestamp). */
function loadTags(): TagInfo[] {
  const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/tags/v*'])
    .trim().split('\n').filter(Boolean)
  const tags: TagInfo[] = []
  for (const ref of refs) {
    const version = ref.slice(1)
    if (!SEMVER.test(version)) throw new Error(`tag ${ref} is not a v<semver> tag`)
    const commit = git(['rev-list', '-n', '1', ref]).trim()
    const [timestamp, date] = git(['log', '-1', '--format=%ct %cs', commit]).trim().split(' ')
    if (timestamp === undefined || date === undefined) throw new Error(`cannot read dates for tag ${ref}`)
    tags.push({ name: ref, version, timestamp, date })
  }
  if (tags.length === 0) throw new Error('no v<semver> tags found')
  tags.sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
  return tags
}

function loadCommits(from: string | undefined, to: string): ParsedCommit[] {
  const range = from === undefined ? to : `${from}..${to}`
  const output = git(['log', '--no-merges', '--format=%H%x00%s%x00%b%x1e', range])
  const commits: ParsedCommit[] = []
  for (const record of output.split('\x1e')) {
    const trimmed = record.trim()
    if (trimmed === '') continue
    const [hash, subject, ...bodyParts] = trimmed.split('\x00')
    if (hash === undefined || subject === undefined) throw new Error('cannot parse a git log record')
    const body = bodyParts.join('\x00')
    const message = body === '' ? subject : `${subject}\n${body}`
    const parsed = parseCommit(hash, message)
    if (parsed !== null) commits.push(parsed)
  }
  return commits
}

/** Every tagged version, newest first, with its commit range. */
function loadVersionEntries(): VersionEntry[] {
  const tags = loadTags()
  const entries: VersionEntry[] = tags.map((tag, index) => {
    const previous = index === 0 ? undefined : tags[index - 1]?.version
    const from = index === 0 ? undefined : tags[index - 1]?.name
    const entry: VersionEntry = {
      version: tag.version,
      date: tag.date,
      commits: loadCommits(from, tag.name),
    }
    if (previous !== undefined) entry.previous = previous
    return entry
  })
  return entries.reverse()
}

/** The upcoming version: commits since the latest tag, dated today (UTC). */
function loadUnreleased(nextVersion: string): VersionEntry {
  const tags = loadTags()
  const last = tags[tags.length - 1]
  if (last === undefined) throw new Error('no v<semver> tags found')
  return {
    version: nextVersion,
    date: new Date().toISOString().slice(0, 10),
    previous: last.version,
    commits: loadCommits(last.name, 'HEAD'),
  }
}

function fail(message: string): never {
  throw new Error(message)
}

function main(): void {
  const args = process.argv.slice(2)
  const nextIndex = args.indexOf('--next')
  const versionIndex = args.indexOf('--version')
  if (nextIndex !== -1 && versionIndex !== -1) fail('--next and --version are mutually exclusive')

  if (nextIndex !== -1) {
    const next = args[nextIndex + 1]
    if (next === undefined || !SEMVER.test(next)) fail(`--next requires a bare semver version, got ${String(next)}`)
    const entry = loadUnreleased(next)
    writeFileSync(CHANGELOG_PATH, renderChangelog([entry, ...loadVersionEntries()]))
    console.log(`changelog: wrote ${CHANGELOG_PATH} (${entry.commits.length} commit(s) for ${next})`)
    return
  }

  if (versionIndex !== -1) {
    const wanted = args[versionIndex + 1]?.replace(/^v/u, '')
    if (wanted === undefined || !SEMVER.test(wanted)) fail(`--version requires a semver version, got ${String(args[versionIndex + 1])}`)
    const entry = loadVersionEntries().find(version => version.version === wanted)
    if (entry === undefined) fail(`no v${wanted} tag found; cannot render release notes`)
    process.stdout.write(renderReleaseNotes(entry))
    return
  }

  if (args.length > 0) fail(`unknown arguments: ${args.join(' ')}`)
  writeFileSync(CHANGELOG_PATH, renderChangelog(loadVersionEntries()))
  console.log(`changelog: wrote ${CHANGELOG_PATH}`)
}

const entryPoint = process.argv[1]
const isMain = entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href
if (isMain) {
  try {
    main()
  } catch (error) {
    console.error(`changelog: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
