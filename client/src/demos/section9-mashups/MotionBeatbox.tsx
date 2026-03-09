import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface Keypoint { x: number; y: number; score?: number; name?: string; }
interface HitIndicator { drum: string; time: number; x: number; y: number; color: string; }

const W = 560, H = 360;
const DRUM_COLORS: Record<string, string> = { kick: '#f87171', snare: '#fbbf24', hihat: '#60a5fa', bass: '#34d399' };
const DRUM_LABELS: Record<string, string> = { kick: '🦶 KICK', snare: '🥁 SNARE', hihat: '🎩 HI-HAT', bass: '🔊 BASS' };

const CODE = `// MASHUP: MotionDetector + BeatMachine + VideoCall
// Body pose keypoints → drum triggers → Tone.js synthesis

const poses = await detector.estimatePoses(videoEl);
const kp = Object.fromEntries(poses[0].keypoints.map(k => [k.name, k]));

const leftWristHigh  = kp.left_wrist.y  < kp.left_shoulder.y  - 40;
const rightWristHigh = kp.right_wrist.y < kp.right_shoulder.y - 40;
const crouching      = kp.nose.y > videoEl.videoHeight * 0.65;

if (leftWristHigh && rightWristHigh && !cooldown.kick) {
  kick.triggerAttackRelease('C1', '8n');
  cooldown.kick = true; setTimeout(() => cooldown.kick = false, 300);
} else if (rightWristHigh && !cooldown.snare) {
  snare.triggerAttackRelease('8n');
  cooldown.snare = true; setTimeout(() => cooldown.snare = false, 250);
}`;

export default function MotionBeatbox() {
  const logger = useMemo(() => new Logger(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const detectorRef = useRef<{ estimatePoses: (v: HTMLVideoElement) => Promise<{ keypoints: Keypoint[] }[]> } | null>(null);
  const synthsRef = useRef<Record<string, { triggerAttackRelease: (...args: unknown[]) => void }>>({});
  const cooldownRef = useRef<Record<string, boolean>>({});
  const hitsRef = useRef<HitIndicator[]>([]);
  const ptsRef = useRef<Keypoint[]>([]);
  const [running, setRunning] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [hitLog, setHitLog] = useState<string[]>([]);

  const triggerDrum = useCallback(async (drum: string, pt?: { x: number; y: number }) => {
    if (cooldownRef.current[drum]) return;
    cooldownRef.current[drum] = true;
    setTimeout(() => { cooldownRef.current[drum] = false; }, drum === 'hihat' ? 150 : 250);
    const synths = synthsRef.current;
    if (!synths.kick) return;
    if (drum === 'kick') synths.kick.triggerAttackRelease('C1', '8n');
    else if (drum === 'snare') synths.snare.triggerAttackRelease('8n');
    else if (drum === 'hihat') synths.hihat.triggerAttackRelease('G4', '32n');
    else if (drum === 'bass') synths.bass.triggerAttackRelease('A1', '4n');
    hitsRef.current.push({ drum, time: Date.now(), x: pt?.x ?? W / 2, y: pt?.y ?? H / 2, color: DRUM_COLORS[drum] });
    setHitLog(prev => [`${DRUM_LABELS[drum]} hit!`, ...prev.slice(0, 4)]);
  }, []);

  const inferLoop = useCallback(async () => {
    const video = videoRef.current; const detector = detectorRef.current;
    if (!video || !detector || video.readyState < 2) { rafRef.current = requestAnimationFrame(inferLoop); return; }

    const poses = await detector.estimatePoses(video);
    if (poses.length > 0) {
      const kpArr = poses[0].keypoints;
      ptsRef.current = kpArr;
      const kp: Record<string, Keypoint> = {};
      kpArr.forEach(k => { if (k.name) kp[k.name] = k; });

      const vw = video.videoWidth || W, vh = video.videoHeight || H;
      const lw = kp['left_wrist'], rw = kp['right_wrist'], ls = kp['left_shoulder'], rs = kp['right_shoulder'], nose = kp['nose'];
      if (lw && rw && ls && rs) {
        const lwHigh = lw.y < ls.y - 40;
        const rwHigh = rw.y < rs.y - 40;
        const crouching = nose && nose.y > vh * 0.65;
        if (lwHigh && rwHigh) await triggerDrum('kick', { x: (lw.x + rw.x) / 2 / vw * W, y: (lw.y + rw.y) / 2 / vh * H });
        else if (rwHigh) await triggerDrum('snare', { x: rw.x / vw * W, y: rw.y / vh * H });
        else if (lwHigh) await triggerDrum('hihat', { x: lw.x / vw * W, y: lw.y / vh * H });
        if (crouching) await triggerDrum('bass', { x: nose!.x / vw * W, y: nose!.y / vh * H });
      }
    }

    // Draw canvas
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && videoRef.current && videoRef.current.videoWidth > 0) {
      ctx.drawImage(videoRef.current, 0, 0, W, H);

      // Draw skeleton
      const kpArr = ptsRef.current;
      if (kpArr.length >= 17) {
        const vw = videoRef.current.videoWidth, vh = videoRef.current.videoHeight;
        const toCanvas = (kp: Keypoint) => ({ x: kp.x / vw * W, y: kp.y / vh * H });
        const PAIRS = [[5,7],[7,9],[6,8],[8,10],[5,6],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
        ctx.strokeStyle = 'rgba(167,139,250,0.7)'; ctx.lineWidth = 2;
        PAIRS.forEach(([a, b]) => {
          const pa = kpArr[a], pb = kpArr[b];
          if ((pa.score ?? 0) > 0.3 && (pb.score ?? 0) > 0.3) {
            const ca = toCanvas(pa), cb = toCanvas(pb);
            ctx.beginPath(); ctx.moveTo(ca.x, ca.y); ctx.lineTo(cb.x, cb.y); ctx.stroke();
          }
        });
        kpArr.forEach((kp, i) => {
          if (i < 5 || (kp.score ?? 0) < 0.3) return;
          const { x, y } = toCanvas(kp);
          ctx.fillStyle = '#a78bfa'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        });
      }

      // Hit indicators
      const now = Date.now();
      hitsRef.current = hitsRef.current.filter(h => now - h.time < 500);
      for (const hit of hitsRef.current) {
        const age = (now - hit.time) / 500;
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = hit.color;
        ctx.beginPath(); ctx.arc(hit.x, hit.y, 30 * (1 + age), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(hit.drum.toUpperCase(), hit.x, hit.y - 35 * (1 + age));
        ctx.globalAlpha = 1;
      }

      // Legend
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.roundRect(8, 8, 210, 75, 8); ctx.fill();
      ctx.fillStyle = '#e2e8f0'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
      ctx.fillText('⬆️L = Hi-Hat   ⬆️R = Snare', 14, 26);
      ctx.fillText('⬆️⬆️ = Kick   🔽 = Bass', 14, 44);
      ctx.fillText('(raise wrists above shoulders)', 14, 62);
      ctx.fillText('(crouch = bass)', 14, 78);
    }

    rafRef.current = requestAnimationFrame(inferLoop);
  }, [triggerDrum]);

  const start = async () => {
    setLoadingModel(true);
    logger.info('Loading MoveNet + Tone.js…');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (import('@tensorflow/tfjs-backend-webgl') as Promise<any>);
      const Tone = await import('tone');
      await Tone.start();
      const pd = await import('@tensorflow-models/pose-detection');
      const detector = await pd.createDetector(pd.SupportedModels.MoveNet, {
        modelType: (pd.movenet as { modelType: { SINGLEPOSE_LIGHTNING: string } }).modelType.SINGLEPOSE_LIGHTNING,
      });
      detectorRef.current = detector as typeof detectorRef.current;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const asAny = (x: unknown) => x as { triggerAttackRelease: (...args: unknown[]) => void };
      synthsRef.current = {
        kick:  asAny(new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 8, envelope: { attack: 0.001, decay: 0.35, sustain: 0 } }).toDestination()),
        snare: asAny(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.2, sustain: 0 } }).toDestination()),
        hihat: asAny(new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.08 }, octaves: 1.5, resonance: 3200 }).toDestination()),
        bass:  asAny(new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.5 } }).toDestination()),
      };

      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H } });
      videoRef.current!.srcObject = stream; await videoRef.current!.play();
      setLoadingModel(false); setRunning(true);
      logger.success('Ready! Raise your left wrist for hi-hat, right for snare, both for kick, crouch for bass');
      rafRef.current = requestAnimationFrame(inferLoop);
    } catch (err) {
      setLoadingModel(false); logger.error(`${err}`);
    }
  };

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    (videoRef.current?.srcObject as MediaStream)?.getTracks().forEach(t => t.stop());
    Object.values(synthsRef.current).forEach(s => { try { (s as { dispose?: () => void }).dispose?.(); } catch { /* ok */ } });
  }, []);

  return (
    <DemoLayout
      title="Motion Beatbox"
      difficulty="advanced"
      description="MASHUP: MotionDetector + BeatMachine — raise your hands to trigger drums, crouch for bass. Your body IS the drum machine."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This mashup wires <strong>TF.js MoveNet</strong> pose detection directly into a{' '}
            <strong>Tone.js drum machine</strong>. Your body becomes a MIDI controller.
          </p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li><strong>Left wrist above shoulder</strong> → Hi-Hat (MetalSynth)</li>
            <li><strong>Right wrist above shoulder</strong> → Snare (NoiseSynth)</li>
            <li><strong>Both wrists high</strong> → Kick (MembraneSynth)</li>
            <li><strong>Crouch (nose below 65% height)</strong> → Bass (Synth)</li>
          </ul>
          <p>Each trigger has a cooldown to prevent double-hits. Color bursts appear where hits occur.</p>
        </div>
      }
      hints={[
        'Stand 1-2 meters back so your full body is visible',
        'Raise arms quickly and deliberately for best detection',
        'Try jumping to trigger kick + bass simultaneously',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex gap-2 items-center">
            {!running
              ? <button onClick={start} disabled={loadingModel} className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                  {loadingModel ? '⏳ Loading…' : '🥁 Start Beatbox'}
                </button>
              : <span className="px-3 py-1 bg-orange-900/40 border border-orange-700 text-orange-300 text-xs rounded-lg">🟢 Beatboxing</span>
            }
          </div>
          <canvas ref={canvasRef} width={W} height={H} className="rounded-xl border border-zinc-800 w-full" style={{ background: '#09090b' }} />
          {hitLog.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {hitLog.map((h, i) => <span key={i} className="px-2 py-0.5 bg-zinc-800 text-zinc-300 text-xs rounded">{h}</span>)}
            </div>
          )}
          <video ref={videoRef} className="hidden" muted playsInline />
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Body pose keypoints → drum triggers' }}
      mdnLinks={[
        { label: 'TF.js Pose Detection', href: 'https://github.com/tensorflow/tfjs-models/tree/master/pose-detection' },
        { label: 'Tone.js MembraneSynth', href: 'https://tonejs.github.io/docs/latest/classes/MembraneSynth' },
      ]}
    />
  );
}
