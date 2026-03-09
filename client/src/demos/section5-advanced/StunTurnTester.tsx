import { useMemo, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { IceCandidateCard } from '@/components/ui/IceCandidateCard';
import { Logger } from '@/lib/logger';

const CODE = `// Test your own STUN/TURN servers
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.example.com:3478' },
    {
      urls: 'turn:turn.example.com:3478',
      username: 'user',
      credential: 'pass'
    }
  ]
});

pc.onicecandidate = (ev) => {
  if (ev.candidate?.type === 'relay') {
    console.log('✓ TURN server working!');
  }
};`;

interface TestResult {
  server: string;
  host: number;
  srflx: number;
  relay: number;
  failed: boolean;
}

const PRESETS = [
  { label: 'Google STUN', url: 'stun:stun.l.google.com:19302' },
  { label: 'Cloudflare STUN', url: 'stun:stun.cloudflare.com:3478' },
  { label: 'Mozilla STUN', url: 'stun:stun.services.mozilla.com' },
];

export default function StunTurnTester() {
  const logger = useMemo(() => new Logger(), []);
  const [servers, setServers] = useState(PRESETS[0].url);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [candidates, setCandidates] = useState<RTCIceCandidate[]>([]);
  const [result, setResult] = useState<TestResult | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setCandidates([]);
    setResult(null);

    const iceServers: RTCIceServer[] = servers
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((url) => {
        if (url.startsWith('turn:') && username) {
          return { urls: url, username, credential: password };
        }
        return { urls: url };
      });

    logger.info(`Testing ${iceServers.length} server(s)...`);

    const gathered: RTCIceCandidate[] = [];
    let failed = false;

    try {
      await new Promise<void>((resolve, reject) => {
        const pc = new RTCPeerConnection({ iceServers });
        pc.addTransceiver('audio');

        const timeout = setTimeout(() => {
          pc.close();
          resolve();
        }, 10000);

        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeout);
            pc.close();
            resolve();
          }
        };

        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            gathered.push(ev.candidate);
            setCandidates((prev) => [...prev, ev.candidate!]);
            logger.info(`${ev.candidate.type?.toUpperCase()} ${ev.candidate.protocol?.toUpperCase()} ${ev.candidate.address}:${ev.candidate.port}`);
          }
        };

        pc.onicecandidateerror = (ev) => {
          logger.error(`ICE error: ${(ev as RTCPeerConnectionIceErrorEvent).errorText}`);
          failed = true;
        };

        (async () => {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
        })().catch(reject);
      });
    } catch (e) {
      logger.error(`Test failed: ${e}`);
      failed = true;
    }

    setResult({
      server: iceServers.map((s) => (Array.isArray(s.urls) ? s.urls[0] : s.urls)).join(', '),
      host: gathered.filter((c) => c.type === 'host').length,
      srflx: gathered.filter((c) => c.type === 'srflx').length,
      relay: gathered.filter((c) => c.type === 'relay').length,
      failed,
    });

    setTesting(false);
    logger.success(`Done — ${gathered.length} candidates`);
  };

  return (
    <DemoLayout
      title="STUN/TURN Tester"
      difficulty="intermediate"
      description="Test custom STUN/TURN servers and verify candidate types gathered."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>STUN</strong> servers help peers discover their public IP (server reflexive candidates).
            <strong> TURN</strong> servers relay traffic when direct connections fail (relay candidates).
          </p>
          <p>
            Enter your STUN/TURN server URLs, click Test, and see what candidate types are gathered.
            If you get <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">relay</code> candidates,
            your TURN server is working correctly.
          </p>
        </div>
      }
      demo={
        <div className="space-y-5">
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2">PRESETS</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button key={p.url} onClick={() => setServers(p.url)}
                    className="px-3 py-1 text-xs bg-surface-2 hover:bg-surface-3 text-zinc-300 rounded-lg">
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-500">ICE Server URLs (one per line)</label>
              <textarea value={servers} onChange={(e) => setServers(e.target.value)}
                className="mt-1 w-full h-20 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none focus:outline-none focus:border-blue-500"
                placeholder="stun:stun.l.google.com:19302&#10;turn:your-turn-server.com:3478" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500">TURN Username (optional)</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)}
                  className="mt-1 w-full bg-surface-0 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">TURN Password (optional)</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full bg-surface-0 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-blue-500" />
              </div>
            </div>

            <button onClick={handleTest} disabled={testing || !servers.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {testing ? 'Testing (up to 10s)...' : 'Test Servers'}
            </button>
          </div>

          {result && (
            <div className={`rounded-lg p-4 border ${result.failed ? 'border-red-800 bg-red-900/20' : 'border-emerald-800 bg-emerald-900/20'}`}>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-2xl font-bold text-zinc-100">{result.host}</p>
                  <p className="text-xs text-ice-host font-mono">host</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100">{result.srflx}</p>
                  <p className="text-xs text-ice-srflx font-mono">srflx (STUN)</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100">{result.relay}</p>
                  <p className="text-xs text-ice-relay font-mono">relay (TURN)</p>
                </div>
              </div>
              <p className="text-center text-sm mt-3">
                {result.relay > 0
                  ? <span className="text-emerald-400">✓ TURN server working!</span>
                  : result.srflx > 0
                  ? <span className="text-blue-400">✓ STUN server working (no TURN configured)</span>
                  : <span className="text-amber-400">⚠ Only host candidates — check your server URLs</span>
                }
              </p>
            </div>
          )}

          {candidates.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2">GATHERED CANDIDATES</p>
              <div className="space-y-2">
                {candidates.map((c, i) => (
                  <IceCandidateCard key={i} candidate={c} />
                ))}
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Testing ICE servers' }}
      mdnLinks={[
        { label: 'RTCIceServer', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCIceServer' },
        { label: 'ICE candidates', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols#ice' },
      ]}
    />
  );
}
