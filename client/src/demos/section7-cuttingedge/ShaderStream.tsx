import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const SHADERS: Array<{ id: string; name: string; emoji: string; frag: string }> = [
  {
    id: 'plasma',
    name: 'Plasma',
    emoji: '🌈',
    frag: `
      precision mediump float;
      uniform float u_time;
      uniform vec2 u_resolution;
      void main() {
        vec2 p = gl_FragCoord.xy / u_resolution;
        float v = sin(p.x * 10.0 + u_time) + sin(p.y * 10.0 + u_time)
                + sin((p.x + p.y) * 10.0 + u_time)
                + sin(sqrt(p.x*p.x + p.y*p.y) * 12.0 + u_time * 2.0);
        gl_FragColor = vec4(0.5 + 0.5*sin(v + 0.0),
                            0.5 + 0.5*sin(v + 2.1),
                            0.5 + 0.5*sin(v + 4.2), 1.0);
      }`,
  },
  {
    id: 'tunnel',
    name: 'Tunnel',
    emoji: '🌀',
    frag: `
      precision mediump float;
      uniform float u_time;
      uniform vec2 u_resolution;
      void main() {
        vec2 p = (gl_FragCoord.xy / u_resolution) * 2.0 - 1.0;
        p.x *= u_resolution.x / u_resolution.y;
        float r = length(p);
        float a = atan(p.y, p.x);
        float t = u_time * 0.5;
        float v = sin(1.0/r*6.0 - t*3.0 + a*4.0) * 0.5 + 0.5;
        float ring = mod(1.0/r + t, 1.0);
        gl_FragColor = vec4(v * ring, v * 0.4, (1.0-v) * ring, 1.0);
      }`,
  },
  {
    id: 'waves',
    name: 'Ocean Waves',
    emoji: '🌊',
    frag: `
      precision mediump float;
      uniform float u_time;
      uniform vec2 u_resolution;
      void main() {
        vec2 p = gl_FragCoord.xy / u_resolution;
        float w = 0.0;
        for(float i=1.0; i<6.0; i++){
          w += sin(p.x * i * 4.0 + u_time * i * 0.5 + cos(p.y * i * 3.0 + u_time * 0.3)) / i;
        }
        float blue = 0.5 + 0.4 * w;
        float green = 0.3 + 0.2 * sin(w * 3.0 + u_time);
        float white = max(0.0, w * 0.6);
        gl_FragColor = vec4(white, green + white*0.3, blue + white*0.5, 1.0);
      }`,
  },
  {
    id: 'fire',
    name: 'Fire',
    emoji: '🔥',
    frag: `
      precision mediump float;
      uniform float u_time;
      uniform vec2 u_resolution;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p), u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
      }
      void main(){
        vec2 p = gl_FragCoord.xy / u_resolution;
        float n = noise(p*6.0 + vec2(0.0, -u_time*2.0));
        n += 0.5*noise(p*12.0 + vec2(0.0,-u_time*4.0));
        float edge = 1.0 - p.y;
        float fire = smoothstep(0.0, 1.0, n * edge * 2.0);
        gl_FragColor = vec4(fire, fire*0.3, 0.0, 1.0);
      }`,
  },
];

const VERT = `
  attribute vec2 a_position;
  void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const CODE = `// GLSL fragment shader → WebGL canvas → captureStream() → WebRTC

// Compile and link shader program
const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
const prog = gl.createProgram();
gl.attachShader(prog, vert); gl.attachShader(prog, frag);
gl.linkProgram(prog);

// Full-screen quad
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);

// Render loop: update u_time uniform each frame
function render(t) {
  gl.uniform1f(uTime, t / 1000);
  gl.uniform2f(uRes, canvas.width, canvas.height);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  requestAnimationFrame(render);
}

// Stream via WebRTC
const stream = canvas.captureStream(30);
stream.getTracks().forEach(track => pc.addTrack(track, stream));`;

export default function ShaderStream() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rcvVideoRef = useRef<HTMLVideoElement>(null);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [activeShader, setActiveShader] = useState(0);
  const rafRef = useRef<number>(0);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const uTimeRef = useRef<WebGLUniformLocation | null>(null);
  const uResRef = useRef<WebGLUniformLocation | null>(null);
  const activeRef = useRef(activeShader);
  activeRef.current = activeShader;
  const W = 400, H = 300;

  const compile = (gl: WebGLRenderingContext, type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { logger.error(gl.getShaderInfoLog(s) ?? 'Shader error'); return null; }
    return s;
  };

  const buildProgram = (gl: WebGLRenderingContext, fragSrc: string) => {
    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
    if (!vert || !frag) return null;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert); gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    return prog;
  };

  const start = () => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (!gl) { logger.error('WebGL not supported'); return; }
    glRef.current = gl;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);

    const loadShader = (idx: number) => {
      const prog = buildProgram(gl, SHADERS[idx].frag);
      if (!prog) return;
      gl.useProgram(prog);
      progRef.current = prog;
      const pos = gl.getAttribLocation(prog, 'a_position');
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      uTimeRef.current = gl.getUniformLocation(prog, 'u_time');
      uResRef.current = gl.getUniformLocation(prog, 'u_resolution');
    };
    loadShader(activeRef.current);

    const render = (t: number) => {
      if (!glRef.current) return;
      const g = glRef.current;
      g.viewport(0, 0, W, H);
      g.uniform1f(uTimeRef.current, t / 1000);
      g.uniform2f(uResRef.current, W, H);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      rafRef.current = requestAnimationFrame(render);
    };
    setRunning(true);
    rafRef.current = requestAnimationFrame(render);
    logger.success(`Shader "${SHADERS[activeRef.current].name}" running`);

    // WebRTC loopback
    const stream = (canvas as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(30);
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = ev => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = ev => ev.candidate && pcA.addIceCandidate(ev.candidate);
    stream.getTracks().forEach(t => pcA.addTrack(t, stream));
    pcB.ontrack = ev => {
      if (rcvVideoRef.current) { rcvVideoRef.current.srcObject = ev.streams[0]; rcvVideoRef.current.play(); }
      setConnected(true);
      logger.success('Shader streaming over WebRTC loopback!');
    };
    pcA.createOffer().then(o => pcA.setLocalDescription(o).then(() => pcB.setRemoteDescription(o).then(() =>
      pcB.createAnswer().then(a => pcB.setLocalDescription(a).then(() => pcA.setRemoteDescription(a))))));
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    glRef.current = null;
    if (rcvVideoRef.current) rcvVideoRef.current.srcObject = null;
    setRunning(false); setConnected(false);
    logger.info('Stopped');
  };

  const switchShader = (idx: number) => {
    setActiveShader(idx);
    activeRef.current = idx;
    const gl = glRef.current;
    if (!gl) return;
    gl.deleteProgram(progRef.current);
    const prog = buildProgram(gl, SHADERS[idx].frag);
    if (!prog) return;
    gl.useProgram(prog);
    progRef.current = prog;
    const pos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    uTimeRef.current = gl.getUniformLocation(prog, 'u_time');
    uResRef.current = gl.getUniformLocation(prog, 'u_resolution');
    logger.info(`Switched to shader: ${SHADERS[idx].name}`);
  };

  useEffect(() => () => stop(), []);

  return (
    <DemoLayout
      title="Animated Shader Stream"
      difficulty="advanced"
      description="GLSL fragment shaders rendered via WebGL, captured with captureStream(), and streamed over WebRTC loopback."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>WebGL fragment shaders</strong> run on the GPU, computing a color for every
            pixel based on a few uniforms: <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">u_time</code> (seconds
            since start) and <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">u_resolution</code> (canvas size).
            A full-screen quad (two triangles covering −1 to +1) gives the shader access to every pixel.
          </p>
          <p>
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">HTMLCanvasElement.captureStream(30)</code>
            snapshots the WebGL canvas at 30 fps and returns a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MediaStream</code> —
            the same type that{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">getUserMedia()</code> returns.
            That stream is added to a WebRTC loopback peer connection, flowing through the full
            encode → network → decode pipeline. The received video is shown on the right.
          </p>
        </div>
      }
      hints={[
        'Switch shaders mid-stream — the change propagates through the WebRTC video',
        'The right panel shows the WebRTC-received video (may have codec artifacts)',
        'These shaders are similar to what you\'d write on Shadertoy.com',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!running ? (
              <button onClick={start} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Start Shaders
              </button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">Stop</button>
            )}
            <div className="flex gap-1 flex-wrap">
              {SHADERS.map((s, i) => (
                <button key={s.id} onClick={() => switchShader(i)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${activeShader === i ? 'border-blue-500 bg-blue-950/40 text-blue-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                  {s.emoji} {s.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">WebGL Source</p>
              <canvas ref={canvasRef} width={W} height={H}
                className="rounded-xl border border-zinc-800 w-full block"
                style={{ background: '#09090b' }} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">WebRTC Received {connected ? '🔴 Live' : ''}</p>
              <video ref={rcvVideoRef} muted playsInline
                className="rounded-xl border border-zinc-800 w-full block"
                style={{ background: '#09090b', aspectRatio: `${W}/${H}` }} />
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'WebGL shader → canvas.captureStream() → WebRTC' }}
      mdnLinks={[
        { label: 'WebGL API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API' },
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
      ]}
    />
  );
}
