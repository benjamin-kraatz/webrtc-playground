import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface Theme {
  hue: number;
  saturation: number;
  lightness: number;
  radius: number;
  blur: number;
  scale: number;
}

const DEFAULT_THEME: Theme = { hue: 220, saturation: 80, lightness: 55, radius: 12, blur: 0, scale: 100 };

const CODE = `// Sync CSS custom properties over a DataChannel
// When any slider changes, serialize the theme object and send it
slider.addEventListener('input', () => {
  theme.hue = hueSlider.value;
  document.documentElement.style.setProperty('--theme-hue', theme.hue);
  dc.send(JSON.stringify({ type: 'theme', ...theme }));
});

// Receiver applies the incoming theme instantly
dc.onmessage = ({ data }) => {
  const theme = JSON.parse(data);
  document.documentElement.style.setProperty('--theme-hue',        theme.hue);
  document.documentElement.style.setProperty('--theme-saturation', theme.saturation + '%');
  document.documentElement.style.setProperty('--theme-lightness',  theme.lightness + '%');
  document.documentElement.style.setProperty('--theme-radius',     theme.radius + 'px');
};`;

export default function CssThemeSync() {
  const logger = useMemo(() => new Logger(), []);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [connected, setConnected] = useState(false);
  const [presetActive, setPresetActive] = useState<string | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const PRESETS: Record<string, Theme> = {
    Ocean:   { hue: 200, saturation: 85, lightness: 50, radius: 16, blur: 4, scale: 100 },
    Sunset:  { hue: 20,  saturation: 90, lightness: 55, radius: 8,  blur: 0, scale: 105 },
    Forest:  { hue: 140, saturation: 70, lightness: 45, radius: 24, blur: 2, scale: 100 },
    Candy:   { hue: 310, saturation: 95, lightness: 65, radius: 32, blur: 0, scale: 95  },
    Slate:   { hue: 230, saturation: 30, lightness: 50, radius: 6,  blur: 0, scale: 100 },
  };

  const applyTheme = (t: Theme) => {
    setTheme(t);
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'theme', ...t }));
    }
  };

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('theme', { ordered: true });
    dcRef.current = dc;
    dc.onopen = () => {
      setConnected(true);
      dc.send(JSON.stringify({ type: 'theme', ...themeRef.current }));
      logger.success('Theme channel open — drag a slider to sync!');
    };
    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'theme') {
          const { type: _, ...t } = msg;
          setTheme(t as Theme);
          setPresetActive(null);
          logger.info(`Theme received: hue=${msg.hue}°, r=${msg.radius}px, blur=${msg.blur}px`);
        }
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const sliders: Array<{ key: keyof Theme; label: string; min: number; max: number; unit: string }> = [
    { key: 'hue',        label: 'Hue',        min: 0,  max: 360, unit: '°'  },
    { key: 'saturation', label: 'Saturation', min: 10, max: 100, unit: '%'  },
    { key: 'lightness',  label: 'Lightness',  min: 20, max: 80,  unit: '%'  },
    { key: 'radius',     label: 'Radius',     min: 0,  max: 40,  unit: 'px' },
    { key: 'blur',       label: 'Blur',       min: 0,  max: 20,  unit: 'px' },
    { key: 'scale',      label: 'Scale',      min: 70, max: 130, unit: '%'  },
  ];

  const primary = `hsl(${theme.hue},${theme.saturation}%,${theme.lightness}%)`;
  const primaryDark = `hsl(${theme.hue},${theme.saturation}%,${Math.max(20, theme.lightness - 20)}%)`;
  const primaryLight = `hsl(${theme.hue},${theme.saturation}%,${Math.min(90, theme.lightness + 20)}%)`;

  return (
    <DemoLayout
      title="CSS Theme Sync"
      difficulty="beginner"
      description="Drag sliders to change color, radius, blur, and scale — all CSS custom properties sync to peers via DataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>CSS Custom Properties</strong> (CSS variables) let you control an entire design
            system from a few values. This demo serializes six properties — hue, saturation,
            lightness, border-radius, blur, and scale — into a JSON object and sends it over a{' '}
            <strong>RTCDataChannel</strong> whenever any slider changes.
          </p>
          <p>
            The receiver applies the incoming values directly to the preview card with inline
            styles. In a real collaborative design tool (think Figma), this same pattern syncs
            component properties, colors, and layout across all collaborators in real time —
            no server relay in the critical path.
          </p>
        </div>
      }
      hints={[
        'Connect Loopback then drag any slider — the card updates on "both peers"',
        'Click a preset to send a complete theme bundle in one DataChannel message',
        'Each slider change sends ~80 bytes of JSON',
      ]}
      demo={
        <div className="space-y-5">
          {/* Preview card */}
          <div className="flex justify-center">
            <div
              className="p-6 space-y-3 w-72 transition-all duration-200"
              style={{
                backgroundColor: `hsl(${theme.hue},${Math.max(10, theme.saturation - 60)}%,15%)`,
                border: `2px solid ${primary}`,
                borderRadius: theme.radius,
                filter: theme.blur > 0 ? `blur(${theme.blur * 0.3}px)` : undefined,
                transform: `scale(${theme.scale / 100})`,
              }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full" style={{ backgroundColor: primary }} />
                <div>
                  <p className="text-sm font-bold" style={{ color: primaryLight }}>Design Preview</p>
                  <p className="text-xs text-zinc-400">Live CSS sync</p>
                </div>
              </div>
              <div className="h-2 rounded-full" style={{ backgroundColor: primaryDark }}>
                <div className="h-full rounded-full" style={{ backgroundColor: primary, width: `${theme.lightness}%` }} />
              </div>
              <button
                className="w-full py-2 text-sm font-semibold rounded-lg transition-all"
                style={{ backgroundColor: primary, color: '#fff', borderRadius: theme.radius / 2 }}
              >
                Sample Button
              </button>
              <div className="grid grid-cols-3 gap-1">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-6 rounded" style={{ backgroundColor: `hsl(${(theme.hue + i * 30) % 360},${theme.saturation}%,${theme.lightness}%)`, borderRadius: theme.radius / 3, opacity: 0.7 + i * 0.1 }} />
                ))}
              </div>
            </div>
          </div>

          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(PRESETS).map(([name, preset]) => (
              <button key={name} onClick={() => { applyTheme(preset); setPresetActive(name); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${presetActive === name ? 'border-blue-500 bg-blue-950/40 text-blue-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                {name}
              </button>
            ))}
          </div>

          {/* Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sliders.map(({ key, label, min, max, unit }) => (
              <label key={key} className="flex items-center gap-3 text-xs text-zinc-400">
                <span className="w-20 shrink-0">{label}</span>
                <input type="range" min={min} max={max} value={theme[key]}
                  onChange={(e) => { const t = {...theme, [key]: Number(e.target.value)}; applyTheme(t); setPresetActive(null); }}
                  className="flex-1 accent-blue-500" />
                <span className="w-12 text-right font-mono text-zinc-300">{theme[key]}{unit}</span>
              </label>
            ))}
          </div>

          {!connected && (
            <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
              Connect Loopback
            </button>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'CSS custom properties sync via DataChannel' }}
      mdnLinks={[
        { label: 'CSS Custom Properties', href: 'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
