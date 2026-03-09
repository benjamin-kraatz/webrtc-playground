import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface StatPoint {
  t: number;
  rtt: number;
  jitter: number;
  bytesSent: number;
  bytesReceived: number;
}

const MAX_POINTS = 60;
const W = 700;
const H = 180;
const MARGIN = { top: 10, right: 20, bottom: 30, left: 48 };

const CODE = `// D3 live line chart of WebRTC stats
const xScale = d3.scaleLinear().domain([0, MAX]).range([0, width]);
const yScale = d3.scaleLinear().domain([0, maxVal]).range([height, 0]);

const line = d3.line<StatPoint>()
  .x((_, i) => xScale(i))
  .y((d) => yScale(d.rtt))
  .curve(d3.curveCatmullRom.alpha(0.5));

// Animate update
svg.select('.rtt-path')
  .datum(data)
  .transition().duration(200)
  .attr('d', line);`;

function LineChart({
  data,
  yKey,
  color,
  label,
  unit,
}: {
  data: StatPoint[];
  yKey: keyof StatPoint;
  color: string;
  label: string;
  unit: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length < 2) return;
    const svg = d3.select(svgRef.current);
    const innerW = W - MARGIN.left - MARGIN.right;
    const innerH = H - MARGIN.top - MARGIN.bottom;

    const values = data.map((d) => d[yKey] as number);
    const maxVal = Math.max(d3.max(values) ?? 1, 1);

    const xScale = d3.scaleLinear().domain([0, MAX_POINTS - 1]).range([0, innerW]);
    const yScale = d3.scaleLinear().domain([0, maxVal * 1.15]).range([innerH, 0]).nice();

    const line = d3.line<StatPoint>()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d[yKey] as number))
      .curve(d3.curveCatmullRom.alpha(0.5));

    let g = svg.select<SVGGElement>('g.inner');
    if (g.empty()) {
      g = svg.append('g').attr('class', 'inner').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
      g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${innerH})`);
      g.append('g').attr('class', 'y-axis');
      g.append('path').attr('class', 'area').attr('fill', color).style('opacity', 0.08);
      g.append('path').attr('class', 'line').attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2);
      // Grid lines
      g.append('g').attr('class', 'grid');
    }

    const area = d3.area<StatPoint>()
      .x((_, i) => xScale(i))
      .y0(innerH)
      .y1((d) => yScale(d[yKey] as number))
      .curve(d3.curveCatmullRom.alpha(0.5));

    g.select<SVGPathElement>('.area').datum(data).attr('d', area);
    g.select<SVGPathElement>('.line').datum(data).attr('d', line);

    g.select<SVGGElement>('.y-axis')
      .call(d3.axisLeft(yScale).ticks(4).tickFormat((v) => `${v}${unit}`));
    g.select<SVGGElement>('.x-axis')
      .call(d3.axisBottom(xScale).ticks(0));
    g.select<SVGGElement>('.grid')
      .call(d3.axisLeft(yScale).ticks(4).tickSize(-innerW).tickFormat(() => ''))
      .call((axis) => axis.select('.domain').remove())
      .call((axis) => axis.selectAll('line').attr('stroke', '#333').attr('stroke-dasharray', '2,4'));

    svg.selectAll('text').style('fill', '#71717a').style('font-size', '11px');
    svg.selectAll('.domain').attr('stroke', '#333');
    svg.selectAll('.tick line').attr('stroke', '#333');
  }, [data, yKey, color, unit]);

  const latest = data[data.length - 1];
  const val = latest ? (latest[yKey] as number) : 0;

  return (
    <div className="bg-surface-0 border border-zinc-800 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium" style={{ color }}>{label}</span>
        <span className="text-sm font-mono font-bold text-zinc-200">
          {val.toFixed(yKey === 'jitter' ? 2 : 1)}{unit}
        </span>
      </div>
      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: 120 }} />
    </div>
  );
}

function ThroughputChart({ data }: { data: StatPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length < 2) return;
    const svg = d3.select(svgRef.current);
    const innerW = W - MARGIN.left - MARGIN.right;
    const innerH = H - MARGIN.top - MARGIN.bottom;

    const sentDeltas = data.map((d, i) => i === 0 ? 0 : Math.max(0, d.bytesSent - data[i - 1].bytesSent) / 1024);
    const recvDeltas = data.map((d, i) => i === 0 ? 0 : Math.max(0, d.bytesReceived - data[i - 1].bytesReceived) / 1024);
    const maxVal = Math.max(d3.max([...sentDeltas, ...recvDeltas]) ?? 1, 1);

    const xScale = d3.scaleLinear().domain([0, MAX_POINTS - 1]).range([0, innerW]);
    const yScale = d3.scaleLinear().domain([0, maxVal * 1.15]).range([innerH, 0]).nice();

    const makeLine = (vals: number[]) =>
      d3.line<number>().x((_, i) => xScale(i)).y((v) => yScale(v)).curve(d3.curveCatmullRom.alpha(0.5))(vals);

    let g = svg.select<SVGGElement>('g.inner');
    if (g.empty()) {
      g = svg.append('g').attr('class', 'inner').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
      g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${innerH})`);
      g.append('g').attr('class', 'y-axis');
      g.append('path').attr('class', 'sent').attr('fill', 'none').attr('stroke', '#34d399').attr('stroke-width', 2);
      g.append('path').attr('class', 'recv').attr('fill', 'none').attr('stroke', '#818cf8').attr('stroke-width', 2);
    }

    g.select<SVGPathElement>('.sent').attr('d', makeLine(sentDeltas) ?? '');
    g.select<SVGPathElement>('.recv').attr('d', makeLine(recvDeltas) ?? '');
    g.select<SVGGElement>('.y-axis').call(d3.axisLeft(yScale).ticks(4).tickFormat((v) => `${v}KB`));
    g.select<SVGGElement>('.x-axis').call(d3.axisBottom(xScale).ticks(0));

    svg.selectAll('text').style('fill', '#71717a').style('font-size', '11px');
    svg.selectAll('.domain').attr('stroke', '#333');
  }, [data]);

  return (
    <div className="bg-surface-0 border border-zinc-800 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-zinc-400">Throughput</span>
        <div className="flex gap-3 text-xs">
          <span className="text-emerald-400">▲ Sent</span>
          <span className="text-indigo-400">▼ Recv</span>
        </div>
      </div>
      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: 120 }} />
    </div>
  );
}

export default function D3StatsViz() {
  const logger = useMemo(() => new Logger(), []);
  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [connected, setConnected] = useState(false);
  const [statsHistory, setStatsHistory] = useState<StatPoint[]>([]);
  const [dataSent, setDataSent] = useState(0);

  const pollStats = useCallback(async () => {
    const pc = pcARef.current;
    if (!pc) return;
    const reports = await pc.getStats();
    let rtt = 0, jitter = 0, bytesSent = 0, bytesReceived = 0;

    reports.forEach((r) => {
      if (r.type === 'candidate-pair' && r.state === 'succeeded') {
        rtt = Math.round((r.currentRoundTripTime ?? 0) * 1000);
      }
      if (r.type === 'outbound-rtp') {
        bytesSent += r.bytesSent ?? 0;
      }
      if (r.type === 'inbound-rtp') {
        jitter = (r.jitter ?? 0) * 1000;
        bytesReceived += r.bytesReceived ?? 0;
      }
    });

    setStatsHistory((prev) => [
      ...prev.slice(-(MAX_POINTS - 1)),
      { t: Date.now(), rtt, jitter, bytesSent, bytesReceived },
    ]);
  }, []);

  const startLoopback = async () => {
    logger.info('Creating loopback RTCPeerConnection…');
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA;
    pcBRef.current = pcB;

    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);

    // Create data channel and flood it with data
    const dc = pcA.createDataChannel('flood');
    dc.onopen = () => {
      logger.success('Loopback connected — streaming data…');
      setConnected(true);
      const buf = new ArrayBuffer(1200);
      const interval = setInterval(() => {
        if (dc.readyState === 'open' && dc.bufferedAmount < 256 * 1024) {
          dc.send(buf);
          setDataSent((n) => n + 1200);
        }
      }, 16);
      timerRef.current = interval;
    };

    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = () => {};
    };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);

    const statsInterval = setInterval(pollStats, 500);
    return () => clearInterval(statsInterval);
  };

  const handleStart = () => { startLoopback(); };

  const handleStop = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    pcARef.current?.close();
    pcBRef.current?.close();
    pcARef.current = null;
    pcBRef.current = null;
    setConnected(false);
    setStatsHistory([]);
    setDataSent(0);
    logger.info('Stopped');
  };

  useEffect(() => {
    let statsInterval: ReturnType<typeof setInterval>;
    if (connected) {
      statsInterval = setInterval(pollStats, 500);
    }
    return () => clearInterval(statsInterval);
  }, [connected, pollStats]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      pcARef.current?.close();
      pcBRef.current?.close();
    };
  }, []);

  const filledData = statsHistory.length < 2 ? [] : statsHistory;

  return (
    <DemoLayout
      title="D3 Live Stats Visualizer"
      difficulty="intermediate"
      description="Beautiful D3.js charts of live RTCPeerConnection stats — RTT, jitter, and throughput in real time."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCPeerConnection.getStats()</code> returns
            a rich <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCStatsReport</code> with dozens
            of metrics. This demo polls it every 500 ms and feeds the data into <strong>D3.js</strong> line
            charts with smooth Catmull-Rom curves.
          </p>
          <p>
            A loopback connection floods the channel with 1200-byte packets at 60 fps to generate
            interesting stats. Watch RTT stabilise around a fraction of a millisecond (loopback),
            jitter fluctuate, and throughput climb.
          </p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {!connected ? (
              <button onClick={handleStart} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Start Loopback
              </button>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Streaming
                </div>
                <span className="text-xs text-zinc-500">Sent: {(dataSent / 1024 / 1024).toFixed(2)} MB</span>
                <button onClick={handleStop} className="px-3 py-1.5 bg-red-900/40 text-red-400 text-xs font-medium rounded-lg border border-red-800">
                  Stop
                </button>
              </>
            )}
          </div>

          {filledData.length < 2 ? (
            <div className="h-32 flex items-center justify-center text-sm text-zinc-600">
              {connected ? 'Collecting stats…' : 'Click Start Loopback to begin'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <LineChart data={filledData} yKey="rtt" color="#f59e0b" label="Round Trip Time" unit="ms" />
              <LineChart data={filledData} yKey="jitter" color="#ec4899" label="Jitter" unit="ms" />
              <ThroughputChart data={filledData} />
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'D3 line chart from RTCStatsReport' }}
      mdnLinks={[
        { label: 'RTCPeerConnection.getStats()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats' },
      ]}
    />
  );
}
