"use client";

/**
 * The stone, in three dimensions, being struck.
 *
 * A bolt falls out of the dark onto the table of a round brilliant. The light
 * enters, splits by wavelength inside the stone, bounces off the pavilion, and
 * leaves through the crown and girdle as spectral fire; what escapes downward
 * lands on the floor as caustics with the gem's own eight-fold star in it.
 *
 * WHY THIS IS NOT REACT THREE FIBER
 *
 * The brief asked for R3F, drei's <MeshTransmissionMaterial>, postprocessing
 * and GSAP. That is four dependencies and roughly three quarters of a megabyte
 * on the first screen of a page whose entire existing motion budget is one
 * fragment shader — and it buys a *worse* diamond. Transmission materials are
 * a screen-space trick: they sample a render target behind the object and
 * offset the three colour channels to imply dispersion. There is no ray inside
 * the stone, so there is no total internal reflection, and TIR is the whole
 * reason a brilliant cut is bright. What comes out looks like glass.
 *
 * So this traces the light instead. `lib/gemSolid.ts` gives the stone as 41
 * half-spaces, which a fragment shader intersects exactly by the slab method:
 * one linear pass returns entry point, exit point and both normals with no
 * marching and no rounded edges. From there it is real optics — Fresnel at
 * every interface, an independent path per wavelength at diamond's actual
 * dispersion (n = 2.407 red to 2.451 blue), five internal bounces with proper
 * TIR — in one WebGL2 program, no dependencies, and the same
 * `requestAnimationFrame`-with-a-kill-switch shape as `AmbientShader`.
 *
 * WHAT KEEPS IT AFFORDABLE
 *
 *   - The expensive path runs only inside the gem's bounding sphere, tested
 *     analytically first. Background pixels cost one gradient and a bolt.
 *   - Interior bounces light themselves from a cheap environment; only the
 *     primary ray and the mirror reflection pay for the full one.
 *   - Resolution is adaptive. The frame time is measured and the render scale
 *     walks between 0.5 and 1.0 to hold the target — a fixed scale is a guess
 *     about hardware nobody has, and this scene is genuinely heavy on an
 *     integrated GPU and genuinely trivial on a discrete one.
 *
 * And the three things it must not do, the same three as the ambient field:
 * cost anything in a hidden tab, override a motion preference (reduced motion
 * gets one still frame of the stone lit, not a strobing bolt), or fail loudly.
 * No WebGL2, no float buffers, a driver that refuses the program: the canvas
 * stays empty and whatever is behind it is the page.
 */

import { useEffect, useRef } from "react";
import { GEM_BOUND, GEM_PLANES, GEM_PLANE_DATA } from "@/lib/gemSolid";

/** Live knobs, so the scene can be tuned against a real screen rather than
 *  guessed at in source. `GemLightning` re-reads these every frame from a ref,
 *  so changing one never rebuilds the program or drops a frame. */
export interface GemSettings {
  /** Spread between the red and blue indices. 0 is colourless glass. */
  dispersion: number;
  /** Strength of the Bifrost column falling on the stone. 0 is no beam. */
  beam: number;
  /** Overall exposure before tone mapping. */
  exposure: number;
  /** Bloom strength on the bright parts. */
  bloom: number;
  /** Turns of the stone per second. */
  spin: number;
  /** Camera distance from the stone. */
  camDist: number;
  /** Camera height above the stone's centre. */
  camHeight: number;
  /** Focal term: larger is a longer lens, a narrower field. */
  zoom: number;
  /** Strength of the studio sources and the overhead fill. */
  light: number;
  /** The Bifröst: strength of the spectral bridge leaving the stone. 0 is no
   *  bridge, which is every scene but the last. */
  arc: number;
}

export const GEM_DEFAULTS: GemSettings = {
  dispersion: 0.022,
  beam: 1.0,
  exposure: 1.45,
  bloom: 0.70,
  spin: 0.018,
  camDist: 7.20,
  camHeight: 0.95,
  zoom: 2.35,
  light: 1.0,
  arc: 0.0,
};

const VERT = `#version 300 es
in vec2 pos;
out vec2 vUv;
void main() {
  vUv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime;
uniform float uDisp;
uniform float uBeam;       // strength of the Bifrost column
uniform float uSpin;
uniform float uStill;      // 1.0 under prefers-reduced-motion
uniform vec2 uPointer;     // -1..1, parallax only
uniform vec4 uPlanes[NP];
uniform vec3 uCam;         // distance, height, focal
uniform float uLight;      // studio + fill multiplier
uniform float uArc;        // strength of the Bifröst bridge leaving the stone

const float IOR = 2.417;                 // diamond, sodium D line
const float F0 = 0.172;                  // ((1-n)/(1+n))^2 at normal incidence
const vec3 GEM_POS = vec3(0.0, 0.12, 0.0);
const float FLOOR_Y = -1.28;
const float BEAM_TOP = 11.0;   // above the frame at every camera the story uses
const float BACKDROP_FILL = 0.20;   // see envLite

// ---------------------------------------------------------------- hashes

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

// --------------------------------------------------------------- the Bifrost
//
// One beam, and it does not strike: it pours. Everything that made the old
// path read as lightning -- the stepped leader, the forks, the impulse
// envelope, the per-strike seed -- is gone, because a beam that flickers is a
// bolt. What is left is a standing column of near-white light that arrives
// from above the frame, lands on the table, and holds.
//
// White on the way down is the whole point of the page: the spectrum is what
// the stone does to the light, so it must not already be in the air.

const float BEAM_R = 0.58;                     // radius of the bright column
const float BEAM_BASE = 0.34 + GEM_POS.y;      // the table, where it lands

/** The beam breathes rather than flickers. Slow on purpose: a source this
 *  bright reads as a strobe at anything quicker, and the brief is a bridge,
 *  not a storm. */
float beamPulse() {
  float t = uTime * (1.0 - uStill);
  return 0.72 + 0.13 * sin(t * 0.53) + 0.05 * sin(t * 1.31 + 1.1);
}

/** The column, integrated along the view ray.
 *
 *  A cylinder around the stone's axis, clipped to the height between the sky
 *  and the table, marched at a fixed step. Marched rather than sampled at the
 *  closest approach because the interesting part is the structure *inside* the
 *  beam -- descending striations and a slow helix -- and one closest approach
 *  can only ever produce a smooth wedge. Sixteen steps is enough: the medium
 *  is smooth along the ray, and it is across the ray that it has detail, which
 *  is exact at every sample. */
vec3 beamColumn(vec3 ro, vec3 rd) {
  vec2 o = ro.xz - GEM_POS.xz;
  float a = dot(rd.xz, rd.xz);
  if (a < 1e-6) return vec3(0.0);
  float b = dot(o, rd.xz);
  // Marched out to the halo, not to the core: the wide dim skirt is most of
  // what makes the air around the beam read as air.
  float rmax = BEAM_R * 3.4;
  float disc = b * b - a * (dot(o, o) - rmax * rmax);
  if (disc <= 0.0) return vec3(0.0);
  float sq = sqrt(disc);
  float t0 = max((-b - sq) / a, 0.0);
  float t1 = (-b + sq) / a;

  // Clipped to the column's height. The far end is above the frame on purpose:
  // the beam has to arrive from somewhere the camera cannot see.
  if (abs(rd.y) > 1e-4) {
    float ta = (BEAM_BASE - ro.y) / rd.y;
    float tb = (BEAM_TOP - ro.y) / rd.y;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (ro.y < BEAM_BASE || ro.y > BEAM_TOP) {
    return vec3(0.0);
  }
  if (t1 <= t0) return vec3(0.0);

  float t = uTime * (1.0 - uStill);
  float dt = (t1 - t0) / 16.0;
  float bright = 0.0;
  float skirt = 0.0;
  for (int i = 0; i < 16; i++) {
    vec3 p = ro + rd * (t0 + dt * (float(i) + 0.5));
    vec2 q = p.xz - GEM_POS.xz;
    // Narrowing as it descends. A parallel-sided column reads as a cylinder
    // drawn over the stone; a slight taper reads as light being drawn *into*
    // it, which is the whole claim the scene is making.
    float taper = 0.72 + 0.28 * smoothstep(BEAM_BASE, BEAM_BASE + 4.0, p.y);
    float r = length(q) / (BEAM_R * taper);
    float core = exp(-r * r * 22.0);
    float sheath = exp(-r * r * 3.0) * 0.30;
    float halo = exp(-r * r * 0.30) * 0.035;
    // The flow, as a function of height rather than of screen position, so it
    // travels *down* the beam instead of crawling across the frame. Two
    // scales: a slow helix that turns the column, and fine striations riding
    // it that give the light somewhere to be granular.
    float ang = atan(q.y, q.x);
    float flow = 0.76 + 0.24 * sin(p.y * 2.4 - t * 1.05 + ang * 0.8);
    flow *= 0.88 + 0.12 * sin(p.y * 9.5 - t * 2.4 + ang * 1.6);
    // Funnelled: denser as it nears the stone, because that is where it is
    // being drawn to and it is the only place the beam has a reason to end.
    float pull = 0.80 + 0.55 * exp(-(p.y - BEAM_BASE) * 0.55);
    bright += (core + sheath) * flow * pull * dt;
    skirt += halo * pull * dt;
  }
  // Near-white, with the cool cast the rest of the page is graded in. The
  // faint colour lives in the skirt, never in the core: the core is the raw
  // opportunity and it is white until the stone gets hold of it.
  return vec3(0.94, 0.98, 1.0) * bright * 2.1
       + vec3(0.38, 0.74, 1.00) * skirt * 2.4;
}

/** The column plus its landing. Without the landing the beam arrives at the
 *  stone and simply stops, which reads as a beam drawn *near* the gem rather
 *  than one falling on it. */
vec3 beamGlow(vec3 ro, vec3 rd) {
  if (uBeam <= 0.0) return vec3(0.0);
  vec3 apex = vec3(GEM_POS.x, BEAM_BASE, GEM_POS.z);
  vec3 av = apex - ro;
  float at = max(dot(av, rd), 0.0);
  vec3 off = av - rd * at;
  float d2 = dot(off, off);
  vec3 land = vec3(0.85, 0.95, 1.00) * exp(-d2 * 26.0) * 0.45
            + vec3(0.30, 0.66, 1.00) * exp(-d2 * 2.6) * 0.10;
  return (beamColumn(ro, rd) + land) * uBeam * beamPulse();
}

// ---------------------------------------------------------------- Bifröst
//
// The ending. Everything the story split is finally *going* somewhere: a sheet
// of spectral light leaves the stone, arcs up out of the frame, and holds —
// the bridge, not a diagram of one.
//
// It is a sheet, and that is the whole trick. Fifty-four straight lines drawn
// from the gem to fifty-four points is a fan of hairlines: no volume, no
// falloff, no reason for the eye to read light rather than geometry. A sheet
// of light has a normal, so it is intersected analytically in one step instead
// of marched — cost of a plane hit and a handful of sines, per pixel, and it
// gets the one thing the fan could never have: it brightens where the view ray
// looks along it and thins where the ray cuts across, which is what makes an
// aurora look like it is made of nothing.
//
// The spectrum runs across the width, not along the length, because that is
// what the stone did to the light: the bridge is the dispersion, laid out.
vec3 bifrost(vec3 ro, vec3 rd) {
  if (uArc <= 0.001) return vec3(0.0);
  vec3 A = GEM_POS;
  vec3 D = normalize(vec3(0.94, 0.30, -0.22));     // where the bridge is headed
  vec3 V = normalize(cross(D, vec3(0.0, 1.0, 0.0)));  // the sheet's normal
  vec3 U = cross(V, D);                            // in-plane "up", the width

  float dv = dot(rd, V);
  if (abs(dv) < 1e-4) return vec3(0.0);
  float t = -dot(ro - A, V) / dv;
  if (t <= 0.05) return vec3(0.0);
  // Clamped rather than raw: an exactly edge-on ray has an infinite path
  // through a zero-thickness sheet, and the honest answer there is a bright
  // line across the screen that nobody wants.
  float graze = 1.0 / max(abs(dv), 0.22);

  vec3 q = ro + rd * t - A;
  float s = dot(q, D);
  if (s < 0.0 || s > 30.0) return vec3(0.0);
  // The arc. Rises out of the stone and flattens as it goes, which is the
  // difference between a bridge and a searchlight.
  float u = dot(q, U) - (0.30 * s - 0.013 * s * s);
  float halfW = 0.40 + 0.155 * s;                  // it widens as it travels
  float n = u / halfW;
  if (abs(n) > 1.3) return vec3(0.0);

  float tm = uTime * (1.0 - uStill);
  // Spectral across the width: one sweep, red edge to violet edge.
  float k = clamp(n * 0.5 + 0.5, 0.0, 1.0);
  vec3 hue = 0.55 + 0.45 * cos(6.2831853 * (vec3(0.00, 0.33, 0.67) + k * 0.92));
  float band = 0.74 + 0.26 * sin(k * 26.0);        // the bands, softly
  // Energy travelling outward, plus a slow shimmer so the sheet is never flat.
  float flow = 0.68 + 0.32 * sin(s * 1.8 - tm * 1.9 + n * 2.2);
  flow *= 0.86 + 0.14 * vnoise(vec2(s * 1.4 - tm * 0.8, n * 2.2));

  float across = exp(-n * n * 2.4) * smoothstep(1.28, 0.72, abs(n));
  float along = smoothstep(0.0, 1.5, s) * exp(-s * 0.075);
  float sheet = across * along * band * flow * graze * 0.40;

  // White at the mouth: the light has not travelled far enough to have
  // separated yet, and a bridge that is already a rainbow at the stone reads
  // as painted on rather than thrown.
  vec3 c = mix(vec3(1.0, 1.0, 1.0), hue, smoothstep(0.5, 3.4, s)) * sheet;
  c += vec3(0.80, 0.93, 1.00) * exp(-s * s * 0.45) * across * graze * 0.16;
  return c * uArc;
}

// ------------------------------------------------------------- environment

/** The cheap environment, used for the fifteen lookups an interior path makes.
 *  No bolt integration, no caustics: from inside the stone what matters is
 *  where the bright things are, not their fine structure.
 *
 *  The fill parameter scales the soft, wide sources only. At 1.0 (what an interior ray
 *  sees) the stone is lit like a photographed gem; at 0.2 (what the camera
 *  sees looking past it) the room stays black. Raising the fill for both at
 *  once is what turned the page steel-blue: the light that makes a diamond
 *  read is also the light that destroys the background it reads against. */
vec3 envLite(vec3 d, float energy, float fill) {
  // A studio backdrop rather than a sky: darkest overhead, lifting to a soft
  // glow that sits *on* the horizon. The first version graded the other way and
  // the result was a bright plate above a black one, meeting in a hard
  // horizontal line across the frame — the most visible thing on the page, and
  // it was the horizon, not the stone.
  // Backdrop and key light are separated on purpose, the way a stone is
  // actually photographed: the room is black, the lights are hard and narrow.
  // Grading the whole environment up to light the stone lit the *page* too,
  // and a bright steel-blue field is a different product from this one.
  float h = abs(d.y);
  vec3 c = mix(vec3(0.014, 0.026, 0.034), vec3(0.004, 0.008, 0.013),
               smoothstep(0.0, 0.75, h));
  c += vec3(0.020, 0.046, 0.062) * exp(-h * 13.0) * 0.85;

  // A broad overhead source on top of the pinpoints. Without it a facet only
  // catches light when it happens to aim at one of the three hard sources, and
  // the stone spends most of its rotation black — which is exactly what a
  // diamond under a single bare lamp does look like, and not what anyone means
  // by a diamond. The wide lobe is the softbox; the pinpoints are the sparkle.
  c += vec3(0.05, 0.10, 0.14) * pow(max(d.y, 0.0), 2.2) * 1.2 * fill * uLight;
  c += vec3(0.012, 0.024, 0.033) * 0.6 * fill * uLight;

  // The bolt, as a shaft overhead. This is the stone's key light, so it has to
  // be present in the cheap version or the interior goes black between strikes.
  vec3 up = normalize(vec3(0.06, 1.0, -0.04));
  float axis = max(dot(d, up), 0.0);
  c += vec3(0.55, 0.86, 1.0) * pow(axis, 30.0) * (0.35 + energy * 3.4);
  c += vec3(0.30, 0.62, 0.85) * pow(axis, 5.0) * (0.05 + energy * 0.5);

  // Two studio sources, because a stone with one light has one highlight and
  // reads as plastic. Cool key from the front left, warm counter from behind
  // right: the counter is what makes the dispersion legible, since a spectrum
  // split out of a purely cyan source is still cyan.
  c += vec3(0.50, 0.85, 1.00) * pow(max(dot(d, normalize(vec3(-0.55, 0.62, 0.55))), 0.0), 90.0) * 9.0 * uLight;
  c += vec3(0.24, 0.46, 0.58) * pow(max(dot(d, normalize(vec3(-0.55, 0.62, 0.55))), 0.0), 9.0) * 1.7 * fill * uLight;
  c += vec3(1.00, 0.52, 0.26) * pow(max(dot(d, normalize(vec3(0.72, 0.28, -0.62))), 0.0), 40.0) * 4.2 * uLight;
  c += vec3(0.55, 0.28, 0.16) * pow(max(dot(d, normalize(vec3(0.72, 0.28, -0.62))), 0.0), 6.0) * 0.95 * fill * uLight;
  c += vec3(0.36, 0.30, 0.95) * pow(max(dot(d, normalize(vec3(0.35, -0.35, 0.86))), 0.0), 26.0) * 0.9 * fill * uLight;

  // The floor, flat: enough for an interior ray to know that down is dimmer.
  c = mix(c, vec3(0.006, 0.011, 0.015), smoothstep(0.0, -0.35, d.y) * 0.55);
  return c;
}

/** Caustics: the pattern the stone throws on the floor. Two warped sine
 *  lattices for the fluid net, times an eight-fold angular star for the cut's
 *  own signature, all inside a radial falloff around the stone. */
float caustic(vec2 p, float t) {
  vec2 q = p * 2.6;
  float v = 0.0;
  for (int i = 0; i < 3; i++) {
    q += vec2(sin(q.y * 1.7 + t * 0.6), cos(q.x * 1.6 - t * 0.5)) * 0.55;
    v += 1.0 - abs(sin(q.x + q.y));
  }
  v = pow(v / 3.0, 3.2);
  float star = pow(abs(sin(atan(p.y, p.x) * 4.0 + t * 0.12)), 6.0);
  return v * (0.45 + 0.85 * star);
}

/** The full environment: everything the cheap one has, plus the bolt properly
 *  integrated and the floor with its caustics and reflection. */
vec3 envFull(vec3 ro, vec3 d, float energy) {
  vec3 c = envLite(d, energy, BACKDROP_FILL);

  if (d.y < -0.002) {
    float t = (FLOOR_Y - ro.y) / d.y;
    if (t > 0.0) {
      vec3 p = ro + d * t;
      vec2 g = p.xz - GEM_POS.xz;
      float r = length(g);
      float fall = exp(-r * r * 0.16);

      // How much floor one pixel covers here. A plane seen at a grazing angle
      // compresses enormously toward the horizon, so a lattice that is a clean
      // pattern underfoot is far finer than a pixel further out — and sampling
      // it with one point per pixel is where moire and crawling come from. This
      // is the texture-filtering problem, and without a mip chain the honest
      // answer is to fade each detail into its own average as it stops being
      // resolvable. Detail you cannot resolve is noise, and noise that moves
      // with the camera is the thing that reads as cheap.
      float fp = t * (2.0 / uRes.y) / uCam.z / max(abs(d.y), 0.02);
      float grainLod = 1.0 - smoothstep(0.01, 0.06, fp);
      float causticLod = 1.0 - smoothstep(0.05, 0.30, fp);

      // The plate: dark, slightly rough metal, so the stone has something to
      // sit on and the caustics have something to sit *in*.
      float grain = vnoise(p.xz * 26.0) * 0.05 * grainLod;
      vec3 plate = vec3(0.020, 0.030, 0.040) * (0.6 + grain) * (0.16 + 0.84 * fall);
      // The pedestal's edge: one soft ring, which is the whole difference
      // between a stone floating over a void and a stone standing on something.
      plate += vec3(0.09, 0.18, 0.24) * exp(-pow(r - 1.85, 2.0) * 46.0) * 0.5;
      plate *= smoothstep(2.9, 1.75, r) * 0.85 + 0.15;

      float ca = caustic(g, uTime * (1.0 - uStill));
      // Spectral, not white: the caustic is what the dispersion threw down
      // there, so it carries the same split. Three offsets of the same pattern
      // is the cheapest honest way to say that.
      vec3 spectral = vec3(
        caustic(g * 1.02, uTime * (1.0 - uStill)),
        ca,
        caustic(g * 0.98, uTime * (1.0 - uStill))
      );
      spectral *= vec3(1.0, 0.92, 1.15);
      // 0.30 is roughly the mean of the caustic field, so this settles to an
      // even wash rather than dimming the far floor as the detail leaves.
      spectral = mix(vec3(0.30), spectral, causticLod);

      float lit = fall * (0.34 + energy * 2.2);
      c = plate + spectral * lit * vec3(0.55, 0.92, 1.25) * 2.2;

      // A hot pool directly under the stone, from the light that went straight
      // through, and the horizon fade so the plate does not end in a hard line.
      c += vec3(0.45, 0.85, 1.1) * exp(-r * r * 2.2) * (0.05 + energy * 0.55);
      // Fog, not a cut. The plate has to arrive at the horizon holding exactly
      // the colour the backdrop holds there, or the two meet as an edge.
      vec3 far = envLite(vec3(d.x, 0.002, d.z), energy, BACKDROP_FILL);
      c = mix(c, far, 1.0 - exp(-max(t - 3.0, 0.0) * 0.20));
    }
  }

  // The column, added last. Everything above this line writes the colour
  // rather than accumulating into it — the floor branch in particular replaces
  // it outright — so a beam added earlier was erased everywhere the view ray
  // reached the plate, which is most of the frame below the horizon.
  c += beamGlow(ro, d);
  c += bifrost(ro, d);
  return c;
}

// ------------------------------------------------------------- the solid

/** Slab method against the convex hull. Returns the near and far boundary and
 *  their normals. Exact, branch-light, and the reason five bounces on three
 *  wavelengths fits in a frame. */
bool convexHit(vec3 ro, vec3 rd, out float tN, out vec3 nN, out float tF, out vec3 nF) {
  tN = -1e9;
  tF = 1e9;
  nN = vec3(0.0, 1.0, 0.0);
  nF = vec3(0.0, -1.0, 0.0);
  for (int i = 0; i < NP; i++) {
    vec3 n = uPlanes[i].xyz;
    float po = dot(ro, n) - uPlanes[i].w;
    float dn = dot(rd, n);
    if (abs(dn) < 1e-7) {
      if (po > 0.0) return false;
      continue;
    }
    float t = -po / dn;
    if (dn < 0.0) {
      if (t > tN) { tN = t; nN = n; }
    } else {
      if (t < tF) { tF = t; nF = n; }
    }
  }
  return tF > max(tN, 0.0);
}

mat3 gemRotation(float t) {
  float a = t * uSpin * 6.2831853;
  float b = 0.10 * sin(t * 0.21) + 0.06;          // slow nutation, so the
  float ca = cos(a), sa = sin(a);                 // facets never settle into
  float cb = cos(b), sb = sin(b);                 // one static arrangement
  mat3 spin = mat3(ca, 0.0, -sa, 0.0, 1.0, 0.0, sa, 0.0, ca);
  mat3 tilt = mat3(1.0, 0.0, 0.0, 0.0, cb, sb, 0.0, -sb, cb);
  return tilt * spin;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime;

  vec3 ro = vec3(0.0 + uPointer.x * 0.30, uCam.y + uPointer.y * 0.20, uCam.x);
  vec3 ta = vec3(0.0, -0.14, 0.0);
  vec3 fw = normalize(ta - ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 upv = cross(rt, fw);
  vec3 rd = normalize(uv.x * rt + uv.y * upv + uCam.z * fw);  // 2.35 is ~46 deg vertical

  // Steady. There is no strike to be between any more, so everything that
  // used to be gated on a flash is gated on a slow breath instead.
  float energy = mix(beamPulse(), 0.72, uStill);

  vec3 col = envFull(ro, rd, energy);

  // Bounding sphere first: everything below is the expensive half of the
  // shader and most of the screen is not the stone.
  vec3 oc = ro - GEM_POS;
  float bq = dot(oc, rd);
  float bc = dot(oc, oc) - BOUND * BOUND;
  if (bq * bq - bc > 0.0 && bq < 0.0) {
    mat3 R = gemRotation(t);
    mat3 Rt = transpose(R);
    vec3 roL = Rt * (ro - GEM_POS);
    vec3 rdL = Rt * rd;

    float tN, tF;
    vec3 nN, nF;
    if (convexHit(roL, rdL, tN, nN, tF, nF) && tN > 0.0) {
      vec3 nW = R * nN;
      float ct = clamp(dot(-rd, nW), 0.0, 1.0);
      float F = F0 + (1.0 - F0) * pow(1.0 - ct, 5.0);

      vec3 hitW = ro + rd * tN;
      vec3 refl = envFull(hitW, reflect(rd, nW), energy);

      // Per-wavelength paths. The index offsets are diamond's real dispersion
      // (2.407 / 2.417 / 2.451 at the F, D and C lines), scaled by the knob.
      // The per-pixel jitter matters more than it looks: three discrete
      // wavelengths band into visible red/green/blue fringes, and dithering
      // the index inside each channel's neighbourhood turns the bands back
      // into something the eye reads as a continuous spectrum.
      vec3 refr = vec3(0.0);
      float jit = hash21(gl_FragCoord.xy + fract(t) * 91.0) - 0.5;
      for (int c = 0; c < 3; c++) {
        float ior = IOR + (float(c) - 1.0) * uDisp + jit * uDisp * 0.8;
        vec3 dirL = refract(rdL, nN, 1.0 / ior);
        vec3 p = roL + rdL * tN + dirL * 2e-4;
        float acc = 0.0;
        float thr = 1.0;
        for (int b = 0; b < 5; b++) {
          float a0, a1;
          vec3 na, nb;
          if (!convexHit(p, dirL, a0, na, a1, nb)) break;
          p += dirL * a1;
          float ci = clamp(dot(dirL, nb), 0.0, 1.0);
          vec3 outD = refract(dirL, -nb, ior);
          float Fx = dot(outD, outD) < 1e-6
            ? 1.0                                     // total internal reflection
            : F0 + (1.0 - F0) * pow(1.0 - ci, 5.0);
          if (Fx < 0.999) {
            vec3 wd = R * outD;
            acc += thr * (1.0 - Fx) * envLite(wd, energy, 1.0)[c];
          }
          thr *= Fx;
          if (thr < 0.02) break;
          dirL = reflect(dirL, nb);
          p += dirL * 2e-4;
        }
        refr[c] = acc;
      }

      // The stone's own fire while the beam is in it: the light does not just
      // pass through, it loads the crystal and the interior carries a glow of
      // its own for as long as the column is standing on it.
      float depth = clamp((tF - tN) * 0.7, 0.0, 1.0);
      vec3 fire = vec3(0.35, 0.75, 1.0) * depth * energy * 0.16
                + vec3(0.55, 0.30, 0.95) * depth * energy * 0.09;

      vec3 stone = mix(refr, refl, F) + fire;

      // The rim: grazing angles on a diamond are almost perfectly reflective,
      // and drawing that explicitly is what gives the silhouette an edge
      // instead of dissolving into the background it is refracting.
      stone += vec3(0.5, 0.85, 1.0) * pow(1.0 - ct, 6.0) * (0.35 + energy * 0.7);

      // Analytic edge coverage, and the reason the outline stops looking like
      // stairsteps. Assigning the stone colour outright inside the hit test made
      // every pixel
      // wholly stone or wholly backdrop, so the silhouette can only ever land on
      // a pixel boundary — raising the resolution buys smaller stairs, not an
      // edge. For a *convex* solid there is an exact signal to hand: the chord
      // the ray cuts, tF - tN, falls to zero precisely at the silhouette. Compare
      // it against the width of the pixel's own footprint at that distance and
      // the ratio is the fraction of the pixel the stone covers.
      //
      // uCam.z is the focal term from the ray construction above; keep them in step.
      float footprint = tN * (2.0 / uRes.y) / uCam.z;
      float cover = smoothstep(0.0, 1.0, (tF - tN) / max(footprint * 2.0, 1e-6));
      col = mix(col, stone, cover);
    }
  }

  fragColor = vec4(col, 1.0);
}`;

const PRESENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform vec2 uTexel;
uniform float uBloom;
uniform float uExposure;
uniform float uTime;
/** How far past 1:1 the scene buffer is supersampled, 0 when it is not. */
uniform float uSuper;

/** Resolve the scene buffer down to the display. A single bilinear tap reads at
 *  most a 2x2 neighbourhood, so at 1.6x it throws away most of the extra samples
 *  it cost us to trace — exactly on the facet edges the supersampling was for.
 *  Four taps on a rotated grid keep them. At uSuper 0 the offsets vanish and all
 *  four taps land on the same texel, so this costs nothing when not needed. */
vec3 resolve(vec2 uv) {
  vec2 o = uTexel * 0.5 * uSuper;
  return 0.25 * (
    texture(uScene, uv + vec2( o.x,  o.y * 0.5)).rgb +
    texture(uScene, uv + vec2(-o.x * 0.5,  o.y)).rgb +
    texture(uScene, uv + vec2(-o.x, -o.y * 0.5)).rgb +
    texture(uScene, uv + vec2( o.x * 0.5, -o.y)).rgb
  );
}

/** ACES filmic, the Narkowicz fit. Cheap, and it is what keeps a scene whose
 *  bright parts are genuinely 30x the mid-tones from clipping to white discs. */
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  // Bloom: 24 taps on a golden-angle spiral, thresholded. A separable gaussian
  // would be two more passes and two more targets for a glow that is, on this
  // scene, one bolt and a handful of facet highlights.
  vec3 glow = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float a = fi * 2.39996323;
    float r = sqrt((fi + 0.5) / 24.0) * 26.0;
    vec2 off = vec2(cos(a), sin(a)) * r * uTexel;
    vec3 s = texture(uScene, vUv + off).rgb;
    float w = 1.0 / (1.0 + r * 0.08);
    glow += max(s - 0.55, 0.0) * w;
    wsum += w;
  }
  glow /= wsum;

  // Chromatic aberration, radial and gentle, applied only at the edges. Free
  // here because it is three taps of a texture that already exists.
  vec2 d = vUv - 0.5;
  float ca = dot(d, d) * 0.012;
  vec3 base = vec3(
    resolve(vUv - d * ca).r,
    resolve(vUv).g,
    resolve(vUv + d * ca).b
  );

  vec3 col = base + glow * uBloom * 2.6;
  col = aces(col * uExposure);

  // Vignette, then a dither. The dither is not decoration: this scene is one
  // slow gradient over most of its area and 8-bit output bands it visibly.
  col *= 1.0 - dot(d, d) * 0.55;
  float dither = fract(sin(dot(gl_FragCoord.xy + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) / 255.0;

  fragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // One line, always, in every build. Quiet-in-production cost an hour: the
    // canvas failing open looks exactly like a canvas that has not painted yet,
    // and with the log suppressed there was nothing anywhere to tell them apart.
    console.warn("gem shader failed to compile:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function program(gl: WebGL2RenderingContext, frag: string) {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, "pos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    // Same reason the compile log is unconditional: a link failure and a canvas
    // that has not painted yet look identical from the outside, and a link
    // failure is what you get for one uniform past the driver's limit.
    console.warn("gem program failed to link:", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

export default function GemLightning({
  className = "",
  settings,
  fixedTime,
}: {
  className?: string;
  /** Pin the clock to one instant. The strike is a fraction of a second inside
   *  a multi-second cycle, so a screenshot taken at wall-clock time almost
   *  never contains one — which made "is the bolt right" unanswerable from a
   *  machine with no display. `/test?t=2.35` answers it. */
  fixedTime?: number;
  /** Read every frame. Pass a ref's `.current` shape via this object; changing
   *  it never remounts the canvas. */
  settings?: GemSettings;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef<GemSettings>(settings ?? GEM_DEFAULTS);
  // In an effect rather than during render: the render loop reads this ref on
  // the next frame, which is always after the commit, so there is nothing to
  // gain by writing it earlier and a lint rule that is right to say so.
  useEffect(() => {
    live.current = settings ?? GEM_DEFAULTS;
  }, [settings]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      depth: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    const scene = program(gl, SCENE.replace(/\bNP\b/g, String(GEM_PLANES.length)).replace(/\bBOUND\b/g, GEM_BOUND.toFixed(3)));
    const present = program(gl, PRESENT);
    if (!scene || !present) return;

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // A half-float target if the driver has one. The scene is genuinely HDR —
    // the bolt core is tens of times brighter than the plate — and on an 8-bit
    // target the bloom threshold has nothing above 1.0 left to find.
    const hdr = gl.getExtension("EXT_color_buffer_half_float") !== null;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    const uni = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);
    const S = {
      res: uni(scene, "uRes"),
      time: uni(scene, "uTime"),
      disp: uni(scene, "uDisp"),
      beam: uni(scene, "uBeam"),
      spin: uni(scene, "uSpin"),
      cam: uni(scene, "uCam"),
      light: uni(scene, "uLight"),
      arc: uni(scene, "uArc"),
      still: uni(scene, "uStill"),
      pointer: uni(scene, "uPointer"),
      // Array uniforms are named "uPlanes[0]" by some drivers and "uPlanes" by
      // others; ask for both rather than silently uploading nothing.
      planes: uni(scene, "uPlanes") ?? uni(scene, "uPlanes[0]"),
    };
    const P = {
      tex: uni(present, "uScene"),
      texel: uni(present, "uTexel"),
      bloom: uni(present, "uBloom"),
      super: uni(present, "uSuper"),
      exposure: uni(present, "uExposure"),
      time: uni(present, "uTime"),
    };

    let bufW = 1;
    let bufH = 1;
    // ponytail: adaptive scale on a frame-time EMA. A fixed scale is a guess
    // about hardware; if this ever needs finer control, split it per-effect
    // (bounce count first) rather than adding steps here.
    let scale = 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Above 1 this is supersampling: the trace runs at more samples than the
    // display has pixels and the present pass filters back down, which is what
    // takes the hard edge off a facet boundary. Capped by a pixel budget so a
    // 4K panel at dpr 2 does not ask for 33M samples a frame.
    const MAX_PIXELS = 5.5e6;

    const allocate = () => {
      const budget = Math.sqrt(
        Math.min(1, MAX_PIXELS / Math.max(1, canvas.clientWidth * dpr * canvas.clientHeight * dpr))
      );
      const s = scale * budget;
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr * s));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr * s));
      if (w === bufW && h === bufH) return;
      bufW = w;
      bufH = h;
      // Published so the tune panel can report what the controller settled on.
      // Guessing at this from a screenshot is how the ratchet bug survived.
      canvas.dataset.render = `${w}x${h}`;
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        hdr ? gl.RGBA16F : gl.RGBA8,
        w,
        h,
        0,
        gl.RGBA,
        hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
        null
      );
    };

    const observer = new ResizeObserver(() => allocate());
    observer.observe(canvas);
    allocate();

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointer = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = 1 - (e.clientY / window.innerHeight) * 2;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (seconds: number) => {
      const s = live.current;
      // Ease the parallax rather than tracking the pointer exactly: an
      // instant-following camera on a scene this reflective reads as jitter.
      pointer.x += (pointer.tx - pointer.x) * 0.045;
      pointer.y += (pointer.ty - pointer.y) * 0.045;

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, bufW, bufH);
      gl.useProgram(scene);
      gl.uniform4fv(S.planes, GEM_PLANE_DATA);
      gl.uniform2f(S.res, bufW, bufH);
      gl.uniform1f(S.time, seconds);
      gl.uniform1f(S.disp, s.dispersion);
      gl.uniform1f(S.beam, s.beam);
      gl.uniform1f(S.spin, s.spin);
      gl.uniform3f(S.cam, s.camDist, s.camHeight, s.zoom);
      gl.uniform1f(S.light, s.light);
      gl.uniform1f(S.arc, s.arc ?? 0);
      gl.uniform1f(S.still, still ? 1 : 0);
      gl.uniform2f(S.pointer, pointer.x, pointer.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(present);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(P.tex, 0);
      gl.uniform2f(P.texel, 1 / bufW, 1 / bufH);
      gl.uniform1f(P.bloom, s.bloom);
      gl.uniform1f(P.super, Math.max(0, bufW / Math.max(1, canvas.width) - 1));
      gl.uniform1f(P.exposure, s.exposure);
      gl.uniform1f(P.time, seconds);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    if (still) {
      // One frame, at full quality, of the stone lit rather than mid-strike.
      // There is no frame budget to hold when there is only one frame, so this
      // takes the supersample ceiling rather than 1:1.
      scale = 1.6;
      bufW = 0;
      allocate();
      draw(fixedTime ?? 2.4);
      return () => {
        observer.disconnect();
        window.removeEventListener("pointermove", onPointer);
      };
    }

    let frame = 0;
    let last = performance.now();
    let ema = 16;
    let settle = 0;
    const start = last;

    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      ema += (Math.min(dt, 60) - ema) * 0.08;
      // Hold ~55fps. Move in small steps and only every 30 frames, or the
      // resolution hunts audibly against its own cost.
      //
      // The climb threshold has to sit *above* a vsync frame, not below it. At
      // 60Hz a GPU with capacity to spare still reports ~16.7ms, because it is
      // waiting on the display rather than on us. Asking for `ema < 12` meant
      // the scale could only ever ratchet down, and every machine ran soft.
      if (++settle > 30) {
        settle = 0;
        const next = ema > 21 ? scale - 0.06 : ema < 18 ? scale + 0.05 : scale;
        const clamped = Math.min(2, Math.max(0.45, next));
        if (clamped !== scale) {
          scale = clamped;
          bufW = 0;
          allocate();
        }
      }
      draw(fixedTime !== undefined ? fixedTime : (now - start) / 1000);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // Two ways to stop tracing: the tab going away, and the stone scrolling
    // away. The second one matters now that the story opens a landing page
    // rather than owning a route — without it a raytracer runs at 55fps for
    // the whole of the page below it, which nobody is looking at.
    let hidden = false;
    let offscreen = false;
    const sync = () => {
      cancelAnimationFrame(frame);
      if (hidden || offscreen) return;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      hidden = document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onScreen = new IntersectionObserver(
      ([entry]) => {
        offscreen = !entry.isIntersecting;
        sync();
      },
      { rootMargin: "10%" }
    );
    onScreen.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      onScreen.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
      gl.deleteProgram(scene);
      gl.deleteProgram(present);
      gl.deleteBuffer(quad);
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
    };
  }, [fixedTime]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
