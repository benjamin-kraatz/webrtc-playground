import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

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
// uniform sampler2D u_tex;  — webcam frame uploaded each rAF tick
// uniform float u_time;     — elapsed seconds`;

const VS = `attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const PRESET_SHADERS: Array<{ name: string; emoji: string; code: string }> = [
  {
    name: 'Chroma',
    emoji: '🌈',
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
    name: 'Glitch',
    emoji: '⚡',
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
    name: 'Plasma',
    emoji: '🔮',
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
    name: 'Mirror',
    emoji: '🪞',
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
    name: 'Edge',
    emoji: '✏️',
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
];

interface WebGLState {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  uTime: WebGLUniformLocation;
  uTex: WebGLUniformLocation;
}

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return null;
  }
  return shader;
}

function buildProgram(gl: WebGLRenderingContext, fsSrc: string): { program: WebGLProgram; error: null } | { program: null; error: string } {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
  if (!vs) return { program: null, error: 'Vertex shader failed (internal error)' };

  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!fs) {
    // Get error with a temp shader to read the log
    const tmpFs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(tmpFs, fsSrc);
    gl.compileShader(tmpFs);
    const log = gl.getShaderInfoLog(tmpFs) ?? 'Unknown error';
    gl.deleteShader(tmpFs);
    gl.deleteShader(vs);
    return { program: null, error: log };
  }

  const prog = gl.createProgram();
  if (!prog) { gl.deleteShader(vs); gl.deleteShader(fs); return { program: null, error: 'createProgram failed' }; }

  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? 'Link error';
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

  const [shaderCode, setShaderCode] = useState(PRESET_SHADERS[0].code);
  const [shaderError, setShaderError] = useState<string | null>(null);
  const [webcamActive, setWebcamActive] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [peerEditing, setPeerEditing] = useState(false);

  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressSendRef = useRef(false);

  // Initialize WebGL
  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl');
    if (!gl) { logger.error('WebGL not supported'); return; }

    const result = buildProgram(gl, PRESET_SHADERS[0].code);
    if (!result.program) {
      setShaderError(result.error);
      return;
    }

    gl.useProgram(result.program);

    // Fullscreen quad
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(result.program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Texture for webcam
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    // Fill with a placeholder pattern
    const pixels = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 40; pixels[i + 1] = 40; pixels[i + 2] = 40; pixels[i + 3] = 255;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const uTime = gl.getUniformLocation(result.program, 'u_time')!;
    const uTex = gl.getUniformLocation(result.program, 'u_tex')!;
    gl.uniform1i(uTex, 0);

    glStateRef.current = { gl, program: result.program, texture, uTime, uTex };

    const loop = () => {
      const t = (performance.now() - startTimeRef.current) / 1000;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);

      // Upload webcam frame
      const video = webcamVideoRef.current;
      if (video && video.readyState >= 2) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
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

  const recompileShader = useCallback((code: string) => {
    const gs = glStateRef.current;
    if (!gs) return;
    const { gl, texture } = gs;

    const result = buildProgram(gl, code);
    if (!result.program) {
      setShaderError(result.error);
      return;
    }

    // Clean up old program
    gl.deleteProgram(gs.program);

    gl.useProgram(result.program);

    // Re-bind geometry
    const aPos = gl.getAttribLocation(result.program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(result.program, 'u_time')!;
    const uTex = gl.getUniformLocation(result.program, 'u_tex')!;
    gl.uniform1i(uTex, 0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    glStateRef.current = { gl, program: result.program, texture, uTime, uTex };
    setShaderError(null);
    logger.info('Shader compiled successfully');
  }, [logger]);

  const handleCodeChange = useCallback((newCode: string) => {
    setShaderCode(newCode);

    // Debounced recompile
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      recompileShader(newCode);

      // Sync to peer
      if (!suppressSendRef.current && dcRef.current?.readyState === 'open') {
        dcRef.current.send(JSON.stringify({ type: 'shader', code: newCode }));
      }
    }, 300);
  }, [recompileShader]);

  const handlePreset = useCallback((code: string, name: string) => {
    logger.info(`Loading preset: ${name}`);
    setShaderCode(code);
    recompileShader(code);
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'shader', code }));
    }
  }, [logger, recompileShader]);

  const handleGetWebcam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 270 }, audio: false });
      webcamStreamRef.current = stream;
      const video = webcamVideoRef.current!;
      video.srcObject = stream;
      await video.play();
      if (webcamPreviewRef.current) {
        webcamPreviewRef.current.srcObject = stream;
        await webcamPreviewRef.current.play();
      }
      setWebcamActive(true);
      logger.info('Webcam active — feeding as shader texture u_tex');
    } catch (err) {
      logger.error(`Webcam error: ${err}`);
    }
  }, [logger]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    logger.info('Setting up loopback RTCPeerConnection for shader sync...');

    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA;
    pcBRef.current = pcB;

    const dc = pcA.createDataChannel('shader-sync');
    dcRef.current = dc;

    dc.onopen = () => {
      setConnected(true);
      setConnecting(false);
      logger.info('DataChannel open — shader edits now sync in real-time');
    };

    const onMsg = (e: MessageEvent) => {
      const msg = JSON.parse(e.data as string) as { type: string; code?: string };
      if (msg.type === 'shader' && msg.code !== undefined) {
        logger.info('Received shader update from peer');
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
    pcB.ondatachannel = (e) => { e.channel.onmessage = onMsg; };

    pcA.onicecandidate = (e) => { if (e.candidate) pcB.addIceCandidate(e.candidate); };
    pcB.onicecandidate = (e) => { if (e.candidate) pcA.addIceCandidate(e.candidate); };

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
      webcamStreamRef.current?.getTracks().forEach(t => t.stop());
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
            Edit a GLSL fragment shader and see it render live on the WebGL canvas. Your webcam feed is uploaded as a texture uniform (<code className="text-teal-400 font-mono">u_tex</code>) every animation frame. A second uniform <code className="text-teal-400 font-mono">u_time</code> provides elapsed seconds.
          </p>
          <p>
            Both "peers" (loopback) edit the same shader — changes are debounced 300ms and sent over an <strong>RTCDataChannel</strong>. The receiving side recompiles and displays the new shader instantly. Try writing your own GLSL or use one of the five presets.
          </p>
          <p>
            Shader compilation errors appear in red below the canvas with the GLSL error message, so you can debug interactively.
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
          </div>

          {/* Shader error */}
          {shaderError && (
            <div className="bg-red-950 border border-red-800 rounded-lg p-3">
              <div className="text-xs font-semibold text-red-400 mb-1">Shader Compilation Error</div>
              <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap break-all">{shaderError}</pre>
            </div>
          )}

          {/* Preset buttons */}
          <div className="flex flex-wrap gap-2">
            {PRESET_SHADERS.map((p) => (
              <button
                key={p.name}
                onClick={() => handlePreset(p.code, p.name)}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {p.emoji} {p.name}
              </button>
            ))}
          </div>

          {/* Editor + webcam preview */}
          <div className="flex gap-4 flex-wrap">
            {/* Code editor */}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-zinc-500 mb-1 font-mono">Fragment Shader (GLSL)</div>
              <textarea
                value={shaderCode}
                onChange={(e) => handleCodeChange(e.target.value)}
                spellCheck={false}
                className="w-full h-52 bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs font-mono text-zinc-200 resize-none focus:outline-none focus:border-zinc-600 leading-relaxed"
                style={{ tabSize: 2 }}
              />
            </div>

            {/* Webcam preview + controls */}
            <div className="flex flex-col gap-3" style={{ width: 200 }}>
              <div>
                <div className="text-xs text-zinc-500 mb-1">Webcam (u_tex)</div>
                <video
                  ref={webcamPreviewRef}
                  muted
                  playsInline
                  className="rounded-lg border border-zinc-800 bg-zinc-950"
                  style={{ width: 200, height: 113, objectFit: 'cover' }}
                />
              </div>
              {/* Hidden video for WebGL texture */}
              <video ref={webcamVideoRef} muted playsInline style={{ display: 'none' }} />

              <button
                onClick={handleGetWebcam}
                disabled={webcamActive}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {webcamActive ? 'Webcam Active' : 'Get Webcam'}
              </button>

              <button
                onClick={handleConnect}
                disabled={connected || connecting}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {connecting ? 'Connecting...' : connected ? 'Connected' : 'Connect Loopback'}
              </button>

              {connected && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-400">
                  <div className="text-green-400 font-medium mb-1">Sync active</div>
                  Shader edits are synced to peer in real-time via RTCDataChannel.
                </div>
              )}
            </div>
          </div>

          {/* Available uniforms reference */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs font-semibold text-zinc-400 mb-2">Available Uniforms</div>
            <div className="grid grid-cols-1 gap-1 text-xs font-mono">
              <div><span className="text-teal-400">sampler2D u_tex</span><span className="text-zinc-500"> — webcam frame texture</span></div>
              <div><span className="text-teal-400">float u_time</span><span className="text-zinc-500"> — elapsed seconds</span></div>
              <div><span className="text-teal-400">varying vec2 v_uv</span><span className="text-zinc-500"> — UV coordinates (0–1, Y-flipped to match webcam)</span></div>
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Shader Sync via RTCDataChannel' }}
      hints={[
        'Uniforms u_tex (webcam), u_time (seconds), and v_uv (UV coords) are always available in the shader.',
        'Shader edits are debounced 300ms before recompile — fast edits won\'t cause excessive GPU work.',
        'GLSL compilation errors appear inline below the canvas — you can debug shaders like a normal IDE.',
        'The webcam texture is re-uploaded every animation frame so time-varying effects work smoothly.',
        'Try displacing v_uv with sin/cos before sampling u_tex for a warped webcam effect.',
      ]}
      mdnLinks={[
        { label: 'WebGLRenderingContext', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'GLSL Reference', href: 'https://www.khronos.org/opengl/wiki/Core_Language_(GLSL)' },
      ]}
    />
  );
}
