/**
 * tsdown config for the ui-webview dual-face package.
 *
 * Node half: bundles `src/index.ts` into lib/index.js (self-contained ESM —
 * no external runtime imports, so the Loader can import the package from
 * outside the harness without a local node_modules).
 *
 * Browser half: bundles `src/client/index.ts` into lib/client.js as a
 * closure-factory artifact — `window.__ModuleLoader__.load({ id, factory })`
 * with externals resolved through the browser-side module table (the
 * platform modules shared by the shell + the runtime store exemption).
 * Everything else (react, clsx) is inlined.
 *
 * The banner id MUST equal the boot-graph row id — i.e. the entry name in
 * cordis.yml, generated into entry-name.json by scripts/gen-config.mjs.
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

/** The shell's shared platform module table (mirror of packages/client/web/src/platform.ts). */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** The runtime store-engine exemption (snapshot stores live in runtime/client). */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

/** Keep module CSS inside the remotely loaded client artifact. */
const CSS_VIRTUAL_PREFIX = '\0ui-webview-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Externals resolved from the loader module table: platform modules + the runtime exemption. */
export const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]

export default [
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [{
      name: 'ui-webview-css-modules-inline',
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
        const tagId = `${ENTRY_NAME}/${basename(fileId)}`
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(tagId)};`,
          `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
          `  const tag = document.createElement('style');`,
          `  tag.dataset.plugin = ${JSON.stringify(ENTRY_NAME)};`,
          `  tag.dataset.pluginCss = tagId;`,
          `  tag.textContent = css;`,
          `  document.head.appendChild(tag);`,
          `}`,
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ENTRY_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
