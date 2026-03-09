import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// Sync plasma parameters between peers via RTCDataChannel
// The processed canvas is also captured and looped through WebRTC video

// Parameter sync on slider change:
dc.send(JSON.stringify({ type: 'params', turbulence, speed, colorShift, blend }));

// Canvas → WebRTC video stream:
const canvasStream = canvas.captureStream(30);
canvasPc.addTrack(canvasStream.getVideoTracks()[0], canvasStream);

// Shader uniforms updated each frame:
gl.uniform1f(uTurbulence, params.turbulence);
gl.uniform1f(uSpeed, params.speed);
gl.uniform1f(uColorShift, params.colorShift);
gl.uniform1f(uBlend, params.blend);`;

const VS = `attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FS = `precision mediump float;
uniform sampler2D u_webcam;
uniform float u_time;
uniform float u_turbulence;
uniform float u_speed;
uniform float u_colorShift;
uniform float u_blend;
varying vec2 v_uv;

void main() {
  vec2 uv = v_uv;
  float t = u_time * u_speed;

  float v = 0.0;
  v += sin(uv.x * 10.0 * u_turbulence + t);
  v += sin(uv.y * 8.0 * u_turbulence + t * 1.3);
  v += sin((uv.x + uv.y) * 6.0 * u_turbulence + t * 0.8);
  float cx = uv.x - 0.5;
  float cy = uv.y - 0.5;
  v += sin(sqrt(cx * cx + cy * cy) * 15.0 * u_turbulence + t);

  vec3 plasma = vec3(
    sin(v * 3.14159 + u_colorShift),
    sin(v * 3.14159 + u_colorShift + 2.094),
    sin(v * 3.14159 + u_colorShift + 4.189)
  ) * 0.5 + 0.5;

  vec2 warpedUv = uv + vec2(
    sin(v * 2.0 + t) * 0.02 * u_blend,
    cos(v * 2.0 + t) * 0.02 * u_blend
  );

  vec4 webcam = texture2D(u_webcam, clamp(warpedUv, 0.0, 1.0));
  gl_FragColor = mix(webcam, vec4(plasma, 1.0), u_blend * 0.6);
}`;

interface PlasmaParams {
  turbulence: number; // 1.0 - 5.0
  speed: number;      // 0.5 - 3.0
  colorShift: number; // 0.0 - 6.28
  blend: number;      // 0.0 - 1.0
}

const DEFAULT_PARAMS: PlasmaParams = {
  turbulence: 2.0,
  speed: 1.0,
  colorShift: 0.0,
  blend: 0.5,
};

interface GLUniforms {
  uTime: WebGLUniformLocation;
  uTurbulence: WebGLUniformLocation;
  uSpeed: WebGLUniformLocation;
  uColorShift: WebGLUniformLocation;
  uBlend: WebGLUniformLocation;
  uWebcam: WebGLUniformLocation;
}

function initWebGL(canvas: HTMLCanvasElement): {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  uniforms: GLUniforms;
} | null {
  const gl = canvas.getContext('webgl');
  if (!gl) return null;

  // Vertex shader
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, VS);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) return null;

  // Fragment shader
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, FS);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return null;

  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  gl.deleteShader(vs);
  gl.deleteShader(fs);
  gl.useProgram(program);

  // Fullscreen quad
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Webcam texture
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

  // Grey placeholder
  const px = new Uint8Array([30, 30, 30, 255]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);

  const uniforms: GLUniforms = {
    uTime: gl.getUniformLocation(program, 'u_time')!,
    uTurbulence: gl.getUniformLocation(program, 'u_turbulence')!,
    uSpeed: gl.getUniformLocation(program, 'u_speed')!,
    uColorShift: gl.getUniformLocation(program, 'u_colorShift')!,
    uBlend: gl.getUniformLocation(program, 'u_blend')!,
    uWebcam: gl.getUniformLocation(program, 'u_webcam')!,
  };

  gl.uniform1i(uniforms.uWebcam, 0);

  return { gl, program, texture, uniforms };
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  displayValue: string;
  disabled?: boolean;
}

function Slider({ label, value, min, max, step, onChange, displayValue, disabled }: SliderProps) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-300 font-mono">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-teal-500 disabled:opacity-40"
      />
    </div>
  );
}

export default function WebGLPlasmaStream() {
  const logger = useMemo(() => new Logger(), []);

  const plasmaCanvasRef = useRef<HTMLCanvasElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const loopbackVideoRef = useRef<HTMLVideoElement>(null);

  const glRef = useRef<ReturnType<typeof initWebGL> | null>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(performance.now());
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const paramsRef = useRef<PlasmaParams>({ ...DEFAULT_PARAMS });

  const [params, setParams] = useState<PlasmaParams>({ ...DEFAULT_PARAMS });
  const [webcamActive, setWebcamActive] = useState(false);
  const [loopbackConnected, setLoopbackConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const pcSendRef = useRef<RTCPeerConnection | null>(null);
  const pcRecvRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  // Init WebGL on mount
  useEffect(() => {
    const canvas = plasmaCanvasRef.current;
    if (!canvas) return;

    const state = initWebGL(canvas);
    if (!state) { logger.error('WebGL initialization failed'); return; }
    glRef.current = state;
    logger.info('WebGL plasma shader ready');

    const { gl, texture, uniforms } = state;

    const loop = () => {
      const t = (performance.now() - startTimeRef.current) / 1000;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uniforms.uTime, t);
      gl.uniform1f(uniforms.uTurbulence, paramsRef.current.turbulence);
      gl.uniform1f(uniforms.uSpeed, paramsRef.current.speed);
      gl.uniform1f(uniforms.uColorShift, paramsRef.current.colorShift);
      gl.uniform1f(uniforms.uBlend, paramsRef.current.blend);

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
      gl.deleteProgram(state.program);
      gl.deleteTexture(state.texture);
    };
  }, [logger]);

  const handleGetWebcam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 560, height: 315 }, audio: false });
      webcamStreamRef.current = stream;
      const video = webcamVideoRef.current!;
      video.srcObject = stream;
      await video.play();
      setWebcamActive(true);
      logger.info('Webcam active — feeding to plasma shader');
    } catch (err) {
      logger.error(`Webcam error: ${err}`);
    }
  }, [logger]);

  const handleConnectLoopback = useCallback(async () => {
    const canvas = plasmaCanvasRef.current;
    if (!canvas) return;
    setConnecting(true);
    logger.info('Capturing plasma canvas stream...');

    // Capture canvas as a video stream
    const canvasStream = canvas.captureStream(30);
    logger.info('Canvas stream captured at 30fps');

    // Sender peer — transmits canvas stream
    const pcSend = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    // Receiver peer — receives the processed video
    const pcRecv = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcSendRef.current = pcSend;
    pcRecvRef.current = pcRecv;

    // DataChannel for parameter sync (piggybacked on the same connection pair)
    const dc = pcSend.createDataChannel('params');
    dcRef.current = dc;
    dc.onopen = () => {
      logger.info('Parameter sync DataChannel open');
    };
    dc.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as { type: string } & Partial<PlasmaParams>;
      if (msg.type === 'params') {
        const newParams: PlasmaParams = {
          turbulence: msg.turbulence ?? paramsRef.current.turbulence,
          speed: msg.speed ?? paramsRef.current.speed,
          colorShift: msg.colorShift ?? paramsRef.current.colorShift,
          blend: msg.blend ?? paramsRef.current.blend,
        };
        paramsRef.current = newParams;
        setParams({ ...newParams });
        logger.info(`Params synced: turbulence=${newParams.turbulence.toFixed(2)} speed=${newParams.speed.toFixed(2)}`);
      }
    };

    pcRecv.ondatachannel = (e) => {
      e.channel.onmessage = dc.onmessage;
    };

    // Add canvas video track to sender
    const track = canvasStream.getVideoTracks()[0];
    pcSend.addTrack(track, canvasStream);

    // Receive processed video on the other side
    pcRecv.ontrack = (e) => {
      const video = loopbackVideoRef.current;
      if (video) {
        video.srcObject = e.streams[0];
        video.play().catch(() => {});
        setLoopbackConnected(true);
        setConnecting(false);
        logger.info('Loopback video stream received — plasma effect flowing through WebRTC');
      }
    };

    pcSend.onicecandidate = (e) => { if (e.candidate) pcRecv.addIceCandidate(e.candidate); };
    pcRecv.onicecandidate = (e) => { if (e.candidate) pcSend.addIceCandidate(e.candidate); };

    const offer = await pcSend.createOffer();
    await pcSend.setLocalDescription(offer);
    await pcRecv.setRemoteDescription(offer);
    const answer = await pcRecv.createAnswer();
    await pcRecv.setLocalDescription(answer);
    await pcSend.setRemoteDescription(answer);
  }, [logger]);

  const updateParam = useCallback(<K extends keyof PlasmaParams>(key: K, value: PlasmaParams[K]) => {
    const newParams = { ...paramsRef.current, [key]: value };
    paramsRef.current = newParams;
    setParams({ ...newParams });

    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'params', ...newParams }));
    }
  }, []);

  const handleReset = useCallback(() => {
    paramsRef.current = { ...DEFAULT_PARAMS };
    setParams({ ...DEFAULT_PARAMS });
    logger.info('Params reset to defaults');
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'params', ...DEFAULT_PARAMS }));
    }
  }, [logger]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      webcamStreamRef.current?.getTracks().forEach(t => t.stop());
      pcSendRef.current?.close();
      pcRecvRef.current?.close();
    };
  }, []);

  const colorShiftDeg = Math.round((params.colorShift / (Math.PI * 2)) * 360);

  return (
    <DemoLayout
      title="WebGL Plasma Stream"
      difficulty="advanced"
      description="Demo-scene plasma shader over webcam, with parameter sync via RTCDataChannel and canvas stream loopback"
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            A classic <strong>demo-scene plasma effect</strong> — four overlapping sine waves including a radial one — is mixed with your live webcam feed in a WebGL fragment shader. The plasma displaces the UV coordinates before sampling the webcam texture, creating a liquid-warp hallucination.
          </p>
          <p>
            Adjust Turbulence, Speed, Color Shift, and Blend in real time. All parameter changes are broadcast to the peer via <strong>RTCDataChannel</strong>, so both sides experience the same psychedelic configuration simultaneously.
          </p>
          <p>
            The processed canvas is also captured via <code className="text-teal-400 font-mono">canvas.captureStream(30)</code> and routed through a loopback <strong>RTCPeerConnection</strong>. The received video appears in the preview window, confirming the full WebRTC video pipeline works end-to-end.
          </p>
        </div>
      }
      demo={
        <div className="space-y-4">
          {/* Main plasma canvas */}
          <div className="relative rounded-xl overflow-hidden border border-zinc-800">
            <canvas
              ref={plasmaCanvasRef}
              width={560}
              height={315}
              className="block w-full"
              style={{ maxWidth: 560, height: 315 }}
            />
            {!webcamActive && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60">
                <span className="text-zinc-500 text-sm">Enable webcam for full plasma effect</span>
              </div>
            )}
          </div>

          {/* Controls row */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleGetWebcam}
              disabled={webcamActive}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {webcamActive ? 'Webcam Active' : 'Get Webcam'}
            </button>
            <button
              onClick={handleConnectLoopback}
              disabled={loopbackConnected || connecting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {connecting ? 'Connecting...' : loopbackConnected ? 'Loopback Active' : 'Connect Loopback'}
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Reset Params
            </button>
          </div>

          {/* Parameter sliders + loopback preview */}
          <div className="flex gap-4 flex-wrap">
            {/* Sliders */}
            <div className="flex-1 min-w-64 bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
              <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Plasma Parameters</div>

              <Slider
                label="Turbulence"
                value={params.turbulence}
                min={1.0}
                max={5.0}
                step={0.1}
                onChange={(v) => updateParam('turbulence', v)}
                displayValue={params.turbulence.toFixed(1)}
              />
              <Slider
                label="Speed"
                value={params.speed}
                min={0.5}
                max={3.0}
                step={0.05}
                onChange={(v) => updateParam('speed', v)}
                displayValue={`${params.speed.toFixed(2)}x`}
              />
              <Slider
                label="Color Shift"
                value={params.colorShift}
                min={0}
                max={Math.PI * 2}
                step={0.05}
                onChange={(v) => updateParam('colorShift', v)}
                displayValue={`${colorShiftDeg}°`}
              />
              <Slider
                label="Plasma Blend"
                value={params.blend}
                min={0}
                max={1.0}
                step={0.01}
                onChange={(v) => updateParam('blend', v)}
                displayValue={`${Math.round(params.blend * 100)}%`}
              />

              {loopbackConnected && (
                <div className="text-xs text-teal-400">
                  Params syncing to peer via DataChannel
                </div>
              )}
            </div>

            {/* Loopback preview */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2" style={{ width: 240 }}>
              <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">WebRTC Loopback Preview</div>
              <video
                ref={loopbackVideoRef}
                muted
                playsInline
                autoPlay
                className="rounded-lg border border-zinc-800 bg-zinc-950 block"
                style={{ width: 208, height: 117, objectFit: 'cover' }}
              />
              {!loopbackConnected ? (
                <p className="text-xs text-zinc-600">Connect loopback to see canvas stream received through WebRTC</p>
              ) : (
                <p className="text-xs text-zinc-500">Plasma canvas → <code className="text-teal-400">captureStream(30)</code> → RTCPeerConnection → video element</p>
              )}
            </div>
          </div>

          {/* Hidden webcam video */}
          <video ref={webcamVideoRef} muted playsInline style={{ display: 'none' }} />

          {/* Shader info */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs font-semibold text-zinc-400 mb-2">Plasma Formula</div>
            <pre className="text-xs font-mono text-zinc-500 leading-relaxed whitespace-pre-wrap">{`v  = sin(x·T + t) + sin(y·T·0.8 + t·1.3)
   + sin((x+y)·T·0.6 + t·0.8)
   + sin(√(cx²+cy²)·T·1.5 + t)

plasma = (sin(v·π + shift), sin(v·π + shift + 2.09), sin(v·π + shift + 4.19))
warpedUV = uv + sin/cos(v·2+t) · 0.02 · blend
output = mix(webcam(warpedUV), plasma, blend·0.6)`}</pre>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Plasma Params Sync + Canvas captureStream' }}
      hints={[
        'canvas.captureStream(30) converts any HTML5 canvas into a live MediaStream at 30fps.',
        'The plasma warp displaces UV before webcam texture sampling — set blend=0 to see pure webcam, blend=1 for maximum warp.',
        'Color Shift rotates the RGB phase offsets of the plasma, cycling through the full spectrum.',
        'Increasing Turbulence multiplies all spatial frequencies, creating finer, more chaotic plasma patterns.',
        'The DataChannel parameter sync means both peers always see the same plasma configuration — great for collaborative psychedelia.',
      ]}
      mdnLinks={[
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
        { label: 'WebGLRenderingContext', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
