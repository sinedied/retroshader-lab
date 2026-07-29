<div align="center">

# RetroShader Lab

**A browser bench for authoring and testing [NextUI](https://github.com/LoveRetro/NextUI) GLSL retro shader pipelines — and exporting them as `minarch` `.cfg` presets.**

![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)
![Lit](https://img.shields.io/badge/Lit-3-324FFF?style=flat-square&logo=lit&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)
![WebGL2](https://img.shields.io/badge/WebGL-2-990000?style=flat-square&logo=webgl&logoColor=white)
![License](https://img.shields.io/badge/license-GPL--3.0--or--later-3DA639?style=flat-square)

**[▶ Open the lab](https://sinedied.github.io/retroshader-lab/)**

[Quick start](#quick-start) · [How it works](#how-it-works) · [CFG format](#cfg-format) · [Fidelity notes](#fidelity-notes) · [Project structure](#project-structure)

</div>

## Overview

Tuning shaders on a handheld is slow: edit a `.cfg`, copy it to the SD card, boot a game, squint, repeat.
RetroShader Lab runs **the same pipeline in the browser** so you can iterate in milliseconds, then save a
`.cfg` that drops straight onto the device.

The pipeline is a port of NextUI's `generic_video.c` / `ma_config.c`: identical pass sizing rules,
identical uniform contract, identical GLSL preprocessing, identical `#pragma parameter` quantization.

## Features

- **1–3 shader passes** with the exact NextUI options: `filter`, `srctype`, `scaletype`, `upscale` (`1×`–`8×` or `screen`)
- **29 stock shaders** — 21 from NextUI's `Shaders/glsl` and the 8 MIT `*-perfect` ones from
  [perfect-retroshaders](https://github.com/sinedied/perfect-retroshaders) — plus **your own** added from a file or a URL
- **29 stock presets** (`real-gameboy`, `crt-perfect-v5`, `lcd-perfect`, `old-tv`, the per-system `sets/…`) loadable in one click
- **Your own presets**, saved in the browser and listed above the stock ones, with rename, update and delete
- **16 real game screenshots** at native resolution — 2 per platform, unfiltered, from libretro-thumbnails
- **Shader parameters** parsed from `#pragma parameter` and snapped to NextUI's discrete steps, saved with the preset
- **NextUI screen scaling** — `Native`, `Aspect`, `Aspect (screen)`, `Fullscreen`, `Cropped` — with real letterboxing
- **Generated test patterns** (1px grid, colour bars, dithered gradients) at console resolutions
  (GB, GBC, GBA, NES, SNES, Mega Drive, PlayStation, PSP), or your own screenshots
- **Pixel-honest viewport**: 1:1 by default, `Fit · 1:1 · 2:1 · 4:1` shortcuts and zoom up to 16× with
  drag-to-pan, and **PNG export at 1:1**
- **Compare up to 3 pipelines** — the one you are editing against the raw source or any stock preset,
  in two layouts: a movable **overlay** divider, or **side-by-side** columns that pan together
- **Sizable comparison frame** (e.g. `1280×480`) that the render is cropped into and dragged around,
  never scaled down, exported at exactly that size, with optional labels
- **Foldable panels** and collapsible side rails (`[` and `]`), down to an icon-only toolbar on narrow screens
- **Pass inspector** showing every intermediate render with its computed `InputSize` / `TextureSize` / `OutputSize`
- **Live `.cfg`** you can edit, download, or load back — unknown keys (core options like `gambatte_*`) are preserved
- **GLSL error panel** with the fully preprocessed source, line-numbered
- **Share as a link** — the whole setup in a URL fragment; an unedited stock preset costs ~150 characters
- Everything is persisted to `localStorage`

## Quick start

The lab runs entirely in the browser — try it at
**[sinedied.github.io/retroshader-lab](https://sinedied.github.io/retroshader-lab/)**, or run it locally:

```bash
npm install
npm run dev
```

Then open <http://localhost:5180>.

| Script | What it does |
| --- | --- |
| `npm run dev` | Regenerates the asset manifest and starts Vite |
| `npm run build` | Manifest + typecheck + production build into `dist/` |
| `npm run preview` | Serves the production build |
| `npm run typecheck` | `tsc --noEmit` |

> [!NOTE]
> A WebGL2-capable browser is required — the same GLSL ES 3.0 / 1.0 dual path NextUI relies on.

### Using your own screenshots

The lab ships with 16 native-resolution game screenshots (2 per platform) in `public/samples/`.
To add yours, drop an image onto the source panel, or bundle it permanently:

```bash
cp my-screenshot.png public/samples/
npm run dev   # the manifest picks up public/samples automatically
```

They then appear in the **Game screenshots** dropdown.

### Comparing pipelines

Hit **Compare** in the viewport toolbar to put 2 or 3 panes on screen. Pane A is always the pipeline
you are editing; the others show the raw source (the default) or any stock preset.

| Layout | Behaviour |
| --- | --- |
| **Overlay** | Panes are clipped by a movable divider (two dividers for 3 panes) so the result reads as a single image |
| **Side by side** | Fixed equal columns, each showing the *same* region of the scene; dragging pans them all together |

While comparing, **Export PNG 1:1** writes the comparison exactly as laid out; **Current** exports
just the edited pipeline.

#### Comparison frame

The comparison has its own rectangle, set with **Frame** in the comparison bar and measured in
export pixels. The presets follow your output resolution — the full size, half its height, half its
width — plus `1280×480` and `800×400` as fixed wide strips.

The render is **cropped inside that frame and dragged into place**, and the exported PNG is written
at exactly the frame size, so what you arrange on screen is what you get. Zoom magnifies the content
*inside* the frame rather than growing it, which is how you export a tight strip of a single detail.

**The frame is never scaled down to fit the window** — scaling it would resample the very pixels you
are trying to inspect. A frame larger than the window scrolls instead, so one screen pixel is always
one export pixel. Dragging pans the render inside the frame; the wheel and the scrollbars move the
window over it.

**Labels** shows the pane names, in the preview and in the exported PNG alike (on by default). Pane
A is named after the preset it was loaded from, so a comparison exported from one of your own
presets carries that name rather than a generic "Current".

**Benchmark** measures the real GPU cost of each pane with timer queries — not CPU time, which
would measure almost nothing — and reports the median GPU time per frame, a robust deviation and
the p10–p90 spread, with a performance percentage relative to the current pipeline. Choose **Quick**
(12 samples), **Standard** (30), **Thorough** (90) or **Extended** (300).

Timing a GPU from a browser is mostly a fight against measuring the wrong thing, so the run keeps
several rounds of work queued at all times — a GPU left waiting drops its clock, and the next sample
then measures a slower chip — sizes each batch to a target duration so cheap shaders are not lost in
timer quantization, and summarises with a median so one compositor hitch cannot drag a result
around. Anything still too noisy to trust is flagged rather than reported as fact.

**Read the Perf. column rather than the milliseconds.** The ratio between pipelines is stable; the
absolute time is not, because a GPU throttles as it heats. Going from 30 to 90 samples tightens the
ratio's run-to-run spread from ~4.6% to ~2.8%, but 300 only reaches ~2.0% while the absolute figures
visibly drift upward — past a point, extra samples buy precision on a moving quantity.

Expect the **first run after loading the page to be the noisiest**, since the GPU is still cold; a
second run settles. The figures rank pipelines against each other on your GPU; they are not a
prediction of handheld performance.

### Presets

The 29 stock configs are bundled in
`public/shaders/presets/`. Pick one in the **Presets** dropdown of the cfg panel and the whole
pipeline — passes, filters, scaling and shader parameters — is applied at once.

**Save preset** stores the pipeline you are working on in the browser as a user preset. Your presets
are listed first, above the stock ones, and can be renamed, updated to the current pipeline or
deleted. A dot next to the name means the pipeline has diverged from what was saved.

A user preset holds the same cfg text the panel shows, so loading one is identical to loading a
`.cfg` file — including any core options it carries.

### Recolouring a Game Boy screenshot

Game Boy shots are usually captured in flat greyscale. `npm run palette` recolours one into any of
Gambatte's 543 palettes:

```bash
npm run palette -- --list "TWB64 04"
npm run palette -- public/samples/gb-tetris.png "TWB64 040 - DMG Ver."
```

Indexed PNGs — what most screenshots are — are recoloured by rewriting the palette chunk, so the
pixels themselves are untouched. Colours are quantized to 5 bits per channel the way Gambatte packs
them, so they match what the handheld displays.

### Adding your own shader

Open the **Shaders** tab in the right dock. You can drop a `.glsl` file on it, pick one from disk,
or fetch one from a URL. Anything you add is kept in `localStorage`, appears in every pass dropdown
(there is an **＋ Add shader…** shortcut there too) and can be deleted from the same tab.

A shader is compiled before it is stored, so a broken one is reported with its compile log instead
of silently rendering as an empty pass. Names are always normalised to `.glsl` and can never shadow
a bundled shader — presets reference shaders by file name, so a custom `crt-perfect-v4.glsl` would
otherwise change what every stock preset renders; collisions get a `-2` suffix instead.

> [!NOTE]
> Loading from a URL is an ordinary browser `fetch`, so it only works if the server sends CORS
> headers. Raw GitHub links and CDNs do; most plain web servers do not. There is no way around that
> without a server to proxy through, so for anything else download the file and add it from disk.

To ship a shader with the project instead, drop it in `public/shaders/glsl/` and re-run `npm run dev`.

### Sharing a setup

**Share** copies a link that reproduces what you are looking at: the pipeline and its parameters,
the comparison and its frame, the source, zoom and pan, and which panels are open.

The whole thing rides in the URL fragment, compressed. That keeps it off the server entirely — no
request carries it, so nothing can reject or log it — and how much it costs depends on what you are
sharing:

| Sharing | Link size |
| --- | --- |
| A stock preset you have not edited | **~150 characters** — it travels as a reference, not a copy |
| An edited preset, or one of your own | **~250–450** — the cfg is embedded |
| A pipeline using one of your own shaders | **~9,500** — the GLSL is embedded too |

Over 8,000 characters you get a warning, since some chat and mail clients truncate long links. Over
16,000 it refuses and tells you which shaders are responsible and what each costs, rather than
handing you a link that silently breaks.

> [!NOTE]
> Opening someone's link does **not** touch your own saved session — it is applied for viewing only,
> and becomes yours the moment you change something. An uploaded screenshot cannot travel in a link,
> so the recipient sees the selected sample instead; you are told when that applies.

If a shared shader has the same name as one of yours but different contents, yours is kept and the
incoming one is renamed, with the pipeline repointed at it.

## How it works

The render graph mirrors NextUI exactly:

```
source texture ──▶ pass 1 (FBO) ──▶ pass 2 (FBO) ──▶ pass 3 (FBO) ──▶ default.glsl ──▶ screen
```

**Per-pass sizing** (`upscale` → `scale`, where `screen` is scale 9):

| Value | `InputSize` (`srctype`) | `TextureSize` (`scaletype`) | `OutputSize` |
| --- | --- | --- | --- |
| `source` | original source size | original source size | `last × scale` |
| `relative` | previous pass output | previous pass output | `last × scale` |

The engine also understands a third value, `viewport` (the destination rect), which the cfg reader
accepts but the UI does not offer — NextUI's own menu does not expose it either.

**Uniforms** set on every pass: `MVPMatrix` (identity), `FrameDirection` (1), `FrameCount`, `OutputSize`,
`TextureSize`, `InputSize`, `OrigTextureSize`, `OrigInputSize`, `texelSize` (`1/TextureSize`), `Texture`
(unit 0), `OrigTexture` (unit 1), and one `float` per `#pragma parameter`.

**GLSL preprocessing**, ported from `load_shader_from_file()`:

1. every `#pragma parameter` line is stripped
2. `#version 110…450` becomes `#version 300 es`; a missing `#version` becomes `#version 100`
3. `#define VERTEX` or `#define FRAGMENT` + the ES precision block is inserted after the version line
4. `PARAMETER_UNIFORM` is defined **for the fragment stage only** — so parameters used in a vertex stage
   fall back to their compile-time defaults, exactly like on the device

The intermediate target of pass *N* is created with pass *N+1*'s filter, and the source texture uses pass 1's
filter — the subtle detail that makes `NEAREST`/`LINEAR` chains behave identically.

**Destination rect**, ported from `selectScaler()` + `setRectToAspectRatio()`:

| Mode | Rect |
| --- | --- |
| `Native` | `src × min(⌊W/w⌋, ⌊H/h⌋)`, centered |
| `Cropped` | `src × min(⌈W/w⌉, ⌈H/h⌉)`, centered (overscans) |
| `Aspect` | height-driven fit of the core aspect ratio, clamped to width |
| `Aspect (screen)` | same fit using the source's own aspect |
| `Fullscreen` | the whole screen (stretch) |

## CFG format

The exported file is a `minarch` config, ready to be used as `<rom>.cfg` or as a preset in `Shaders/`:

```ini
minarch_screen_scaling = Aspect
minarch_scale_filter = NEAREST

minarch_nrofshaders = 2
minarch_shader1 = pixellate.glsl
minarch_shader1_filter = NEAREST
minarch_shader1_srctype = source
minarch_shader1_scaletype = source
minarch_shader1_upscale = 2
minarch_shader2 = scanline.glsl
minarch_shader2_filter = NEAREST
minarch_shader2_srctype = relative
minarch_shader2_scaletype = relative
minarch_shader2_upscale = screen

INTERPOLATE_IN_LINEAR_GAMMA = 1.00
```

Shader parameters are written under their raw pragma name with `%.2f` formatting, snapped to the
`(max - min) / step` value list NextUI builds for its menu.

> [!TIP]
> Loading a cfg keeps every key it does not own — core options such as `gambatte_gb_internal_palette`
> survive a full round-trip through the lab.

## Fidelity notes

The pipeline is intentionally faithful, including quirks. Known deviations:

- **Y orientation** is reproduced rather than corrected: the source is uploaded without `UNPACK_FLIP_Y`
  (matching `glTexImage2D` of a top-down buffer) and `default.glsl` flips at the end, which keeps
  scanline and dot-matrix phase identical to the device.
- **`#extension GL_OES_standard_derivatives`** is emitted by NextUI's precision block. Derivatives are core in
  ES 3.0, so if a driver rejects the directive the lab retries without it and reports the deviation in the log.
- **NextUI only refreshes uniforms when the GL program handle changes.** Because every pass owns its own
  program object this is a no-op on device, so the lab simply sets uniforms on every pass.
- **A pass whose shader fails to compile is skipped** and the pipeline continues, instead of rendering an
  undefined target. The failure is reported in the log panel.
- The final `dst_rect` viewport is converted to GL's bottom-left origin. For NextUI's always-centered rects
  this is identical to the device.
- Overlays, screen effects and notification layers are out of scope — only the game pipeline is simulated.

## Project structure

```
public/shaders/glsl/      29 stock shaders (21 NextUI + 8 perfect-retroshaders)
public/shaders/presets/   29 stock shader configs (incl. the per-system sets/)
public/shaders/           default.glsl — the final scale pass · LICENSE · NOTICE
public/samples/           game screenshots + index.json + NOTICE
scripts/                  asset manifest generator
src/core/
  glsl-preprocess.ts      port of load_shader_from_file()
  pragma-params.ts        #pragma parameter parsing + NextUI step quantization
  scaling.ts              destination rect for all 5 scaling modes
  pipeline.ts             the WebGL2 render graph
  cfg.ts                  minarch .cfg reader/writer
  test-patterns.ts        generated console-resolution sources
  state.ts                app state + localStorage
src/components/           Lit web components (rsl-*)
```

## Credits & licensing

RetroShader Lab is © 2026 Yohan Lasorsa and released under the **GNU GPL v3 or later**
(see `LICENSE`), matching the license of NextUI it is derived from.

- **Shaders and presets** in `public/shaders/` are byte-identical copies from two upstreams:
  [NextUI](https://github.com/LoveRetro/NextUI) (GPL-3.0) for most of them, and
  [perfect-retroshaders](https://github.com/sinedied/perfect-retroshaders) (MIT, same author as this
  lab) for the `crt-perfect`, `lcd-perfect` and `pixel-perfect` family. Most of the NextUI shaders
  originate from the [libretro GLSL collection](https://github.com/libretro/glsl-shaders) and keep
  the license stated in their own header — see `public/shaders/NOTICE`.
- **Screenshots** in `public/samples/` come from
  [libretro-thumbnails](https://github.com/libretro-thumbnails/libretro-thumbnails) `Named_Snaps`
  (captured with shaders and filters off, at native resolution). They depict copyrighted works that
  remain the property of their respective publishers and are **not** covered by this project's
  license — see `public/samples/NOTICE`.
