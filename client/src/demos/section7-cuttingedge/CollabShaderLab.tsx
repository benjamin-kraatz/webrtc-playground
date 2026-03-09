import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { DemoLayout } from "@/components/layout/DemoLayout";
import { Logger } from "@/lib/logger";
import { DEFAULT_PC_CONFIG } from "@/config/iceServers";

const CODE = `// Sync shader code changes between peers via RTCDataChannel
// Both peers edit the same GLSL fragment shader in real-time

// On local edit (debounced 300ms):
dc.send(JSON.stringify({ type: 'shader', code: newCode }));

// On receive:
dc.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'shader') {
    setShaderCode(msg.code); // update editor
    recompileShader(msg.code); // recompile WebGL program
  }
};

// Shader uses webcam as texture input:
// uniform sampler2D u_tex;       — webcam frame uploaded each rAF tick
// uniform float u_time;          — elapsed seconds
// uniform vec2  u_eye_l;         — left eye center (UV 0-1, face tracking)
// uniform vec2  u_eye_r;         — right eye center
// uniform vec2  u_nose;          — nose tip
// uniform vec2  u_mouth;         — mouth center
// uniform float u_face_w;        — face width (normalized)
// uniform float u_face_detected; — 1.0 if face tracked, 0.0 otherwise`;

const VS = `attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

function avg2(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const PRESET_SHADERS: Array<{
  name: string;
  emoji: string;
  code: string;
  face?: boolean;
}> = [
  // ── Regular shaders ──────────────────────────────────────────────────
  {
    name: "Chroma",
    emoji: "🌈",
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv;
  float r = texture2D(u_tex, uv + vec2(0.012, 0.0)).r;
  float g = texture2D(u_tex, uv).g;
  float b = texture2D(u_tex, uv - vec2(0.012, 0.0)).b;
  gl_FragColor = vec4(r, g, b, 1.0);
}`,
  },
  {
    name: "Glitch",
    emoji: "⚡",
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv;
  float glitch = step(0.95, fract(sin(uv.y * 100.0 + u_time) * 43758.5));
  uv.x += sin(uv.y * 50.0 + u_time * 5.0) * 0.02 * glitch;
  vec4 col = texture2D(u_tex, uv);
  float scan = step(0.5, mod(uv.y * 200.0 + u_time * 30.0, 1.0)) * 0.08;
  gl_FragColor = col - vec4(scan, scan, scan, 0.0);
}`,
  },
  {
    name: "Plasma",
    emoji: "🔮",
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv;
  float v = sin(uv.x * 10.0 + u_time)
          + sin(uv.y * 10.0 + u_time * 0.7)
          + sin((uv.x + uv.y) * 8.0 + u_time * 0.5);
  vec3 plasma = vec3(sin(v), sin(v + 2.094), sin(v + 4.189)) * 0.5 + 0.5;
  vec4 webcam = texture2D(u_tex, uv);
  gl_FragColor = mix(webcam, vec4(plasma, 1.0), 0.5);
}`,
  },
  {
    name: "Mirror",
    emoji: "🪞",
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv;
  uv = abs(mod(uv * 2.0, 2.0) - 1.0);
  float spin = u_time * 0.1;
  float cs = cos(spin), sn = sin(spin);
  uv = vec2(cs * uv.x - sn * uv.y, sn * uv.x + cs * uv.y) * 0.5 + 0.5;
  gl_FragColor = texture2D(u_tex, uv);
}`,
  },
  {
    name: "Edge",
    emoji: "✏️",
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv;
  float d = 0.003;
  vec4 c  = texture2D(u_tex, uv);
  vec4 cR = texture2D(u_tex, uv + vec2(d, 0.0));
  vec4 cL = texture2D(u_tex, uv - vec2(d, 0.0));
  vec4 cU = texture2D(u_tex, uv + vec2(0.0, d));
  vec4 cD = texture2D(u_tex, uv - vec2(0.0, d));
  float edge = length((cR - cL).rgb) + length((cU - cD).rgb);
  float glow = edge * 4.0;
  vec3 col = mix(c.rgb * 0.15, vec3(0.2, 1.0, 0.8) * glow, smoothstep(0.1, 0.5, glow));
  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Ghost",
    emoji: "👻",
    code: `
#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;

float vignette(vec2 uv) {
    vec2 p = uv * 2.0 - 1.0;
    return smoothstep(1.1, 0.4, length(p));
}

void main() {
    vec2 uv = v_uv;
    float mirrorMix = 0.5 + 0.5 * sin(u_time * 0.6);
    vec2 uvMirror = vec2(1.0 - uv.x, uv.y);
    vec2 mirrorUV = mix(uv, uvMirror, mirrorMix);
    vec2 c = mirrorUV * 2.0 - 1.0;
    float r = length(c);
    float breath = 0.04 * sin(u_time * 1.5 + r * 10.0);
    vec2 warpDir = c / max(r, 0.001);
    mirrorUV += warpDir * breath;
    mirrorUV = clamp(mirrorUV, 0.0, 1.0);
    vec3 normalFace = texture2D(u_tex, uv).rgb;
    vec2 ghostUV = uv;
    ghostUV.x = 1.0 - ghostUV.x;
    ghostUV += warpDir * (0.08 + 0.05 * sin(u_time * 3.0));
    ghostUV = clamp(ghostUV, 0.0, 1.0);
    vec3 ghostFace = texture2D(u_tex, ghostUV).rgb;
    float ghostGray = dot(ghostFace, vec3(0.299, 0.587, 0.114));
    vec3 ghostColor = vec3(1.0 - ghostGray) * vec3(0.7, 0.9, 1.0);
    float slice = floor(uv.y * 40.0);
    float slicePhase = mod(slice + floor(u_time * 8.0), 40.0) / 40.0;
    float smearAmt = 0.02 * sin(slicePhase * 6.2831);
    vec2 smearUV = clamp(mirrorUV + vec2(smearAmt, 0.0), 0.0, 1.0);
    vec3 smeared = texture2D(u_tex, smearUV).rgb;
    vec3 base = mix(normalFace, smeared, 0.5);
    float luma = dot(base, vec3(0.299, 0.587, 0.114));
    base = mix(vec3(luma), base, 0.6);
    base *= vec3(0.7, 0.8, 1.0);
    float ghostMask =
        smoothstep(0.25, 0.0, abs(r - 0.25 + 0.05 * sin(u_time * 2.0))) *
        (0.5 + 0.5 * sin(u_time * 1.3 + uv.y * 10.0));
    vec3 col = mix(base, ghostColor, ghostMask);
    float pulse = 0.9 + 0.1 * sin(u_time * 2.5);
    col *= vignette(uv) * pulse;
    vec2 eyePosL = vec2(0.35, 0.4);
    vec2 eyePosR = vec2(0.65, 0.4);
    float eyes = max(
      smoothstep(0.08, 0.0, distance(uv, eyePosL)),
      smoothstep(0.08, 0.0, distance(uv, eyePosR))
    );
    col *= 1.0 - eyes * (0.4 + 0.2 * sin(u_time * 4.0));
    gl_FragColor = vec4(col, 1.0);
}`,
  },
  // ── Surreal / Horror / Absurd ─────────────────────────────────────────
  {
    name: "Void",
    emoji: "🕳️",
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv;
  // Slowly orbiting singularity
  vec2 center = vec2(
    0.5 + 0.18 * cos(u_time * 0.37),
    0.5 + 0.12 * sin(u_time * 0.53)
  );
  vec2 d = uv - center;
  float r = length(d);
  // Gravitational lensing — pull pixels inward
  float pull = 0.045 / (r + 0.04);
  vec2 warped = uv - (d / (r + 0.001)) * pull;
  // Einstein ring
  float ring = smoothstep(0.008, 0.0, abs(r - 0.065)) * 0.9;
  float darkness = smoothstep(0.28, 0.0, r);
  vec4 col = texture2D(u_tex, clamp(warped, 0.0, 1.0));
  col.rgb *= 1.0 - darkness;
  col.rgb += vec3(0.05, 0.0, 0.3) * ring * (0.8 + 0.2 * sin(u_time * 6.0));
  gl_FragColor = vec4(col.rgb, 1.0);
}`,
  },
  {
    name: "Acid",
    emoji: "🍄",
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv;
  // Wobbly UV distortion
  uv.x += 0.025 * sin(uv.y * 9.0 + u_time * 1.9);
  uv.y += 0.018 * cos(uv.x * 7.0 - u_time * 1.3);
  vec4 col = texture2D(u_tex, clamp(uv, 0.0, 1.0));
  // Psychedelic hue rotation driven by pixel brightness
  float hue = u_time * 0.8 + col.r * 2.5 + col.g * 1.2;
  vec3 acid = vec3(
    0.5 + 0.5 * sin(hue),
    0.5 + 0.5 * sin(hue + 2.094),
    0.5 + 0.5 * sin(hue + 4.189)
  );
  // Pulsing mix — from subtle to overwhelming
  float mix_amt = 0.5 + 0.35 * sin(u_time * 0.6);
  gl_FragColor = vec4(mix(col.rgb, acid, mix_amt), 1.0);
}`,
  },
  {
    name: "Ritual",
    emoji: "🔯",
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv;
  vec2 cc = uv * 2.0 - 1.0;
  float r = length(cc);
  float theta = atan(cc.y, cc.x);
  // Concentric rings
  float ring1 = smoothstep(0.018, 0.0, abs(r - 0.50));
  float ring2 = smoothstep(0.013, 0.0, abs(r - 0.75));
  float ring3 = smoothstep(0.010, 0.0, abs(r - 0.28));
  // 5 rotating spokes
  float spoke = 0.0;
  for (int i = 0; i < 5; i++) {
    float a = float(i) * 1.2566 + u_time * 0.4;
    float da = abs(mod(theta - a + 3.14159, 6.28318) - 3.14159);
    spoke += smoothstep(0.05, 0.0, da * r) * step(0.0, cos(theta - a));
  }
  float glyph = max(max(ring1, ring2), max(ring3, spoke * 0.7));
  // Dark webcam base with crimson sigil overlay
  vec4 webcam = texture2D(u_tex, uv);
  vec3 dark = webcam.rgb * vec3(0.25, 0.04, 0.04);
  float pulse = 1.4 + 0.5 * sin(u_time * 2.3);
  vec3 glow = vec3(1.0, 0.08, 0.04) * glyph * pulse;
  gl_FragColor = vec4(dark + glow, 1.0);
}`,
  },
  {
    name: "Melt",
    emoji: "🫠",
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv;
  // Slow vertical drip driven by horizontal position
  float drip  = sin(uv.x * 11.0 + u_time * 0.4) * 0.035
              + sin(uv.x *  7.0 - u_time * 0.25) * 0.022;
  // Extra gravity toward bottom
  float sag   = pow(uv.y, 1.6) * 0.10 * sin(uv.x * 18.0 + u_time * 0.9);
  uv.y -= drip + sag;
  uv = clamp(uv, 0.0, 1.0);
  vec4 col = texture2D(u_tex, uv);
  // Warm colour shift — hotter (redder) near bottom
  col.r = min(1.0, col.r + uv.y * 0.35);
  col.g *= 1.0 - uv.y * 0.25;
  col.b *= 1.0 - uv.y * 0.45;
  gl_FragColor = col;
}`,
  },
  {
    name: "Abyss",
    emoji: "🦑",
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;
// Simple hash for pseudo-random noise
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5);
}
void main() {
  vec2 uv = v_uv;
  // Swaying current
  uv.x += sin(uv.y * 4.0 + u_time * 0.6) * 0.018;
  uv.y += cos(uv.x * 3.0 + u_time * 0.4) * 0.010;
  vec4 col = texture2D(u_tex, clamp(uv, 0.0, 1.0));
  // Deep-water crush + cold tint
  col.rgb = pow(col.rgb, vec3(1.9));
  col.rgb *= vec3(0.08, 0.25, 0.55);
  // Bioluminescent sparks
  float n = hash(floor(uv * 120.0) + floor(u_time * 0.5));
  float spark = smoothstep(0.97, 1.0, n)
              * (0.6 + 0.4 * sin(u_time * 7.0 + n * 30.0));
  col.rgb += spark * vec3(0.15, 1.0, 0.75);
  // Tentacle shadow webs
  float tentacle = pow(max(0.0, sin(uv.x * 28.0 + sin(uv.y * 4.0 + u_time))), 9.0);
  col.rgb += tentacle * vec3(0.0, 0.25, 0.55) * 0.5;
  gl_FragColor = vec4(col.rgb, 1.0);
}`,
  },
  {
    name: "Nightmare",
    emoji: "😱",
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
varying vec2 v_uv;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5);
}
void main() {
  vec2 uv = v_uv;
  // Tremor warp
  float tremor = 0.004 * sin(u_time * 13.0 + uv.y * 80.0);
  uv.x += tremor;
  vec4 col = texture2D(u_tex, clamp(uv, 0.0, 1.0));
  // Desaturate + darken
  float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  col.rgb = mix(col.rgb, vec3(luma), 0.65) * 0.5;
  // Red veins creeping in from all edges
  vec2 edge = abs(uv * 2.0 - 1.0);
  float veinDist = max(edge.x, edge.y);
  float vein = smoothstep(0.65, 1.0, veinDist);
  // Pulsing vein glow
  float pulse = 0.7 + 0.3 * sin(u_time * 3.0);
  float veinNoise = hash(floor(uv * 40.0 + u_time * 2.0));
  col.rgb += vec3(vein * pulse * (0.8 + 0.4 * veinNoise), 0.0, 0.0);
  // Creeping static
  float staticN = hash(uv + fract(u_time));
  float flicker = step(0.994, staticN) * 0.6;
  col.rgb += vec3(flicker, 0.0, 0.0);
  gl_FragColor = vec4(col.rgb, 1.0);
}`,
  },
  // ── Face-Landmark Shaders ─────────────────────────────────────────────
  {
    name: "Possessed",
    emoji: "👁",
    face: true,
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2  u_eye_l;
uniform vec2  u_eye_r;
uniform float u_face_detected;
varying vec2 v_uv;

// Apply a spinning vortex distortion centred on pt
vec2 vortex(vec2 uv, vec2 pt, float strength) {
  vec2 d = uv - pt;
  float r = length(d);
  float angle = strength / (r * r + 0.008);
  float cs = cos(angle), sn = sin(angle);
  return pt + vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
}

void main() {
  vec2 uv = v_uv;
  // Fallback eye positions when face not detected
  vec2 eyeL = mix(vec2(0.35, 0.42), u_eye_l, u_face_detected);
  vec2 eyeR = mix(vec2(0.65, 0.42), u_eye_r, u_face_detected);
  // Spin direction alternates with time
  float spin = 0.0025 * sin(u_time * 1.8);
  uv = vortex(uv, eyeL, spin);
  uv = vortex(uv, eyeR, spin);
  vec4 col = texture2D(u_tex, clamp(uv, 0.0, 1.0));
  // Drain colour in vortex core → ghostly grey-violet
  float dL = length(uv - eyeL);
  float dR = length(uv - eyeR);
  float drain = smoothstep(0.14, 0.0, min(dL, dR));
  float grey  = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  col.rgb = mix(col.rgb, vec3(grey), drain * 0.92);
  col.rgb += vec3(0.28, 0.0, 0.55) * drain * (0.7 + 0.3 * sin(u_time * 5.0));
  // Subtle dark vignette
  vec2 vig = v_uv * 2.0 - 1.0;
  col.rgb *= 1.0 - dot(vig, vig) * 0.38;
  gl_FragColor = vec4(col.rgb, 1.0);
}`,
  },
  {
    name: "Third Eye",
    emoji: "🔴",
    face: true,
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2  u_eye_l;
uniform vec2  u_eye_r;
uniform vec2  u_nose;
uniform float u_face_detected;
varying vec2 v_uv;

void main() {
  vec2 uv = v_uv;
  vec4 col = texture2D(u_tex, uv);
  vec2 eyeL = mix(vec2(0.35, 0.42), u_eye_l, u_face_detected);
  vec2 eyeR = mix(vec2(0.65, 0.42), u_eye_r, u_face_detected);
  vec2 nose  = mix(vec2(0.50, 0.55), u_nose,  u_face_detected);
  // Third eye sits above the nose, between the two eyes
  vec2 te = mix(eyeL, eyeR, 0.5);
  te.y -= (nose.y - te.y) * 0.45;          // above eye midpoint
  float eyeSpan = length(eyeR - eyeL);      // distance between eyes
  // Animate eyelid opening: closes/opens slowly
  float open   = 0.55 + 0.45 * sin(u_time * 0.65);
  float lensR  = eyeSpan * 0.19;           // iris radius
  float lidH   = lensR * open;             // eyelid half-height
  vec2 delta   = uv - te;
  // Elliptical eye shape
  float ell    = length(delta / vec2(lensR, max(lidH, 0.002)));
  float iris   = smoothstep(1.0, 0.7, ell);
  float pupil  = smoothstep(lensR * 0.38, 0.0, length(delta));
  float outerG = smoothstep(2.5, 0.85, ell) * 0.5;
  // Iris colour: burning crimson with animated ring pattern
  float irisAnim = sin(length(delta) * 60.0 - u_time * 4.0) * 0.5 + 0.5;
  vec3 irisCol = mix(vec3(0.7, 0.05, 0.0), vec3(1.0, 0.35, 0.0), irisAnim);
  vec3 res = col.rgb;
  res = mix(res, irisCol,     iris   * 0.92);
  res = mix(res, vec3(0.0),   pupil);
  res += vec3(1.0, 0.25, 0.0) * outerG;
  // Blood-vessel rays radiating outward
  float ang = atan(delta.y, delta.x);
  float veins = pow(max(0.0, sin(ang * 9.0 + u_time * 2.0)), 7.0)
              * smoothstep(lensR * 2.5, lensR * 0.8, length(delta)) * 0.55;
  res += vec3(0.75, 0.0, 0.0) * veins;
  gl_FragColor = vec4(res, 1.0);
}`,
  },
  {
    name: "Melt Face",
    emoji: "😵",
    face: true,
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2  u_eye_l;
uniform vec2  u_eye_r;
uniform vec2  u_nose;
uniform vec2  u_mouth;
uniform float u_face_detected;
varying vec2 v_uv;

// Gravity well pulling UV downward toward landmark pt
float well(vec2 uv, vec2 pt, float seed) {
  vec2 d = uv - pt;
  float r = length(d) + 0.05;
  return 0.014 / (r * r) * (1.0 + 0.4 * sin(u_time + seed));
}

void main() {
  vec2 uv = v_uv;
  vec2 eyeL = mix(vec2(0.34, 0.40), u_eye_l,  u_face_detected);
  vec2 eyeR = mix(vec2(0.66, 0.40), u_eye_r,  u_face_detected);
  vec2 nose  = mix(vec2(0.50, 0.54), u_nose,   u_face_detected);
  vec2 mouth = mix(vec2(0.50, 0.67), u_mouth,  u_face_detected);
  // Accumulate melt from each landmark
  float m = well(uv, eyeL,  0.00)
          + well(uv, eyeR,  1.57)
          + well(uv, nose,  3.14)
          + well(uv, mouth, 4.71);
  // Warp UVs downward + sideways proportional to gravity
  uv.y -= m * 0.65 * (0.8 + 0.2 * sin(u_time * 0.5 + uv.x * 5.0));
  uv.x += m * 0.12 * sin(u_time * 0.9 + uv.y * 7.0);
  // Slow ambient sag from top
  uv.y -= 0.009 * sin(uv.x * 22.0 + u_time * 0.35) * pow(uv.y, 2.0);
  uv = clamp(uv, 0.0, 1.0);
  vec4 col = texture2D(u_tex, uv);
  // Thermal colouring — hotter (more orange-red) where melt is strongest
  float heat = smoothstep(0.0, 0.065, m);
  col.r = min(1.0, col.r + heat * 0.45);
  col.g *= 1.0 - heat * 0.30;
  col.b *= 1.0 - heat * 0.55;
  gl_FragColor = vec4(col.rgb, 1.0);
}`,
  },
  {
    name: "Neural Net",
    emoji: "🧠",
    face: true,
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2  u_eye_l;
uniform vec2  u_eye_r;
uniform vec2  u_nose;
uniform vec2  u_mouth;
uniform float u_face_w;
uniform float u_face_detected;
varying vec2 v_uv;

// Signed distance to a line segment
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t  = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - (a + t * ab));
}

// Animated signal spark travelling from a→b
float spark(vec2 uv, vec2 a, vec2 b, float speed, float phase) {
  vec2 ab = b - a;
  float t    = clamp(dot(uv - a, ab) / dot(ab, ab), 0.0, 1.0);
  float dist = length(uv - (a + t * ab));
  float onEdge = smoothstep(0.007, 0.001, dist);
  float pos    = fract(u_time * speed + phase);
  return smoothstep(0.10, 0.0, abs(t - pos)) * onEdge;
}

void main() {
  vec2 uv = v_uv;
  vec4 col = texture2D(u_tex, uv);
  vec2 el  = mix(vec2(0.35, 0.42), u_eye_l,  u_face_detected);
  vec2 er  = mix(vec2(0.65, 0.42), u_eye_r,  u_face_detected);
  vec2 ns  = mix(vec2(0.50, 0.55), u_nose,   u_face_detected);
  vec2 mt  = mix(vec2(0.50, 0.67), u_mouth,  u_face_detected);
  float fw = mix(0.30, u_face_w,   u_face_detected);

  // Dark neural-tinted base from webcam luma
  float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  vec3 base = luma * vec3(0.04, 0.11, 0.22);

  // 6 edges of the fully-connected 4-node graph
  float edgeDist = 9.9;
  edgeDist = min(edgeDist, sdSeg(uv, el, er));
  edgeDist = min(edgeDist, sdSeg(uv, el, ns));
  edgeDist = min(edgeDist, sdSeg(uv, er, ns));
  edgeDist = min(edgeDist, sdSeg(uv, ns, mt));
  edgeDist = min(edgeDist, sdSeg(uv, el, mt));
  edgeDist = min(edgeDist, sdSeg(uv, er, mt));
  base += vec3(0.05, 0.35, 0.80) * smoothstep(0.010, 0.002, edgeDist) * 0.65;

  // Bidirectional pulses on each edge
  float sparks = 0.0;
  sparks += spark(uv, el, er, 0.80, 0.00);
  sparks += spark(uv, er, el, 0.65, 0.25);
  sparks += spark(uv, el, ns, 0.90, 0.10);
  sparks += spark(uv, er, ns, 0.75, 0.50);
  sparks += spark(uv, ns, mt, 1.10, 0.35);
  sparks += spark(uv, mt, ns, 0.85, 0.70);
  sparks += spark(uv, el, mt, 0.60, 0.80);
  sparks += spark(uv, er, mt, 0.70, 0.15);
  base += vec3(0.40, 0.90, 1.00) * min(sparks * 2.0, 1.0);

  // Landmark nodes
  float nr  = fw * 0.055;
  float pulse = 0.5 + 0.5 * sin(u_time * 2.5);
  float pingR = nr + fw * 0.08 * pulse;
  float nodes = 0.0;
  nodes += smoothstep(nr,        0.0, length(uv - el));
  nodes += smoothstep(nr,        0.0, length(uv - er));
  nodes += smoothstep(nr * 0.8,  0.0, length(uv - ns));
  nodes += smoothstep(nr,        0.0, length(uv - mt));
  // Expanding ping rings
  nodes += smoothstep(0.010, 0.0, abs(length(uv - el) - pingR)) * (1.0 - pulse);
  nodes += smoothstep(0.010, 0.0, abs(length(uv - er) - pingR)) * (1.0 - pulse);
  nodes += smoothstep(0.008, 0.0, abs(length(uv - ns) - pingR * 0.85)) * (1.0 - pulse);
  nodes += smoothstep(0.010, 0.0, abs(length(uv - mt) - pingR)) * (1.0 - pulse);
  base += vec3(0.00, 1.00, 0.90) * min(nodes, 1.0) * 1.4;

  gl_FragColor = vec4(base, 1.0);
}`,
  },
  {
    name: "Thermal",
    emoji: "🌡️",
    face: true,
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2  u_eye_l;
uniform vec2  u_eye_r;
uniform vec2  u_nose;
uniform vec2  u_mouth;
uniform float u_face_w;
uniform float u_face_detected;
varying vec2 v_uv;

// Scientific IR false-colour ramp: black→blue→cyan→green→yellow→red→white
vec3 thermalRamp(float t) {
  t = clamp(t * 6.0, 0.0, 6.0);
  vec3 c0 = vec3(0.00, 0.00, 0.10);
  vec3 c1 = vec3(0.00, 0.05, 0.60);
  vec3 c2 = vec3(0.00, 0.60, 0.80);
  vec3 c3 = vec3(0.15, 0.90, 0.20);
  vec3 c4 = vec3(1.00, 0.85, 0.00);
  vec3 c5 = vec3(1.00, 0.10, 0.00);
  vec3 c6 = vec3(1.00, 1.00, 1.00);
  vec3 col = mix(c0, c1, clamp(t,       0.0, 1.0));
  col = mix(col, mix(c1, c2, clamp(t - 1.0, 0.0, 1.0)), step(1.0, t));
  col = mix(col, mix(c2, c3, clamp(t - 2.0, 0.0, 1.0)), step(2.0, t));
  col = mix(col, mix(c3, c4, clamp(t - 3.0, 0.0, 1.0)), step(3.0, t));
  col = mix(col, mix(c4, c5, clamp(t - 4.0, 0.0, 1.0)), step(4.0, t));
  col = mix(col, mix(c5, c6, clamp(t - 5.0, 0.0, 1.0)), step(5.0, t));
  return col;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5);
}

void main() {
  vec2 uv = v_uv;
  vec4 col = texture2D(u_tex, uv);
  vec2 el  = mix(vec2(0.35, 0.42), u_eye_l,  u_face_detected);
  vec2 er  = mix(vec2(0.65, 0.42), u_eye_r,  u_face_detected);
  vec2 ns  = mix(vec2(0.50, 0.55), u_nose,   u_face_detected);
  vec2 mt  = mix(vec2(0.50, 0.67), u_mouth,  u_face_detected);
  float fw = mix(0.30, u_face_w,   u_face_detected);

  // Webcam luma gives ambient background heat
  float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  float heat = luma * 0.28;

  // Gaussian heat plumes from each landmark
  float sp = fw * 4.0;
  heat += 0.55 * exp(-length(uv - el) * sp * 4.0);
  heat += 0.55 * exp(-length(uv - er) * sp * 4.0);
  heat += 0.50 * exp(-length(uv - ns) * sp * 3.5);
  heat += 0.45 * exp(-length(uv - mt) * sp * 3.5);

  // Subtle breathing pulse centred on nose
  heat += 0.04 * sin(u_time * 1.3) * exp(-length(uv - ns) * sp * 2.5);

  // Sensor grain
  heat += (hash(uv * 280.0 + fract(u_time * 0.4)) - 0.5) * 0.03;

  gl_FragColor = vec4(thermalRamp(heat), 1.0);
}`,
  },
  {
    name: "Rift",
    emoji: "⚡",
    face: true,
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2  u_eye_l;
uniform vec2  u_eye_r;
uniform vec2  u_nose;
uniform vec2  u_mouth;
uniform float u_face_w;
uniform float u_face_detected;
varying vec2 v_uv;

void main() {
  vec2 uv  = v_uv;
  vec2 el  = mix(vec2(0.35, 0.42), u_eye_l,  u_face_detected);
  vec2 er  = mix(vec2(0.65, 0.42), u_eye_r,  u_face_detected);
  vec2 ns  = mix(vec2(0.50, 0.55), u_nose,   u_face_detected);

  // Jagged dimensional tear centred on the nose x axis
  float riftX = ns.x
    + 0.020 * sin(uv.y * 14.0 + u_time * 3.5)
    + 0.010 * sin(uv.y * 37.0 - u_time * 6.5)
    + 0.005 * sin(uv.y * 83.0 + u_time * 10.0);

  // Left eye: counter-clockwise vortex
  float spinL =  0.0030 * sin(u_time * 2.0);
  vec2 dL = uv - el;
  float aL = spinL / (dot(dL, dL) + 0.007);
  float csL = cos(aL), snL = sin(aL);
  vec2 uvL = el + vec2(csL * dL.x - snL * dL.y, snL * dL.x + csL * dL.y);

  // Right eye: clockwise vortex (opposite spin)
  float spinR = -spinL;
  vec2 dR = uv - er;
  float aR = spinR / (dot(dR, dR) + 0.007);
  float csR = cos(aR), snR = sin(aR);
  vec2 uvR = er + vec2(csR * dR.x - snR * dR.y, snR * dR.x + csR * dR.y);

  // This dimension (left): warm tones
  vec4 leftCol = texture2D(u_tex, clamp(uvL, 0.0, 1.0));
  leftCol.rgb *= vec3(1.12, 1.03, 0.85);

  // Mirror dimension (right): flipped around nose, inverted, cold + glitch
  vec2 uvFlip  = vec2(2.0 * ns.x - uvR.x, uvR.y);
  uvFlip.x    += 0.020 * sin(uv.y * 28.0 - u_time * 9.0);
  vec4 rightCol = texture2D(u_tex, clamp(uvFlip, 0.0, 1.0));
  rightCol.rgb  = 1.0 - rightCol.rgb;
  rightCol.rgb *= vec3(0.70, 0.82, 1.20);
  rightCol.rgb  = clamp(rightCol.rgb, 0.0, 1.0);

  // Blend sides across the tear
  float blend = smoothstep(-0.003, 0.003, uv.x - riftX);
  vec3 col = mix(leftCol.rgb, rightCol.rgb, blend);

  // Energy crack: white core + wider blue aura
  float riftDist = abs(uv.x - riftX);
  float flicker  = 0.7 + 0.3 * sin(u_time * 20.0 + uv.y * 60.0);
  col = mix(col, vec3(0.85, 0.97, 1.00) * flicker,
            smoothstep(0.010, 0.001, riftDist) * 0.95);
  col += vec3(0.15, 0.45, 1.00) * smoothstep(0.040, 0.0, riftDist) * 0.35;

  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Laser Visor",
    emoji: "🔻",
    face: true,
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2  u_eye_l;
uniform vec2  u_eye_r;
uniform vec2  u_nose;
uniform float u_face_detected;
varying vec2 v_uv;

float lineGlow(vec2 uv, vec2 a, vec2 b, float width) {
  vec2 pa = uv - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return smoothstep(width, 0.0, length(pa - ba * h));
}

void main() {
  vec2 uv = v_uv;
  vec4 webcam = texture2D(u_tex, uv);
  vec2 eyeL = mix(vec2(0.35, 0.42), u_eye_l, u_face_detected);
  vec2 eyeR = mix(vec2(0.65, 0.42), u_eye_r, u_face_detected);
  vec2 nose = mix(vec2(0.50, 0.55), u_nose, u_face_detected);
  vec2 visorMid = mix(eyeL, eyeR, 0.5);
  float visorBand = smoothstep(0.12, 0.02, abs(uv.y - visorMid.y));
  float sweep = smoothstep(0.05, 0.0, abs(uv.x - fract(u_time * 0.22)));
  vec2 beamLTarget = vec2(-0.25, eyeL.y + 0.03 * sin(u_time * 3.0));
  vec2 beamRTarget = vec2(1.25, eyeR.y - 0.03 * sin(u_time * 3.0));
  float beamL = lineGlow(uv, eyeL, beamLTarget, 0.025);
  float beamR = lineGlow(uv, eyeR, beamRTarget, 0.025);
  float eyeLCore = smoothstep(0.12, 0.0, distance(uv, eyeL));
  float eyeRCore = smoothstep(0.12, 0.0, distance(uv, eyeR));
  float reticleRing = smoothstep(0.025, 0.004, abs(distance(uv, nose) - 0.055));
  float reticleCross = smoothstep(0.012, 0.0, abs(uv.x - nose.x))
                     * smoothstep(0.09, 0.0, abs(uv.y - nose.y))
                     + smoothstep(0.012, 0.0, abs(uv.y - nose.y))
                     * smoothstep(0.09, 0.0, abs(uv.x - nose.x));
  vec3 base = webcam.rgb * vec3(0.16, 0.2, 0.26);
  vec3 visor = vec3(0.05, 0.95, 1.0) * visorBand * (0.35 + sweep * 0.95);
  vec3 beam = vec3(1.0, 0.15, 0.2) * (beamL + beamR) * (0.85 + 0.15 * sin(u_time * 12.0));
  vec3 eyeGlow = vec3(1.0, 0.25, 0.3) * (eyeLCore + eyeRCore);
  vec3 reticle = vec3(0.95, 0.9, 0.2) * (reticleRing + reticleCross * 0.55);
  gl_FragColor = vec4(base + visor + beam + eyeGlow + reticle, 1.0);
}`,
  },
  {
    name: "Mouth Portal",
    emoji: "🌀",
    face: true,
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2  u_eye_l;
uniform vec2  u_eye_r;
uniform vec2  u_mouth;
uniform float u_face_w;
uniform float u_face_detected;
varying vec2 v_uv;

void main() {
  vec2 uv = v_uv;
  vec2 mouth = mix(vec2(0.50, 0.67), u_mouth, u_face_detected);
  vec2 eyeL = mix(vec2(0.35, 0.42), u_eye_l, u_face_detected);
  vec2 eyeR = mix(vec2(0.65, 0.42), u_eye_r, u_face_detected);
  float faceW = mix(0.30, u_face_w, u_face_detected);
  vec2 delta = uv - mouth;
  float r = length(delta);
  float swirl = atan(delta.y, delta.x) + u_time * 1.8 + 0.12 / (r + 0.05);
  vec2 warped = mouth + vec2(cos(swirl), sin(swirl)) * r;
  warped += normalize(delta + vec2(0.0001)) * (0.08 / (1.0 + r * 18.0));
  vec3 portalBase = texture2D(u_tex, clamp(warped, 0.0, 1.0)).rgb;
  float ringA = smoothstep(faceW * 0.10, faceW * 0.02, abs(r - faceW * 0.15));
  float ringB = smoothstep(faceW * 0.08, faceW * 0.02, abs(r - faceW * 0.24));
  float spiral = 0.5 + 0.5 * sin(18.0 * r - u_time * 7.0 + atan(delta.y, delta.x) * 5.0);
  float mouthCore = smoothstep(faceW * 0.22, 0.0, r);
  float eyeShock = smoothstep(faceW * 0.13, 0.0, distance(uv, eyeL))
                  + smoothstep(faceW * 0.13, 0.0, distance(uv, eyeR));
  vec3 abyss = mix(vec3(0.02, 0.0, 0.05), vec3(0.35, 0.0, 0.65), spiral);
  vec3 glow = vec3(0.0, 0.95, 1.0) * ringA + vec3(1.0, 0.0, 0.7) * ringB;
  vec3 col = mix(portalBase * 0.22, abyss, mouthCore * 0.85);
  col += glow * (0.55 + 0.45 * sin(u_time * 4.0));
  col += vec3(0.8, 0.95, 1.0) * eyeShock * 0.28;
  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Crown Bloom",
    emoji: "👑",
    face: true,
    code: `precision mediump float;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2  u_eye_l;
uniform vec2  u_eye_r;
uniform vec2  u_nose;
uniform float u_face_w;
uniform float u_face_detected;
varying vec2 v_uv;

float sparkle(vec2 uv, vec2 pt, float size) {
  float d = distance(uv, pt);
  return smoothstep(size, 0.0, d);
}

void main() {
  vec2 uv = v_uv;
  vec4 webcam = texture2D(u_tex, uv);
  vec2 eyeL = mix(vec2(0.35, 0.42), u_eye_l, u_face_detected);
  vec2 eyeR = mix(vec2(0.65, 0.42), u_eye_r, u_face_detected);
  vec2 nose = mix(vec2(0.50, 0.55), u_nose, u_face_detected);
  float faceW = mix(0.30, u_face_w, u_face_detected);
  vec2 brow = mix(eyeL, eyeR, 0.5);
  brow.y -= faceW * 0.42;
  vec2 sideL = brow + vec2(-faceW * 0.36, faceW * 0.16);
  vec2 sideR = brow + vec2(faceW * 0.36, faceW * 0.16);
  vec2 top = brow + vec2(0.0, -faceW * 0.34);
  float crownBand = smoothstep(faceW * 0.09, 0.0, abs(uv.y - brow.y))
                  * smoothstep(faceW * 0.75, faceW * 0.18, abs(uv.x - brow.x));
  float spikeL = smoothstep(faceW * 0.14, 0.0, distance(uv, sideL));
  float spikeR = smoothstep(faceW * 0.14, 0.0, distance(uv, sideR));
  float spikeT = smoothstep(faceW * 0.16, 0.0, distance(uv, top));
  float halo = smoothstep(faceW * 0.72, faceW * 0.16, distance(uv, nose));
  float aurora = 0.5 + 0.5 * sin(uv.x * 40.0 + u_time * 3.5 + uv.y * 13.0);
  float gem = sparkle(uv, brow + vec2(0.0, faceW * 0.04), faceW * 0.11);
  vec3 crown = mix(vec3(0.1, 0.55, 1.0), vec3(1.0, 0.25, 0.9), aurora);
  vec3 base = mix(webcam.rgb, webcam.rgb * vec3(0.35, 0.18, 0.5), halo * 0.55);
  base += crown * crownBand * 0.75;
  base += vec3(1.0, 0.85, 0.2) * (spikeL + spikeR + spikeT) * (0.7 + 0.3 * sin(u_time * 6.0));
  base += vec3(1.0, 0.95, 0.5) * gem;
  gl_FragColor = vec4(base, 1.0);
}`,
  },
];

interface WebGLState {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  uTime: WebGLUniformLocation;
  uTex: WebGLUniformLocation;
  uEyeL: WebGLUniformLocation | null;
  uEyeR: WebGLUniformLocation | null;
  uNose: WebGLUniformLocation | null;
  uMouth: WebGLUniformLocation | null;
  uFaceW: WebGLUniformLocation | null;
  uFaceDetected: WebGLUniformLocation | null;
}

interface FaceData {
  eyeL: [number, number];
  eyeR: [number, number];
  nose: [number, number];
  mouth: [number, number];
  faceW: number;
  detected: boolean;
}

function getFaceUniforms(
  gl: WebGLRenderingContext,
  prog: WebGLProgram,
): Pick<
  WebGLState,
  "uEyeL" | "uEyeR" | "uNose" | "uMouth" | "uFaceW" | "uFaceDetected"
> {
  return {
    uEyeL: gl.getUniformLocation(prog, "u_eye_l"),
    uEyeR: gl.getUniformLocation(prog, "u_eye_r"),
    uNose: gl.getUniformLocation(prog, "u_nose"),
    uMouth: gl.getUniformLocation(prog, "u_mouth"),
    uFaceW: gl.getUniformLocation(prog, "u_face_w"),
    uFaceDetected: gl.getUniformLocation(prog, "u_face_detected"),
  };
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return null;
  }
  return shader;
}

function buildProgram(
  gl: WebGLRenderingContext,
  fsSrc: string,
): { program: WebGLProgram; error: null } | { program: null; error: string } {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
  if (!vs)
    return { program: null, error: "Vertex shader failed (internal error)" };

  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!fs) {
    const tmpFs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(tmpFs, fsSrc);
    gl.compileShader(tmpFs);
    const log = gl.getShaderInfoLog(tmpFs) ?? "Unknown error";
    gl.deleteShader(tmpFs);
    gl.deleteShader(vs);
    return { program: null, error: log };
  }

  const prog = gl.createProgram();
  if (!prog) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { program: null, error: "createProgram failed" };
  }

  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? "Link error";
    gl.deleteProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { program: null, error: log };
  }

  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return { program: prog, error: null };
}

export default function CollabShaderLab() {
  const logger = useMemo(() => new Logger(), []);

  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const webcamPreviewRef = useRef<HTMLVideoElement>(null);

  const glStateRef = useRef<WebGLState | null>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(performance.now());
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [shaderCode, setShaderCode] = useState(PRESET_SHADERS[0].code);
  const [shaderError, setShaderError] = useState<string | null>(null);
  const [webcamActive, setWebcamActive] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [peerEditing, setPeerEditing] = useState(false);

  // Face tracking
  const [faceActive, setFaceActive] = useState(false);
  const [faceLoading, setFaceLoading] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const faceModelRef = useRef<{
    estimateFaces: (v: HTMLVideoElement) => Promise<
      { keypoints: { x: number; y: number; name?: string }[] }[]
    >;
  } | null>(null);
  const faceDataRef = useRef<FaceData>({
    eyeL: [0.35, 0.42],
    eyeR: [0.65, 0.42],
    nose: [0.5, 0.55],
    mouth: [0.5, 0.67],
    faceW: 0.3,
    detected: false,
  });

  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressSendRef = useRef(false);

  // Initialize WebGL
  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl");
    if (!gl) {
      logger.error("WebGL not supported");
      return;
    }

    const result = buildProgram(gl, PRESET_SHADERS[0].code);
    if (!result.program) {
      setShaderError(result.error);
      return;
    }

    gl.useProgram(result.program);

    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(result.program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    const pixels = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 40;
      pixels[i + 1] = 40;
      pixels[i + 2] = 40;
      pixels[i + 3] = 255;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const uTime = gl.getUniformLocation(result.program, "u_time")!;
    const uTex = gl.getUniformLocation(result.program, "u_tex")!;
    gl.uniform1i(uTex, 0);

    glStateRef.current = {
      gl,
      program: result.program,
      texture,
      uTime,
      uTex,
      ...getFaceUniforms(gl, result.program),
    };

    const loop = () => {
      const gs = glStateRef.current;
      if (!gs) {
        animRef.current = requestAnimationFrame(loop);
        return;
      }
      const t = (performance.now() - startTimeRef.current) / 1000;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(gs.uTime, t);

      // Face uniforms — always set if the shader uses them
      const fd = faceDataRef.current;
      if (gs.uFaceDetected !== null)
        gl.uniform1f(gs.uFaceDetected, fd.detected ? 1.0 : 0.0);
      if (gs.uEyeL !== null) gl.uniform2f(gs.uEyeL, fd.eyeL[0], fd.eyeL[1]);
      if (gs.uEyeR !== null) gl.uniform2f(gs.uEyeR, fd.eyeR[0], fd.eyeR[1]);
      if (gs.uNose !== null) gl.uniform2f(gs.uNose, fd.nose[0], fd.nose[1]);
      if (gs.uMouth !== null)
        gl.uniform2f(gs.uMouth, fd.mouth[0], fd.mouth[1]);
      if (gs.uFaceW !== null) gl.uniform1f(gs.uFaceW, fd.faceW);

      const video = webcamVideoRef.current;
      if (video && video.readyState >= 2) {
        gl.bindTexture(gl.TEXTURE_2D, gs.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
      gl.deleteProgram(result.program);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buf);
    };
  }, [logger]);

  const recompileShader = useCallback(
    (code: string) => {
      const gs = glStateRef.current;
      if (!gs) return;
      const { gl, texture } = gs;

      const result = buildProgram(gl, code);
      if (!result.program) {
        setShaderError(result.error);
        return;
      }

      gl.deleteProgram(gs.program);
      gl.useProgram(result.program);

      const aPos = gl.getAttribLocation(result.program, "a_pos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      const uTime = gl.getUniformLocation(result.program, "u_time")!;
      const uTex = gl.getUniformLocation(result.program, "u_tex")!;
      gl.uniform1i(uTex, 0);
      gl.bindTexture(gl.TEXTURE_2D, texture);

      glStateRef.current = {
        gl,
        program: result.program,
        texture,
        uTime,
        uTex,
        ...getFaceUniforms(gl, result.program),
      };
      setShaderError(null);
      logger.info("Shader compiled successfully");
    },
    [logger],
  );

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setShaderCode(newCode);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        recompileShader(newCode);
        if (!suppressSendRef.current && dcRef.current?.readyState === "open") {
          dcRef.current.send(JSON.stringify({ type: "shader", code: newCode }));
        }
      }, 300);
    },
    [recompileShader],
  );

  const handleGetWebcam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 270 },
        audio: false,
      });
      webcamStreamRef.current = stream;
      const video = webcamVideoRef.current!;
      video.srcObject = stream;
      await video.play();
      if (webcamPreviewRef.current) {
        webcamPreviewRef.current.srcObject = stream;
        await webcamPreviewRef.current.play();
      }
      setWebcamActive(true);
      logger.info("Webcam active — feeding as shader texture u_tex");
    } catch (err) {
      logger.error(`Webcam error: ${err}`);
    }
  }, [logger]);

  // Enable face tracking — loads FaceMesh model and starts detection
  const enableFaceTracking = useCallback(async () => {
    setFaceLoading(true);
    logger.info("Loading FaceMesh model…");
    try {
      const tf = await import("@tensorflow/tfjs");
      await tf.setBackend("webgl");
      await tf.ready();
      const fld = await import("@tensorflow-models/face-landmarks-detection");
      const model = await fld.createDetector(
        fld.SupportedModels.MediaPipeFaceMesh,
        { runtime: "tfjs" as const, maxFaces: 1, refineLandmarks: false },
      );
      faceModelRef.current = model as typeof faceModelRef.current;
      setFaceActive(true);
      logger.success(
        "Face tracking active! Eye/nose/mouth positions now drive the shader uniforms.",
      );
    } catch (e) {
      logger.error(`Face model failed: ${e}`);
    }
    setFaceLoading(false);
  }, [logger]);

  const handlePreset = useCallback(
    (p: (typeof PRESET_SHADERS)[number]) => {
      logger.info(`Loading preset: ${p.name}`);
      setShaderCode(p.code);
      recompileShader(p.code);
      if (dcRef.current?.readyState === "open") {
        dcRef.current.send(JSON.stringify({ type: "shader", code: p.code }));
      }
      // Auto-start face tracking when selecting a face shader
      if (p.face && webcamActive && !faceActive && !faceLoading) {
        enableFaceTracking();
      }
    },
    [logger, recompileShader, webcamActive, faceActive, faceLoading, enableFaceTracking],
  );

  // Face detection polling loop (~20 fps)
  // Uses an offscreen canvas so TF.js gets a clean snapshot independent
  // of the WebGL render loop that reads the same video element.
  useEffect(() => {
    if (!faceActive) return;
    let cancelled = false;
    let errCount = 0;

    // Create a persistent offscreen canvas for face detection input
    const offscreen = document.createElement('canvas');
    faceCanvasRef.current = offscreen;

    const detect = async () => {
      if (cancelled) return;
      const model = faceModelRef.current;
      const video = webcamVideoRef.current;
      if (model && video && video.readyState >= 2 && video.videoWidth > 0) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        // Resize offscreen canvas to match video if needed
        if (offscreen.width !== vw || offscreen.height !== vh) {
          offscreen.width = vw;
          offscreen.height = vh;
        }
        const ctx2d = offscreen.getContext('2d');
        if (ctx2d) {
          ctx2d.drawImage(video, 0, 0, vw, vh);
          try {
            const faces = await model.estimateFaces(offscreen as unknown as HTMLVideoElement);
            errCount = 0;
            if (faces.length > 0) {
              const kp = faces[0].keypoints as { x: number; y: number }[];
              const eyeL = avg2(kp[33], kp[133]);
              const eyeR = avg2(kp[362], kp[263]);
              const faceL = kp[234];
              const faceR = kp[454];
              const faceW = Math.hypot(faceR.x - faceL.x, faceR.y - faceL.y) / vw;
              const mouth = avg2(kp[61], kp[291]);
              faceDataRef.current = {
                eyeL: [eyeL.x / vw, eyeL.y / vh],
                eyeR: [eyeR.x / vw, eyeR.y / vh],
                nose: [kp[1].x / vw, kp[1].y / vh],
                mouth: [mouth.x / vw, mouth.y / vh],
                faceW,
                detected: true,
              };
              setFaceDetected(true);
            } else {
              faceDataRef.current = { ...faceDataRef.current, detected: false };
              setFaceDetected(false);
            }
          } catch (e) {
            errCount++;
            if (errCount <= 3) logger.error(`Face detection error: ${e}`);
          }
        }
      }
      if (!cancelled) setTimeout(detect, 50);
    };
    detect();
    return () => {
      cancelled = true;
      faceCanvasRef.current = null;
    };
  }, [faceActive, logger]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    logger.info("Setting up loopback RTCPeerConnection for shader sync...");

    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA;
    pcBRef.current = pcB;

    const dc = pcA.createDataChannel("shader-sync");
    dcRef.current = dc;

    dc.onopen = () => {
      setConnected(true);
      setConnecting(false);
      logger.info("DataChannel open — shader edits now sync in real-time");
    };

    const onMsg = (e: MessageEvent) => {
      const msg = JSON.parse(e.data as string) as {
        type: string;
        code?: string;
      };
      if (msg.type === "shader" && msg.code !== undefined) {
        logger.info("Received shader update from peer");
        setPeerEditing(true);
        suppressSendRef.current = true;
        setShaderCode(msg.code);
        recompileShader(msg.code);
        setTimeout(() => {
          suppressSendRef.current = false;
          setPeerEditing(false);
        }, 400);
      }
    };

    dc.onmessage = onMsg;
    pcB.ondatachannel = (e) => {
      e.channel.onmessage = onMsg;
    };

    pcA.onicecandidate = (e) => {
      if (e.candidate) pcB.addIceCandidate(e.candidate);
    };
    pcB.onicecandidate = (e) => {
      if (e.candidate) pcA.addIceCandidate(e.candidate);
    };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  }, [logger, recompileShader]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
      pcARef.current?.close();
      pcBRef.current?.close();
    };
  }, []);

  return (
    <DemoLayout
      title="Collaborative Shader Lab"
      difficulty="advanced"
      description="Live GLSL fragment shader editor with webcam texture, synced between peers via RTCDataChannel"
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Edit a GLSL fragment shader live. Your webcam feeds as{" "}
            <code className="text-teal-400 font-mono">u_tex</code>. Enable{" "}
            <strong>Face Tracking</strong> to unlock six special shaders —
            eye, nose, mouth, and face-width positions are injected as uniforms
            and update every frame as your face moves.
          </p>
          <p>
            Shader edits are debounced 300 ms and synced via{" "}
            <strong>RTCDataChannel</strong>. GLSL errors appear inline below the
            canvas.
          </p>
        </div>
      }
      demo={
        <div className="space-y-4">
          {/* WebGL canvas */}
          <div className="relative">
            <canvas
              ref={glCanvasRef}
              width={480}
              height={270}
              className="rounded-xl border border-zinc-800 block w-full"
              style={{ maxWidth: 480, height: 270 }}
            />
            {peerEditing && (
              <div className="absolute top-2 right-2 px-2 py-1 bg-teal-800 text-teal-200 text-xs rounded-lg animate-pulse">
                Peer editing...
              </div>
            )}
            {faceLoading && (
              <div className="absolute top-2 left-2 px-2 py-1 bg-zinc-800/90 border border-zinc-600 text-zinc-300 text-xs rounded-lg animate-pulse">
                ⏳ Loading face model…
              </div>
            )}
            {faceActive && !faceLoading && (
              <div className={`absolute top-2 left-2 px-2 py-1 border text-xs rounded-lg ${faceDetected ? 'bg-violet-900/80 border-violet-500 text-violet-200' : 'bg-zinc-800/80 border-zinc-600 text-zinc-400'}`}>
                {faceDetected ? '👁 Face detected' : '👁 Looking for face…'}
              </div>
            )}
          </div>

          {/* Shader error */}
          {shaderError && (
            <div className="bg-red-950 border border-red-800 rounded-lg p-3">
              <div className="text-xs font-semibold text-red-400 mb-1">
                Shader Compilation Error
              </div>
              <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap break-all">
                {shaderError}
              </pre>
            </div>
          )}

          {/* Preset buttons — grouped */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {PRESET_SHADERS.filter((p) => !p.face).map((p) => (
                <button
                  key={p.name}
                  onClick={() => handlePreset(p)}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {p.emoji} {p.name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-violet-400 font-medium">
                Face-driven:
              </span>
              {PRESET_SHADERS.filter((p) => p.face).map((p) => (
                <button
                  key={p.name}
                  onClick={() => handlePreset(p)}
                  title={!webcamActive ? "Enable webcam first" : ""}
                  className="px-3 py-1.5 bg-violet-950 hover:bg-violet-900 border border-violet-700 text-violet-200 text-xs font-medium rounded-lg transition-colors"
                >
                  {p.emoji} {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Editor + controls */}
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-zinc-500 mb-1 font-mono">
                Fragment Shader (GLSL)
              </div>
              <textarea
                value={shaderCode}
                onChange={(e) => handleCodeChange(e.target.value)}
                spellCheck={false}
                className="w-full h-52 bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs font-mono text-zinc-200 resize-none focus:outline-none focus:border-zinc-600 leading-relaxed"
                style={{ tabSize: 2 }}
              />
            </div>

            <div className="flex flex-col gap-3" style={{ width: 200 }}>
              <div>
                <div className="text-xs text-zinc-500 mb-1">Webcam (u_tex)</div>
                <video
                  ref={webcamPreviewRef}
                  muted
                  playsInline
                  className="rounded-lg border border-zinc-800 bg-zinc-950"
                  style={{ width: 200, height: 113, objectFit: "cover" }}
                />
              </div>
              <video
                ref={webcamVideoRef}
                muted
                playsInline
                style={{ display: "none" }}
              />

              <button
                onClick={handleGetWebcam}
                disabled={webcamActive}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {webcamActive ? "✓ Webcam Active" : "Get Webcam"}
              </button>

              <button
                onClick={enableFaceTracking}
                disabled={faceActive || faceLoading || !webcamActive}
                className="px-3 py-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                title={!webcamActive ? "Enable webcam first" : ""}
              >
                {faceLoading
                  ? "⏳ Loading model…"
                  : faceActive
                    ? "👁 Face Tracking On"
                    : "👁 Enable Face Tracking"}
              </button>

              <button
                onClick={handleConnect}
                disabled={connected || connecting}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {connecting
                  ? "Connecting..."
                  : connected
                    ? "✓ Connected"
                    : "Connect Loopback"}
              </button>

              {connected && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-400">
                  <div className="text-green-400 font-medium mb-1">
                    Sync active
                  </div>
                  Shader edits sync to peer via RTCDataChannel.
                </div>
              )}
            </div>
          </div>

          {/* Uniforms reference */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs font-semibold text-zinc-400 mb-2">
              Available Uniforms
            </div>
            <div className="grid grid-cols-1 gap-1 text-xs font-mono">
              <div>
                <span className="text-teal-400">sampler2D u_tex</span>
                <span className="text-zinc-500"> — webcam frame</span>
              </div>
              <div>
                <span className="text-teal-400">float u_time</span>
                <span className="text-zinc-500"> — elapsed seconds</span>
              </div>
              <div>
                <span className="text-teal-400">varying vec2 v_uv</span>
                <span className="text-zinc-500"> — UV coordinates (0–1)</span>
              </div>
              <div className="mt-1 pt-1 border-t border-zinc-800">
                <span className="text-violet-400">vec2 u_eye_l / u_eye_r</span>
                <span className="text-zinc-500"> — eye centres (UV)</span>
              </div>
              <div>
                <span className="text-violet-400">vec2 u_nose / u_mouth</span>
                <span className="text-zinc-500"> — nose tip, mouth centre</span>
              </div>
              <div>
                <span className="text-violet-400">float u_face_w</span>
                <span className="text-zinc-500"> — face width (0–1)</span>
              </div>
              <div>
                <span className="text-violet-400">float u_face_detected</span>
                <span className="text-zinc-500"> — 1.0 when face visible</span>
              </div>
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: "Shader Sync via RTCDataChannel" }}
      hints={[
        "Face-driven shaders (purple buttons) work without face tracking — they use default positions. Enable tracking for live landmark control.",
        "Shader edits are debounced 300ms before recompile — fast edits won't stall the GPU.",
        "Use mix(defaultPos, u_eye_l, u_face_detected) to gracefully fall back when no face is detected.",
        "Try displacing v_uv with sin/cos before sampling u_tex for a warped webcam effect.",
        "GLSL compilation errors appear inline — you can debug shaders interactively.",
      ]}
      mdnLinks={[
        {
          label: "WebGLRenderingContext",
          href: "https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext",
        },
        {
          label: "RTCDataChannel",
          href: "https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel",
        },
        {
          label: "GLSL Reference",
          href: "https://www.khronos.org/opengl/wiki/Core_Language_(GLSL)",
        },
      ]}
    />
  );
}
