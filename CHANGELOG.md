# Changelog

All notable changes to `dsh-web-review` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-08-25

## [0.5.0-beta.1] - 2026-08-25

### Added

- render browser comments via the rc.8 snapshot context form

### Internal

- remove page snapshot archival feature
- replace page snapshot archival with dsh-better-sidebar integration
- better-sidebar note in README and 0.5.0-beta.1 changelog entry
- accept acknowledged snapshots by id advancement, not the syncing transition
- keyless-by-design runtime, rc.8 fold-row assertions, and sidebar tab render fixes
- derive the web-review line onto main (rc.8 + better-sidebar + rc.8 adaptations)

## [0.4.1-beta.1] - 2026-08-24

### Internal

- add GitHub release creation and changelog generation

## [0.4.1-beta.0] - 2026-08-20

### Changed

- bind annotation context to the queued user message

### Internal

- align welcome notice acknowledgement to the reviewed baseline

## [0.4.0-beta.0] - 2026-08-20

### Changed

- bind annotation context to the queued user message
- archive page snapshots (HTML tree + screenshot) on annotated sends

### Internal

- align welcome notice acknowledgement to the reviewed baseline
- numbered report archives with commit hash inside the report
- archive combined long-task A/B report (f11362b cohort)
- combined multi-target long tasks (todo/shop/landing/forms combos)
- snapshot A/B arm, per-run token attribution, versioned report archive

## [0.3.0] - 2026-08-17

## [0.3.0-rc.2] - 2026-08-17

### Internal

- declare dsh.bundle patch in source package for installability

## [0.3.0-rc.1] - 2026-08-17

### Fixed

- **client:** restore current-row emphasis and finish dark-mode tokenization
- **client:** adapt annotation editor and element selector to dark mode using theme tokens

### Internal

- add npm beta channel (beta dist-tag + release:beta script)
- automate README screenshots and demo GIF regeneration

## [0.2.0] - 2026-08-14

### Added

- return to chat after annotation send

### Changed

- render browser comments as native context
- focus comment input after element pick

### Internal

- preserve npm trusted publishing auth
- install Chromium for release checks
- introduce plugin evaluation suite
- report plugin task acceptance
- restructure report around experiment comparison
- simplify report language
- open harvested sessions in DSH Web
- report the latest runtime cohort
- support published DSH runtime
- show annotation-backed task descriptions
- contain report table overflow
- flag runs that exceed token budgets
- isolate model runs and calibrate semantic checks
- use npm trusted publishing
- refresh capture verification provenance
- record headline capture verification
- harden causal design and semantic grading
- ask readers to star the project
- ask readers to star the project
- calibrate qualitative smoke graders
- calibrate grading and localize reports
- integrate expanded protocol smoke bank
- add plugin capability comparison suite
- batch assertions, menu adjust capture, tolerant task loading for concurrent authoring
- rebase machinery onto harness 0812 baseline, add smoke task filter
- track restoration of harness 0812 npm types
- migrate to harness 0812 contracts
- pilot end-to-end — pre-step injection fidelity, chunk-usage stats, provider baseline, fixture hygiene
- add W0 machinery — question bank, real-GUI capture, headless runner, grader, session stats, HTML report
- add frontend modification eval suite plan

## [0.1.0] - 2026-08-13

### Internal

- trust reviewed release lockfile
- use public DSH npm packages
- add English README
- streamline user-facing README
- prepare public npm installation guide
- separate user and contributor guides
- add npm 0.1.0 release plan
- publish package publicly
- add local tarball installation smoke test
- publish privately under canglongcl
- use private npm development packages

## [0.0.4-rc.2] - 2026-08-13

### Internal

- release 0.0.4-rc.2
- add target ownership and text identity to annotation context

## [0.0.4-rc.1] - 2026-08-12

### Internal

- add built-in UI skills
- add private npm release workflow
- isolate remote previews by origin
- add element tree scroll affordance
- align acceptance launcher with 0811
- support harness 0811 contracts
- add movable resizable annotation editor
- add CSS keyword menus and acceptance history
- harden TypeScript boundaries
- ignore absent-agent clears
- refine corner radius glyphs

## [0.0.3] - 2026-08-11

### Internal

- release v0.0.3
- animate element selection feedback
- add README demo

## [0.0.2] - 2026-08-11

### Changed

- native browser context injection and annotation dock
- preview as a conversation tab with send-time annotation injection
- annotation message becomes English hints-only, empty comments omitted
- location-oriented, framework-agnostic annotation prompt
- keep picked-element outline; XML annotation prompt with full DOM path
- annotation interaction redesign (comment-first, marker echo)
- fix scope-addressed send ('cannot get property conversation without inject')
- restyle panel with the dsh design system
- webview panel + element annotation + AI-driven edits

### Fixed

- restore assistant link preview routing

### Internal

- add local release packaging
- bump version to 0.0.2
- add element hierarchy selector
- redesign spacing controls
- focus property scrubbing and hide editor chrome
- add official DSH bundle installation
- preserve credentials in isolated previews
- support harness 0810 contracts
- add visual web review workflow
- TypeScript-only repo, e2e suite, git hooks and quality gates

[0.5.0]: https://github.com/CanglongCl/dsh-web-review/compare/v0.5.0-beta.1...v0.5.0
[0.5.0-beta.1]: https://github.com/CanglongCl/dsh-web-review/compare/v0.4.1-beta.1...v0.5.0-beta.1
[0.4.1-beta.1]: https://github.com/CanglongCl/dsh-web-review/compare/v0.4.1-beta.0...v0.4.1-beta.1
[0.4.1-beta.0]: https://github.com/CanglongCl/dsh-web-review/compare/v0.4.0-beta.0...v0.4.1-beta.0
[0.4.0-beta.0]: https://github.com/CanglongCl/dsh-web-review/compare/v0.3.0...v0.4.0-beta.0
[0.3.0]: https://github.com/CanglongCl/dsh-web-review/compare/v0.3.0-rc.2...v0.3.0
[0.3.0-rc.2]: https://github.com/CanglongCl/dsh-web-review/compare/v0.3.0-rc.1...v0.3.0-rc.2
[0.3.0-rc.1]: https://github.com/CanglongCl/dsh-web-review/compare/v0.2.0...v0.3.0-rc.1
[0.2.0]: https://github.com/CanglongCl/dsh-web-review/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/CanglongCl/dsh-web-review/compare/v0.0.4-rc.2...v0.1.0
[0.0.4-rc.2]: https://github.com/CanglongCl/dsh-web-review/compare/v0.0.4-rc.1...v0.0.4-rc.2
[0.0.4-rc.1]: https://github.com/CanglongCl/dsh-web-review/compare/v0.0.3...v0.0.4-rc.1
[0.0.3]: https://github.com/CanglongCl/dsh-web-review/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/CanglongCl/dsh-web-review/commits/v0.0.2
