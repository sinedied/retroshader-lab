// lcd-perfect-v3 - a sinusoidal LCD mesh over a pixel-perfect scale.
// -----------------------------------------------------------------------------
// Author:  sinedied
// Licence: MIT - Copyright (c) 2026 sinedied
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions: the above copyright
// notice and this permission notice shall be included in all copies or
// substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
// WITHOUT WARRANTY OF ANY KIND.
// -----------------------------------------------------------------------------
// PARAMETERS
//
//   lp_grid        0.00 - 1.00  Grid visibility. 0 disables it.
//   lp_balance     0.00 - 1.00  Row/column balance. 0 rows, 1 columns.
//   lp_min_pitch   2.00 - 6.00  Smallest pattern pitch, in output pixels.
//   lp_subpixels   0.00 - 1.00  RGB stripe visibility. 0 disables them.
//   lp_layout      0 / 1        Stripe order: RGB or BGR.
//   lp_brightness  0.25 - 4.00  Output gain.
//   lp_gamma       0.50 - 2.00  Source gamma. 1.00 disables it.
// -----------------------------------------------------------------------------
// Simulates a handheld LCD panel as a soft mesh rather than a hard matrix: one
// sinusoid across the source columns and one across the rows, both locked to
// the source grid. This is the shape lcd1x uses, and a sinusoid carries no
// harmonics to fold back past Nyquist, so it stays clean where a hard-edged
// aperture needs a widened ramp to.
//
// lp_balance sets which axis dominates. Real panels are row-dominant - a Game
// Boy Color measures a 9% matrix down against 3.7% across - but lcd1x is the
// reverse at about 4:1, which is a balance of 0.8.
//
// The mesh follows the source grid while there is room for it. Below
// lp_min_pitch output pixels per cell it takes a fixed output-space pitch
// instead, phase-aligned to the pixel grid. That is what keeps a 480x272 source
// usable: at 640x480 it is 1.33 output pixels per cell, below the two per cycle
// any pattern needs, and a source-locked mesh folds there to a wrong coarser
// pitch at nearly full strength.
//
// The stripes are three sinusoids 120 degrees apart, summing to a constant at
// every pixel. They ride the mesh's pitch rules, so they band-limit with it.
//
// Notes:
// - Render at the output resolution, 1:1 with the display.
// - A column mesh and the stripes share a pitch, so they multiply into a
//   per-channel cast. It is divided out in closed form.

#pragma parameter lp_grid       "Grid visibility"          0.37 0.00 1.00 0.01
#pragma parameter lp_balance    "Row/column balance"       0.79 0.00 1.00 0.01
#pragma parameter lp_min_pitch  "Minimum pitch in px"      3.00 2.00 6.00 0.25
#pragma parameter lp_subpixels  "RGB stripe visibility"    0.20 0.00 1.00 0.05
#pragma parameter lp_layout     "Stripe order 0=RGB 1=BGR" 0.00 0.00 1.00 1.00
#pragma parameter lp_brightness "Brightness"               1.00 0.25 4.00 0.05
#pragma parameter lp_gamma      "Gamma"                    1.00 0.50 2.00 0.05

#if defined(VERTEX)

#if __VERSION__ >= 130
#define COMPAT_VARYING out
#define COMPAT_ATTRIBUTE in
#define COMPAT_TEXTURE texture
#else
#define COMPAT_VARYING varying
#define COMPAT_ATTRIBUTE attribute
#define COMPAT_TEXTURE texture2D
#endif

#ifdef GL_ES
#define COMPAT_PRECISION mediump
#else
#define COMPAT_PRECISION
#endif

COMPAT_ATTRIBUTE vec4 VertexCoord;
COMPAT_ATTRIBUTE vec4 COLOR;
COMPAT_ATTRIBUTE vec4 TexCoord;
COMPAT_VARYING vec4 COL0;
COMPAT_VARYING vec4 TEX0;

uniform mat4 MVPMatrix;
uniform COMPAT_PRECISION int FrameDirection;
uniform COMPAT_PRECISION int FrameCount;
uniform COMPAT_PRECISION vec2 OutputSize;
uniform COMPAT_PRECISION vec2 TextureSize;
uniform COMPAT_PRECISION vec2 InputSize;

void main()
{
    gl_Position = MVPMatrix * VertexCoord;
    COL0 = COLOR;
    TEX0.xy = TexCoord.xy;
}

#elif defined(FRAGMENT)

#if __VERSION__ >= 130
#define COMPAT_VARYING in
#define COMPAT_TEXTURE texture
out vec4 FragColor;
#else
#define COMPAT_VARYING varying
#define FragColor gl_FragColor
#define COMPAT_TEXTURE texture2D
#endif

#ifdef GL_ES
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define COMPAT_PRECISION highp
#else
#define COMPAT_PRECISION
#endif

uniform COMPAT_PRECISION int FrameDirection;
uniform COMPAT_PRECISION int FrameCount;
uniform COMPAT_PRECISION vec2 OutputSize;
uniform COMPAT_PRECISION vec2 TextureSize;
uniform COMPAT_PRECISION vec2 InputSize;
uniform sampler2D Texture;
COMPAT_VARYING vec4 TEX0;

#ifdef PARAMETER_UNIFORM
uniform COMPAT_PRECISION float lp_grid;
uniform COMPAT_PRECISION float lp_balance;
uniform COMPAT_PRECISION float lp_min_pitch;
uniform COMPAT_PRECISION float lp_subpixels;
uniform COMPAT_PRECISION float lp_layout;
uniform COMPAT_PRECISION float lp_brightness;
uniform COMPAT_PRECISION float lp_gamma;
#else
#define lp_grid 0.37
#define lp_balance 0.79
#define lp_min_pitch 3.00
#define lp_subpixels 0.20
#define lp_layout 0.0
#define lp_brightness 1.00
#define lp_gamma 1.00
#endif

#define TAU 6.283185307
#define PI  3.141592654

// Integral of the aperture profile 1 - m*cos(TAU*(t - phase)), in cycles.
// Differencing it over an output pixel's footprint is the exact box filter, and
// at an integer t the sine term depends on the phase alone, which is what lets
// the blend below be weighted by aperture rather than by area.
vec2 apertureIntegral(vec2 t, vec2 m, vec2 phase)
{
    return t - m * sin(TAU * (t - phase)) / TAU;
}

// Mean of a unit sinusoid of f cycles per output pixel over one pixel, reaching
// zero at one cycle per pixel. The mesh gets this exactly, from the integral
// above; the stripes are sampled rather than integrated, so they need it named.
float boxSinc(float f)
{
    float x = PI * max(f, 1e-4);
    return sin(x) / x;
}

// Nothing above Nyquist can be represented, so take the pattern out entirely
// rather than let it fold to a coarser pitch at nearly full strength. Reaching
// zero at half a cycle per pixel is the point: between there and one cycle the
// fold is what would be seen, not the pattern.
vec2 nyquistFade(vec2 f)
{
    return 1.0 - smoothstep(0.34, 0.5, f);
}

void main()
{
    vec2 p = TEX0.xy * TextureSize;
    vec2 d = max(InputSize / OutputSize, 1e-6);
    vec2 h = 0.4995 * d;
    vec2 B = floor(p + 0.5);

    // ------------------------------------------------------------------
    // Which regime the mesh is in.
    //
    // One cycle per source cell while the cells are big enough to carry it, so
    // the mesh follows the content. Below lp_min_pitch output pixels per cell it
    // stops tracking the source and takes a fixed output-space pitch, which is
    // exactly periodic on the pixel grid and so cannot alias at all.
    //
    // A sinusoid does not band-limit itself. The trapezoid this shader grew out
    // of did - its coverage flattens on its own as cells shrink - and the fade
    // was dropped along with it when the aperture changed. That is what let a
    // 480x272 source through: at 640x480 it is 1.33 output pixels per cell,
    // below the two per cycle a pattern needs, and it folded to a wrong coarser
    // pitch at nearly full amplitude.
    //
    // The regime blend is a narrow biased smoothstep, not a comparison. GPUs
    // evaluate a/b as a*rcp(b), so a pitch mathematically equal to lp_min_pitch
    // can land either side of it, and the regimes do not agree on contrast.
    // ------------------------------------------------------------------
    vec2 srcPitch = 1.0 / d;
    vec2 f        = 1.0 / max(srcPitch, vec2(lp_min_pitch));
    vec2 locked   = 1.0 - smoothstep(lp_min_pitch * 1.001,
                                     lp_min_pitch * 1.02, srcPitch);

    vec2 amp = clamp(lp_grid * 2.0 * vec2(lp_balance, 1.0 - lp_balance), 0.0, 1.0)
               * mix(nyquistFade(f), vec2(1.0), locked);

    // Half an output pixel, in cycles. It puts one sample per cycle on the
    // trough, which is what lets a two-pixel pitch resolve at all: sampling at
    // pixel centres instead places both samples symmetrically about the peak,
    // and they return the same value.
    vec2 phase = 0.5 * f;

    // The pattern coordinate. With f == d this is exactly p, so the
    // source-locked regime needs no separate code path.
    vec2 t  = TEX0.xy * OutputSize * f;
    vec2 hh = 0.4995 * f;

    vec2 Alo = apertureIntegral(t - hh, amp, phase);
    vec2 Ahi = apertureIntegral(t + hh, amp, phase);
    vec2 I   = max(Ahi - Alo, 1e-6);

    // Peak-normalised, so the flat top lands at 1 and nothing meets the clamp.
    vec2 g = I / (2.0 * hh * (1.0 + amp));
    float gain = g.x * g.y;

    // ------------------------------------------------------------------
    // The blend weights.
    //
    // While the mesh tracks the cells, its dark line sits on the cell boundary,
    // which is where the scaler's one soft transition pixel sits too, so the two
    // correlate and the blend has to be weighted by how much aperture falls each
    // side rather than how much area. Once the mesh locks to output space that
    // correlation is gone and plain area weights are the correct ones, so the
    // two are blended on the same regime term.
    // ------------------------------------------------------------------
    vec2 AB  = B + amp * sin(TAU * phase) / TAU;
    vec2 wAp = clamp((AB - Alo) / I, 0.0, 1.0);
    vec2 wAr = clamp((B - p + h) / (2.0 * h), 0.0, 1.0);
    vec2 w   = mix(wAp, wAr, locked);

    vec2 lo = (B - 0.5) / TextureSize;
    vec2 hi = (B + 0.5) / TextureSize;

    vec3 a = COMPAT_TEXTURE(Texture, vec2(lo.x, lo.y)).rgb;
    vec3 b = COMPAT_TEXTURE(Texture, vec2(hi.x, lo.y)).rgb;
    vec3 c = COMPAT_TEXTURE(Texture, vec2(lo.x, hi.y)).rgb;
    vec3 e = COMPAT_TEXTURE(Texture, vec2(hi.x, hi.y)).rgb;

    // Gamma on the taps, before the blend, so the blend stays linear in them.
    // pow(0, g) is undefined and returns NaN on real drivers, and black texels
    // are everywhere, so the base is clamped; 1e-8 is small enough that pure
    // black still encodes to 0 even at the lowest gamma.
    if (abs(lp_gamma - 1.0) > 0.001) {
        vec3 gm = vec3(lp_gamma);
        a = pow(max(a, 1e-8), gm);
        b = pow(max(b, 1e-8), gm);
        c = pow(max(c, 1e-8), gm);
        e = pow(max(e, 1e-8), gm);
    }

    vec3 color = mix(mix(e, c, w.x), mix(b, a, w.x), w.y);

    // ------------------------------------------------------------------
    // RGB stripes: three sinusoids 120 degrees apart, which sum to exactly 3 at
    // every pixel, so the stripe is luminance neutral by construction and blue
    // costs no third cosine. They ride the mesh's own pitch rules, so the box
    // filter and the Nyquist fade band-limit them and no separate fade is
    // needed - the one they used to have switched them off entirely at 3.2
    // output pixels per cell, which is the most common scale there is.
    //
    // The -1/6 centres the triad on its cell: red at 1/6, green at 1/2 and blue
    // at 5/6 across it.
    // ------------------------------------------------------------------
    vec3 stripe = vec3(1.0);
    if (lp_subpixels > 0.0) {
        float sinc = mix(boxSinc(f.x), 1.0, locked.x);
        float ac   = lp_subpixels * sinc * mix(nyquistFade(f).x, 1.0, locked.x);
        vec2 rg = 1.0 + ac * cos(TAU * (t.x - phase.x - (1.0 / 6.0)
                                        - vec2(0.0, 1.0 / 3.0)));
        stripe = vec3(rg, 3.0 - rg.x - rg.y);

        // --------------------------------------------------------------
        // Take the colour cast out.
        //
        // A column mesh and a stripe mask both sit at one cycle per cell, so
        // they correlate: whichever stripe lands on the mesh's dark line is
        // dimmed relative to the other two, and swapping the stripe order swaps
        // which one, so RGB and BGR cast in different directions. It is not a
        // small effect - an uncorrected column-dominant mesh casts about four
        // levels on a white field, where crt-perfect casts none, and it is only
        // absent there because a CRT mask has no column pattern to correlate
        // with in the first place.
        //
        // The mean of the product over a cell has a closed form: for a mesh
        // 1 - M*cos(TAU*(t - psi)) against a stripe 1 + ac*cos(TAU*(t - k)) it
        // is 1 - (M*ac/2)*cos(TAU*(k - psi)). Dividing each channel by that
        // equalises the three for a per-channel constant and no extra taps. The
        // amplitude has to be the box-filtered one, not the nominal one, or the
        // correction overshoots wherever the filter is biting.
        // --------------------------------------------------------------
        float M = amp.x * sinc;
        vec3 corr = 1.0 - 0.5 * M * ac
                    * cos(TAU * (vec3(0.0, 1.0 / 3.0, 2.0 / 3.0) + (1.0 / 6.0)
                                 - phase.x));
        stripe /= max(corr, 1e-3);

        if (lp_layout >= 0.5) {
            stripe = stripe.bgr;
        }
    }

    // The colour is still encoded, and the encoding is treated as a gamma of 2,
    // so sqrt(linear * m) == encoded * sqrt(m): one square root replaces the
    // whole decode, modulate and re-encode round trip.
    vec3 m = sqrt(max(stripe * (gain * lp_brightness), 0.0));

    FragColor = vec4(clamp(color * m, 0.0, 1.0), 1.0);
}


#endif
