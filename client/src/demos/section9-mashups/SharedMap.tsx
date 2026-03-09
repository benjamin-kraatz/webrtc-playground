import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

// Fix Leaflet default icon URLs (Vite asset handling)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface Pin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color: string;
}

const MY_COLOR = '#3b82f6';
const PEER_COLOR = '#a855f7';

const CODE = `// Sync map view + markers via RTCDataChannel
map.on('moveend', () => {
  const c = map.getCenter();
  dc.send(JSON.stringify({
    type: 'view',
    lat: c.lat,
    lng: c.lng,
    zoom: map.getZoom(),
  }));
});

map.on('click', ({ latlng }) => {
  const pin = { id: uuid(), lat: latlng.lat, lng: latlng.lng, label: 'Pin', color: myColor };
  addMarker(pin);
  dc.send(JSON.stringify({ type: 'pin', pin }));
});`;

export default function SharedMap() {
  const logger = useMemo(() => new Logger(), []);
  const [roomId, setRoomId] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [joined, setJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [pins, setPins] = useState<Pin[]>([]);
  const [syncView, setSyncView] = useState(true);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});
  const suppressMoveRef = useRef(false);

  const addMarker = useCallback((pin: Pin) => {
    if (!mapRef.current) return;
    const existing = markersRef.current.get(pin.id);
    if (existing) existing.remove();

    const icon = L.divIcon({
      html: `<div style="width:20px;height:20px;background:${pin.color};border:2px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,0.4)"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 20],
      className: '',
    });

    const marker = L.marker([pin.lat, pin.lng], { icon })
      .bindPopup(`<strong>${pin.label}</strong><br><small>${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}</small>`)
      .addTo(mapRef.current);

    markersRef.current.set(pin.id, marker);
    setPins((prev) => [...prev.filter((p) => p.id !== pin.id), pin]);
  }, []);

  const setupMap = useCallback(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, { zoomControl: true, attributionControl: false }).setView([48.8566, 2.3522], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);
    L.control.attribution({ prefix: '© OSM' }).addTo(map);
    mapRef.current = map;

    map.on('click', (ev) => {
      if (!dcRef.current || dcRef.current.readyState !== 'open') return;
      const pin: Pin = {
        id: uuidv4().slice(0, 8),
        lat: ev.latlng.lat,
        lng: ev.latlng.lng,
        label: 'Pin',
        color: MY_COLOR,
      };
      addMarker(pin);
      dcRef.current.send(JSON.stringify({ type: 'pin', pin }));
      logger.info(`Dropped pin at ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`);
    });

    map.on('moveend', () => {
      if (suppressMoveRef.current || !dcRef.current || dcRef.current.readyState !== 'open' || !syncView) return;
      const c = map.getCenter();
      dcRef.current.send(JSON.stringify({ type: 'view', lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
    });
  }, [addMarker, logger, syncView]);

  const setupDc = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.onopen = () => {
      logger.success('Map channel open — explore together!');
      // Send current view to new peer
      if (mapRef.current) {
        const c = mapRef.current.getCenter();
        dc.send(JSON.stringify({ type: 'view', lat: c.lat, lng: c.lng, zoom: mapRef.current.getZoom() }));
      }
    };
    dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'pin') {
        const pin = { ...msg.pin, color: PEER_COLOR };
        addMarker(pin);
        logger.info(`Peer dropped pin at ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`);
      } else if (msg.type === 'view' && syncView && mapRef.current) {
        suppressMoveRef.current = true;
        mapRef.current.setView([msg.lat, msg.lng], msg.zoom, { animate: true, duration: 0.8 });
        setTimeout(() => { suppressMoveRef.current = false; }, 1000);
      } else if (msg.type === 'clear') {
        markersRef.current.forEach((m) => m.remove());
        markersRef.current.clear();
        setPins([]);
      }
    };
  }, [addMarker, logger, syncView]);

  const onMessage = useCallback(async (msg: SignalingMessage) => {
    const pc = pcRef.current;
    if (!pc) return;
    switch (msg.type) {
      case 'peer-joined': {
        remotePeerIdRef.current = msg.peerId;
        const dc = pc.createDataChannel('map');
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

  const handleClearPins = () => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();
    setPins([]);
    dcRef.current?.send(JSON.stringify({ type: 'clear' }));
  };

  useEffect(() => {
    setupMap();
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      pcRef.current?.close();
    };
  }, []);

  return (
    <DemoLayout
      title="Shared World Map"
      difficulty="intermediate"
      description="Explore a Leaflet.js map together — drop pins and sync the view with your peer in real time via RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Leaflet.js</strong> renders interactive OpenStreetMap tiles in the browser.
            Map interactions — pan, zoom, and marker clicks — are serialized to JSON and broadcast
            over <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCDataChannel</code>.
          </p>
          <p>
            Blue pins are yours; purple pins come from your peer. Toggle <em>Sync View</em> to follow
            your peer's map position automatically.
          </p>
          {sigStatus !== 'connected' && (
            <p className="text-amber-400 text-xs">⚠ Run <code className="bg-surface-2 px-1 py-0.5 rounded">bun run dev</code> to start the signaling server.</p>
          )}
        </div>
      }
      hints={['Click anywhere on the map to drop a pin (synced to peer)', 'Toggle "Sync View" to follow your peer\'s navigation', 'Blue = your pins, Purple = peer\'s pins']}
      demo={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionStatus state={connectionState} />
            <span className="text-xs text-zinc-500">Signaling: <span className={sigStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{sigStatus}</span></span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!joined ? (
              <>
                <div>
                  <label className="text-xs text-zinc-500">Room Code</label>
                  <input value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                    className="block mt-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none focus:border-blue-500" />
                </div>
                <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg mt-4">
                  Join Room
                </button>
              </>
            ) : (
              <>
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input type="checkbox" checked={syncView} onChange={(e) => setSyncView(e.target.checked)} className="w-3.5 h-3.5" />
                  Sync View
                </label>
                <button onClick={handleClearPins} className="text-xs px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-zinc-400 rounded transition-colors">
                  Clear Pins
                </button>
                <button onClick={handleLeave} className="text-xs px-3 py-1.5 bg-red-900/40 text-red-400 rounded border border-red-800 transition-colors">
                  Leave
                </button>
              </>
            )}
          </div>

          <div
            ref={mapContainerRef}
            className="w-full rounded-xl overflow-hidden border border-zinc-800"
            style={{ height: 420, zIndex: 0 }}
          />

          {pins.length > 0 && (
            <div className="text-xs text-zinc-600">
              {pins.length} pin{pins.length !== 1 ? 's' : ''} dropped &nbsp;·&nbsp;
              <span style={{ color: MY_COLOR }}>● yours</span>
              &nbsp;<span style={{ color: PEER_COLOR }}>● peer</span>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Leaflet map events via RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
