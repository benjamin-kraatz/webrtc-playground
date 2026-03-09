import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const GRID = 32;
const CELL = 16;
const W = GRID * CELL;

const PALETTE = [
  '#000000','#ffffff','#ef4444','#f97316','#eab308','#22c55e',
  '#3b82f6','#8b5cf6','#ec4899','#6b7280','#0ea5e9','#10b981',
  '#f59e0b','#84cc16','#e879f9','#38bdf8',
];

const CODE = `// Collaborative pixel art — sync paint events over DataChannel
const grid = new Array(32 * 32).fill('#000000');

canvas.addEventListener('mousedown', (e) => {
  const x = Math.floor(e.offsetX / CELL);
  const y = Math.floor(e.offsetY / CELL);
  paint(x, y, selectedColor);
  dc.send(JSON.stringify({ type: 'paint', x, y, color: selectedColor }));
});

// On connect: send the full grid state to sync
dc.onopen = () => {
  dc.send(JSON.stringify({ type: 'grid', cells: grid }));
};

// Receive paint events
dc.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === 'paint') { grid[msg.y * 32 + msg.x] = msg.color; redraw(); }
  if (msg.type === 'grid')  { grid.splice(0, grid.length, ...msg.cells); redraw(); }
};`;

export default function PixelArtCollab() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<string[]>(new Array(GRID * GRID).fill('#000000'));
  const [selectedColor, setSelectedColor] = useState('#ffffff');
  const [connected, setConnected] = useState(false);
  const [tool, setTool] = useState<'pen' | 'fill' | 'erase'>('pen');
  const painting = useRef(false);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const colorRef = useRef(selectedColor);
  const toolRef = useRef(tool);
  colorRef.current = selectedColor;
  toolRef.current = tool;

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        ctx.fillStyle = gridRef.current[y * GRID + x];
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= GRID; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, W); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke();
    }
  };

  const floodFill = (startX: number, startY: number, fillColor: string) => {
    const targetColor = gridRef.current[startY * GRID + startX];
    if (targetColor === fillColor) return;
    const stack = [[startX, startY]];
    const changed: Array<{ x: number; y: number }> = [];
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cx >= GRID || cy < 0 || cy >= GRID) continue;
      if (gridRef.current[cy * GRID + cx] !== targetColor) continue;
      gridRef.current[cy * GRID + cx] = fillColor;
      changed.push({ x: cx, y: cy });
      stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
    }
    return changed;
  };

  const paint = (x: number, y: number) => {
    if (x < 0 || x >= GRID || y < 0 || y >= GRID) return;
    const c = toolRef.current === 'erase' ? '#000000' : colorRef.current;
    if (toolRef.current === 'fill') {
      const changed = floodFill(x, y, c);
      redraw();
      changed?.forEach((p) => {
        if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'paint', x: p.x, y: p.y, color: c }));
      });
    } else {
      gridRef.current[y * GRID + x] = c;
      redraw();
      if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'paint', x, y, color: c }));
    }
  };

  const getXY = (e: React.MouseEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [Math.floor((e.clientX - rect.left) * (W / rect.width) / CELL), Math.floor((e.clientY - rect.top) * (W / rect.height) / CELL)];
  };

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('pixels', { ordered: true });
    dcRef.current = dc;
    dc.onopen = () => {
      setConnected(true);
      dc.send(JSON.stringify({ type: 'grid', cells: gridRef.current }));
      logger.success('Pixel art channel open — draw together!');
    };
    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'paint') { gridRef.current[msg.y * GRID + msg.x] = msg.color; redraw(); }
        if (msg.type === 'grid') { gridRef.current = msg.cells; redraw(); }
        if (msg.type === 'clear') { gridRef.current.fill('#000000'); redraw(); }
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const clearCanvas = () => {
    gridRef.current.fill('#000000');
    redraw();
    if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'clear' }));
    logger.info('Canvas cleared');
  };

  return (
    <DemoLayout
      title="Collaborative Pixel Art"
      difficulty="beginner"
      description="Paint on a shared 32×32 pixel canvas — every stroke syncs to your peer via RTCDataChannel in real time."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Each paint stroke sends a tiny JSON event <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">{`{x, y, color}`}</code> over a
            DataChannel. The flood-fill tool sends all changed pixels in a single burst.
            When connecting, the entire grid state (32×32 = 1024 color strings) is serialized
            as one JSON payload and sent to the new peer to ensure a clean starting state.
          </p>
          <p>
            This <em>event sourcing</em> pattern — broadcast only changes, not the full state —
            is how Google Docs, Figma, and real-time collaborative tools work at scale.
          </p>
        </div>
      }
      hints={[
        'Click Connect Loopback, then draw — the "remote" peer\'s canvas updates instantly',
        'Flood Fill lets you bucket-fill any enclosed area',
        'Right-click the canvas and "Save image as…" to download your pixel art',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!connected && (
              <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Connect Loopback
              </button>
            )}
            {(['pen','fill','erase'] as const).map((t) => (
              <button key={t} onClick={() => setTool(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${tool === t ? 'border-blue-500 bg-blue-950/40 text-blue-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                {t === 'pen' ? '✏️ Pen' : t === 'fill' ? '🪣 Fill' : '🧹 Erase'}
              </button>
            ))}
            <button onClick={clearCanvas} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs rounded-lg">Clear</button>
          </div>

          {/* Color palette */}
          <div className="flex flex-wrap gap-1.5">
            {PALETTE.map((c) => (
              <button key={c} onClick={() => setSelectedColor(c)}
                className="w-7 h-7 rounded-md border-2 transition-all hover:scale-110"
                style={{ backgroundColor: c, borderColor: selectedColor === c ? 'white' : 'transparent' }} />
            ))}
            <input type="color" value={selectedColor} onChange={(e) => setSelectedColor(e.target.value)}
              className="w-7 h-7 rounded-md cursor-pointer border-2 border-zinc-700" title="Custom color" />
          </div>

          <canvas
            ref={canvasRef}
            width={W}
            height={W}
            className="rounded-xl border border-zinc-800 cursor-crosshair block"
            style={{ background: '#000', imageRendering: 'pixelated', maxWidth: '100%' }}
            onMouseDown={(e) => { painting.current = true; paint(...getXY(e)); }}
            onMouseMove={(e) => { if (painting.current) paint(...getXY(e)); }}
            onMouseUp={() => { painting.current = false; }}
            onMouseLeave={() => { painting.current = false; }}
          />
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Collaborative pixel art via DataChannel events' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'CanvasRenderingContext2D.fillRect()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/fillRect' },
      ]}
    />
  );
}
