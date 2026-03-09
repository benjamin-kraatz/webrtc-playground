import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Logger } from '@/lib/logger';

/** Resolution options for capture and processing. Lower = faster ML; higher = sharper. */
const RESOLUTIONS = [
  { label: '320×240', width: 320, height: 240 },
  { label: '640×480', width: 640, height: 480 },
  { label: '1280×720 (HD)', width: 1280, height: 720 },
  { label: '1920×1080 (FHD)', width: 1920, height: 1080 },
] as const;

const CODE = `// TensorFlow.js body segmentation
import * as bodySegmentation from '@tensorflow-models/body-segmentation';

const model = await bodySegmentation.createSegmenter(
  bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
  { runtime: 'tfjs', modelType: 'general' }
);

// Run segmentation on each frame
const segmentation = await model.segmentPeople(videoElement);
const mask = await bodySegmentation.toBinaryMask(segmentation);

// Draw person on canvas with blurred background
ctx.filter = 'blur(15px)';
ctx.drawImage(videoElement, 0, 0); // blurred background
ctx.filter = 'none';
ctx.putImageData(mask, 0, 0);     // person cutout`;

interface EmojiParticle {
  x: number; y: number; emoji: string; size: number;
  life: number; vy: number; rotation: number; rotSpeed: number;
}

const EMOJI_LIST = ['🎉','🌟','💫','✨','🦋','🌸','🍀','🎈','🌈','🦄','⭐','🔥','💥','🎊','🎁','🎶','💎','🌺','🚀','👾','💜','💚','💙','🧡','❤️','🌙','☀️','⚡','🌊','🍄','🦚','🎯','🪄','🫧','🌀'];

const MODES = [
  { id: 'blur', label: '🌫 Blur' },
  { id: 'solid', label: '🎨 Solid' },
  { id: 'gradient', label: '🌈 Gradient' },
  { id: 'none', label: '🔲 Remove' },
  { id: 'pixelate', label: '🧱 Pixelate' },
  { id: 'greyscale', label: '⚪ Greyscale' },
  { id: 'invert', label: '🔄 Invert' },
  { id: 'posterize', label: '🎭 Posterize' },
  { id: 'vignette', label: '⭕ Vignette' },
  { id: 'ripple', label: '🌊 Ripple' },
  { id: 'glitch', label: '⚡ Glitch' },
  { id: 'starfield', label: '🌌 Starfield' },
  { id: 'thermal', label: '🌡️ Thermal' },
  { id: 'sketch', label: '✏️ Neon Sketch' },
  { id: 'custom-image', label: '📸 Custom BG' },
  { id: 'pencil', label: '🖊️ Pencil' },
  { id: 'emoji', label: '🎉 Emoji Pop' },
  { id: 'halo', label: '✨ Halo' },
  { id: 'matrix', label: '💾 Matrix' },
  { id: 'duotone', label: '🎨 Duotone' },
] as const;

type BgMode = (typeof MODES)[number]['id'];

const DEFAULT_PARAMS = {
  blurAmount: 15,
  bgColor: '#1e1b4b',
  bgColor2: '#4c1d95',
  gradientAngle: 135,
  pixelSize: 12,
  posterizeLevel: 4,
  vignetteStrength: 0.8,
  maskThreshold: 0.5,
  rippleAmp: 12,
  rippleFreq: 0.04,
  rippleSpeed: 1.5,
  glitchIntensity: 0.5,
  starSpeed: 0.006,
  sketchThreshold: 40,
  sketchColor: '#00ffff',
  haloColor: '#7c3aed',
  haloSize: 22,
  haloIntensity: 0.85,
  matrixSpeed: 0.5,
  emojiDensity: 0.5,
  duotoneShadow: '#1e0a3c',
  duotoneHighlight: '#f4e0ff',
};

export default function VirtualBackground() {
  const logger = useMemo(() => new Logger(), []);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [active, setActive] = useState(false);
  const [bgMode, setBgMode] = useState<BgMode>('blur');
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]>(RESOLUTIONS[1]);
  const [fps, setFps] = useState(15);
  const [settings, setSettings] = useState<{ width: number; height: number; frameRate?: number } | null>(null);
  const resolutionRef = useRef(resolution);
  const fpsRef = useRef(fps);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<unknown>(null);
  const bgModeRef = useRef<BgMode>('blur');
  const paramsRef = useRef(DEFAULT_PARAMS);
  const customImageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { bgModeRef.current = bgMode; }, [bgMode]);
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { resolutionRef.current = resolution; fpsRef.current = fps; }, [resolution, fps]);

  const handleStart = async () => {
    setLoading(true);
    setLoadProgress(10);
    try {
      logger.info('Loading TensorFlow.js body segmentation model (~15MB)...');
      const [bodySegmentation, tf] = await Promise.all([
        import('@tensorflow-models/body-segmentation'),
        import('@tensorflow/tfjs'),
      ]);
      setLoadProgress(60);
      await (tf as unknown as { ready: () => Promise<void> }).ready();
      setLoadProgress(80);

      const model = await (bodySegmentation as {
        createSegmenter: (model: string, opts: object) => Promise<unknown>;
        SupportedModels: { MediaPipeSelfieSegmentation: string };
      }).createSegmenter(
        bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
        { runtime: 'tfjs', modelType: 'general' }
      );
      modelRef.current = model;
      setLoadProgress(100);
      logger.success('Model loaded!');

      const r = resolutionRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: r.width },
          height: { ideal: r.height },
          frameRate: { ideal: fpsRef.current },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) resolve();
        else video.addEventListener('loadeddata', () => resolve(), { once: true });
      });

      const applied = stream.getVideoTracks()[0].getSettings();
      const cw = applied.width ?? r.width;
      const ch = applied.height ?? r.height;
      setSettings({ width: cw, height: ch, frameRate: applied.frameRate });

      const canvas = canvasRef.current!;
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d')!;

      const segModel = model as { segmentPeople: (el: HTMLVideoElement | HTMLCanvasElement) => Promise<unknown[]> };
      const bsModule = bodySegmentation as {
        toBinaryMask: (segs: unknown[], fg?: object, bg?: object, drawContour?: boolean, fgThreshold?: number) => Promise<ImageData | null>;
      };
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = cw;
      frameCanvas.height = ch;
      const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true })!;

      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = cw;
      bgCanvas.height = ch;
      const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true })!;

      const maskCanvas = document.createElement('canvas');
      const maskCtx = maskCanvas.getContext('2d')!;
      const scaledMaskCanvas = document.createElement('canvas');
      scaledMaskCanvas.width = cw;
      scaledMaskCanvas.height = ch;
      const scaledMaskCtx = scaledMaskCanvas.getContext('2d', { willReadFrequently: true })!;
      const pixelateBuffer = document.createElement('canvas');
      const pixelateCtx = pixelateBuffer.getContext('2d')!;
      const haloCanvas = document.createElement('canvas');
      haloCanvas.width = cw;
      haloCanvas.height = ch;
      const haloCtx = haloCanvas.getContext('2d')!;

      let animTime = 0;
      const stars: Array<{ x: number; y: number; z: number; pz: number }> = [];
      let matrixDrops: number[] = [];
      const emojiParticles: EmojiParticle[] = [];

      const render = async () => {
        if (!modelRef.current) return;
        animTime += 0.05;
        try {
          let cw = video.videoWidth;
          let ch = video.videoHeight;
          if (video.readyState < 2 || cw === 0 || ch === 0) {
            animRef.current = requestAnimationFrame(() => { render().catch(console.error); });
            return;
          }
          if (frameCanvas.width !== cw || frameCanvas.height !== ch) {
            frameCanvas.width = cw;
            frameCanvas.height = ch;
            bgCanvas.width = cw;
            bgCanvas.height = ch;
            scaledMaskCanvas.width = cw;
            scaledMaskCanvas.height = ch;
            haloCanvas.width = cw;
            haloCanvas.height = ch;
            canvas.width = cw;
            canvas.height = ch;
            matrixDrops = [];
            emojiParticles.length = 0;
          }

          frameCtx.clearRect(0, 0, cw, ch);
          frameCtx.drawImage(video, 0, 0, cw, ch);
          const segmentations = await segModel.segmentPeople(frameCanvas);

          const p = paramsRef.current;
          const mode = bgModeRef.current;
          if (mode === 'matrix') {
            bgCtx.fillStyle = 'rgba(0,0,0,0.15)';
            bgCtx.fillRect(0, 0, cw, ch);
          } else {
            bgCtx.clearRect(0, 0, cw, ch);
          }

          if (mode === 'blur') {
            bgCtx.save();
            bgCtx.filter = `blur(${p.blurAmount}px)`;
            bgCtx.drawImage(video, 0, 0, cw, ch);
            bgCtx.restore();
          } else if (mode === 'solid') {
            bgCtx.fillStyle = p.bgColor;
            bgCtx.fillRect(0, 0, cw, ch);
          } else if (mode === 'gradient') {
            const rad = (p.gradientAngle * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const grad = bgCtx.createLinearGradient(
              cw / 2 - cos * cw,
              ch / 2 - sin * ch,
              cw / 2 + cos * cw,
              ch / 2 + sin * ch
            );
            grad.addColorStop(0, p.bgColor);
            grad.addColorStop(1, p.bgColor2);
            bgCtx.fillStyle = grad;
            bgCtx.fillRect(0, 0, cw, ch);
          } else if (mode === 'pixelate') {
            const size = Math.max(2, p.pixelSize);
            const smallW = Math.max(8, Math.floor(cw / size));
            const smallH = Math.max(8, Math.floor(ch / size));
            pixelateBuffer.width = smallW;
            pixelateBuffer.height = smallH;
            pixelateCtx.drawImage(video, 0, 0, smallW, smallH);
            bgCtx.imageSmoothingEnabled = false;
            bgCtx.drawImage(pixelateBuffer, 0, 0, smallW, smallH, 0, 0, cw, ch);
            bgCtx.imageSmoothingEnabled = true;
          } else if (mode === 'ripple') {
            bgCtx.save();
            bgCtx.filter = `blur(${p.blurAmount}px)`;
            bgCtx.drawImage(video, 0, 0, cw, ch);
            bgCtx.restore();
          } else if (mode === 'glitch') {
            bgCtx.save();
            bgCtx.filter = 'blur(2px)';
            bgCtx.drawImage(video, 0, 0, cw, ch);
            bgCtx.restore();
          } else if (mode === 'starfield') {
            bgCtx.fillStyle = '#020209';
            bgCtx.fillRect(0, 0, cw, ch);
            if (stars.length === 0) {
              for (let s = 0; s < 250; s++) {
                stars.push({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random(), pz: 1 });
              }
            }
            const cx2 = cw / 2, cy2 = ch / 2;
            for (const star of stars) {
              star.pz = star.z;
              star.z -= p.starSpeed;
              if (star.z <= 0) { star.x = (Math.random() - 0.5) * 2; star.y = (Math.random() - 0.5) * 2; star.z = 1; star.pz = 1; }
              const sx = (star.x / star.z) * cw + cx2;
              const sy = (star.y / star.z) * ch + cy2;
              const px2 = (star.x / star.pz) * cw + cx2;
              const py2 = (star.y / star.pz) * ch + cy2;
              if (sx < 0 || sx > cw || sy < 0 || sy > ch) continue;
              const brightness = 1 - star.z;
              bgCtx.beginPath();
              bgCtx.strokeStyle = `rgba(200,220,255,${brightness})`;
              bgCtx.lineWidth = brightness * 2.5;
              bgCtx.moveTo(px2, py2);
              bgCtx.lineTo(sx, sy);
              bgCtx.stroke();
            }
          } else if (mode === 'custom-image') {
            if (customImageRef.current?.complete) {
              bgCtx.drawImage(customImageRef.current, 0, 0, cw, ch);
            } else {
              bgCtx.fillStyle = '#111827';
              bgCtx.fillRect(0, 0, cw, ch);
              bgCtx.fillStyle = 'rgba(255,255,255,0.18)';
              bgCtx.font = '14px sans-serif';
              bgCtx.textAlign = 'center';
              bgCtx.fillText('Upload a background image above ↑', cw / 2, ch / 2);
              bgCtx.textAlign = 'left';
            }
          } else if (mode === 'emoji') {
            bgCtx.fillStyle = '#05050f';
            bgCtx.fillRect(0, 0, cw, ch);
            if (Math.random() < p.emojiDensity * 0.18) {
              emojiParticles.push({
                x: Math.random() * cw, y: ch * 0.2 + Math.random() * ch * 0.6,
                emoji: EMOJI_LIST[Math.floor(Math.random() * EMOJI_LIST.length)],
                size: 28 + Math.random() * 46, life: 1,
                vy: -0.6 - Math.random() * 1.2,
                rotation: (Math.random() - 0.5) * 0.6, rotSpeed: (Math.random() - 0.5) * 0.04,
              });
            }
            bgCtx.save();
            bgCtx.textBaseline = 'middle'; bgCtx.textAlign = 'center';
            for (let ei = emojiParticles.length - 1; ei >= 0; ei--) {
              const ep = emojiParticles[ei];
              ep.life -= 0.014; ep.y += ep.vy; ep.rotation += ep.rotSpeed;
              if (ep.life <= 0) { emojiParticles.splice(ei, 1); continue; }
              const fadeIn = Math.min(1, (1 - ep.life) * 10);
              const fadeOut = ep.life < 0.3 ? ep.life / 0.3 : 1;
              const scale = fadeIn * fadeOut;
              bgCtx.save();
              bgCtx.globalAlpha = scale;
              bgCtx.translate(ep.x, ep.y);
              bgCtx.rotate(ep.rotation);
              bgCtx.font = `${ep.size * scale}px serif`;
              bgCtx.fillText(ep.emoji, 0, 0);
              bgCtx.restore();
            }
            bgCtx.restore();
          } else if (mode === 'halo') {
            bgCtx.fillStyle = '#08080f';
            bgCtx.fillRect(0, 0, cw, ch);
          } else if (mode === 'matrix') {
            const mFsz = 16;
            const cols = Math.floor(cw / mFsz);
            if (matrixDrops.length !== cols) {
              matrixDrops = Array.from({ length: cols }, () => Math.floor(Math.random() * ch / mFsz));
            }
            const mChars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>[]{}#@$%';
            bgCtx.font = `bold ${mFsz}px monospace`;
            for (let mc = 0; mc < cols; mc++) {
              const ch2 = mChars[Math.floor(Math.random() * mChars.length)];
              bgCtx.fillStyle = '#00ff41';
              bgCtx.fillText(ch2, mc * mFsz, matrixDrops[mc] * mFsz);
              bgCtx.fillStyle = '#ccffcc';
              bgCtx.fillText(ch2, mc * mFsz, matrixDrops[mc] * mFsz);
              if (Math.random() < 0.025 + p.matrixSpeed * 0.1) {
                matrixDrops[mc]++;
                if (matrixDrops[mc] * mFsz > ch + mFsz) matrixDrops[mc] = 0;
              }
            }
          } else if (mode === 'greyscale' || mode === 'invert' || mode === 'posterize' || mode === 'vignette' || mode === 'thermal' || mode === 'sketch' || mode === 'pencil' || mode === 'duotone') {
            bgCtx.drawImage(video, 0, 0, cw, ch);
          } else if (mode === 'none') {
            bgCtx.clearRect(0, 0, cw, ch);
          }

          const frameData = frameCtx.getImageData(0, 0, cw, ch);
          const output = bgCtx.getImageData(0, 0, cw, ch);

          const applyEffect = (data: ImageData, effect: string) => {
            const d = data.data;

            if (effect === 'ripple') {
              const src = new Uint8ClampedArray(d);
              const amp = p.rippleAmp;
              const freq = p.rippleFreq;
              const t = animTime;
              for (let ry = 0; ry < ch; ry++) {
                for (let rx = 0; rx < cw; rx++) {
                  const dx = Math.round(Math.sin(ry * freq + t * p.rippleSpeed) * amp);
                  const dy = Math.round(Math.cos(rx * freq * 0.7 + t * p.rippleSpeed * 0.8) * amp);
                  const sx = Math.max(0, Math.min(cw - 1, rx + dx));
                  const sy = Math.max(0, Math.min(ch - 1, ry + dy));
                  const si = (sy * cw + sx) * 4;
                  const di = (ry * cw + rx) * 4;
                  d[di] = src[si]; d[di + 1] = src[si + 1]; d[di + 2] = src[si + 2];
                }
              }
              return;
            }

            if (effect === 'glitch') {
              const numBands = Math.ceil(p.glitchIntensity * 8);
              for (let b = 0; b < numBands; b++) {
                if (Math.random() > p.glitchIntensity) continue;
                const bandY = Math.floor(Math.random() * ch);
                const bandH = Math.floor(Math.random() * 24) + 4;
                const shift = Math.floor((Math.random() * 2 - 1) * 70);
                for (let row = bandY; row < Math.min(bandY + bandH, ch); row++) {
                  for (let col = 0; col < cw; col++) {
                    const srcCol = ((col - shift) % cw + cw) % cw;
                    const si = (row * cw + srcCol) * 4;
                    const di = (row * cw + col) * 4;
                    d[di] = d[si]; d[di + 1] = d[si + 1]; d[di + 2] = d[si + 2];
                  }
                }
              }
              const rgbShift = Math.ceil(p.glitchIntensity * 10);
              const src = new Uint8ClampedArray(d);
              for (let gy = 0; gy < ch; gy++) {
                for (let gx = 0; gx < cw; gx++) {
                  const di = (gy * cw + gx) * 4;
                  const ri = (gy * cw + Math.min(cw - 1, gx + rgbShift)) * 4;
                  const bi = (gy * cw + Math.max(0, gx - rgbShift)) * 4;
                  d[di] = src[ri];
                  d[di + 2] = src[bi + 2];
                }
              }
              return;
            }

            if (effect === 'thermal') {
              for (let i = 0; i < d.length; i += 4) {
                const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                const t = lum / 255;
                let r, g, b;
                if (t < 0.25) {
                  r = 0; g = 0; b = Math.floor(t * 4 * 255);
                } else if (t < 0.5) {
                  const s = (t - 0.25) / 0.25;
                  r = 0; g = Math.floor(s * 255); b = 255;
                } else if (t < 0.75) {
                  const s = (t - 0.5) / 0.25;
                  r = Math.floor(s * 255); g = 255; b = Math.floor((1 - s) * 255);
                } else {
                  const s = (t - 0.75) / 0.25;
                  r = 255; g = 255; b = Math.floor(s * 255);
                }
                d[i] = r; d[i + 1] = g; d[i + 2] = b;
              }
              return;
            }

            if (effect === 'sketch') {
              const src = new Uint8ClampedArray(d);
              const gray = new Float32Array(cw * ch);
              for (let i = 0; i < cw * ch; i++) {
                gray[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
              }
              const thresh = p.sketchThreshold;
              const sc = p.sketchColor;
              const sr = parseInt(sc.slice(1, 3), 16);
              const sg = parseInt(sc.slice(3, 5), 16);
              const sb = parseInt(sc.slice(5, 7), 16);
              for (let ey = 1; ey < ch - 1; ey++) {
                for (let ex = 1; ex < cw - 1; ex++) {
                  const gx =
                    -gray[(ey - 1) * cw + (ex - 1)] + gray[(ey - 1) * cw + (ex + 1)] +
                    -2 * gray[ey * cw + (ex - 1)] + 2 * gray[ey * cw + (ex + 1)] +
                    -gray[(ey + 1) * cw + (ex - 1)] + gray[(ey + 1) * cw + (ex + 1)];
                  const gy =
                    -gray[(ey - 1) * cw + (ex - 1)] - 2 * gray[(ey - 1) * cw + ex] - gray[(ey - 1) * cw + (ex + 1)] +
                    gray[(ey + 1) * cw + (ex - 1)] + 2 * gray[(ey + 1) * cw + ex] + gray[(ey + 1) * cw + (ex + 1)];
                  const mag = Math.sqrt(gx * gx + gy * gy);
                  const di = (ey * cw + ex) * 4;
                  if (mag > thresh) {
                    const t = Math.min(1, mag / 200);
                    d[di] = Math.floor(sr * t); d[di + 1] = Math.floor(sg * t); d[di + 2] = Math.floor(sb * t);
                  } else {
                    d[di] = 0; d[di + 1] = 0; d[di + 2] = 0;
                  }
                }
              }
              return;
            }

            if (effect === 'pencil') {
              const src = new Uint8ClampedArray(d);
              const gray = new Float32Array(cw * ch);
              for (let i = 0; i < cw * ch; i++) {
                gray[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
              }
              const thresh = p.sketchThreshold;
              for (let ey = 1; ey < ch - 1; ey++) {
                for (let ex = 1; ex < cw - 1; ex++) {
                  const gx =
                    -gray[(ey - 1) * cw + (ex - 1)] + gray[(ey - 1) * cw + (ex + 1)] +
                    -2 * gray[ey * cw + (ex - 1)] + 2 * gray[ey * cw + (ex + 1)] +
                    -gray[(ey + 1) * cw + (ex - 1)] + gray[(ey + 1) * cw + (ex + 1)];
                  const gy =
                    -gray[(ey - 1) * cw + (ex - 1)] - 2 * gray[(ey - 1) * cw + ex] - gray[(ey - 1) * cw + (ex + 1)] +
                    gray[(ey + 1) * cw + (ex - 1)] + 2 * gray[(ey + 1) * cw + ex] + gray[(ey + 1) * cw + (ex + 1)];
                  const mag = Math.min(255, Math.sqrt(gx * gx + gy * gy));
                  const di = (ey * cw + ex) * 4;
                  const t = Math.max(0, (mag - thresh) / 180);
                  d[di]     = Math.floor(245 * (1 - t * 0.85));
                  d[di + 1] = Math.floor(235 * (1 - t * 0.85));
                  d[di + 2] = Math.floor(210 * (1 - t * 0.85));
                }
              }
              return;
            }

            if (effect === 'duotone') {
              const hexRgb = (hex: string): [number, number, number] => [
                parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
              ];
              const [sr, sg, sb] = hexRgb(p.duotoneShadow);
              const [hr, hg, hb] = hexRgb(p.duotoneHighlight);
              for (let i = 0; i < d.length; i += 4) {
                const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
                d[i]     = Math.floor(sr + (hr - sr) * lum);
                d[i + 1] = Math.floor(sg + (hg - sg) * lum);
                d[i + 2] = Math.floor(sb + (hb - sb) * lum);
              }
              return;
            }

            const centerX = cw / 2, centerY = ch / 2;
            const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
            for (let i = 0; i < d.length; i += 4) {
              if (effect === 'vignette') {
                const px = (i / 4) % cw;
                const py = Math.floor((i / 4) / cw);
                const dist = Math.sqrt((px - centerX) ** 2 + (py - centerY) ** 2);
                const factor = 1 - (dist / maxDist) * p.vignetteStrength;
                d[i] *= factor;
                d[i + 1] *= factor;
                d[i + 2] *= factor;
              } else if (effect === 'greyscale') {
                const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                d[i] = d[i + 1] = d[i + 2] = g;
              } else if (effect === 'invert') {
                d[i] = 255 - d[i];
                d[i + 1] = 255 - d[i + 1];
                d[i + 2] = 255 - d[i + 2];
              } else if (effect === 'posterize') {
                const levels = Math.max(2, p.posterizeLevel);
                const step = 255 / (levels - 1);
                d[i] = Math.round(d[i] / step) * step;
                d[i + 1] = Math.round(d[i + 1] / step) * step;
                d[i + 2] = Math.round(d[i + 2] / step) * step;
              }
            }
          };

          if (mode === 'greyscale') applyEffect(output, 'greyscale');
          else if (mode === 'invert') applyEffect(output, 'invert');
          else if (mode === 'posterize') applyEffect(output, 'posterize');
          else if (mode === 'vignette') applyEffect(output, 'vignette');
          else if (mode === 'ripple') applyEffect(output, 'ripple');
          else if (mode === 'glitch') applyEffect(output, 'glitch');
          else if (mode === 'thermal') applyEffect(output, 'thermal');
          else if (mode === 'sketch') applyEffect(output, 'sketch');
          else if (mode === 'pencil') applyEffect(output, 'pencil');
          else if (mode === 'duotone') applyEffect(output, 'duotone');

          if (segmentations.length === 0) {
            ctx.putImageData(mode === 'none' ? frameData : output, 0, 0);
          } else {
            const mask = await bsModule.toBinaryMask(
              segmentations,
              { r: 0, g: 0, b: 0, a: 255 },
              { r: 0, g: 0, b: 0, a: 0 },
              false,
              p.maskThreshold
            );

            if (!mask) {
              ctx.putImageData(frameData, 0, 0);
            } else {
              maskCanvas.width = mask.width;
              maskCanvas.height = mask.height;
              maskCtx.putImageData(mask, 0, 0);
              scaledMaskCtx.clearRect(0, 0, cw, ch);
              scaledMaskCtx.drawImage(maskCanvas, 0, 0, mask.width, mask.height, 0, 0, cw, ch);
              const scaledMask = scaledMaskCtx.getImageData(0, 0, cw, ch);

              for (let i = 0; i < scaledMask.data.length; i += 4) {
                if (scaledMask.data[i + 3] >= 128) {
                  output.data[i] = frameData.data[i];
                  output.data[i + 1] = frameData.data[i + 1];
                  output.data[i + 2] = frameData.data[i + 2];
                  output.data[i + 3] = frameData.data[i + 3];
                }
              }

              ctx.putImageData(output, 0, 0);

              if (mode === 'halo') {
                const haloImgData = haloCtx.createImageData(cw, ch);
                const hr = parseInt(p.haloColor.slice(1, 3), 16);
                const hg = parseInt(p.haloColor.slice(3, 5), 16);
                const hb = parseInt(p.haloColor.slice(5, 7), 16);
                for (let i = 0; i < scaledMask.data.length; i += 4) {
                  if (scaledMask.data[i + 3] >= 128) {
                    haloImgData.data[i] = hr;
                    haloImgData.data[i + 1] = hg;
                    haloImgData.data[i + 2] = hb;
                    haloImgData.data[i + 3] = Math.floor(p.haloIntensity * 255);
                  }
                }
                haloCtx.putImageData(haloImgData, 0, 0);
                ctx.save();
                ctx.globalCompositeOperation = 'screen';
                ctx.filter = `blur(${p.haloSize}px)`;
                ctx.drawImage(haloCanvas, 0, 0);
                ctx.restore();
              }
            }
          }
        } catch (error) {
          logger.error(`Render failed: ${error}`);
        }
        animRef.current = requestAnimationFrame(() => { render().catch(console.error); });
      };

      render().catch(console.error);
      setActive(true);
      logger.success(`Virtual background active! ${cw}×${ch}@${applied.frameRate?.toFixed(0) ?? '?'}fps`);
    } catch (e) {
      logger.error(`Failed: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = () => {
    cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    modelRef.current = null;
    setActive(false);
    setSettings(null);
    setLoadProgress(0);
  };

  const handleApplyConstraints = async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    const r = resolutionRef.current;
    try {
      await track.applyConstraints({
        width: { ideal: r.width },
        height: { ideal: r.height },
        frameRate: { ideal: fpsRef.current },
      });
      const applied = track.getSettings();
      setSettings({
        width: applied.width ?? r.width,
        height: applied.height ?? r.height,
        frameRate: applied.frameRate,
      });
      logger.success(`Applied: ${applied.width}×${applied.height}@${applied.frameRate?.toFixed(0) ?? '?'}fps`);
    } catch (e) {
      logger.error(`applyConstraints failed: ${e}`);
    }
  };

  useEffect(() => () => { cancelAnimationFrame(animRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  return (
    <DemoLayout
      title="Virtual Background (ML)"
      difficulty="advanced"
      description="Replace or blur your background using TensorFlow.js body segmentation."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Uses <strong>MediaPipe Selfie Segmentation</strong> via TensorFlow.js to separate the person
            from the background in real time. The segmentation mask is applied on a canvas, which can
            then be streamed via WebRTC.
          </p>
          <p>
            Pick a resolution and frame rate before starting. Lower resolution (e.g. 320×240) runs
            the ML faster on weak devices; higher (720p, 1080p) gives sharper output. You can change
            resolution mid-session with &quot;Apply resolution&quot; — canvases resize automatically.
          </p>
          <p className="text-amber-400/80">
            ⚡ The model is ~15MB and requires a moment to download. Processing runs entirely in
            the browser — no data is sent to any server.
          </p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-1.5">Resolution</p>
              <div className="flex flex-wrap gap-2">
                {RESOLUTIONS.map((r) => (
                  <label key={r.label} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="res"
                      checked={resolution.width === r.width}
                      onChange={() => setResolution(r)}
                      className="accent-blue-400"
                    />
                    <span className="text-sm text-zinc-300">{r.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-1">Frame rate: {fps} fps</p>
              <input
                type="range"
                min={10}
                max={30}
                step={5}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-24 accent-blue-400"
              />
            </div>
            <div className="flex gap-2">
              {!active && !loading && (
                <button onClick={handleStart} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                  Load Model & Start
                </button>
              )}
              {active && (
                <>
                  <button onClick={handleApplyConstraints} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                    Apply resolution
                  </button>
                  <button onClick={handleStop} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                    Stop
                  </button>
                </>
              )}
            </div>
          </div>
          {active && settings && (
            <div className="flex gap-3 text-sm text-zinc-500">
              <span>Actual: {settings.width}×{settings.height}</span>
              {settings.frameRate != null && (
                <span>@ {settings.frameRate.toFixed(1)} fps</span>
              )}
            </div>
          )}

          {loading && <ProgressBar value={loadProgress} label="Loading TensorFlow.js model..." />}

          {active && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {MODES.map(({ id, label }) => (
                  <button key={id} onClick={() => setBgMode(id)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${bgMode === id ? 'bg-blue-600 text-white' : 'bg-surface-2 text-zinc-300 hover:bg-surface-3'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-4 items-center p-3 rounded-lg bg-surface-2/50 border border-surface-3">
                <span className="text-xs text-zinc-500 font-medium w-full">Live controls</span>
                {bgMode === 'blur' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Blur</span>
                    <input type="range" min={2} max={40} value={params.blurAmount}
                      onChange={(e) => setParams((p) => ({ ...p, blurAmount: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-8">{params.blurAmount}px</span>
                  </label>
                )}
                {(bgMode === 'solid' || bgMode === 'gradient') && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-16">Color 1</span>
                      <input type="color" value={params.bgColor}
                        onChange={(e) => setParams((p) => ({ ...p, bgColor: e.target.value }))}
                        className="w-9 h-8 rounded cursor-pointer" />
                    </label>
                    {bgMode === 'gradient' && (
                      <>
                        <label className="flex items-center gap-2 text-sm">
                          <span className="text-zinc-400 w-16">Color 2</span>
                          <input type="color" value={params.bgColor2}
                            onChange={(e) => setParams((p) => ({ ...p, bgColor2: e.target.value }))}
                            className="w-9 h-8 rounded cursor-pointer" />
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <span className="text-zinc-400 w-20">Angle</span>
                          <input type="range" min={0} max={360} value={params.gradientAngle}
                            onChange={(e) => setParams((p) => ({ ...p, gradientAngle: +e.target.value }))}
                            className="w-24 accent-blue-500" />
                          <span className="text-zinc-500 tabular-nums w-10">{params.gradientAngle}°</span>
                        </label>
                      </>
                    )}
                  </>
                )}
                {bgMode === 'pixelate' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Block size</span>
                    <input type="range" min={4} max={32} value={params.pixelSize}
                      onChange={(e) => setParams((p) => ({ ...p, pixelSize: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-8">{params.pixelSize}px</span>
                  </label>
                )}
                {bgMode === 'posterize' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Levels</span>
                    <input type="range" min={2} max={8} value={params.posterizeLevel}
                      onChange={(e) => setParams((p) => ({ ...p, posterizeLevel: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-8">{params.posterizeLevel}</span>
                  </label>
                )}
                {bgMode === 'vignette' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Strength</span>
                    <input type="range" min={0.2} max={1.2} step={0.1} value={params.vignetteStrength}
                      onChange={(e) => setParams((p) => ({ ...p, vignetteStrength: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-10">{params.vignetteStrength.toFixed(1)}</span>
                  </label>
                )}
                {bgMode === 'ripple' && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-24">Amplitude</span>
                      <input type="range" min={2} max={40} value={params.rippleAmp}
                        onChange={(e) => setParams((p) => ({ ...p, rippleAmp: +e.target.value }))}
                        className="w-32 accent-blue-500" />
                      <span className="text-zinc-500 tabular-nums w-8">{params.rippleAmp}px</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-24">Speed</span>
                      <input type="range" min={0.5} max={5} step={0.5} value={params.rippleSpeed}
                        onChange={(e) => setParams((p) => ({ ...p, rippleSpeed: +e.target.value }))}
                        className="w-32 accent-blue-500" />
                      <span className="text-zinc-500 tabular-nums w-8">{params.rippleSpeed}×</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-24">Blur base</span>
                      <input type="range" min={0} max={20} value={params.blurAmount}
                        onChange={(e) => setParams((p) => ({ ...p, blurAmount: +e.target.value }))}
                        className="w-32 accent-blue-500" />
                      <span className="text-zinc-500 tabular-nums w-8">{params.blurAmount}px</span>
                    </label>
                  </>
                )}
                {bgMode === 'glitch' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Intensity</span>
                    <input type="range" min={0.1} max={1} step={0.05} value={params.glitchIntensity}
                      onChange={(e) => setParams((p) => ({ ...p, glitchIntensity: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-8">{params.glitchIntensity.toFixed(2)}</span>
                  </label>
                )}
                {bgMode === 'starfield' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Warp speed</span>
                    <input type="range" min={0.001} max={0.025} step={0.001} value={params.starSpeed}
                      onChange={(e) => setParams((p) => ({ ...p, starSpeed: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-8">{(params.starSpeed * 1000).toFixed(0)}</span>
                  </label>
                )}
                {bgMode === 'sketch' && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-24">Threshold</span>
                      <input type="range" min={10} max={120} value={params.sketchThreshold}
                        onChange={(e) => setParams((p) => ({ ...p, sketchThreshold: +e.target.value }))}
                        className="w-32 accent-blue-500" />
                      <span className="text-zinc-500 tabular-nums w-8">{params.sketchThreshold}</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-16">Glow color</span>
                      <input type="color" value={params.sketchColor}
                        onChange={(e) => setParams((p) => ({ ...p, sketchColor: e.target.value }))}
                        className="w-9 h-8 rounded cursor-pointer" />
                    </label>
                  </>
                )}
                {bgMode === 'custom-image' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-20">Image file</span>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1 bg-surface-3 hover:bg-zinc-600 text-zinc-200 text-xs rounded-lg">
                      Upload image…
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const img = new Image();
                        img.onload = () => { customImageRef.current = img; };
                        img.src = URL.createObjectURL(file);
                      }} />
                  </label>
                )}
                {bgMode === 'pencil' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Detail</span>
                    <input type="range" min={10} max={120} value={params.sketchThreshold}
                      onChange={(e) => setParams((p) => ({ ...p, sketchThreshold: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-8">{params.sketchThreshold}</span>
                  </label>
                )}
                {bgMode === 'emoji' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Density</span>
                    <input type="range" min={0.1} max={1} step={0.05} value={params.emojiDensity}
                      onChange={(e) => setParams((p) => ({ ...p, emojiDensity: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-8">{params.emojiDensity.toFixed(2)}</span>
                  </label>
                )}
                {bgMode === 'halo' && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-16">Halo color</span>
                      <input type="color" value={params.haloColor}
                        onChange={(e) => setParams((p) => ({ ...p, haloColor: e.target.value }))}
                        className="w-9 h-8 rounded cursor-pointer" />
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-24">Glow radius</span>
                      <input type="range" min={5} max={60} value={params.haloSize}
                        onChange={(e) => setParams((p) => ({ ...p, haloSize: +e.target.value }))}
                        className="w-32 accent-blue-500" />
                      <span className="text-zinc-500 tabular-nums w-8">{params.haloSize}px</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-24">Intensity</span>
                      <input type="range" min={0.2} max={1} step={0.05} value={params.haloIntensity}
                        onChange={(e) => setParams((p) => ({ ...p, haloIntensity: +e.target.value }))}
                        className="w-32 accent-blue-500" />
                      <span className="text-zinc-500 tabular-nums w-8">{params.haloIntensity.toFixed(2)}</span>
                    </label>
                  </>
                )}
                {bgMode === 'matrix' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Fall speed</span>
                    <input type="range" min={0.1} max={1} step={0.05} value={params.matrixSpeed}
                      onChange={(e) => setParams((p) => ({ ...p, matrixSpeed: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-8">{params.matrixSpeed.toFixed(2)}</span>
                  </label>
                )}
                {bgMode === 'duotone' && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-16">Shadows</span>
                      <input type="color" value={params.duotoneShadow}
                        onChange={(e) => setParams((p) => ({ ...p, duotoneShadow: e.target.value }))}
                        className="w-9 h-8 rounded cursor-pointer" />
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-16">Highlights</span>
                      <input type="color" value={params.duotoneHighlight}
                        onChange={(e) => setParams((p) => ({ ...p, duotoneHighlight: e.target.value }))}
                        className="w-9 h-8 rounded cursor-pointer" />
                    </label>
                  </>
                )}
                <label className="flex items-center gap-2 text-sm ml-auto">
                  <span className="text-zinc-400 w-24">Mask sensitivity</span>
                  <input type="range" min={0.3} max={0.9} step={0.05} value={params.maskThreshold}
                    onChange={(e) => setParams((p) => ({ ...p, maskThreshold: +e.target.value }))}
                    className="w-28 accent-blue-500" />
                  <span className="text-zinc-500 tabular-nums w-10">{params.maskThreshold.toFixed(2)}</span>
                </label>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Original</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">With virtual background</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <canvas ref={canvasRef} className="w-full h-full object-cover scale-x-[-1]" />
              </div>
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Body segmentation + canvas compositing' }}
      mdnLinks={[
        { label: 'TensorFlow.js', href: 'https://www.tensorflow.org/js' },
        { label: 'MediaPipe Selfie Segmentation', href: 'https://github.com/tensorflow/tfjs-models/tree/master/body-segmentation' },
      ]}
    />
  );
}
