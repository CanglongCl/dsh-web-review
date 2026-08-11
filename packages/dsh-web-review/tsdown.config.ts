/**
 * tsdown config for the dsh-web-review dual-face package.
 *
 * Node half: bundles `src/index.ts` into lib/index.js (self-contained ESM —
 * no external runtime imports, so the Loader can import the package from
 * outside the harness without a local node_modules).
 *
 * Browser half: compiles the same `src/client/index.ts` twice as closure-
 * factory artifacts. `lib/client.js` uses the generated absolute-path id for
 * the source-checkout development channel; `lib/client-official.js` uses the
 * stable npm package name for the official DSH bundle tarball. Externals
 * resolve through the browser module table and everything else is inlined.
 *
 * The banner id MUST equal the boot-graph row id — i.e. the entry name in
 * cordis.yml, generated into entry-name.json by scripts/gen-config.ts.
 * The browser module loader checks the handoff id against the graph row id.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const ENTRY_NAME = (
  JSON.parse(readFileSync(new URL('./entry-name.json', import.meta.url), 'utf8')) as { name: string }
).name
const PACKAGE_ID = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string }
).name

/** The shell's shared platform module table (mirror of packages/client/web/src/platform.ts). */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** The runtime store-engine exemption (snapshot stores live in runtime/client). */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

/** Keep module CSS inside the remotely loaded client artifact. */
const CSS_VIRTUAL_PREFIX = '\0dsh-web-review-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Externals resolved from the loader module table: platform modules + the runtime exemption. */
export const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]
/** Third-party packages intentionally embedded in the browser artifact. */
const CLIENT_BUNDLED_DEPENDENCIES = ['clsx', 'css-selector-generator'] as const

/** Build one client artifact for an install channel and its loader id. */
function clientBundle(pluginId: string, entryFile: string): UserConfig {
  return {
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      alwaysBundle: (id: string) => CLIENT_EXTERNALS.includes(id) ? undefined : true,
      onlyBundle: [...CLIENT_BUNDLED_DEPENDENCIES],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      name: 'dsh-web-review-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const absolute = importer === undefined ? source : resolvePath(dirname(importer), source)
        return `${CSS_VIRTUAL_PREFIX}${absolute}${CSS_VIRTUAL_SUFFIX}`
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, value] of Object.entries(cssExports ?? {})) classMap[local] = value.name
        const tagId = `${pluginId}/${basename(fileId)}`
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(tagId)};`,
          `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
          `  const tag = document.createElement('style');`,
          `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
          `  tag.dataset.pluginCss = tagId;`,
          `  tag.textContent = css;`,
          `  document.head.appendChild(tag);`,
          `}`,
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: entryFile,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

export default [
  {
    entry: ['src/index.ts'],
    tsconfig: 'tsconfig.node.json',
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      // The Loader artifact intentionally inlines its small DSH helpers and
      // parser graph; the post-build gate rejects any surviving bare import.
      alwaysBundle: ['parse5', 'entities'],
      onlyBundle: ['parse5', 'entities'],
    },
  },
  clientBundle(ENTRY_NAME, 'client.js'),
  clientBundle(PACKAGE_ID, 'client-official.js'),
] satisfies UserConfig[]
