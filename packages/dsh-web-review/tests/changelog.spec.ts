/**
 * Pure-function suite for the changelog generator (scripts/changelog.ts).
 * The git-backed parts are exercised end to end by the release pipeline; here
 * we pin the commit-parsing, grouping, and rendering contracts.
 */
import { describe, expect, it } from 'vitest'
import {
  groupCommits,
  parseCommit,
  renderBullet,
  renderChangelog,
  renderReleaseNotes,
  renderVersionSection,
} from '../../../scripts/changelog.ts'
import type { ParsedCommit, VersionEntry } from '../../../scripts/changelog.ts'

function commit(overrides: Partial<ParsedCommit> & { subject: string }): ParsedCommit {
  return {
    hash: 'a'.repeat(40),
    type: null,
    scope: null,
    breaking: false,
    ...overrides,
  }
}

function entry(commits: ParsedCommit[], overrides: Partial<VersionEntry> = {}): VersionEntry {
  return {
    version: '1.2.3',
    date: '2026-08-20',
    previous: '1.2.2',
    commits,
    ...overrides,
  }
}

describe('parseCommit', () => {
  it('parses conventional commits with and without scope', () => {
    expect(parseCommit('h', 'feat: add preview')).toEqual({
      hash: 'h',
      type: 'feat',
      scope: null,
      breaking: false,
      subject: 'add preview',
    })
    expect(parseCommit('h', 'fix(client): restore emphasis')).toMatchObject({
      type: 'fix',
      scope: 'client',
      subject: 'restore emphasis',
    })
  })

  it('detects breaking changes from the bang and the footer', () => {
    expect(parseCommit('h', 'feat!: drop legacy api')?.breaking).toBe(true)
    expect(parseCommit('h', 'feat: drop legacy api\n\nBREAKING CHANGE: removed')?.breaking).toBe(true)
    expect(parseCommit('h', 'feat: drop legacy api\n\nNotes.\n\nBREAKING: removed')?.breaking).toBe(true)
    expect(parseCommit('h', 'feat: keep api')?.breaking).toBe(false)
  })

  it('skips merge, release, and empty commits', () => {
    expect(parseCommit('h', 'Merge pull request #3 from a/b')).toBeNull()
    expect(parseCommit('h', 'Merge branch fix/dark-mode')).toBeNull()
    expect(parseCommit('h', 'release: bump 0.4.1-beta.1')).toBeNull()
    expect(parseCommit('h', 'release: publish 0.3.0')).toBeNull()
    expect(parseCommit('h', '')).toBeNull()
  })

  it('keeps non-conventional subjects under Internal', () => {
    expect(parseCommit('h', 'TypeScript-only repo, e2e suite, git hooks and quality gates'))
      .toMatchObject({ type: null, subject: 'TypeScript-only repo, e2e suite, git hooks and quality gates' })
  })
})

describe('groupCommits', () => {
  it('maps types to Keep a Changelog sections', () => {
    const { groups } = groupCommits([
      commit({ subject: 'add preview', type: 'feat' }),
      commit({ subject: 'restore routing', type: 'fix' }),
      commit({ subject: 'bind annotation context', type: 'ui-webview' }),
      commit({ subject: 'report cohort', type: 'eval' }),
      commit({ subject: 'plain subject' }),
    ])
    expect(groups.Added.map(c => c.subject)).toEqual(['add preview'])
    expect(groups.Fixed.map(c => c.subject)).toEqual(['restore routing'])
    expect(groups.Changed.map(c => c.subject)).toEqual(['bind annotation context'])
    expect(groups.Internal.map(c => c.subject)).toEqual(['report cohort', 'plain subject'])
    expect(groups.Removed).toEqual([])
  })

  it('moves breaking commits into their own list', () => {
    const { breaking, groups } = groupCommits([
      commit({ subject: 'drop legacy', type: 'feat', breaking: true }),
      commit({ subject: 'add preview', type: 'feat' }),
    ])
    expect(breaking.map(c => c.subject)).toEqual(['drop legacy'])
    expect(groups.Added.map(c => c.subject)).toEqual(['add preview'])
  })
})

describe('renderBullet', () => {
  it('prefixes the scope and keeps plain subjects', () => {
    expect(renderBullet(commit({ subject: 'restore emphasis', type: 'fix', scope: 'client' })))
      .toBe('- **client:** restore emphasis')
    expect(renderBullet(commit({ subject: 'add preview', type: 'feat' }))).toBe('- add preview')
  })
})

describe('renderVersionSection', () => {
  it('renders heading and sections in canonical order', () => {
    const out = renderVersionSection(entry([
      commit({ subject: 'restore routing', type: 'fix' }),
      commit({ subject: 'add preview', type: 'feat' }),
      commit({ subject: 'report cohort', type: 'eval' }),
    ]))
    expect(out).toBe([
      '## [1.2.3] - 2026-08-20',
      '',
      '### Added',
      '',
      '- add preview',
      '',
      '### Fixed',
      '',
      '- restore routing',
      '',
      '### Internal',
      '',
      '- report cohort',
    ].join('\n'))
  })

  it('renders breaking changes first in a dedicated subsection', () => {
    const out = renderVersionSection(entry([
      commit({ subject: 'drop legacy', type: 'feat', breaking: true }),
      commit({ subject: 'restore routing', type: 'fix' }),
    ]))
    expect(out).toContain('### Breaking changes\n\n- drop legacy\n\n### Fixed')
  })

  it('omits the heading for release notes', () => {
    const commits = [commit({ subject: 'add preview', type: 'feat' })]
    expect(renderVersionSection(entry(commits), false)).toBe('### Added\n\n- add preview')
    expect(renderReleaseNotes(entry(commits))).toBe('### Added\n\n- add preview')
  })

  it('renders a bare heading for versions without commits', () => {
    expect(renderVersionSection(entry([]))).toBe('## [1.2.3] - 2026-08-20')
  })
})

describe('renderChangelog', () => {
  it('writes the Keep a Changelog header and per-version compare links', () => {
    const out = renderChangelog([
      entry([commit({ subject: 'add preview', type: 'feat' })], { version: '1.1.0', previous: '1.0.0' }),
      { version: '1.0.0', date: '2026-08-10', commits: [] },
    ])
    expect(out.startsWith('# Changelog\n\nAll notable changes to `dsh-web-review` are documented in this file.')).toBe(true)
    expect(out).toContain('## [1.1.0] - 2026-08-20\n\n### Added\n\n- add preview')
    expect(out).toContain('[1.1.0]: https://github.com/CanglongCl/dsh-web-review/compare/v1.0.0...v1.1.0')
    expect(out).toContain('[1.0.0]: https://github.com/CanglongCl/dsh-web-review/commits/v1.0.0')
  })
})
