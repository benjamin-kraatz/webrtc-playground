import { useMemo, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { SdpViewer } from '@/components/ui/SdpViewer';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const SAMPLE_SDP = `v=0
o=- 4611731400430051336 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1
a=extmap-allow-mixed
a=msid-semantic: WMS
m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=ice-ufrag:abcd
a=ice-pwd:efghijklmnopqrstuvwxyz12
a=ice-options:trickle
a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99
a=setup:actpass
a=mid:0
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=sendrecv
a=msid:stream1 audio1
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtcp-fb:111 transport-cc
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:63 red/48000/2
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=ssrc:1234567890 cname:abc123
m=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103 104 105
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=ice-ufrag:abcd
a=ice-pwd:efghijklmnopqrstuvwxyz12
a=ice-options:trickle
a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99
a=setup:actpass
a=mid:1
a=extmap:14 urn:ietf:params:rtp-hdrext:toffset
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=sendrecv
a=msid:stream1 video1
a=rtcp-mux
a=rtpmap:96 VP8/90000
a=rtcp-fb:96 goog-remb
a=rtcp-fb:96 transport-cc
a=rtcp-fb:96 ccm fir
a=rtcp-fb:96 nack
a=rtcp-fb:96 nack pli
a=rtpmap:97 rtx/90000
a=fmtp:97 apt=96
a=rtpmap:102 H264/90000
a=rtcp-fb:102 goog-remb
a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f
a=candidate:1 1 udp 2122260223 192.168.1.100 54321 typ host generation 0
a=candidate:2 1 udp 1686052607 203.0.113.1 54321 typ srflx raddr 192.168.1.100 rport 54321 generation 0`;

const CODE = `// Generate an offer to see a real SDP
const pc = new RTCPeerConnection();
pc.addTransceiver('audio');
pc.addTransceiver('video');
const offer = await pc.createOffer();
console.log(offer.sdp); // Paste the output here!`;

export default function SdpInspector() {
  const logger = useMemo(() => new Logger(), []);
  const [sdpText, setSdpText] = useState('');
  const [parsedSdp, setParsedSdp] = useState<string | null>(null);
  const [tab, setTab] = useState<'paste' | 'generate'>('paste');
  const [generating, setGenerating] = useState(false);

  const handleParse = () => {
    if (!sdpText.trim()) return;
    setParsedSdp(sdpText);
    logger.success('SDP parsed successfully');
  };

  const handleLoadSample = () => {
    setSdpText(SAMPLE_SDP);
    setParsedSdp(SAMPLE_SDP);
    logger.info('Sample SDP loaded');
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pc.addTransceiver('audio');
      pc.addTransceiver('video');
      const offer = await pc.createOffer();
      pc.close();
      setSdpText(offer.sdp ?? '');
      setParsedSdp(offer.sdp ?? '');
      logger.success('Real offer SDP generated from browser');
    } catch (e) {
      logger.error(`Failed to generate: ${e}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <DemoLayout
      title="SDP Inspector"
      difficulty="beginner"
      description="Paste any SDP and explore its structure — codecs, ICE candidates, extensions."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>SDP</strong> (Session Description Protocol) is the text format WebRTC uses to
            describe a media session — what codecs are supported, what network addresses are available,
            and how to secure the connection.
          </p>
          <p>
            An SDP blob has a <strong>session section</strong> (starts with <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">v=0</code>)
            followed by one or more <strong>media sections</strong> (each starting with <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">m=</code>)
            for audio, video, and data channels.
          </p>
          <p>
            This inspector parses the raw text into a structured tree so you can explore it visually.
          </p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex gap-2 border-b border-zinc-800">
            {(['paste', 'generate'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-sm capitalize ${
                  tab === t
                    ? 'text-zinc-100 border-b-2 border-blue-400'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {t === 'paste' ? 'Paste SDP' : 'Generate from browser'}
              </button>
            ))}
          </div>

          {tab === 'paste' ? (
            <div className="space-y-3">
              <textarea
                value={sdpText}
                onChange={(e) => setSdpText(e.target.value)}
                placeholder="Paste SDP here..."
                className="w-full h-36 bg-surface-0 border border-zinc-700 rounded-lg p-3 text-xs font-mono text-zinc-300 resize-none focus:outline-none focus:border-blue-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleParse}
                  disabled={!sdpText.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Parse SDP
                </button>
                <button
                  onClick={handleLoadSample}
                  className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg transition-colors"
                >
                  Load Sample
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">Generate a real SDP offer from your browser with audio + video transceivers.</p>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {generating ? 'Generating...' : 'Generate Offer SDP'}
              </button>
            </div>
          )}

          {parsedSdp && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Parsed Structure</p>
              <SdpViewer sdp={parsedSdp} />
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Generate your own SDP' }}
      mdnLinks={[
        { label: 'SDP on MDN', href: 'https://developer.mozilla.org/en-US/docs/Glossary/SDP' },
        { label: 'RTCSessionDescription', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCSessionDescription' },
      ]}
    />
  );
}
