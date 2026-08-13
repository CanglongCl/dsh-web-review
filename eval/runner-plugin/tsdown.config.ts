/**
 * tsdown config for the eval runner: one self-contained node ESM bundle.
 * The Loader imports the package from the headless profile's node_modules
 * alias, so every harness helper (createUserMessage, SessionId,
 * renderSkillContent, installModelSelection) and the plugin's own real
 * context formatter must be inlined — no surviving bare runtime imports.
 */
import type { UserConfig } from 'tsdown'

export default [{
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  clean: true,
  dts: false,
  deps: {
    alwaysBundle: () => true,
    onlyBundle: false,
  },
}] satisfies UserConfig[]
