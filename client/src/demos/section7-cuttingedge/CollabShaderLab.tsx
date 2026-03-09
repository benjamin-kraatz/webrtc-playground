import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

// MediaPipe Face Mesh landmark indices
const LEFT_EYE = [33, 133, 160, 159, 158, 157];
const RIGHT_EYE = [263, 362, 387, 386, 385, 384];
const NOSE_TIP = 4;
const UPPER_LIP = 13;
const LOWER_LIP = 14;
const MOUTH_LEFT = 61;
const MOUTH_RIGHT = 291;

const VERT = `#version 300 es
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_video;
uniform vec2 u_resolution;

// Original 3: eyes + face
uniform vec2 u_leftEye;
uniform vec2 u_rightEye;
uniform vec2 u_faceCenter;

// New 3: mouth ripple, head tilt, smile
uniform float u_mouthOpen;
uniform float u_headTilt;
uniform float u_smile;

#define PI 3.14159265359

void main() {
  vec2 uv = v_uv;
  vec2 px = 1.0 / u_resolution;

  // 1. EYE BEAMS: radial glow from each eye position
  float distL = length(uv - u_leftEye);
  float distR = length(uv - u_rightEye);
  float beamL = exp(-distL * 8.0) * 0.4;
  float beamR = exp(-distR * 8.0) * 0.4;
  vec3 eyeGlow = vec3(0.2, 0.6, 1.0) * beamL + vec3(1.0, 0.4, 0.6) * beamR;

  // 2. MOUTH RIPPLE: concentric waves from face center when mouth opens
  vec2 toCenter = uv - u_faceCenter;
  float distFromCenter = length(toCenter);
  float ripplePhase = distFromCenter * 20.0 - u_mouthOpen * 15.0;
  float ripple = sin(ripplePhase) * 0.5 + 0.5;
  float rippleAmp = u_mouthOpen * 0.15;
  uv += toCenter * (1.0 + ripple * rippleAmp) - toCenter;

  // 3. HEAD TILT: rotate UV around face center (gravity-like swirl)
  vec2 centered = uv - u_faceCenter;
  float angle = u_headTilt * 0.5;
  float c = cos(angle), s = sin(angle);
  uv = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c) + u_faceCenter;

  // Sample video with distortion
  vec4 tex = texture(u_video, uv);
  vec3 col = tex.rgb;

  // Add eye beam overlay (additive blend)
  col += eyeGlow;

  // 4. SMILE MOOD RING: hue shift based on smile (0=cool purple, 1=warm orange)
  float hueShift = u_smile * 0.15;
  vec3 mood = vec3(
    col.r * (1.0 + hueShift) + col.b * hueShift,
    col.g,
    col.b * (1.0 - hueShift) - col.r * hueShift * 0.5
  );
  col = mix(col, mood, 0.4);

  // 5. FACE VIGNETTE: darken edges, subtle focus on face
  float faceDist = length(uv - u_faceCenter);
  float vignette = 1.0 - smoothstep(0.3, 0.8, faceDist) * 0.3;
  col *= vignette;

  fragColor = vec4(col, 1.0);
}
`;

function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, vertSrc);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(vs));
    return null;
  }
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, fragSrc);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(fs));
    return null;
  }
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

const CODE = `// FaceMesh landmarks drive shader uniforms
const faces = await detector.estimateFaces(video);
const kp = faces[0]?.keypoints ?? [];

// Left eye center (avg of landmarks)
const leftEye = avg(kp, [33, 133, 160, 159, 158, 157]);
// Right eye, face center, mouth open, smile, head tilt...
gl.uniform2f(u_leftEye, leftEye.x / w, 1 - leftEye.y / h);
gl.uniform1f(u_mouthOpen, mouthOpenness);
// Shader combines: eye beams, mouth ripple, head-tilt rotation, smile hue
`;

export default function CollabShaderLab() {
  const logger = useMemo(() => new Logger(), []);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<unknown>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const texRef = useRef<WebGLTexture | null>(null);
  const rafRef = useRef<number>(0);

  const W = 640;
  const H = 480;

  const defaults = useMemo(
    () => ({
      leftEye: [0.35, 0.45] as [number, number],
      rightEye: [0.65, 0.45] as [number, number],
      faceCenter: [0.5, 0.5] as [number, number],
      mouthOpen: 0,
      headTilt: 0,
      smile: 0.5,
    }),
    []
  );

  const paramsRef = useRef({ ...defaults });

  const start = useCallback(async () => {
    setLoading(true);
    setLoadProgress(10);
    try {
      logger.info('Loading FaceMesh model...');
      const faceLandmarks = await import('@tensorflow-models/face-landmarks-detection');
      const tf = await import('@tensorflow/tfjs');
      setLoadProgress(30);
      await (tf as { ready: () => Promise<void> }).ready();

      const model = faceLandmarks.SupportedModels.MediaPipeFaceMesh;
      const detector = await faceLandmarks.createDetector(model, {
        runtime: 'mediapipe',
        solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
        maxFaces: 1,
        refineLandmarks: false,
      });
      detectorRef.current = detector;
      setLoadProgress(60);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: W, height: H, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setLoadProgress(80);

      const canvas = canvasRef.current!;
      canvas.width = W;
      canvas.height = H;
      const gl = canvas.getContext('webgl2');
      if (!gl) {
        throw new Error('WebGL2 not supported');
      }
      glRef.current = gl;

      const prog = createProgram(gl, VERT, FRAG);
      if (!prog) throw new Error('Shader compile failed');
      progRef.current = prog;

      const tex = gl.createTexture()!;
      texRef.current = tex;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

      const detectorFn = detector as { estimateFaces: (input: HTMLVideoElement) => Promise<Array<{ keypoints: Array<{ x: number; y: number; z?: number; name?: string }> }>> };

      setLoadProgress(100);
      logger.success('FaceMesh + Shader ready! Move your face to drive the effects.');

      const render = async () => {
        if (!detectorRef.current || !glRef.current || !progRef.current) return;
        const g = glRef.current;
        const prog = progRef.current;
        const video = videoRef.current!;

        try {
          const faces = await detectorFn.estimateFaces(video);
          const face = faces[0];
          const kp = face?.keypoints ?? [];

          const avgPt = (indices: number[]) => {
            if (indices.length === 0) return { x: W / 2, y: H / 2 };
            let x = 0, y = 0, n = 0;
            indices.forEach((i) => {
              const p = kp[i];
              if (p) {
                x += p.x;
                y += p.y;
                n++;
              }
            });
            return n ? { x: x / n, y: y / n } : { x: W / 2, y: H / 2 };
          };

          const leftEye = avgPt(LEFT_EYE);
          const rightEye = avgPt(RIGHT_EYE);
          const faceCenter = face
            ? { x: kp.reduce((s, p) => s + p.x, 0) / kp.length, y: kp.reduce((s, p) => s + p.y, 0) / kp.length }
            : { x: W / 2, y: H / 2 };

          const upper = kp[UPPER_LIP];
          const lower = kp[LOWER_LIP];
          const mouthOpen = upper && lower ? Math.min(1, Math.abs(upper.y - lower.y) / 30) : 0;

          const leftCorner = kp[MOUTH_LEFT];
          const rightCorner = kp[MOUTH_RIGHT];
          const mouthCenterY = upper && lower ? (upper.y + lower.y) / 2 : H / 2;
          const cornerAvgY = leftCorner && rightCorner ? (leftCorner.y + rightCorner.y) / 2 : mouthCenterY;
          const smile = face ? Math.max(0, Math.min(1, (mouthCenterY - cornerAvgY) / 25 + 0.5)) : 0.5;

          const noseTip = kp[NOSE_TIP];
          const noseZ = noseTip?.z ?? 0;
          const headTilt = face && noseTip ? (noseTip.x - faceCenter.x) / (W * 0.3) : 0;

          paramsRef.current = {
            leftEye: [leftEye.x / W, 1 - leftEye.y / H],
            rightEye: [rightEye.x / W, 1 - rightEye.y / H],
            faceCenter: [faceCenter.x / W, 1 - faceCenter.y / H],
            mouthOpen,
            headTilt,
            smile,
          };
        } catch (_) {
          // Keep previous params on detection failure
        }

        const p = paramsRef.current;

        g.viewport(0, 0, W, H);
        g.clearColor(0.1, 0.1, 0.12, 1);
        g.clear(g.COLOR_BUFFER_BIT);

        g.activeTexture(g.TEXTURE0);
        g.bindTexture(g.TEXTURE_2D, texRef.current);
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, video);

        g.useProgram(prog);
        const uVideo = g.getUniformLocation(prog, 'u_video');
        const uRes = g.getUniformLocation(prog, 'u_resolution');
        const uLeftEye = g.getUniformLocation(prog, 'u_leftEye');
        const uRightEye = g.getUniformLocation(prog, 'u_rightEye');
        const uFaceCenter = g.getUniformLocation(prog, 'u_faceCenter');
        const uMouthOpen = g.getUniformLocation(prog, 'u_mouthOpen');
        const uHeadTilt = g.getUniformLocation(prog, 'u_headTilt');
        const uSmile = g.getUniformLocation(prog, 'u_smile');

        g.uniform1i(uVideo, 0);
        g.uniform2f(uRes, W, H);
        g.uniform2f(uLeftEye, p.leftEye[0], p.leftEye[1]);
        g.uniform2f(uRightEye, p.rightEye[0], p.rightEye[1]);
        g.uniform2f(uFaceCenter, p.faceCenter[0], p.faceCenter[1]);
        g.uniform1f(uMouthOpen, p.mouthOpen);
        g.uniform1f(uHeadTilt, p.headTilt);
        g.uniform1f(uSmile, p.smile);

        const aUv = g.getAttribLocation(prog, 'a_uv');
        const buf = g.createBuffer()!;
        g.bindBuffer(g.ARRAY_BUFFER, buf);
        g.bufferData(
          g.ARRAY_BUFFER,
          new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
          g.STATIC_DRAW
        );
        g.enableVertexAttribArray(aUv);
        g.vertexAttribPointer(aUv, 2, g.FLOAT, false, 0, 0);
        g.drawArrays(g.TRIANGLES, 0, 6);

        rafRef.current = requestAnimationFrame(render);
      };

      setActive(true);
      rafRef.current = requestAnimationFrame(render);
    } catch (e) {
      logger.error(`Failed: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [logger]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    logger.info('Stopped');
  }, [logger]);

  useEffect(() => () => stop(), [stop]);

  return (
    <DemoLayout
      title="Collaborative Shader Lab (FaceMesh)"
      difficulty="advanced"
      description="A WebGL shader driven by MediaPipe FaceMesh — 6 filters: eye beams, face center, mouth ripple, head tilt, smile mood."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Six FaceMesh-driven filters feed into a single fragment shader. The original three: <strong>left
            eye</strong> and <strong>right eye</strong> positions create radial glows (“eye beams”), and{' '}
            <strong>face center</strong> drives a vignette and ripple origin.
          </p>
          <p>
            Three new filters: <strong>Mouth Ripple</strong> — opening your mouth triggers concentric distortion
            waves; <strong>Head Tilt</strong> — rotating your head rotates the effect; <strong>Smile Mood Ring</strong> —
            smile intensity shifts the hue toward warm orange, frown toward cool purple.
          </p>
          <p className="text-amber-400/80">
            ⚡ TensorFlow.js FaceMesh (~3MB) loads on first start. Good lighting improves tracking.
          </p>
        </div>
      }
      hints={[
        'Open your mouth wide to trigger the ripple effect',
        'Tilt your head left/right to rotate the distortion',
        'Smile to warm up the colors, relax to cool them down',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!active ? (
              <button
                onClick={start}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                {loading ? `Loading... ${loadProgress}%` : 'Start FaceMesh Shader'}
              </button>
            ) : (
              <button
                onClick={stop}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg"
              >
                Stop
              </button>
            )}
          </div>

          <video ref={videoRef} className="hidden" playsInline muted />

          <div className="rounded-xl overflow-hidden border border-zinc-800" style={{ height: 360 }}>
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className="w-full h-full object-contain block mx-auto"
              style={{ background: '#18181b' }}
            />
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'FaceMesh → shader uniforms' }}
      mdnLinks={[
        { label: 'WebGL2', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext' },
        { label: 'face-landmarks-detection', href: 'https://github.com/tensorflow/tfjs-models/tree/master/face-landmarks-detection' },
      ]}
    />
  );
}
