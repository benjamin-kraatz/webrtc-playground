import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { DemoLayout } from '@/components/layout/DemoLayout'
import { Logger } from '@/lib/logger'
import { DEFAULT_PC_CONFIG } from '@/config/iceServers'

const CODE = `// Map WebRTC stats to Tone.js music parameters
const report = await pc.getStats()
report.forEach(stat => {
  if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
    rtt = (stat.currentRoundTripTime ?? 0) * 1000 // ms
  }
  if (stat.type === 'inbound-rtp') {
    jitter = (stat.jitter ?? 0) * 1000 // ms
    packetsLost = stat.packetsLost ?? 0
  }
  if (stat.type === 'outbound-rtp') {
    const elapsed = stat.timestamp - prevTimestamp
    bitrate = ((stat.bytesSent - prevBytes) * 8) / (elapsed / 1000)
  }
})

// RTT  → synth frequency (200–800 Hz exponential)
const freq = 200 * Math.pow(4, rtt / 200)
synth.set({ oscillator: { frequency: freq } })

// Jitter → vibrato rate (0–8 Hz)
vibrato.frequency.value = (jitter / 50) * 8

// Packet loss → random dropouts
if (Math.random() < packetsLoss / 100) {
  synth.triggerRelease()
}`

interface StatsSnapshot {
  rtt: number       // ms
  jitter: number    // ms
  packetsLost: number
  bitrate: number   // kbps
}

type ToneModule = typeof import('tone')

export default function NetworkSynesthesia() {
  const logger = useMemo(() => new Logger(), [])

  const [isRunning, setIsRunning] = useState(false)
  const [isFlooding, setIsFlooding] = useState(false)
  const [stats, setStats] = useState<StatsSnapshot>({ rtt: 0, jitter: 0, packetsLost: 0, bitrate: 0 })
  const [currentNotes, setCurrentNotes] = useState<string[]>([])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const floodIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pcARef = useRef<RTCPeerConnection | null>(null)
  const pcBRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)

  const toneRef = useRef<ToneModule | null>(null)
  const synthRef = useRef<InstanceType<ToneModule['PolySynth']> | null>(null)
  const vibratoRef = useRef<InstanceType<ToneModule['Vibrato']> | null>(null)
  const reverbRef = useRef<InstanceType<ToneModule['Reverb']> | null>(null)
  const distortionRef = useRef<InstanceType<ToneModule['Distortion']> | null>(null)
  const toneLoopRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const prevBytesRef = useRef(0)
  const prevTimestampRef = useRef(0)
  const statsRef = useRef<StatsSnapshot>({ rtt: 0, jitter: 0, packetsLost: 0, bitrate: 0 })
  const historyRef = useRef<StatsSnapshot[]>([])

  // Canvas draw
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width
    const H = canvas.height
    const s = statsRef.current
    const history = historyRef.current

    ctx.clearRect(0, 0, W, H)
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#080c14')
    bg.addColorStop(1, '#0c0820')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 1
    for (let x = 0; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

    // Draw history lines
    if (history.length > 1) {
      const metrics: Array<{ key: keyof StatsSnapshot; max: number; color: string; label: string }> = [
        { key: 'rtt', max: 200, color: '#60a5fa', label: 'RTT' },
        { key: 'jitter', max: 50, color: '#f472b6', label: 'Jitter' },
        { key: 'bitrate', max: 2000, color: '#34d399', label: 'Bitrate' },
      ]
      const laneH = (H - 20) / 3

      metrics.forEach((m, i) => {
        const yBase = i * laneH + laneH + 10
        ctx.beginPath()
        ctx.strokeStyle = m.color
        ctx.lineWidth = 1.5
        history.forEach((snap, idx) => {
          const x = (idx / Math.max(history.length - 1, 1)) * W
          const raw = (snap[m.key] as number) / m.max
          const clamped = Math.min(1, Math.max(0, raw))
          const y = yBase - clamped * (laneH - 16)
          if (idx === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()

        // Current value glow dot
        const curRaw = Math.min(1, (s[m.key] as number) / m.max)
        const dotX = W - 4
        const dotY = yBase - curRaw * (laneH - 16)
        ctx.beginPath()
        ctx.arc(dotX, dotY, 4, 0, Math.PI * 2)
        ctx.fillStyle = m.color
        ctx.fill()
      })
    }

    // Frequency visualization — standing wave shaped by RTT
    const rttNorm = Math.min(1, s.rtt / 200)
    const freqViz = 200 * Math.pow(4, rttNorm)
    const waveY = H * 0.5
    const waveAmp = 18 + s.jitter * 0.8
    const waveFreq = (freqViz / 800) * 10 + 1
    ctx.beginPath()
    ctx.strokeStyle = `rgba(167, 139, 250, ${0.3 + rttNorm * 0.5})`
    ctx.lineWidth = 2
    const t = Date.now() / 600
    for (let x = 0; x < W; x++) {
      const angle = (x / W) * Math.PI * 2 * waveFreq + t
      const y = waveY + Math.sin(angle) * waveAmp
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    animFrameRef.current = requestAnimationFrame(drawCanvas)
  }, [])

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(drawCanvas)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [drawCanvas])

  const pollStats = useCallback(async () => {
    const pc = pcARef.current
    if (!pc) return

    const report = await pc.getStats()
    let rtt = 0
    let jitter = 0
    let packetsLost = 0
    let bitrateKbps = 0

    report.forEach((stat: RTCStats & Record<string, unknown>) => {
      if (stat.type === 'candidate-pair') {
        const s = stat as unknown as RTCIceCandidatePairStats
        if (s.state === 'succeeded' && s.currentRoundTripTime != null) {
          rtt = s.currentRoundTripTime * 1000
        }
      }
      if (stat.type === 'inbound-rtp') {
        const s = stat as unknown as RTCInboundRtpStreamStats
        if (s.jitter != null) jitter = s.jitter * 1000
        if (s.packetsLost != null) packetsLost = s.packetsLost
      }
      if (stat.type === 'outbound-rtp') {
        const s = stat as unknown as RTCOutboundRtpStreamStats
        const bytesSent = s.bytesSent ?? 0
        const now = stat.timestamp as number
        if (prevTimestampRef.current > 0) {
          const elapsed = (now - prevTimestampRef.current) / 1000
          bitrateKbps = ((bytesSent - prevBytesRef.current) * 8) / (elapsed * 1000)
        }
        prevBytesRef.current = bytesSent
        prevTimestampRef.current = stat.timestamp as number
      }
    })

    const snap: StatsSnapshot = {
      rtt: Math.round(rtt * 10) / 10,
      jitter: Math.round(jitter * 10) / 10,
      packetsLost,
      bitrate: Math.round(bitrateKbps),
    }
    statsRef.current = snap
    setStats({ ...snap })

    historyRef.current = [...historyRef.current.slice(-119), snap]

    // Apply to Tone.js
    const Tone = toneRef.current
    const synth = synthRef.current
    const vibrato = vibratoRef.current
    const distortion = distortionRef.current
    if (!Tone || !synth || !vibrato || !distortion) return

    // RTT → frequency
    const rttNorm = Math.min(1, rtt / 200)
    const targetFreq = 200 * Math.pow(4, rttNorm)

    // Jitter → vibrato rate
    const vibratoRate = Math.min(8, (jitter / 50) * 8)
    vibrato.frequency.value = Math.max(0.1, vibratoRate)

    // RTT > 100ms → distortion
    const distAmt = rtt > 100 ? Math.min(0.9, (rtt - 100) / 200) : 0
    distortion.distortion = distAmt

    // Bitrate → number of harmonics (chord notes)
    const harmonicsCount = Math.max(1, Math.min(5, Math.floor((bitrateKbps / 2000) * 5) + 1))

    // Build chord
    const baseNote = targetFreq
    const notes: string[] = []
    const ratios = [1, 1.25, 1.5, 1.75, 2]
    for (let i = 0; i < harmonicsCount; i++) {
      const freq = baseNote * ratios[i]
      const octave = Math.floor(Math.log2(freq / 16.35))
      const semitone = Math.round(12 * Math.log2(freq / (16.35 * Math.pow(2, octave))))
      const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
      const noteName = `${noteNames[semitone % 12]}${Math.min(7, Math.max(1, octave))}`
      notes.push(noteName)
    }
    setCurrentNotes(notes.slice(0, harmonicsCount))

    // Packet loss → random dropout
    const lossPct = packetsLost > 0 ? Math.min(30, packetsLost) : 0
    if (Math.random() < lossPct / 100) {
      synth.releaseAll()
    }
  }, [])

  const startToneLoop = useCallback((Tone: ToneModule) => {
    const synth = synthRef.current
    if (!synth) return

    toneLoopRef.current = setInterval(() => {
      const s = statsRef.current
      const rttNorm = Math.min(1, s.rtt / 200)
      const baseFreq = 200 * Math.pow(4, rttNorm)

      const bitrateKbps = s.bitrate
      const count = Math.max(1, Math.min(5, Math.floor((bitrateKbps / 2000) * 5) + 1))
      const ratios = [1, 1.25, 1.5, 1.75, 2]
      const noteFreqs = ratios.slice(0, count).map(r => baseFreq * r)

      const toNoteName = (freq: number): string => {
        const midiNote = 69 + 12 * Math.log2(freq / 440)
        const midi = Math.round(Math.max(24, Math.min(96, midiNote)))
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        const octave = Math.floor(midi / 12) - 1
        const name = noteNames[midi % 12]
        return `${name}${octave}`
      }

      const notes = noteFreqs.map(toNoteName)
      synth.triggerAttackRelease(notes, '4n', Tone.now())
    }, 800)
  }, [])

  const handleStart = useCallback(async () => {
    if (isRunning) {
      if (toneLoopRef.current) clearInterval(toneLoopRef.current)
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current)
      synthRef.current?.dispose()
      vibratoRef.current?.dispose()
      reverbRef.current?.dispose()
      distortionRef.current?.dispose()
      synthRef.current = null
      vibratoRef.current = null
      reverbRef.current = null
      distortionRef.current = null
      pcARef.current?.close()
      pcBRef.current?.close()
      pcARef.current = null
      pcBRef.current = null
      setIsRunning(false)
      setIsFlooding(false)
      setCurrentNotes([])
      logger.info('Stopped Network Synesthesia')
      return
    }

    logger.info('Loading Tone.js...')
    const Tone = await import('tone')
    await Tone.start()
    toneRef.current = Tone

    const reverb = new Tone.Reverb({ decay: 2, wet: 0.35 }).toDestination()
    const distortion = new Tone.Distortion(0).connect(reverb)
    const vibrato = new Tone.Vibrato(2, 0.3).connect(distortion)
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.8 },
    }).connect(vibrato)

    synthRef.current = synth
    vibratoRef.current = vibrato
    reverbRef.current = reverb
    distortionRef.current = distortion

    logger.success('Tone.js instruments ready')

    // Setup loopback RTCPeerConnection
    logger.info('Setting up WebRTC loopback...')
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG)
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG)
    pcARef.current = pcA
    pcBRef.current = pcB

    pcA.onicecandidate = ev => { if (ev.candidate) pcB.addIceCandidate(ev.candidate).catch(() => {}) }
    pcB.onicecandidate = ev => { if (ev.candidate) pcA.addIceCandidate(ev.candidate).catch(() => {}) }

    const dc = pcA.createDataChannel('synesthesia', { ordered: false, maxRetransmits: 0 })
    dataChannelRef.current = dc
    dc.onopen = () => logger.success('Data channel open — WebRTC loopback established')

    pcB.ondatachannel = ev => { ev.channel.onmessage = () => {} }

    const offer = await pcA.createOffer()
    await pcA.setLocalDescription(offer)
    await pcB.setRemoteDescription(offer)
    const answer = await pcB.createAnswer()
    await pcB.setLocalDescription(answer)
    await pcA.setRemoteDescription(answer)

    setIsRunning(true)
    logger.success('Network Synesthesia running — your connection quality is now music')

    statsIntervalRef.current = setInterval(pollStats, 500)
    startToneLoop(Tone)
  }, [isRunning, pollStats, startToneLoop, logger])

  const handleFlood = useCallback(() => {
    if (isFlooding) {
      if (floodIntervalRef.current) clearInterval(floodIntervalRef.current)
      floodIntervalRef.current = null
      setIsFlooding(false)
      logger.info('Stopped artificial jitter flooding')
      return
    }

    const dc = dataChannelRef.current
    if (!dc || dc.readyState !== 'open') {
      logger.warn('Data channel not open — start the demo first')
      return
    }

    logger.warn('Flooding data channel with large messages to degrade stats...')
    const payload = new Uint8Array(16384).fill(0xFF) // 16KB chunks
    floodIntervalRef.current = setInterval(() => {
      if (dc.readyState === 'open') {
        try { dc.send(payload) } catch (_) {}
      }
    }, 20)
    setIsFlooding(true)
  }, [isFlooding, logger])

  const handleReset = useCallback(() => {
    if (floodIntervalRef.current) clearInterval(floodIntervalRef.current)
    floodIntervalRef.current = null
    setIsFlooding(false)
    statsRef.current = { rtt: 0, jitter: 0, packetsLost: 0, bitrate: 0 }
    historyRef.current = []
    prevBytesRef.current = 0
    prevTimestampRef.current = 0
    setStats({ rtt: 0, jitter: 0, packetsLost: 0, bitrate: 0 })
    logger.info('Stats reset')
  }, [logger])

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current)
      if (toneLoopRef.current) clearInterval(toneLoopRef.current)
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current)
      if (floodIntervalRef.current) clearInterval(floodIntervalRef.current)
      synthRef.current?.dispose()
      vibratoRef.current?.dispose()
      reverbRef.current?.dispose()
      distortionRef.current?.dispose()
      pcARef.current?.close()
      pcBRef.current?.close()
    }
  }, [])

  const statBadgeColor = (val: number, warn: number, danger: number) => {
    if (val >= danger) return 'bg-rose-900/60 text-rose-300 border-rose-700/50'
    if (val >= warn) return 'bg-amber-900/60 text-amber-300 border-amber-700/50'
    return 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50'
  }

  return (
    <DemoLayout
      title="Network Synesthesia"
      difficulty="advanced"
      description="WebRTC connection quality converted to live music via Tone.js. Your network sounds."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Synesthesia</strong> is a neurological phenomenon where one sense triggers another.
            This demo translates WebRTC network statistics into real-time music using Tone.js:
          </p>
          <ul className="list-disc list-inside space-y-1 text-zinc-400">
            <li><strong className="text-blue-400">RTT</strong> → oscillator frequency (low ping = low pitch, high ping = high pitch)</li>
            <li><strong className="text-pink-400">Jitter</strong> → vibrato rate (unstable connection = wobbling pitch)</li>
            <li><strong className="text-rose-400">Packet loss</strong> → random audio dropouts</li>
            <li><strong className="text-emerald-400">Bitrate</strong> → number of harmonics (more data = richer chord)</li>
            <li><strong className="text-amber-400">High RTT (&gt;100ms)</strong> → adds audio distortion</li>
          </ul>
          <p className="text-zinc-500 text-xs">
            A loopback RTCPeerConnection generates real stats. Use "Add Artificial Jitter" to degrade
            the connection and hear the musical change.
          </p>
        </div>
      }
      demo={
        <div className="space-y-5">
          {/* Canvas */}
          <div className="bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800">
            <canvas ref={canvasRef} width={560} height={200} className="w-full" />
          </div>

          {/* Stats badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'RTT', value: `${stats.rtt.toFixed(1)} ms`, raw: stats.rtt, warn: 50, danger: 100 },
              { label: 'Jitter', value: `${stats.jitter.toFixed(1)} ms`, raw: stats.jitter, warn: 15, danger: 30 },
              { label: 'Pkt Lost', value: `${stats.packetsLost}`, raw: stats.packetsLost, warn: 5, danger: 20 },
              { label: 'Bitrate', value: `${stats.bitrate} kbps`, raw: 0, warn: 999, danger: 9999 },
            ].map(s => (
              <div key={s.label} className={`px-3 py-2 rounded-lg border text-center ${statBadgeColor(s.raw, s.warn, s.danger)}`}>
                <div className="text-xs opacity-70 uppercase tracking-wider">{s.label}</div>
                <div className="text-lg font-mono font-bold mt-0.5">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Current notes */}
          {currentNotes.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-zinc-500">Playing:</span>
              {currentNotes.map((n, i) => (
                <span key={i} className="px-2 py-0.5 bg-purple-900/50 border border-purple-700/50 text-purple-300 text-xs rounded-md font-mono">
                  {n}
                </span>
              ))}
            </div>
          )}

          {/* Controls */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleStart}
              className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                isRunning
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {isRunning ? '⏹ Stop' : '▶ Start Synesthesia'}
            </button>

            <button
              onClick={handleFlood}
              disabled={!isRunning}
              className={`px-4 py-2 text-sm font-medium rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                isFlooding
                  ? 'bg-amber-700 border-amber-600 text-white hover:bg-amber-600'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
              }`}
            >
              {isFlooding ? '🌊 Flooding...' : 'Add Artificial Jitter'}
            </button>

            <button
              onClick={handleReset}
              disabled={!isRunning}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Reset Stats
            </button>

            {isRunning && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                <span className="text-xs text-purple-400">Sonifying network…</span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500/60 inline-block" /> RTT history</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-pink-500/60 inline-block" /> Jitter history</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500/60 inline-block" /> Bitrate history</span>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'WebRTC stats → Tone.js music parameters' }}
      hints={[
        'On a local loopback, RTT is near 0 — use "Add Jitter" to hear the effect',
        'Bitrate increases as data channel floods — more harmonics appear in the chord',
        'The music sounds chaotic at high jitter — that IS the data, made audible',
      ]}
      mdnLinks={[
        { label: 'RTCPeerConnection.getStats()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats' },
        { label: 'Tone.js Docs', href: 'https://tonejs.github.io/' },
        { label: 'RTCIceCandidatePairStats', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidatePairStats' },
      ]}
    />
  )
}
