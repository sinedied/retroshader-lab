# AGENTS.md — RetroShader Lab

Browser bench for [NextUI](https://github.com/LoveRetro/NextUI) GLSL shader pipelines: load a
screenshot, stack 1–3 shader passes, export a `minarch` `.cfg`. Vite + Lit 3 + strict TypeScript +
WebGL2, no other runtime deps. GPL-3.0-or-later (NextUI is GPL-3.0). Pushes to `main` deploy to
GitHub Pages.

## Commands

```sh
npm run dev        # regenerates the manifest, then vite on :5180
npm run build      # manifest + tsc --noEmit + vite build
npm run shaders    # asset manifest only
npm run typecheck
npm run palette    # recolour a GB screenshot into a Gambatte palette
```

- `src/generated/shader-manifest.json` is **gitignored and generated**. A fresh checkout (or a
  `git worktree`) fails `tsc` with "Cannot find module '../generated/shader-manifest.json'" until
  `npm run shaders` runs. `dev` and `build` already do it.
- The manifest indexes `public/shaders/glsl`, `public/shaders/presets` and `public/samples`
  (metadata merged from `public/samples/index.json`). Drop files in those folders and re-run it.
- No test suite. Verification is typecheck + build + driving the real app in a browser.

## NextUI is upstream

Everything under `public/shaders/` is a **byte-identical copy** from a local NextUI clone at
`~/projects/NextUI`:

| Here | Upstream |
|---|---|
| `public/shaders/glsl/` | `skeleton/BASE/Shaders/glsl/` |
| `public/shaders/presets/` | `skeleton/BASE/Shaders/` (the `.cfg` tree, incl. `sets/`) |
| `public/shaders/default.glsl` | `skeleton/SYSTEM/desktop/shaders/default.glsl` (final scale pass) |

```sh
# re-sync both, always together
cp ~/projects/NextUI/skeleton/BASE/Shaders/glsl/*.glsl public/shaders/glsl/
(cd ~/projects/NextUI/skeleton/BASE/Shaders && tar cf - $(find . -name '*.cfg')) \
  | tar xf - -C public/shaders/presets/
npm run shaders
```

**Presets reference shaders by filename.** Syncing presets without shaders ships configs that point
to missing files — this happened mid-session when NextUI gained `crt-perfect-v2/v3`, then `v4`. After
any sync, check every referenced shader exists:

```sh
grep -rhoE 'minarch_shader[123] = .*' public/shaders/presets/ | sed 's/.*= //' | sort -u \
  | while read -r f; do [ -f "public/shaders/glsl/$f" ] || echo "MISSING: $f"; done
```

The pipeline semantics come from NextUI's C, not from guesswork:

| What | Where |
|---|---|
| Pass loop, `runShaderPass`, uniforms, GLSL preprocessing, `setRectToAspectRatio` | `workspace/all/common/generic_video.c` |
| cfg keys, option labels, `#pragma parameter` menu, `%.2f` quantization | `workspace/all/minarch/ma_config.c` |
| `selectScaler` → `renderer.aspect` / `scale` per scaling mode | `workspace/all/minarch/ma_video.c` |

## The pipeline contract

Ported in `src/core/pipeline.ts` + `glsl-preprocess.ts` + `scaling.ts`. These are faithful to the C
**including its quirks — do not "fix" them**, or the lab stops predicting the device.

- `upscale` is stored as `optionIndex + 1`, so `screen` = **9**, which means "render at the
  destination rect size".
- `srctype` / `scaletype`: `0` = source (original), `1` = relative (previous pass output),
  `2` = viewport (dst_rect). Only 0 and 1 are offered in the UI, matching NextUI's menu; 2 stays in
  the type and the cfg reader so an exotic file still loads.
- A pass's target texture is created with the **next** pass's filter; the source texture uses
  pass 1's filter. This is what makes NEAREST/LINEAR chains match the device.
- Uniforms per pass: `MVPMatrix` (identity), `FrameDirection` (1), `FrameCount`, `OutputSize`,
  `TextureSize`, `InputSize`, `OrigTextureSize`, `OrigInputSize`, `texelSize` (`1/TextureSize`),
  `Texture` (unit 0), `OrigTexture` (unit 1), one float per `#pragma parameter`.
- Preprocessing: strip `#pragma parameter` lines; rewrite `#version 110…450` to `#version 300 es`;
  no `#version` becomes `#version 100`; insert `#define VERTEX` or `#define FRAGMENT` + the ES
  precision block. **`PARAMETER_UNIFORM` is defined for the fragment stage only**, so parameters
  used in a vertex stage fall back to compile-time defaults. That asymmetry is deliberate.
- **Y orientation**: the source is uploaded without `UNPACK_FLIP_Y` and `default.glsl` flips at the
  end. Looks wrong in isolation, keeps scanline/dot-matrix phase identical to the device.
- `dst_rect`: Native/Cropped use an integer scale (floor / ceil-div), Aspect fits the core ratio,
  Fullscreen stretches. Parameters snap to `min + n*step` and serialize as `%.2f`.

## Codebase map

- `src/core/` — pure logic, no DOM beyond canvas: `pipeline` (render graph), `glsl-preprocess`,
  `pragma-params`, `scaling`, `cfg` (minarch reader/writer), `preset-config`, `user-presets`,
  `shader-library`, `test-patterns`, `state` (store singleton + localStorage).
- `src/components/` — Lit elements, all `rsl-*`: `app` (owns pipelines and orchestration),
  `viewport` (canvases, zoom/pan, comparison frame, export), `source-panel`, `pipeline-panel`,
  `dock` (cfg / passes / shaders / log tabs), `benchmark`, `shared-styles`.
- Up to 3 WebGL contexts, one per comparison pane; pane 0 is the pipeline being edited.
- localStorage keys: `retroshader-lab:state`, `:custom-shaders`, `:user-presets`. `state.restore()`
  migrates old shapes — add a fallback there rather than breaking saved sessions.

### The comparison frame

While comparing, the panes divide a rectangle measured in **export pixels** (`compareWidth` ×
`compareHeight`, `0` meaning "follow the output resolution"), not the browser window.

- **Panning is clamped against the frame, never against the stage.** This is the whole point: it is
  what makes the exported PNG match the screen. It used to clamp against `stage.clientWidth`, so the
  pannable range moved when the window was resized and the export agreed only by coincidence.
- `exportComposite()` deliberately repeats the screen's arithmetic rather than inverting it into
  source rectangles. If you change one, change the other — a unit check that both place the render
  identically across modes, pane counts, frame sizes, zooms and pans is cheap to write and catches
  this immediately.
- `zoom` magnifies content *inside* the frame; it does not resize it. `displayScale` is a
  screen-only shrink capped at 1, and must never reach the export.
- Custom shaders are validated by compiling them before they are stored, because `render()` silently
  skips a pass whose shader is not cached — an invalid shader would look like an empty pass.
- Shader URLs are a plain `fetch` and so bound by CORS; it cannot be proxied without a server. Say
  so in the error rather than reporting a generic failure.

## Verifying in the browser

Drive the real app with chrome-devtools MCP; it is fully scriptable because every control is a
CustomEvent and TypeScript `private` is not a runtime barrier:

```js
const app = document.querySelector('rsl-app');
const fire = (el, t, d) => el.dispatchEvent(new CustomEvent(t, { detail: d, bubbles: true, composed: true }));
fire(app.shadowRoot.querySelector('rsl-dock'), 'preset-load', { kind: 'stock', id: 'crt-perfect-v4.cfg' });
app.appState; app.pipelines; app.userPresets; app.source;   // all readable
```

Useful events: `preset-load|save|rename|update|delete`, `cfg-import`, `pass-add|remove|move|change`,
`pass-param`, `source-system|pattern|sample|file`, `output-size`, `scaling`, `view-change`,
`compare-change` (also carries `compareWidth|compareHeight|exportLabels`), `pane-change`,
`shader-add-file|shader-add-url|shader-delete`, `export-png`, `toggle-panel`. Keyboard: `[` / `]`
toggle the rails.

- Console should contain **only** Lit's dev-mode notice. Anything else is a regression.
- Chrome will not resize below ~500px wide; `resize_page` clamps silently.
- To sanity-check rendering, `gl.readPixels` on `app.main.gl`, or compare pane pixels.
- Benchmarking uses `EXT_disjoint_timer_query_webgl2`, and everything about it is load-bearing —
  each of these was measured, and each one produced a *wrong ranking* when absent:
  - **Never wait on an idle GPU.** A drained GPU drops its clock and the next sample measures a
    slower chip. `QUEUE_DEPTH` rounds are kept submitted at all times; only one query may be
    *active*, but any number may be finished-and-unread, which is what makes this possible.
    Switching the poll to `requestAnimationFrame` made it worse, not better — 16.7ms of idle.
  - **Size batches to a duration, not a count.** `TARGET_BATCH_MS` picks iterations per pipeline,
    re-derived from live samples, because a cold warmup reads ~10× steady state and would lock in
    batches far too short.
  - **But cap it** (`MAX_ITERATIONS`). At 600 the CPU could not queue commands fast enough, the GPU
    drained mid-run, and a one-pass shader measured the same as a three-pass one.
  - **More samples is not free precision.** Measured across four repeats each: 30 rounds gives a
    4.6% run-to-run spread on the *ratio* between two pipelines, 90 gives 2.8%, 300 gives 2.0% —
    but by 300 the GPU is throttling and the absolute milliseconds climb run over run. 90 is the
    knee. Read the Perf. column, not the milliseconds.
  - **Warmup matters more than sample count.** After the GPU has been idle, 400ms of warmup left
    the first quarter of a run reading ~35% high. It is `WARMUP_MS`, not `ROUND_PRESETS`, that
    limits accuracy.
  - **Median and p10–p90, never mean and σ.** One compositor hitch moves a mean; it does not move
    a median.
  - The modal backdrop has no `backdrop-filter`: a blur of the canvases rendering underneath would
    be recomputed every frame and compete with the measurement. Plain alpha compositing is cheap,
    so the backdrop being translucent is fine — only the blur was ever the problem.
- **Timeouts must be wall-clock, not poll counts.** A `STALL_LIMIT` of 600 polls sounded generous
  and was ~30ms, so healthy queries were abandoned and every result came back `NaN`. Adding
  instrumentation made it disappear (it changed the timing) — a textbook Heisenbug.

## Gotchas that actually bite

Every one of these cost time in the session that built this repo.

- **Assert outcomes, not mechanisms.** The fold toggle was verified with
  `hasAttribute('hidden')` — which passed — while nothing ever hid. It survived two phases. Measure
  rendered height, geometry or pixels.
- **`display: flex` beats the UA `[hidden] { display: none }`.** Panel bodies need an explicit
  `[hidden] { display: none !important }`, and it must live in `shared-styles` because each shadow
  root needs its own copy.
- **`display: none` removes an item from a grid**, so auto-placement shifts the survivors into the
  wrong tracks. Give grid children explicit `grid-column` **and** `grid-row`, media queries
  included. This bit twice: first the viewport collapsed to 0 width, later to 0 height.
- **An outside rule beats `:host`.** A global `rsl-app { display: block }` in `theme.css` overrode
  `:host { display: grid }`. Keep layout in `:host`; never set `display` on the element from outside.
- **A scroll container's automatic minimum is 0**, so a grid track will squeeze it to nothing.
  `overflow-y: auto` needs an explicit `min-height`.
- **Lit change-in-update**: writing reactive state from `updated()`/`firstUpdated()` warns and
  re-renders. Defer with `requestAnimationFrame`, and dispatch "ready" events from a microtask.
- **A fresh `import('/src/core/state.ts')` in a devtools script is a different module instance** —
  `store.update()` there never reaches the app. Dispatch events instead.
- **Vite HMR does not reliably swap Lit static styles.** Reload before concluding a CSS fix failed.
- **`git checkout -- <files>` discards work.** Splitting a feature and a fix that share a file is
  best done by backing the file up, reverting the fix, committing the feature, restoring, then
  committing the fix. Verify each commit typechecks in a `git worktree` (remember `npm run shaders`).
- **Keep `package-lock.json` in step with `package.json`** or `npm ci` fails in CI only.
- **Derive comparison panes from live state**, not a cached config snapshot, or a raw pane silently
  stops following edits.
- **Separate user-action messages from per-render output.** Import/preset warnings were written to
  the same field the render loop overwrites every frame, so they vanished before being read. The
  same applies across tabs: a result belongs next to the control that caused it, since the log is
  somewhere the user is not looking.
- **`.silk` does not exist** — the silkscreen label class is `.label`, and it is `display: block`,
  so inline uses in a toolbar need an explicit override. Grep before inventing a class name.
- **`TODO` is the owner's file**, marked "for human draft, not for AI agents". Never edit it.
- **Validate anything pulled from libretro-thumbnails**: some entries are upscaled (Symphony of the
  Night is 512×332) and some are not PNG despite the extension (FF7 disc 1). Check the magic bytes
  and the expected native resolution before bundling.

## Where to look

| Need | File |
|---|---|
| Features, cfg format, fidelity notes | `README.md` |
| Licensing and provenance of bundled assets | `public/shaders/NOTICE`, `public/samples/NOTICE` |
| Screenshot sources and resolutions | `public/samples/index.json` |
| Deploy pipeline | `.github/workflows/deploy.yml` |
| Gambatte palette table (GPL-2.0, tooling only) | `scripts/vendor/` — see its `NOTICE` |
| Owner's backlog (read-only) | `TODO` |
| Device-side truth for any pipeline question | `~/projects/NextUI` (see the table above) |

## Workflow

- **Diagnose, don't guess.** Reproduce the problem and measure it before proposing a fix; a
  plausible-sounding root cause that hasn't been observed is usually the wrong one.
- **Verify in the browser before calling anything done** — measured outcomes, not assumptions, and
  a console with nothing in it but Lit's dev-mode notice.
- **Commit granularly**, conventional commits, one logical change each, and each commit should
  typecheck on its own.
- **Don't push unless asked.** A push to `main` deploys straight to production, so that call is the
  owner's. Commit locally and stop there.
- **Report concisely**, and say plainly what went wrong, what was skipped, or what remains uncertain.
