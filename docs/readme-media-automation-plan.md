# README media automation

> Operational runbook: the project skill `readme-media`
> (`.agents/skills/readme-media/SKILL.md`) — load it before regenerating or
> modifying the media. This document is the design rationale behind it.

## Goal

Regenerate the README's two screenshots and one demo GIF with a single
deterministic command instead of hand-made captures. The command drives the
real DSH Web GUI (isolated Preview, real picker, real property inspector, real
annotation toolbar) with Playwright and writes exactly the assets the root
README already references:

- `docs/assets/web-review-preview.jpg` — the 网页预览 tab in browse mode with
  the demo page loaded through the isolated Preview Origin.
- `docs/assets/web-review-annotation-editor.jpg` — the host-owned annotation
  editor expanded into the Adjust inspector, with the comment filled and live
  style changes applied to the picked element.
- `docs/assets/web-review-demo.gif` — the full annotation loop:
  添加页面注释 → pick the hero title → 调整 (expand the inspector) → change
  文本颜色 by clicking the picker's spectrum control and walking its value
  through five shades so the title visibly progresses from white to gold →
  scroll the inspector down → drag the 字号 scrub handle (28px → 48px, the
  field value and the hero title grow step by step) → type a comment →
  确认注释 → click the toolbar 发送 button and watch the message go out.

## Design

### One disposable run, no profile pollution

The script copies the persistent acceptance profile
(`.artifacts/acceptance/dsh-home`) into a fresh temporary `DSH_HOME`.
Settings, the connected-workspace storage, the session store, and its
projection cache all come along unchanged: the GUI's sidebar list is
cache-backed, so a re-seeded jsonl alone would not show up. The real
acceptance profile is never read-modify-written and survives the run.

If the acceptance profile does not exist yet, the script fails with
instructions to run `pnpm dev:acceptance` once (that is the documented
bootstrap for this profile).

### Services

Three children are spawned and killed at exit:

- the demo server (`demo/server.ts`) and the DSH web CLI
  (`harnessWebLaunch`, same overlay rows as acceptance: plugin insert,
  disabled directory picker, browse picker, telemetry off, `llm-deepseek`
  retries off). Both boot on the recorded acceptance ports (`ports.json`), so
  the fixture turn's Demo link keeps pointing at this run's demo server; if
  those ports are busy the run fails instead of racing the user's acceptance
  instance.
- an in-process hang endpoint. `DEEPSEEK_BASE_URL` points at it: boot probes
  get 503 instantly, and it switches to never-responding right before the
  GIF's 发送 click, so the recorded send shows a real sent message and a
  pending assistant turn without ever spending a model call. The credential
  chain is still loaded from the product sources (repo `.env`, then
  `~/.dsh/.env`) so readiness reads "configured", but no key value is ever
  printed.

### Browser drive

Playwright Chromium, 1280×800 viewport at deviceScaleFactor 2: screenshots
come out at 2560×1600 physical pixels so the README's half-width display
stays crisp, and the 1280×800 video is supersampled from the 2x render for a
sharper GIF. The run pins the Chinese product UI
(`localStorage dsh.locale = zh`, the same browser-scope boot default the eval
capture uses for English) because the README media is Chinese; the drive still
probes the rendered 网页预览/Web Preview tab label and resolves the matching
zh/en label set as a self-check, and it acknowledges the fresh-profile
internal-beta notice when shown.

GIF runs also inject a cursor HUD (`scripts/media-hud.ts`): a signal-red DOM
cursor plus a click ripple, driven from the script's own viewport coordinates
because Playwright video never renders the real OS cursor and page-event
following cannot cover the cross-Origin Preview iframe. The drive moves the
cursor in interpolated steps so the GIF shows a natural glide, presses it on
mousedown, and spawns the ripple at every click. The HUD is hidden while the
two JPEG screenshots are captured so the product shots stay clean, and a
`.artifacts/media-cursor-sample.png` snapshot after the hero pick makes the
HUD rendering verifiable. It then drives:

1. open the seeded 网页批注验收 conversation and click its assistant Demo link
   (assistant-link delegation opens Preview);
2. wait for the iframe to render the demo page → screenshot 1;
3. context `recordVideo` covers the whole run, but the GIF is trimmed to the
   annotation loop: record a start marker before the 添加页面注释 click and an
   end marker after the sent message appears, then trim with ffmpeg;
4. pick `.hero h1`, open 调整, edit 文本颜色 (click the spectrum control,
   then walk its value through five shades via the value-setter + input event
   trick — the native OS picker itself cannot be scripted and no hex field is
   typed into), wheel the inspector down, then drag the 字号 scrub handle
   right by 20px (step 1px/px, so the field and title ramp 28 → 48 live),
   type the comment → screenshot 2;
5. 确认注释, wait for the capsule `synced` acknowledgement, click 发送
   (`发送 (1)`), wait for the fixed prompt message, hold ~2s for the tail;
6. close the browser, convert the trimmed webm to a palette GIF with
   `ffmpeg-static` (fps 10, lanczos scale, 128-color diff palette, Bayer
   dither; if the result exceeds 9 MB it re-encodes at 1024 wide with a
   96-color palette), and write it next to the two JPEG screenshots.

### Dependencies

- `ffmpeg-static` becomes a devDependency (macOS/Windows/Linux binaries at
  install time) because no system ffmpeg is assumed. It is dev-only and never
  enters the official package allowlist.
- `scripts/readme-media.ts` runs through tsx and is covered by
  `tsconfig.scripts.json` like every other script.
- `package.json` gains `"media": "tsx scripts/readme-media.ts"` with an
  optional `--only screenshots|gif` flag for fast partial runs.

## Verification

- `DSH_HARNESS=~/Program/deepseek-harness pnpm media` regenerates the three
  assets; the run prints their paths and byte sizes.
- Visual check: both JPEGs show the states described above; the GIF shows the
  exact ten-step loop from the goal description.
- `pnpm typecheck` passes with the new script; `pnpm check` stays green
  (the README asset paths do not change, so the staging allowlist is
  untouched).
- Repeatability: every run copies the acceptance profile fresh into a temp
  home and must produce equivalent media without touching
  `.artifacts/acceptance` (a concurrent `pnpm dev:acceptance` on the recorded
  ports fails the run with a clear message instead of racing it).
