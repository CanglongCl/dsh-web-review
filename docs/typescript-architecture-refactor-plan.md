# TypeScript architecture refactor plan

## Status

The original TypeScript/boundary refactor was implemented and verified on
2026-08-11. The local-only transport decision in phase 3 was superseded on
2026-08-12 by the isolated arbitrary-HTTP(S) Preview architecture below.

## 2026-08-12 isolated Preview architecture upgrade

### Product decision

Preview accepts public, LAN, and loopback credential-free absolute HTTP(S)
pages. Remote support is not implemented as a direct iframe or by promoting
remote code onto the DSH host Origin. Every top-level target instead receives a
random, short-lived `*.localhost` Origin served from an independent loopback
listener.

### Boundary invariants

1. The DSH host exposes only the same-origin session control endpoint and the
   annotation endpoint; it never serves target HTML, JavaScript, or CSS.
2. A Preview session is capability-scoped to one target Origin. Its first DNS
   resolution is pinned while Host/SNI remain the original hostname, preventing
   DNS rebinding from changing the network destination mid-session.
3. Same-Origin navigation remains in the current random Origin. Cross-Origin
   links and redirects use a server-authored handoff to a fresh random Origin.
4. The host never reads `contentDocument` or retains remote `Element` values.
   Picker, hierarchy, temporary DOM writes, and exact rollback live in the
   isolated bridge; only bounded serializable handles and snapshots cross the
   versioned `postMessage` protocol.
5. Parent messages require the exact iframe window, expected Origin, protocol
   version, random channel, and server-bound target Origin. A page cannot make
   the host accept a ready URL for another target Origin. Remaining page
   metadata stays untrusted evidence; only user-entered comments/requested
   values are user intent.
6. The server carries no browser cookies or authorization, strips response
   cookies/security/host-mutating headers, and enforces method, redirect,
   handoff, timeout, session, request, and response limits.

### Implementation slices

- Added strict shared contracts in `preview-contract.ts`, an independent
  `preview-server.ts`, and pure isolated HTML rewriting.
- Built `src/bridge/index.ts` as its own browser IIFE/TypeScript project and
  included it in the exact official-package allowlist.
- Replaced production direct-frame access with `PreviewBridgeClient` and
  serializable editor/tree props. Removed the legacy host-injected picker,
  local editor path, and obsolete host DOM-transaction abstraction.
- Expanded URL normalization, assistant-link delegation, annotation validation,
  model guidance, and product copy to all credential-free HTTP(S) pages.
- Added strict Origin/source/channel parser tests, real Loader composition,
  session revocation/handoff coverage, and random-Origin browser assertions.
- Fixed a route-codec bug discovered during review: prefixes already ending in
  `/` produced a second separator, which broke relative CSS/JS/API decoding.
  The codec now guarantees exactly one separator and composition tests fetch a
  resource resolved through the injected `<base>`.

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

### 3. Harden the legacy local preview transport (superseded 2026-08-12)

- Restrict preview targets and every redirect hop to explicit local development hosts;
  keep remote resource URLs browser-native instead of rewriting them to host-proxy URLs.
- Parse HTML structurally, inject the exact final-page base, and keep script/comment
  text untouched.
- Stream response limits, preserve binary POST bodies, forward true HEAD, decode HTML
  charsets, and remove host-mutating/framing headers.
- This was the safe intermediate boundary before a consumer requirement for
  remote pages justified the separate-Origin architecture above. Direct remote
  mode, host-Origin execution, JavaScript source rewriting, and a headless
  browser remain out of scope.

### 4. Enforce module and wire contracts

- Split node/client TypeScript projects and isolate cross-face URL/contract modules.
- Make `PickItem` complete, extract pure transaction/label/inspector helpers, and bound
  cyclic framework metadata reads.
- Reject unknown JSON keys and intent-free comments; never silently truncate
  user-authored requested values.
- Remove private source exports, migrate deprecated tsdown dependency options, and gate
  self-contained node output plus parser-free browser output.

## Verification evidence

- With `DSH_HARNESS` pinned to the reviewed 0810 checkout, `pnpm check --e2e`
  passed the strict source/test typechecks, all 198 Vitest tests,
  deterministic config generation, both bundles, real directory loading, real Loader
  composition, self-contained node/bridge artifacts, the official package
  allowlist/checksum, and all 12 Playwright browser scenarios.
- Browser coverage now includes a cross-target-Origin redirect that mints a
  second random Origin and completes a new bridge handshake before annotation
  becomes available.
- A live network smoke test loaded `https://example.com/` through the isolated
  server with HTTP 200, the expected bound target Origin, injected bridge, and
  remote page content.
- The 2026-08-11 browser scenarios covered the real GUI, local proxy, picker, reversible editor,
  exact SnapshotId send loop, stock-draft and fallback sends, and clear-before-send.
- A worktree-owned isolated diagnostic launch returned HTTP 200 for DSH, the demo, and
  the proxied demo. The user's normal profile was not mutated: it already installs the
  official package, so adding the source overlay there would duplicate the plugin row.
- `git diff --check` passed; generated absolute-path config, bundles, package staging,
  build metadata, and reports remain ignored and absent from the tracked diff.
- The resolved Harness checkout has no changes from this work.
