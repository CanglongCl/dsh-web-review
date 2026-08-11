/** CLI wrapper used by setup/check to repair worktree-local Harness links. */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHarnessRoot } from './harness-path.ts'
import { materializeHarnessLinks } from './harness-links.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const harness = resolveHarnessRoot(root)
const result = materializeHarnessLinks(root, harness)
console.log(`harness-links: ${result.verified} verified, ${result.changed} updated -> ${harness}`)
