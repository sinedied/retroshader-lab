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

## Two upstreams

Everything under `public/shaders/` is a **byte-identical copy** from one of two local clones. Both
are re-synced regularly; keep them straight, because they have different licences.

### 1. NextUI — `~/projects/NextUI` (GPL-3.0)

| Here | Upstream |
|---|---|
| `public/shaders/glsl/` (21 files) | `skeleton/BASE/Shaders/glsl/` |
| `public/shaders/presets/nextui/` | `skeleton/BASE/Shaders/*.cfg` (the root configs) |
| `public/shaders/presets/sets/` | `skeleton/BASE/Shaders/sets/` (the per-system sets) |
| `public/shaders/default.glsl` | `skeleton/SYSTEM/desktop/shaders/default.glsl` (final scale pass) |

```sh
# re-sync both, always together
cp ~/projects/NextUI/skeleton/BASE/Shaders/glsl/*.glsl public/shaders/glsl/
cp ~/projects/NextUI/skeleton/BASE/Shaders/*.cfg public/shaders/presets/nextui/
(cd ~/projects/NextUI/skeleton/BASE/Shaders/sets && tar cf - $(find . -name '*.cfg')) \
  | tar xf - -C public/shaders/presets/sets/
npm run shaders
```

**The cfg tree is split across two folders here**, so do not extract it in one go the way an
older version of this file did — the root configs belong under `nextui/` and only `sets/`
keeps its own name. See "Preset layout" below.

### 2. perfect-retroshaders — `~/projects/perfect-retroshaders` (MIT, the owner's own)

The `crt-perfect` / `lcd-perfect` / `pixel-perfect` family. NextUI used to carry these as public
domain and **no longer ships them at all**, so they are tracked from their own repo now. Do not
expect to find them under `~/projects/NextUI`.

```sh
cp ~/projects/perfect-retroshaders/shaders/*.glsl public/shaders/glsl/
npm run shaders
```

**That repo carries no `.cfg`,** so their presets are written here in
`public/shaders/presets/perfect-retroshaders/`, one per shader, named after it. Every shader in
that family documents its required pass settings in its own header, and so far all of them want
the same thing — a NEAREST sampler and rendering at the final output resolution:

```ini
minarch_nrofshaders = 1
minarch_shader1 = <name>.glsl
minarch_shader1_filter = NEAREST
minarch_shader1_srctype = source
minarch_shader1_scaletype = source
minarch_shader1_upscale = screen
minarch_scale_filter = NEAREST
```

Read the header rather than copying this blindly: these shaders scale the image themselves, so a
future one that wanted LINEAR, or an intermediate pass, would need something else.

### After any sync, from either upstream

**Presets reference shaders by filename**, and minarch resolves a missing one to *index 0* rather
than erroring — so a bad reference silently loads whichever shader sorts first. Syncing presets
without shaders once shipped exactly that, when NextUI gained `crt-perfect-v2/v3`, then `v4`. Always
check:

```sh
grep -rhoE 'minarch_shader[123] = .*' public/shaders/presets/ | sed 's/.*= //' | sort -u \
  | while read -r f; do [ -f "public/shaders/glsl/$f" ] || echo "MISSING: $f"; done
```

Then give any newly added shader a preset, update `public/shaders/NOTICE` if the provenance or the
licence of a file changed, and confirm in the browser that every shader still compiles — the Log tab
should read "All shaders compiled".

**A sync can remove shaders, not only add them.** `perfect-retroshaders` folded
`crt-perfect-v2`…`v5b` back into a single `crt-perfect`. Deleting a shader means deleting its preset
in the same commit, or the reference check above fails — and it is worth grepping the whole tree
first, since a *NextUI* preset referencing a removed file would be a much worse breakage than one of
ours. Saved sessions and shared links can still name a shader that is gone; `render()` reports
`shader "x" is not loaded` as a warning, so that degrades loudly rather than silently, which is why
the pass loop keeps that check.

### Preset layout

Every bundled preset lives in a category folder, and the dropdowns group by that folder rather
than by path depth:

| Folder | What |
|---|---|
| `presets/nextui/` | NextUI's own root configs |
| `presets/other/` | ours, for a shader that is not from either family (`dmg_dot_matrix`) |
| `presets/perfect-retroshaders/` | ours, one per shader in that family |
| `presets/sets/` | NextUI's per-system sets, sub-folders and all |

A category is the first path segment; the label is the rest of the path without `.cfg`, so
`sets/GBA/Retro.cfg` reads as `GBA/Retro` under a `sets` heading. That is what keeps the nine
presets called "Retro" tellable apart without nine headings. `groupPresets` in
`core/preset-config.ts` is the single source of both, shared by the cfg panel and the pane
pickers — they used to group separately and disagreed about labels and order.

**Preset paths are persisted**, in `selectedPreset.id`, in each comparison pane, and inside a
shared link's payload, so moving a file breaks saved sessions and every link already handed out.
`resolvePresetPath` maps an old path onto its current home — exact, then by path suffix, then by
a file name that matches exactly one preset — and it is applied in `loadPreset`, in
`store.restore()` and on the share-import path. If a preset ever moves again, that is the one
function to keep honest, and the way to check it is to plant an old path in localStorage and
reload, not to read the code.

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
  `shader-library`, `test-patterns`, `share` (URL state), `state` (store singleton + localStorage).
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
- **Re-clamp whenever the window a pane shows changes**, and whenever the pan itself does. Dragging
  to the edge of a narrow frame and then widening it left the pan at its old limit and opened a
  253px black gap. `updated()` watches frame size, compare mode, pane count, output size, zoom and
  pan — the last because a pan can arrive from a shared link or a restored session without ever
  passing through the drag handler.
- `exportComposite()` deliberately repeats the screen's arithmetic rather than inverting it into
  source rectangles. If you change one, change the other — a unit check that both place the render
  identically across modes, pane counts, frame sizes, zooms and pans is cheap to write and catches
  this immediately.
- **The frame is never scaled down for display.** Shrinking it resamples the pixels the lab exists
  to inspect, so an oversized frame scrolls the stage instead and one screen pixel is one export
  pixel. There is deliberately no `displayScale` any more. Centring the frame needs **`safe`**
  centring: plain `place-items: center` puts the start edge out of reach once the child overflows.
- `zoom` magnifies content *inside* the frame; it does not resize it.
- **Labels are what-you-see-is-what-you-export**: `exportLabels` drives the preview and the PNG
  together. It used to affect only the export, which made the toggle look broken.
- **A toolbar toggle outside a `.seg` gets no pressed styling** — that rule is
  `.seg button[aria-pressed='true']`. Use `.toggle`, or the button changes state invisibly, which
  reads as a dead control.
- Custom shaders are validated by compiling them before they are stored, because `render()` silently
  skips a pass whose shader is not cached — an invalid shader would look like an empty pass.
- Shader URLs are a plain `fetch` and so bound by CORS; it cannot be proxied without a server. Say
  so in the error rather than reporting a generic failure.

### Sharing state in a URL

`src/core/share.ts`. The payload is a deflate-raw + base64url blob in the **fragment**.

- **Fragment, never the query string.** A fragment is not sent to the server, so a static host
  cannot 414 it and it stays out of logs. Moving it to `?` would cap the length at whatever the host
  allows.
- **Only the delta against `defaultState()` is written.** That is what keeps an ordinary link near
  150 characters, and it makes old links forward-compatible: a field added later is absent and takes
  its default. A `v` marker guards the shape, so a newer link says so instead of decoding to
  nonsense.
- **The pipeline travels as cfg text**, reusing `exportCfg`/`importCfg` rather than a second
  serialization that could drift from the one the app actually uses.
- **Screen scaling and core aspect are compared and carried separately** from the preset. They are
  output settings the user owns and most presets never mention them; folding them into the
  "is this preset untouched?" comparison made 4 of 5 stock presets embed their whole cfg for no
  reason. Use `exportCfg({ includeScreenScaling: false })` on both sides.
- **`normaliseCfg` must resolve parameters the way loading a preset does** (`resolveParams`), since
  `importCfg` returns them in a side table rather than on the passes. Skipping that makes every
  preset look edited.
- **`store.holdSaving()` has to be taken before the cfg import**, not after: the import goes through
  the ordinary update path and would otherwise persist over the recipient's own session. Verify this
  by checking localStorage, and make sure the link actually applied first — an assertion that a
  session survived is vacuous if nothing was ever applied.
- **A fragment-only change is a same-document navigation.** Pasting a link into an open tab fires
  `hashchange` and nothing else, so without that listener the link appears to do nothing. The same
  trap makes `Page.navigate` to a `#…` URL a no-op when testing.
- Incoming custom shaders are matched **by content**: identical is reused, same-name-different-source
  is renamed *and the pass references remapped*.
- A comparison pane's preset is a **plain string**: a bundled path, or `user:<id>` for one of the
  user's own. Keeping it a string is what lets sessions and links written before user presets were
  selectable keep parsing — anything without the prefix is a stock path. A user preset a pane points
  at travels with the link and is held **transiently** on arrival, never written to the recipient's
  saved presets.
- A user preset is cfg text, not a fetchable file, so it is resolved through a lookup and kept out of
  `readPreset`'s path cache — its text changes on every update, and a cached copy would outlive the
  edit. Update, rename and delete all have to re-resolve the panes, or a pane keeps rendering a copy
  of something that has changed or gone.

## Verifying in the browser

Drive the real app with chrome-devtools MCP; it is fully scriptable because every control is a
CustomEvent and TypeScript `private` is not a runtime barrier:

```js
const app = document.querySelector('rsl-app');
const fire = (el, t, d) => el.dispatchEvent(new CustomEvent(t, { detail: d, bubbles: true, composed: true }));
fire(app.shadowRoot.querySelector('rsl-dock'), 'preset-load', { kind: 'stock', id: 'crt-perfect.cfg' });
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
- **If the chrome-devtools MCP tools are unavailable**, headless Chrome over CDP works and needs no
  dependencies — Node has a built-in `WebSocket`:

  ```sh
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
    --remote-debugging-port=9333 --user-data-dir=/tmp/rslchrome --enable-unsafe-swiftshader &
  curl -s http://127.0.0.1:9333/json/list          # grab webSocketDebuggerUrl
  ```

  Then `Runtime.evaluate` with `awaitPromise` and `returnByValue`. WebGL works. This is how the
  comparison frame was verified: overriding `viewport.download` captures an export as a `Blob`, and
  `createImageBitmap` + `getImageData` turns "are the labels there?" into a pixel count rather than
  an opinion.
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
