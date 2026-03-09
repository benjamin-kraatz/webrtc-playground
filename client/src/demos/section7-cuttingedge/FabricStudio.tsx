import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import * as fabric from 'fabric';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

type Tool = 'select' | 'pen' | 'rect' | 'circle' | 'text';

const COLORS = ['#ffffff', '#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6', '#000000'];

const CODE = `import { Canvas, PencilBrush, Rect, Circle, IText } from 'fabric';

const fc = new Canvas(canvasEl, {
  backgroundColor: '#1c1c1e',
  isDrawingMode: true,
});

// Sync object additions to peer
fc.on('object:added', (ev) => {
  const json = ev.target?.toObject(['id']);
  dc.send(JSON.stringify({ type: 'add', object: json }));
});

// Receive and render remote objects
dc.onmessage = async ({ data }) => {
  const { type, object } = JSON.parse(data);
  if (type === 'add') {
    const obj = await fabric.util.enlivenObjects([object]);
    fc.add(obj[0]);
    fc.renderAll();
  }
};`;

export default function FabricStudio() {
  const logger = useMemo(() => new Logger(), []);
  const [roomId, setRoomId] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [joined, setJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#60a5fa');
  const [strokeWidth, setStrokeWidth] = useState(3);

  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fcRef = useRef<fabric.Canvas | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});
  const isRemoteRef = useRef(false);

  const initCanvas = useCallback(() => {
    if (!canvasElRef.current || fcRef.current) return;
    const fc = new fabric.Canvas(canvasElRef.current, {
      backgroundColor: '#1c1c1e',
      isDrawingMode: true,
      width: 700,
      height: 420,
    });
    fc.freeDrawingBrush = new fabric.PencilBrush(fc);
    fc.freeDrawingBrush.width = strokeWidth;
    fc.freeDrawingBrush.color = color;
    fcRef.current = fc;

    fc.on('object:added', (ev) => {
      if (isRemoteRef.current || !dcRef.current || dcRef.current.readyState !== 'open') return;
      const obj = ev.target;
      if (!obj) return;
      const json = obj.toObject();
      dcRef.current.send(JSON.stringify({ type: 'add', object: json }));
    });

    fc.on('object:modified', (ev) => {
      if (isRemoteRef.current || !dcRef.current || dcRef.current.readyState !== 'open') return;
      const json = fc.toJSON();
      dcRef.current.send(JSON.stringify({ type: 'canvas', json }));
    });
  }, [color, strokeWidth]);

  const applyTool = useCallback((t: Tool, c: string, sw: number) => {
    const fc = fcRef.current;
    if (!fc) return;
    fc.isDrawingMode = t === 'pen';
    fc.selection = t === 'select';
    fc.getObjects().forEach((o) => { o.selectable = t === 'select'; });

    if (t === 'pen') {
      if (!fc.freeDrawingBrush) {
        fc.freeDrawingBrush = new fabric.PencilBrush(fc);
      }
      fc.freeDrawingBrush.width = sw;
      fc.freeDrawingBrush.color = c;
    }

    if (t === 'rect') {
      const rect = new fabric.Rect({
        left: 100 + Math.random() * 200,
        top: 100 + Math.random() * 150,
        width: 100,
        height: 70,
        fill: 'transparent',
        stroke: c,
        strokeWidth: sw,
        selectable: false,
      });
      fc.add(rect);
      fc.renderAll();
    }

    if (t === 'circle') {
      const circle = new fabric.Circle({
        left: 120 + Math.random() * 200,
        top: 100 + Math.random() * 150,
        radius: 45,
        fill: 'transparent',
        stroke: c,
        strokeWidth: sw,
        selectable: false,
      });
      fc.add(circle);
      fc.renderAll();
    }

    if (t === 'text') {
      const text = new fabric.IText('Type here', {
        left: 120 + Math.random() * 150,
        top: 150 + Math.random() * 100,
        fontSize: 20,
        fill: c,
        fontFamily: 'system-ui',
      });
      fc.add(text);
      fc.setActiveObject(text);
      fc.renderAll();
      setTool('select');
    }
  }, []);

  useEffect(() => {
    initCanvas();
    return () => { fcRef.current?.dispose(); fcRef.current = null; };
  }, []);

  useEffect(() => {
    const fc = fcRef.current;
    if (!fc) return;
    if (fc.freeDrawingBrush) {
      fc.freeDrawingBrush.width = strokeWidth;
      fc.freeDrawingBrush.color = color;
    }
  }, [color, strokeWidth]);

  const setupDc = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.onopen = () => {
      logger.success('Design channel open — draw together!');
      // Share current canvas to new peer
      if (fcRef.current) {
        const json = fcRef.current.toJSON();
        dc.send(JSON.stringify({ type: 'canvas', json }));
      }
    };
    dc.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data as string);
      const fc = fcRef.current;
      if (!fc) return;

      isRemoteRef.current = true;
      try {
        if (msg.type === 'add') {
          const objs = await fabric.util.enlivenObjects([msg.object]) as fabric.FabricObject[];
          objs.forEach((o) => { o.selectable = tool === 'select'; fc.add(o); });
          fc.renderAll();
        } else if (msg.type === 'canvas') {
          await fc.loadFromJSON(msg.json);
          fc.renderAll();
        } else if (msg.type === 'clear') {
          fc.clear();
          fc.backgroundColor = '#1c1c1e';
          fc.renderAll();
        }
      } finally {
        isRemoteRef.current = false;
      }
    };
  }, [logger, tool]);

  const onMessage = useCallback(async (msg: SignalingMessage) => {
    const pc = pcRef.current;
    if (!pc) return;
    switch (msg.type) {
      case 'peer-joined': {
        remotePeerIdRef.current = msg.peerId;
        const dc = pc.createDataChannel('fabric');
        setupDc(dc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendRef.current({ type: 'offer', from: peerId, to: msg.peerId, sdp: offer });
        break;
      }
      case 'offer':
        remotePeerIdRef.current = msg.from;
        await pc.setRemoteDescription(msg.sdp);
        pc.ondatachannel = (ev) => setupDc(ev.channel);
        {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
        }
        break;
      case 'answer':
        await pc.setRemoteDescription(msg.sdp);
        break;
      case 'ice-candidate':
        await pc.addIceCandidate(msg.candidate).catch(() => {});
        break;
    }
  }, [peerId, logger, setupDc]);

  const { status: sigStatus, connect, join, send, disconnect } = useSignaling({ logger, onMessage });
  sendRef.current = send;

  const handleJoin = () => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc;
    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
    pc.onicecandidate = (ev) => {
      if (ev.candidate && remotePeerIdRef.current) {
        send({ type: 'ice-candidate', from: peerId, to: remotePeerIdRef.current, candidate: ev.candidate.toJSON() });
      }
    };
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 400);
  };

  const handleLeave = () => {
    pcRef.current?.close();
    disconnect();
    setJoined(false);
    setConnectionState('new');
  };

  const handleClear = () => {
    fcRef.current?.clear();
    if (fcRef.current) { fcRef.current.backgroundColor = '#1c1c1e'; fcRef.current.renderAll(); }
    dcRef.current?.send(JSON.stringify({ type: 'clear' }));
  };

  const handleToolClick = (t: Tool) => {
    setTool(t);
    applyTool(t, color, strokeWidth);
  };

  useEffect(() => { return () => { pcRef.current?.close(); }; }, []);

  const TOOLS: { id: Tool; label: string; icon: string }[] = [
    { id: 'select', label: 'Select', icon: '↖' },
    { id: 'pen', label: 'Pen', icon: '✏️' },
    { id: 'rect', label: 'Rect', icon: '▭' },
    { id: 'circle', label: 'Circle', icon: '○' },
    { id: 'text', label: 'Text', icon: 'T' },
  ];

  return (
    <DemoLayout
      title="Fabric.js Design Studio"
      difficulty="advanced"
      description="Collaborative vector canvas with shapes, freehand drawing, and text — synced in real time via RTCDataChannel using Fabric.js."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Fabric.js v7</strong> is a powerful HTML5 canvas library that manages objects
            (paths, shapes, text) as serializable JSON. When a new object is added or the canvas
            is modified, it's serialized and sent over <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCDataChannel</code>.
            The receiver calls <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">canvas.loadFromJSON()</code> to reconstruct.
          </p>
          {sigStatus !== 'connected' && (
            <p className="text-amber-400 text-xs">⚠ Run <code className="bg-surface-2 px-1 py-0.5 rounded">bun run dev</code> to start the signaling server.</p>
          )}
        </div>
      }
      hints={['Select "Pen" and draw freehand — strokes sync to peer', 'Rect/Circle/Text adds an object and syncs it', 'Use "Select" tool to move/resize objects']}
      demo={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionStatus state={connectionState} />
            <span className="text-xs text-zinc-500">Signaling: <span className={sigStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{sigStatus}</span></span>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-surface-0 border border-zinc-800 rounded-lg p-1">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleToolClick(t.id)}
                  title={t.label}
                  className={`px-3 py-1.5 text-sm rounded transition-colors ${tool === t.id ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  {t.icon}
                </button>
              ))}
            </div>

            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setColor(c);
                    if (fcRef.current?.freeDrawingBrush) fcRef.current.freeDrawingBrush.color = c;
                  }}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? 'border-zinc-200 scale-110' : 'border-transparent'}`}
                  style={{ background: c }}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Width</span>
              <input type="range" min={1} max={20} value={strokeWidth}
                onChange={(e) => {
                  const w = parseInt(e.target.value);
                  setStrokeWidth(w);
                  if (fcRef.current?.freeDrawingBrush) fcRef.current.freeDrawingBrush.width = w;
                }}
                className="w-20 accent-blue-500"
              />
              <span className="text-xs text-zinc-400">{strokeWidth}px</span>
            </div>

            <div className="flex gap-2 ml-auto">
              {!joined ? (
                <>
                  <input value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                    className="bg-surface-0 border border-zinc-700 rounded-lg px-2 py-1 text-xs font-mono text-zinc-200 w-20 focus:outline-none focus:border-blue-500" />
                  <button onClick={handleJoin} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg">
                    Join
                  </button>
                </>
              ) : (
                <button onClick={handleLeave} className="px-3 py-1.5 bg-red-900/40 text-red-400 text-xs rounded border border-red-800">Leave</button>
              )}
              <button onClick={handleClear} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-zinc-400 text-xs rounded transition-colors">
                Clear
              </button>
            </div>
          </div>

          <div className="rounded-xl overflow-hidden border border-zinc-800" style={{ maxWidth: 700 }}>
            <canvas ref={canvasElRef} />
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Fabric.js canvas sync via RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
