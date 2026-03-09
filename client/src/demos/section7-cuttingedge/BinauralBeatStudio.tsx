import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { DemoLayout } from '@/components/layout/DemoLayout'
import { Logger } from '@/lib/logger'
import { DEFAULT_PC_CONFIG } from '@/config/iceServers'

const CODE = `// Binaural beats via Web Audio API — stereo panning per oscillator
const audioCtx = new AudioContext()
const merger = audioCtx.createChannelMerger(2)
const gainNode = audioCtx.createGain()
gainNode.gain.value = 0.4

// Left ear: base frequency
const oscL = audioCtx.createOscillator()
const gainL = audioCtx.createGain()
oscL.frequency.value = baseFreq      // e.g. 200 Hz
gainL.gain.value = 1
oscL.connect(gainL)
gainL.connect(merger, 0, 0) // → left channel

// Right ear: base + beat frequency
const oscR = audioCtx.createOscillator()
const gainR = audioCtx.createGain()
oscR.frequency.value = baseFreq + beatFreq // e.g. 210 Hz
gainR.gain.value = 1
oscR.connect(gainR)
gainR.connect(merger, 0, 1) // → right channel

merger.connect(gainNode)
gainNode.connect(audioCtx.destination)
oscL.start()
oscR.start()

// The brain perceives a 10 Hz "beat" between 200 Hz and 210 Hz
// → Alpha wave entrainment (relaxed focus)`

interface Preset {
  name: string
  beat: number
  base: number
  color: string
  description: string
}

const PRESETS: Preset[] = [
  { name: 'Delta', beat: 2, base: 100, color: '#6366f1', description: 'Deep sleep (0.5–4 Hz)' },
  { name: 'Theta', beat: 6, base: 200, color: '#8b5cf6', description: 'Meditation (4–8 Hz)' },
  { name: 'Alpha', beat: 10, base: 200, color: '#06b6d4', description: 'Relaxed focus (8–13 Hz)' },
  { name: 'Beta', beat: 20, base: 300, color: '#10b981', description: 'Active focus (13–30 Hz)' },
  { name: 'Gamma', beat: 40, base: 400, color: '#f59e0b', description: 'Peak cognition (30–50 Hz)' },
]

export default function BinauralBeatStudio() {
  const logger = useMemo(() => new Logger(), [])

  const [isPlaying, setIsPlaying] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [baseFreq, setBaseFreq] = useState(200)
  const [beatFreq, setBeatFreq] = useState(10)
  const [volume, setVolume] = useState(40)
  const [activePreset, setActivePreset] = useState<string>('Alpha')

  const audioCtxRef = useRef<AudioContext | null>(null)
  const oscLRef = useRef<OscillatorNode | null>(null)
  const oscRRef = useRef<OscillatorNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const mergerRef = useRef<ChannelMergerNode | null>(null)
  const streamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const phaseRef = useRef(0)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pcRemoteRef = useRef<RTCPeerConnection | null>(null)

  // Live refs for slider values so canvas animation always sees latest
  const baseFreqRef = useRef(baseFreq)
  const beatFreqRef = useRef(beatFreq)
  baseFreqRef.current = baseFreq
  beatFreqRef.current = beatFreq

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width
    const H = canvas.height

    ctx.clearRect(0, 0, W, H)

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0a0a1a')
    bg.addColorStop(1, '#0f0a1e')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 1
    for (let y = 0; y <= H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }

    const phase = phaseRef.current
    const bF = baseFreqRef.current
    const beatF = beatFreqRef.current

    // Normalize frequencies for visual — scale so waves look good
    const scaleL = (bF / 500) * 0.8 + 0.2
    const scaleR = ((bF + beatF) / 540) * 0.8 + 0.2
    const scaleBeat = (beatF / 40) * 0.5 + 0.1

    const centerY = H / 2
    const amp = H * 0.28

    // Left ear wave (blue)
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.85)'
    ctx.lineWidth = 2
    for (let x = 0; x < W; x++) {
      const t = (x / W) * Math.PI * 2 * 6 * scaleL + phase * scaleL
      const y = centerY - amp * 0.6 * Math.sin(t)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Right ear wave (pink)
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.85)'
    ctx.lineWidth = 2
    for (let x = 0; x < W; x++) {
      const t = (x / W) * Math.PI * 2 * 6 * scaleR + phase * scaleR
      const y = centerY + amp * 0.6 * Math.sin(t)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Perceived beat wave (purple dashed)
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.7)'
    ctx.lineWidth = 2.5
    ctx.setLineDash([8, 6])
    for (let x = 0; x < W; x++) {
      const t = (x / W) * Math.PI * 2 * 4 * scaleBeat + phase * scaleBeat * 0.3
      const envelope = Math.abs(Math.sin((x / W) * Math.PI * 2 * scaleBeat * 2 + phase * 0.05))
      const y = centerY + amp * 0.85 * Math.sin(t) * envelope
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.setLineDash([])

    // Labels
    ctx.font = '11px monospace'
    ctx.fillStyle = 'rgba(96, 165, 250, 0.9)'
    ctx.fillText(`Left ear: ${bF} Hz`, 12, 20)
    ctx.fillStyle = 'rgba(244, 114, 182, 0.9)'
    ctx.fillText(`Right ear: ${bF + beatF} Hz`, 12, 36)
    ctx.fillStyle = 'rgba(167, 139, 250, 0.9)'
    ctx.fillText(`Beat perceived: ${beatF} Hz`, 12, 52)

    // Advance phase
    phaseRef.current += 0.018
    animFrameRef.current = requestAnimationFrame(drawCanvas)
  }, [])

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(drawCanvas)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [drawCanvas])

  const buildAudioGraph = useCallback((ctx: AudioContext) => {
    const merger = ctx.createChannelMerger(2)
    const gainNode = ctx.createGain()
    gainNode.gain.value = volume / 100

    const oscL = ctx.createOscillator()
    oscL.type = 'sine'
    oscL.frequency.value = baseFreq

    const oscR = ctx.createOscillator()
    oscR.type = 'sine'
    oscR.frequency.value = baseFreq + beatFreq

    const gainL = ctx.createGain()
    const gainR = ctx.createGain()
    gainL.gain.value = 1
    gainR.gain.value = 1

    oscL.connect(gainL)
    oscR.connect(gainR)
    gainL.connect(merger, 0, 0)
    gainR.connect(merger, 0, 1)
    merger.connect(gainNode)

    // Stream destination for WebRTC
    const streamDest = ctx.createMediaStreamDestination()
    gainNode.connect(streamDest)
    gainNode.connect(ctx.destination)

    oscL.start()
    oscR.start()

    mergerRef.current = merger
    gainNodeRef.current = gainNode
    oscLRef.current = oscL
    oscRRef.current = oscR
    streamDestRef.current = streamDest
  }, [baseFreq, beatFreq, volume])

  const handleStart = useCallback(async () => {
    if (isPlaying) {
      oscLRef.current?.stop()
      oscRRef.current?.stop()
      await audioCtxRef.current?.close()
      audioCtxRef.current = null
      oscLRef.current = null
      oscRRef.current = null
      gainNodeRef.current = null
      mergerRef.current = null
      streamDestRef.current = null
      setIsPlaying(false)
      setIsStreaming(false)
      logger.info('Stopped binaural beat playback')
      return
    }

    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    buildAudioGraph(ctx)
    setIsPlaying(true)
    logger.success(`Started: ${baseFreq} Hz base + ${beatFreq} Hz beat (${activePreset} state)`)
  }, [isPlaying, buildAudioGraph, baseFreq, beatFreq, activePreset, logger])

  const handlePreset = useCallback((preset: Preset) => {
    setActivePreset(preset.name)
    setBaseFreq(preset.base)
    setBeatFreq(preset.beat)
    baseFreqRef.current = preset.base
    beatFreqRef.current = preset.beat

    if (oscLRef.current && oscRRef.current) {
      oscLRef.current.frequency.setTargetAtTime(preset.base, audioCtxRef.current!.currentTime, 0.1)
      oscRRef.current.frequency.setTargetAtTime(preset.base + preset.beat, audioCtxRef.current!.currentTime, 0.1)
    }
    logger.info(`Preset: ${preset.name} — ${preset.description} (base=${preset.base}Hz, beat=${preset.beat}Hz)`)
  }, [logger])

  const handleBaseFreqChange = useCallback((val: number) => {
    setBaseFreq(val)
    baseFreqRef.current = val
    if (oscLRef.current && audioCtxRef.current) {
      oscLRef.current.frequency.setTargetAtTime(val, audioCtxRef.current.currentTime, 0.05)
    }
    if (oscRRef.current && audioCtxRef.current) {
      oscRRef.current.frequency.setTargetAtTime(val + beatFreqRef.current, audioCtxRef.current.currentTime, 0.05)
    }
  }, [])

  const handleBeatFreqChange = useCallback((val: number) => {
    setBeatFreq(val)
    beatFreqRef.current = val
    if (oscRRef.current && audioCtxRef.current) {
      oscRRef.current.frequency.setTargetAtTime(baseFreqRef.current + val, audioCtxRef.current.currentTime, 0.05)
    }
  }, [])

  const handleVolumeChange = useCallback((val: number) => {
    setVolume(val)
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(val / 100, audioCtxRef.current.currentTime, 0.05)
    }
  }, [])

  const handleStream = useCallback(async () => {
    if (!streamDestRef.current || !isPlaying) {
      logger.warn('Start playback before streaming via WebRTC')
      return
    }
    if (isStreaming) {
      pcRef.current?.close()
      pcRemoteRef.current?.close()
      pcRef.current = null
      pcRemoteRef.current = null
      setIsStreaming(false)
      logger.info('Stopped WebRTC loopback stream')
      return
    }

    logger.info('Setting up WebRTC loopback for audio stream...')
    const stream = streamDestRef.current.stream
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG)
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG)
    pcRef.current = pcA
    pcRemoteRef.current = pcB

    pcA.onicecandidate = (ev) => { if (ev.candidate) pcB.addIceCandidate(ev.candidate) }
    pcB.onicecandidate = (ev) => { if (ev.candidate) pcA.addIceCandidate(ev.candidate) }

    pcB.ontrack = (ev) => {
      const audio = new Audio()
      audio.srcObject = ev.streams[0]
      audio.volume = 0 // loopback — audio already playing locally
      audio.play().catch(() => {})
      logger.success('WebRTC loopback: audio track received on remote end')
    }

    stream.getTracks().forEach(t => pcA.addTrack(t, stream))

    const offer = await pcA.createOffer()
    await pcA.setLocalDescription(offer)
    await pcB.setRemoteDescription(offer)
    const answer = await pcB.createAnswer()
    await pcB.setLocalDescription(answer)
    await pcA.setRemoteDescription(answer)

    setIsStreaming(true)
    logger.success('WebRTC loopback established — binaural audio flowing over peer connection')
  }, [isPlaying, isStreaming, logger])

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current)
      oscLRef.current?.stop()
      oscRRef.current?.stop()
      audioCtxRef.current?.close()
      pcRef.current?.close()
      pcRemoteRef.current?.close()
    }
  }, [])

  return (
    <DemoLayout
      title="Binaural Beat Studio"
      difficulty="advanced"
      description="Generate binaural beats for brainwave entrainment using Web Audio API, streamed over WebRTC."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Binaural beats</strong> occur when two slightly different frequencies are played separately
            into each ear. Your brain perceives the mathematical difference as a rhythmic "beat." This beat
            frequency can entrain brainwave activity toward specific states — from deep sleep (Delta) to
            peak cognition (Gamma).
          </p>
          <p>
            The left oscillator plays the <strong>base frequency</strong>; the right oscillator plays
            <strong> base + beat frequency</strong>. The brain does the rest. Audio is routed through a
            stereo <code>ChannelMergerNode</code> and can be streamed over a WebRTC loopback connection.
          </p>
          <p className="text-amber-400/80 font-medium">
            🎧 HEADPHONES REQUIRED — binaural beats only work with proper stereo headphones. Speakers
            mix both channels before reaching your ears, eliminating the effect entirely.
          </p>
        </div>
      }
      demo={
        <div className="space-y-5">
          {/* Headphone warning banner */}
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-950/40 border border-amber-700/50 rounded-xl">
            <span className="text-2xl">🎧</span>
            <div>
              <p className="text-amber-300 font-semibold text-sm">Headphones Required</p>
              <p className="text-amber-400/70 text-xs">Binaural beats only work with proper stereo headphones — not speakers.</p>
            </div>
          </div>

          {/* Canvas visualization */}
          <div className="bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800">
            <canvas ref={canvasRef} width={560} height={220} className="w-full" />
          </div>

          {/* Presets */}
          <div>
            <p className="text-xs text-zinc-500 mb-2 uppercase tracking-wider">Brainwave Presets</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(preset => (
                <button
                  key={preset.name}
                  onClick={() => handlePreset(preset)}
                  title={preset.description}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    activePreset === preset.name
                      ? 'border-transparent text-white'
                      : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 bg-zinc-900'
                  }`}
                  style={activePreset === preset.name ? { backgroundColor: preset.color, borderColor: preset.color } : {}}
                >
                  {preset.name}
                  <span className="ml-1.5 text-xs opacity-70">{preset.beat}Hz</span>
                </button>
              ))}
            </div>
            {activePreset && (
              <p className="text-xs text-zinc-500 mt-1.5">
                {PRESETS.find(p => p.name === activePreset)?.description}
              </p>
            )}
          </div>

          {/* Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">
                Base Frequency: <span className="text-zinc-200 font-mono">{baseFreq} Hz</span>
              </label>
              <input
                type="range" min={50} max={500} step={5} value={baseFreq}
                onChange={e => handleBaseFreqChange(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">
                Beat Frequency: <span className="text-zinc-200 font-mono">{beatFreq} Hz</span>
              </label>
              <input
                type="range" min={0.5} max={40} step={0.5} value={beatFreq}
                onChange={e => handleBeatFreqChange(Number(e.target.value))}
                className="w-full accent-purple-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">
                Volume: <span className="text-zinc-200 font-mono">{volume}%</span>
              </label>
              <input
                type="range" min={0} max={100} step={1} value={volume}
                onChange={e => handleVolumeChange(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={handleStart}
              className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                isPlaying
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {isPlaying ? '⏹ Stop' : '▶ Start Binaural Beats'}
            </button>

            <button
              onClick={handleStream}
              disabled={!isPlaying}
              className={`px-4 py-2 text-sm font-medium rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                isStreaming
                  ? 'bg-emerald-700 border-emerald-600 text-white hover:bg-emerald-600'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
              }`}
            >
              {isStreaming ? '✓ Streaming via WebRTC' : 'Stream via WebRTC'}
            </button>

            {isPlaying && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-emerald-400">Playing</span>
                <span className="text-xs text-zinc-500 ml-2">
                  L: {baseFreq}Hz / R: {baseFreq + beatFreq}Hz / Beat: {beatFreq}Hz
                </span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-blue-400 inline-block rounded" />Left ear</span>
            <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-pink-400 inline-block rounded" />Right ear</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-5" style={{ borderBottom: '2px dashed #a78bfa' }} />
              Perceived beat
            </span>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Stereo binaural beat routing via ChannelMergerNode' }}
      hints={[
        'Use quality over-ear headphones for strongest entrainment effect',
        'Start with Alpha (10 Hz) for focused work, Theta (6 Hz) for meditation',
        'Allow 5–10 minutes for the brain to synchronize with the beat frequency',
        'Binaural beats are subtle — turn volume up to 50%+ for best results',
      ]}
      mdnLinks={[
        { label: 'ChannelMergerNode', href: 'https://developer.mozilla.org/en-US/docs/Web/API/ChannelMergerNode' },
        { label: 'OscillatorNode', href: 'https://developer.mozilla.org/en-US/docs/Web/API/OscillatorNode' },
        { label: 'createMediaStreamDestination', href: 'https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination' },
      ]}
    />
  )
}
