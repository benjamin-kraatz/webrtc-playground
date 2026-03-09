import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { DemoLayout } from '@/components/layout/DemoLayout'
import { Logger } from '@/lib/logger'
import { DEFAULT_PC_CONFIG } from '@/config/iceServers'
import { v4 as uuidv4 } from 'uuid'

const CODE = `// Plant a seed and sync via RTCDataChannel
interface Seed {
  id: string;  x: number;  y: number
  type: 'rose' | 'crystal' | 'drum' | 'wind'
  plantedAt: number;  color: string
}

// When user clicks:
const seed: Seed = { id: uuidv4(), x: nx, y: ny, type, plantedAt: Date.now(), color }
setSeeds(prev => [...prev, seed])
dc.send(JSON.stringify({ type: 'seed', seed }))

// After growth completes (4s), start Tone.js instrument:
const Tone = await import('tone')
const synth = new Tone.PluckSynth().toDestination()
const loop = new Tone.Loop(time => {
  const note = freqToNote(220 + seed.x * 660)  // X → pitch
  synth.triggerAttack(note, time)
}, seed.y * 3 + 1)  // Y → loop interval
loop.start(0)
Tone.Transport.start()`

type SeedType = 'rose' | 'crystal' | 'drum' | 'wind'

interface Seed {
  id: string
  x: number  // 0-1 normalized
  y: number  // 0-1 normalized
  type: SeedType
  plantedAt: number
  color: string
}

type ToneModule = typeof import('tone')

const SEED_TYPES: SeedType[] = ['rose', 'crystal', 'drum', 'wind']
const SEED_EMOJIS: Record<SeedType, string> = { rose: '🌹', crystal: '💎', drum: '🥁', wind: '🌬️' }
const SEED_COLORS: Record<SeedType, string> = {
  rose: '#f472b6',
  crystal: '#67e8f9',
  drum: '#fbbf24',
  wind: '#a3e635',
}
const SEED_LABELS: Record<SeedType, string> = {
  rose: 'Rose (PluckSynth)',
  crystal: 'Crystal (MetalSynth)',
  drum: 'Drum (MembraneSynth)',
  wind: 'Wind (AMSynth)',
}

const MAX_SEEDS = 12

// Random star positions, generated once
const STARS = Array.from({ length: 60 }, () => ({
  x: Math.random(),
  y: Math.random() * 0.45,
  r: Math.random() * 1.2 + 0.3,
  brightness: Math.random() * 0.6 + 0.4,
}))

export default function SoundscapeGarden() {
  const logger = useMemo(() => new Logger(), [])

  const [seeds, setSeeds] = useState<Seed[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [volume, setVolume] = useState(60)
  const [toneReady, setToneReady] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const seedsRef = useRef<Seed[]>([])
  seedsRef.current = seeds

  const pcARef = useRef<RTCPeerConnection | null>(null)
  const pcBRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)

  const toneRef = useRef<ToneModule | null>(null)
  const volumeNodeRef = useRef<InstanceType<ToneModule['Volume']> | null>(null)
  const synthsRef = useRef<Map<string, { synth: unknown; loop: unknown }>>(new Map())

  const volumeRef = useRef(volume)
  volumeRef.current = volume

  // Draw the garden
  const drawGarden = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width
    const H = canvas.height
    const now = Date.now()

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.7)
    sky.addColorStop(0, '#0a0614')
    sky.addColorStop(0.6, '#12081a')
    sky.addColorStop(1, '#1a0a12')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, W, H)

    // Ground
    const ground = ctx.createLinearGradient(0, H * 0.72, 0, H)
    ground.addColorStop(0, '#1a1005')
    ground.addColorStop(1, '#0f0a02')
    ctx.fillStyle = ground
    ctx.fillRect(0, H * 0.72, W, H * 0.28)

    // Ground line with soft glow
    ctx.shadowColor = '#4a3000'
    ctx.shadowBlur = 12
    ctx.fillStyle = '#2a1a06'
    ctx.fillRect(0, H * 0.72 - 2, W, 4)
    ctx.shadowBlur = 0

    // Stars
    STARS.forEach(star => {
      const twinkle = 0.5 + 0.5 * Math.sin(now / 1200 + star.x * 10)
      ctx.beginPath()
      ctx.arc(star.x * W, star.y * H * 0.72, star.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 240, ${star.brightness * twinkle})`
      ctx.fill()
    })

    // Moon
    ctx.beginPath()
    ctx.arc(W * 0.88, H * 0.12, 22, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 250, 200, 0.08)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(W * 0.88, H * 0.12, 18, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 250, 200, 0.12)'
    ctx.fill()

    // Waveform line across the garden floor
    const waveY = H * 0.72 - 12
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(120, 80, 20, 0.4)'
    ctx.lineWidth = 1.5
    const t = now / 800
    for (let x = 0; x < W; x++) {
      const amp = seedsRef.current.length * 2.5
      const freq = 0.04 + seedsRef.current.length * 0.008
      const y = waveY + Math.sin(x * freq + t) * amp
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Draw seeds
    seedsRef.current.forEach(seed => {
      const elapsed = (now - seed.plantedAt) / 4000
      const growth = Math.min(1, elapsed)
      const eased = growth < 1 ? 1 - Math.pow(1 - growth, 3) : 1 // ease out cubic

      const px = seed.x * W
      const py = seed.y * (H * 0.62) + H * 0.08  // keep in sky/upper area above ground

      // Glow ring pulsing to beat
      const pulseScale = 1 + 0.15 * Math.sin(now / 500 + seed.x * 6.28)
      const glowRadius = 22 * eased * pulseScale
      if (eased > 0.1) {
        const grd = ctx.createRadialGradient(px, py, 0, px, py, glowRadius * 2.5)
        grd.addColorStop(0, `${seed.color}30`)
        grd.addColorStop(1, `${seed.color}00`)
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.arc(px, py, glowRadius * 2.5, 0, Math.PI * 2)
        ctx.fill()
      }

      // Stem growing from ground
      if (eased > 0.05) {
        const groundY = H * 0.72
        const stemH = (groundY - py - 10) * eased
        ctx.beginPath()
        ctx.moveTo(px, groundY)
        ctx.lineTo(px, groundY - stemH)
        ctx.strokeStyle = `rgba(60, 120, 30, ${eased * 0.6})`
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // Emoji — scale from 0 to full
      const fontSize = Math.round(22 * eased)
      if (fontSize > 3) {
        ctx.font = `${fontSize}px serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.globalAlpha = eased
        ctx.fillText(SEED_EMOJIS[seed.type], px, py)
        ctx.globalAlpha = 1
      }

      // Growth progress ring
      if (growth < 1) {
        ctx.beginPath()
        ctx.arc(px, py, 14, -Math.PI / 2, -Math.PI / 2 + growth * Math.PI * 2)
        ctx.strokeStyle = seed.color
        ctx.lineWidth = 2
        ctx.stroke()
      }
    })

    animFrameRef.current = requestAnimationFrame(drawGarden)
  }, [])

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(drawGarden)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [drawGarden])

  const ensureTone = useCallback(async (): Promise<ToneModule> => {
    if (toneRef.current) return toneRef.current
    const Tone = await import('tone')
    await Tone.start()
    const vol = new Tone.Volume(-12).toDestination()
    vol.volume.value = (volumeRef.current / 100) * 20 - 20
    volumeNodeRef.current = vol
    Tone.getTransport().bpm.value = 80
    Tone.getTransport().start()
    toneRef.current = Tone
    setToneReady(true)
    return Tone
  }, [])

  const startSeedInstrument = useCallback(async (seed: Seed) => {
    const Tone = await ensureTone()

    const freqFromX = (x: number) => 110 + x * 550  // 110–660 Hz
    const intervalFromY = (y: number) => `${Math.round(y * 3 + 1)}n`  // 1n–4n
    const decayFromY = (y: number) => 0.2 + y * 2.0

    let synth: unknown
    let loop: unknown

    if (seed.type === 'rose') {
      const pluck = new Tone.PluckSynth({ attackNoise: 1, dampening: 4000, resonance: 0.98 }).connect(volumeNodeRef.current!)
      const freq = freqFromX(seed.x)
      const interval = intervalFromY(seed.y)
      loop = new Tone.Loop((time: number) => {
        pluck.triggerAttack(freq, time)
      }, interval)
      ;(loop as { start: (t: number) => void }).start(0)
      synth = pluck
    } else if (seed.type === 'crystal') {
      const metal = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: decayFromY(seed.y), release: 0.2 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5,
      }).connect(volumeNodeRef.current!)
      metal.frequency.value = freqFromX(seed.x) * 0.5
      loop = new Tone.Loop((time: number) => {
        metal.triggerAttackRelease('16n', time)
      }, intervalFromY(1 - seed.y))
      ;(loop as { start: (t: number) => void }).start(0)
      synth = metal
    } else if (seed.type === 'drum') {
      const centerDist = Math.sqrt((seed.x - 0.5) ** 2 + (seed.y - 0.5) ** 2)
      const membrane = new Tone.MembraneSynth({
        pitchDecay: 0.05 + centerDist * 0.1,
        octaves: 4 + centerDist * 3,
        envelope: { attack: 0.001, decay: 0.2 + centerDist * 0.3, sustain: 0, release: 0.1 },
      }).connect(volumeNodeRef.current!)
      const kickFreq = 60 + centerDist * 80
      loop = new Tone.Loop((time: number) => {
        membrane.triggerAttackRelease(kickFreq, '8n', time)
      }, '2n')
      ;(loop as { start: (t: number) => void }).start(0)
      synth = membrane
    } else {
      // wind - AMSynth
      const am = new Tone.AMSynth({
        harmonicity: 2,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.5, decay: 0.1, sustain: 0.9, release: 1.5 },
        modulation: { type: 'square' },
        modulationEnvelope: { attack: 0.5, decay: 0, sustain: 1, release: 0.5 },
      }).connect(volumeNodeRef.current!)
      const carrierFreq = freqFromX(seed.x)
      loop = new Tone.Loop((time: number) => {
        am.triggerAttackRelease(carrierFreq, '2n', time)
      }, '1n')
      ;(loop as { start: (t: number) => void }).start(0)
      synth = am
    }

    synthsRef.current.set(seed.id, { synth, loop })
    logger.success(`${SEED_EMOJIS[seed.type]} ${seed.type} seed bloomed — playing at ${Math.round(freqFromX(seed.x))} Hz`)
  }, [ensureTone, logger])

  const plantSeed = useCallback(async (x: number, y: number) => {
    if (seedsRef.current.length >= MAX_SEEDS) {
      logger.warn(`Garden full (${MAX_SEEDS} seeds max) — remove some seeds first`)
      return
    }

    const type = SEED_TYPES[Math.floor(Math.random() * SEED_TYPES.length)]
    const seed: Seed = {
      id: uuidv4(),
      x: Math.max(0.03, Math.min(0.97, x)),
      y: Math.max(0.05, Math.min(0.95, y)),
      type,
      plantedAt: Date.now(),
      color: SEED_COLORS[type],
    }

    setSeeds(prev => [...prev, seed])
    logger.info(`Planted ${SEED_EMOJIS[type]} ${type} seed (x=${x.toFixed(2)}, y=${y.toFixed(2)})`)

    // Sync via data channel if connected
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'seed', seed }))
    }

    // Start instrument after growth animation (4s)
    setTimeout(() => startSeedInstrument(seed), 4000)
  }, [startSeedInstrument, logger])

  const removeSeed = useCallback((id: string) => {
    const entry = synthsRef.current.get(id)
    if (entry) {
      const { synth, loop } = entry as {
        synth: { dispose: () => void }
        loop: { dispose: () => void; stop: () => void }
      }
      loop.stop()
      loop.dispose()
      synth.dispose()
      synthsRef.current.delete(id)
    }
    setSeeds(prev => prev.filter(s => s.id !== id))

    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'remove', id }))
    }
    logger.info(`Seed removed`)
  }, [logger])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const cx = (e.clientX - rect.left) * scaleX
    const cy = (e.clientY - rect.top) * scaleY
    const nx = cx / canvas.width
    const ny = cy / canvas.height
    // Clicking below ground removes nearest seed
    if (ny > 0.75) return
    plantSeed(nx, ny)
  }, [plantSeed])

  const handleConnect = useCallback(async () => {
    if (isConnected) {
      pcARef.current?.close()
      pcBRef.current?.close()
      pcARef.current = null
      pcBRef.current = null
      dcRef.current = null
      setIsConnected(false)
      logger.info('Disconnected loopback')
      return
    }

    logger.info('Connecting WebRTC loopback for seed sync...')
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG)
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG)
    pcARef.current = pcA
    pcBRef.current = pcB

    pcA.onicecandidate = ev => { if (ev.candidate) pcB.addIceCandidate(ev.candidate).catch(() => {}) }
    pcB.onicecandidate = ev => { if (ev.candidate) pcA.addIceCandidate(ev.candidate).catch(() => {}) }

    const dc = pcA.createDataChannel('garden', { ordered: true })
    dcRef.current = dc

    dc.onopen = () => {
      logger.success('Garden sync channel open — seeds will be broadcast over WebRTC')
      setIsConnected(true)
    }

    pcB.ondatachannel = ev => {
      const remoteDc = ev.channel
      remoteDc.onmessage = async (msgEv) => {
        const msg = JSON.parse(msgEv.data as string)
        if (msg.type === 'seed') {
          const seed: Seed = msg.seed
          setSeeds(prev => {
            if (prev.find(s => s.id === seed.id)) return prev
            return [...prev, seed]
          })
          logger.info(`Received remote seed: ${SEED_EMOJIS[seed.type]} ${seed.type}`)
          setTimeout(() => startSeedInstrument(seed), 4000)
        } else if (msg.type === 'remove') {
          removeSeed(msg.id)
        }
      }
    }

    const offer = await pcA.createOffer()
    await pcA.setLocalDescription(offer)
    await pcB.setRemoteDescription(offer)
    const answer = await pcB.createAnswer()
    await pcB.setLocalDescription(answer)
    await pcA.setRemoteDescription(answer)
  }, [isConnected, startSeedInstrument, removeSeed, logger])

  const handleClearGarden = useCallback(() => {
    synthsRef.current.forEach(({ synth, loop }) => {
      const s = synth as { dispose: () => void }
      const l = loop as { stop: () => void; dispose: () => void }
      l.stop()
      l.dispose()
      s.dispose()
    })
    synthsRef.current.clear()
    setSeeds([])
    logger.info('Garden cleared')
  }, [logger])

  const handleVolumeChange = useCallback((val: number) => {
    setVolume(val)
    volumeRef.current = val
    if (volumeNodeRef.current) {
      volumeNodeRef.current.volume.value = (val / 100) * 20 - 20
    }
  }, [])

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current)
      synthsRef.current.forEach(({ synth, loop }) => {
        const s = synth as { dispose: () => void }
        const l = loop as { stop: () => void; dispose: () => void }
        try { l.stop(); l.dispose(); s.dispose() } catch (_) {}
      })
      toneRef.current?.getTransport().stop()
      pcARef.current?.close()
      pcBRef.current?.close()
    }
  }, [])

  return (
    <DemoLayout
      title="Soundscape Garden"
      difficulty="advanced"
      description="Click to plant sound seeds that grow into Tone.js instruments. Seeds sync over RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Click anywhere in the garden to plant a <strong>sound seed</strong>. Each seed type becomes
            a different Tone.js instrument after a 4-second growth animation. Seed position controls
            the musical parameters:
          </p>
          <div className="grid grid-cols-2 gap-2 text-zinc-400">
            <div>🌹 <strong>Rose</strong> — PluckSynth. X → pitch</div>
            <div>💎 <strong>Crystal</strong> — MetalSynth. Y → decay</div>
            <div>🥁 <strong>Drum</strong> — MembraneSynth. Distance from center → frequency</div>
            <div>🌬️ <strong>Wind</strong> — AMSynth. X → carrier frequency</div>
          </div>
          <p className="text-zinc-500 text-xs">
            Seeds are synced over an RTCDataChannel loopback connection. In a real multi-peer scenario,
            all participants would hear the same collaborative garden grow in real time.
          </p>
        </div>
      }
      demo={
        <div className="space-y-4">
          {/* Canvas garden */}
          <div className="rounded-xl overflow-hidden border border-zinc-800 cursor-crosshair">
            <canvas
              ref={canvasRef}
              width={580}
              height={360}
              className="w-full"
              onClick={handleCanvasClick}
              title="Click to plant a seed"
            />
          </div>

          <p className="text-xs text-zinc-500 text-center">
            Click anywhere above the ground to plant a seed • Seeds play music after 4 seconds of growth
          </p>

          {/* Seed roster */}
          {seeds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {seeds.map(seed => (
                <button
                  key={seed.id}
                  onClick={() => removeSeed(seed.id)}
                  title="Click to remove"
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium transition-all hover:opacity-75"
                  style={{ borderColor: seed.color + '60', backgroundColor: seed.color + '15', color: seed.color }}
                >
                  <span>{SEED_EMOJIS[seed.type]}</span>
                  <span>{seed.type}</span>
                  <span className="opacity-50 ml-0.5">×</span>
                </button>
              ))}
            </div>
          )}

          {/* Controls bar */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleConnect}
              className={`px-4 py-2 text-sm font-medium rounded-xl border transition-all ${
                isConnected
                  ? 'bg-emerald-800 border-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
              }`}
            >
              {isConnected ? '✓ Loopback Connected' : 'Connect Loopback'}
            </button>

            <button
              onClick={handleClearGarden}
              disabled={seeds.length === 0}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Clear Garden
            </button>

            <div className="flex items-center gap-2 ml-auto">
              <label className="text-xs text-zinc-500">Volume:</label>
              <input
                type="range" min={0} max={100} step={1} value={volume}
                onChange={e => handleVolumeChange(Number(e.target.value))}
                className="w-24 accent-emerald-500"
              />
              <span className="text-xs text-zinc-400 font-mono w-8">{volume}%</span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg">
              <span className="text-xs text-zinc-500">Seeds:</span>
              <span className={`text-sm font-mono font-bold ${seeds.length >= MAX_SEEDS ? 'text-rose-400' : 'text-zinc-100'}`}>
                {seeds.length}/{MAX_SEEDS}
              </span>
            </div>

            {toneReady && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                <span className="text-xs text-emerald-400">Tone.js active</span>
              </div>
            )}
          </div>

          {/* Seed type legend */}
          <div className="flex flex-wrap gap-3">
            {SEED_TYPES.map(t => (
              <div key={t} className="flex items-center gap-1.5 text-xs text-zinc-500">
                <span>{SEED_EMOJIS[t]}</span>
                <span style={{ color: SEED_COLORS[t] }}>{SEED_LABELS[t]}</span>
              </div>
            ))}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Seed planting + WebRTC sync + Tone.js instruments' }}
      hints={[
        'Plant seeds in different positions for varied pitch and rhythm combinations',
        'Crystal seeds (💎) near the top have longer decay times — more reverberant bells',
        'Drum seeds (🥁) near the center have lower kick frequencies',
        'Mix all 4 types for richest ambient texture — up to 12 seeds total',
        'Click a seed badge below the garden to remove it and stop its instrument',
      ]}
      mdnLinks={[
        { label: 'Tone.js PluckSynth', href: 'https://tonejs.github.io/docs/15.0.4/classes/PluckSynth.html' },
        { label: 'Tone.js Loop', href: 'https://tonejs.github.io/docs/15.0.4/classes/Loop.html' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  )
}
