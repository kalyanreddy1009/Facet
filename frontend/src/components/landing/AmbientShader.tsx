"use client";

/**
 * The landing page's field: one fullscreen WebGL fragment shader, fixed behind
 * everything.
 *
 * What it replaces is three drifting radial gradients and a rotating conic
 * sweep — four large composited layers that between them read as "a gradient"
 * rather than as light. This is one canvas, one draw call of two triangles per
 * frame, and no DOM. The domain-warp loop (five iterations of a sine feedback
 * on the sample point) is what gives the slow fluid folding; the glint term is
 * a narrow moving highlight so the field has an event in it and not only a
 * drift.
 *
 * Three things it must not do, and does not:
 *
 *   1. Cost anything when nobody can see it. `IntersectionObserver` is no help
 *      for a `fixed` element, so the rAF loop stops on `visibilitychange` — a
 *      backgrounded tab renders nothing.
 *   2. Override a motion preference. Under `prefers-reduced-motion` it draws
 *      exactly one frame and stops, so the page still has a field, just a
 *      still one.
 *   3. Fail loudly. No WebGL context, or a driver that refuses to link the
 *      program, leaves the canvas empty and the CSS floor under it unchanged.
 *      The page is fully legible without this file ever running.
 */

import { useEffect, useRef } from "react";

const VERT = `attribute vec2 pos; void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

/** Teal rather than the reference's indigo, because everything above it —
 *  accent, borders, the gem's own fan — is on the cyan side, and a field in a
 *  different family reads as a second design. */
const FRAG = `
precision highp float;
uniform float time;
uniform vec2 res;
void main() {
  vec2 uv = gl_FragCoord.xy / res;
  float t = time * 0.04;
  vec2 p = uv * 4.0 - vec2(2.0);
  for (int i = 1; i < 6; i++) {
    float fi = float(i);
    p += vec2(
      0.6 / fi * sin(fi * p.y + t + 0.6 * fi) + 0.6,
      0.6 / fi * sin(fi * p.x + t + 0.6 * fi) + 0.6
    );
  }
  float fold = 0.5 + 0.5 * sin(p.x + p.y);
  vec3 color = mix(vec3(0.043, 0.055, 0.062), vec3(0.055, 0.105, 0.125), fold);
  color += vec3(0.02, 0.09, 0.11) * pow(fold, 3.0);
  // Fewer, softer bands than the reference's 25. At that frequency the
  // highlight reads as a row of lasers ruled across the page rather than as
  // light moving through the field, and it competes with the gem's own fan,
  // which is the thing on this screen that is actually supposed to be light.
  float glint = pow(max(0.0, sin(uv.x * 7.0 + uv.y * 4.0 + time * 0.2)), 22.0);
  color += vec3(0.06, 0.34, 0.42) * glint * 0.35;
  gl_FragColor = vec4(color, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export default function AmbientShader() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, depth: false, alpha: false });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "time");
    const uRes = gl.getUniformLocation(program, "res");

    // Half resolution, capped. This is a field of slow low-frequency colour;
    // there is nothing in it a second device pixel would resolve, and the
    // fragment count is the whole cost of the effect.
    // ponytail: fixed 0.5 scale, make it adaptive only if a real device drops frames.
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
    const resize = () => {
      canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (t: number) => {
      gl.uniform1f(uTime, t * 0.001);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      draw(0);
      return () => window.removeEventListener("resize", resize);
    }

    let frame = 0;
    const loop = (t: number) => {
      draw(t);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) frame = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="ambient-shader" aria-hidden />;
}
