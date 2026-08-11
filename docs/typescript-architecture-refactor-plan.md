# TypeScript architecture refactor plan

## Status

Implemented and verified on 2026-08-11.

## Review conclusions

The package's extension-point architecture is sound: it should remain one external
dual-face plugin and must not move state into Harness internals. The highest-risk
problems were instead at boundaries:

1. a clean worktree could not reliably materialize absolute Harness links, and tests
   were outside the strict TypeScript solution;
2. annotation send completion relied on a generic conversation event rather than the
   exact prepared snapshot, allowing stale acknowledgements;
3. reversible iframe writes had several lifecycle exits but no single transaction
   abstraction;
4. regex HTML rewriting, whole-body buffering, text POST forwarding, unrestricted
   remote fetches, and redirect handling made the proxy both fragile and over-broad;
5. optional internal fields, permissive JSON shapes, unsafe framework metadata casts,
   cross-face imports, and public `src/*` exports weakened compile-time boundaries.

## Implementation phases

### 1. Make the gate reproducible

- Materialize only manifest-declared Harness links against the resolved Harness root.
- Strict-typecheck source, scripts, unit/component tests, and E2E TypeScript.
- Run build before the real directory-entry loading test and make `pnpm check --fast`
  the pre-commit gate.

### 2. Make annotation admission transactional

- Assign each durable pending full snapshot a node-owned opaque `snapshotId`.
- Return a strict acknowledgement receipt and clear the browser state only when the
  matching durable plugin Context record appears.
- Preserve stock composer ownership, rejection behavior, retryability, and A→B→old-A
  race safety.
- Centralize editor rollback/discard operations and cover remove, clear, send,
  navigation, target switch, reload, and unmount.

### 3. Harden the local preview transport

- Restrict preview targets and every redirect hop to explicit local development hosts;
  keep remote resource URLs browser-native instead of rewriting them to host-proxy URLs.
- Parse HTML structurally, inject the exact final-page base, and keep script/comment
  text untouched.
- Stream response limits, preserve binary POST bodies, forward true HEAD, decode HTML
  charsets, and remove host-mutating/framing headers.
- Keep JavaScript rewriting, DNS/LAN allowlists, remote mode, and a headless browser out
  of scope.

### 4. Enforce module and wire contracts

- Split node/client TypeScript projects and isolate cross-face URL/contract modules.
- Make `PickItem` complete, extract pure transaction/label/inspector helpers, and bound
  cyclic framework metadata reads.
- Reject unknown JSON keys and intent-free comments; never silently truncate
  user-authored requested values.
- Remove private source exports, migrate deprecated tsdown dependency options, and gate
  self-contained node output plus parser-free browser output.

## Verification evidence

- `pnpm check:e2e` passed the strict source/test typechecks, full Vitest suite,
  deterministic config generation, both bundles, real directory loading, real Loader
  composition, the official package allowlist/checksum, and all 11 Playwright browser
  scenarios.
- The browser scenarios cover the real GUI, local proxy, picker, reversible editor,
  exact SnapshotId send loop, stock-draft and fallback sends, and clear-before-send.
- A worktree-owned isolated diagnostic launch returned HTTP 200 for DSH, the demo, and
  the proxied demo. The user's normal profile was not mutated: it already installs the
  official package, so adding the source overlay there would duplicate the plugin row.
- `git diff --check` passed; generated absolute-path config, bundles, package staging,
  build metadata, and reports remain ignored and absent from the tracked diff.
- The resolved Harness checkout has no changes from this work.
