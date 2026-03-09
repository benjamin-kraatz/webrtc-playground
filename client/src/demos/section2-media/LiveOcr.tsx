import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';

interface OcrResult {
  text: string;
  confidence: number;
  timestamp: number;
}

const CODE = `import { createWorker } from 'tesseract.js';

// Initialize the OCR worker (downloads ~4MB language data)
const worker = await createWorker('eng');

// Capture a video frame and recognize text
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d')!;
ctx.drawImage(videoElement, 0, 0);

const { data: { text, confidence } } = await worker.recognize(canvas);
console.log(\`Recognized: "\${text}" (confidence: \${confidence.toFixed(1)}%)\`);

// This text could then be sent to a peer via RTCDataChannel:
dataChannel.send(JSON.stringify({ type: 'ocr', text, confidence }));`;

export default function LiveOcr() {
  const logger = useMemo(() => new Logger(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<TesseractWorker | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<OcrResult[]>([]);
  const [workerReady, setWorkerReady] = useState(false);
  const [progress, setProgress] = useState(0);

  const initWorker = useCallback(async () => {
    if (workerRef.current) return;
    logger.info('Initializing Tesseract.js OCR engine…');
    try {
      const w = await createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setProgress(Math.round((m.progress ?? 0) * 100));
          }
        },
      });
      workerRef.current = w;
      setWorkerReady(true);
      logger.success('OCR engine ready');
    } catch (e) {
      logger.error(`Failed to init OCR worker: ${e}`);
    }
  }, [logger]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOn(true);
      logger.success('Camera started');
      initWorker();
    } catch (e) {
      logger.error(`Camera error: ${e}`);
    }
  };

  const stopCamera = () => {
    stopScanning();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    logger.info('Camera stopped');
  };

  const captureAndRecognize = useCallback(async () => {
    if (!videoRef.current || !captureCanvasRef.current || !workerRef.current) return;
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setProcessing(true);
    try {
      const { data } = await workerRef.current.recognize(canvas);
      const trimmed = data.text.trim();
      if (trimmed) {
        setResults((prev) => [
          { text: trimmed, confidence: data.confidence, timestamp: Date.now() },
          ...prev.slice(0, 9),
        ]);
        logger.success(`OCR: "${trimmed.slice(0, 60).replace(/\n/g, ' ')}…" (${data.confidence.toFixed(0)}%)`);
      } else {
        logger.info('No text detected in frame');
      }
    } catch (e) {
      logger.error(`OCR failed: ${e}`);
    } finally {
      setProcessing(false);
      setProgress(0);
    }
  }, [logger]);

  const startScanning = () => {
    if (!workerReady) { logger.warn('OCR engine not ready yet'); return; }
    setScanning(true);
    captureAndRecognize();
    intervalRef.current = setInterval(captureAndRecognize, 3000);
    logger.info('Continuous OCR scanning started (every 3 s)');
  };

  const stopScanning = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setScanning(false);
  };

  const scanOnce = () => {
    if (!workerReady) { logger.warn('OCR engine not ready yet'); return; }
    captureAndRecognize();
  };

  useEffect(() => {
    return () => {
      intervalRef.current && clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      workerRef.current?.terminate();
    };
  }, []);

  return (
    <DemoLayout
      title="Live OCR Scanner"
      difficulty="intermediate"
      description="Tesseract.js reads text from your live webcam feed entirely in-browser — no server required."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Tesseract.js</strong> is a pure JavaScript port of Google's battle-tested OCR
            engine. It runs entirely in a Web Worker, keeping the UI thread unblocked while
            processing each video frame.
          </p>
          <p>
            Point your camera at printed text, a book, a whiteboard, or a sign. Every 3 seconds
            (or on demand) a frame is extracted to a hidden canvas and passed to Tesseract's
            LSTM neural network. The recognized text could then be transmitted to a peer
            via <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCDataChannel</code> — useful for
            sharing docs, whiteboards, or business cards in a WebRTC call.
          </p>
        </div>
      }
      hints={[
        'Try pointing at a printed page, book cover, or screen with text',
        '"Scan Once" for a single frame; "Auto Scan" repeats every 3 seconds',
        'Confidence % indicates how certain Tesseract is about each recognition',
      ]}
      demo={
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Camera feed */}
            <div className="space-y-2">
              <p className="text-xs text-zinc-500 font-medium">Camera Feed</p>
              <div className="relative aspect-video bg-zinc-900 rounded-xl overflow-hidden flex items-center justify-center">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                {!cameraOn && (
                  <p className="absolute text-sm text-zinc-600">Camera not started</p>
                )}
                {processing && (
                  <div className="absolute bottom-2 left-2 right-2">
                    <div className="bg-zinc-900/80 rounded-lg px-3 py-1.5 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-xs text-amber-400">
                        Recognizing… {progress > 0 ? `${progress}%` : ''}
                      </span>
                    </div>
                  </div>
                )}
                {scanning && !processing && (
                  <div className="absolute top-2 left-2">
                    <div className="flex items-center gap-1.5 bg-emerald-900/80 rounded-full px-2 py-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs text-emerald-400">Auto scanning</span>
                    </div>
                  </div>
                )}
              </div>
              <canvas ref={captureCanvasRef} className="hidden" />
              <div className="flex gap-2">
                {!cameraOn ? (
                  <button
                    onClick={startCamera}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Start Camera
                  </button>
                ) : (
                  <>
                    <button
                      onClick={scanOnce}
                      disabled={!workerReady || processing}
                      className="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Scan Once
                    </button>
                    {!scanning ? (
                      <button
                        onClick={startScanning}
                        disabled={!workerReady}
                        className="flex-1 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        Auto Scan
                      </button>
                    ) : (
                      <button
                        onClick={stopScanning}
                        className="flex-1 px-3 py-2 bg-amber-700 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        Stop
                      </button>
                    )}
                    <button
                      onClick={stopCamera}
                      className="px-3 py-2 bg-red-900/50 hover:bg-red-900 text-red-400 text-sm font-medium rounded-lg border border-red-800 transition-colors"
                    >
                      Off
                    </button>
                  </>
                )}
              </div>
              {!workerReady && cameraOn && (
                <p className="text-xs text-amber-400/80">⏳ Loading OCR engine…</p>
              )}
            </div>

            {/* OCR results */}
            <div className="space-y-2">
              <p className="text-xs text-zinc-500 font-medium">Recognized Text</p>
              <div className="h-64 overflow-y-auto space-y-2 pr-1">
                {results.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-zinc-700">
                    No text detected yet
                  </div>
                ) : (
                  results.map((r) => (
                    <div key={r.timestamp} className="bg-surface-0 border border-zinc-800 rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-600">
                          {new Date(r.timestamp).toLocaleTimeString()}
                        </span>
                        <span className={`text-xs font-medium ${r.confidence > 80 ? 'text-emerald-400' : r.confidence > 60 ? 'text-amber-400' : 'text-red-400'}`}>
                          {r.confidence.toFixed(0)}% confidence
                        </span>
                      </div>
                      <p className="text-sm text-zinc-200 whitespace-pre-wrap font-mono break-words leading-relaxed">
                        {r.text}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Tesseract.js OCR + DataChannel relay' }}
      mdnLinks={[
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
