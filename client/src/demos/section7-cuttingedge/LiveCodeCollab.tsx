import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// Collaborative code sync over RTCDataChannel
// Send full code + cursor on every change
dc.send(JSON.stringify({
  type: 'code-update',
  code: editorValue,
  cursorLine,
  cursorCol,
  seq: ++localSeq,
}));

dc.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'code-update' && msg.seq > lastRemoteSeq) {
    lastRemoteSeq = msg.seq;
    setCode(msg.code); // apply remote code
    setPeerCursor({ line: msg.cursorLine, col: msg.cursorCol });
  }
};

// Run code in sandboxed iframe
iframe.srcdoc = \`<!DOCTYPE html><html><body>
<script>
console.log = (...a) => parent.postMessage({type:'log',msg:a.join(' ')}, '*');
window.onerror = (msg) => parent.postMessage({type:'error',msg}, '*');
<\/script>
<script>\${code}<\/script>
</body></html>\`;`;

const STARTER_CODE = `// Collaborative JS Playground
// Both peers edit this code together!

function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const results = [];
for (let i = 0; i < 10; i++) {
  results.push(fibonacci(i));
}
console.log('Fibonacci:', results.join(', '));
console.log('Ready to collaborate!');
`;

interface ConsoleEntry {
  id: number;
  text: string;
  isError: boolean;
}

interface PeerCursor {
  line: number;
  col: number;
}

let _entryId = 0;

export default function LiveCodeCollab() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [code, setCode] = useState(STARTER_CODE);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [peerCursor, setPeerCursor] = useState<PeerCursor | null>(null);
  const [wordWrap, setWordWrap] = useState(false);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pc2Ref = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remoteDcRef = useRef<RTCDataChannel | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const localSeqRef = useRef(0);
  const remoteSeqRef = useRef(0);
  const codeRef = useRef(code);
  const consoleRef = useRef<HTMLDivElement>(null);
  const isRemoteUpdateRef = useRef(false);

  useEffect(() => { codeRef.current = code; }, [code]);

  // Listen for iframe messages
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data?.type) return;
      if (e.data.type === 'log') {
        addConsoleEntry(e.data.msg as string, false);
      } else if (e.data.type === 'error') {
        addConsoleEntry(`ERROR: ${e.data.msg as string}`, true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Auto-scroll console
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleEntries]);

  const addConsoleEntry = (text: string, isError: boolean) => {
    setConsoleEntries(prev => [...prev.slice(-99), { id: ++_entryId, text, isError }]);
  };

  const sendCodeUpdate = useCallback((currentCode: string, line: number, col: number) => {
    const msg = JSON.stringify({
      type: 'code-update',
      code: currentCode,
      cursorLine: line,
      cursorCol: col,
      seq: ++localSeqRef.current,
    });
    if (dcRef.current?.readyState === 'open') dcRef.current.send(msg);
    if (remoteDcRef.current?.readyState === 'open') remoteDcRef.current.send(msg);
  }, []);

  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isRemoteUpdateRef.current) return;
    const value = e.target.value;
    setCode(value);
    codeRef.current = value;
    const ta = e.target;
    const pos = ta.selectionStart;
    const lines = value.slice(0, pos).split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    setCursorLine(line);
    setCursorCol(col);
    sendCodeUpdate(value, line, col);
  }, [sendCodeUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = codeRef.current.slice(0, start) + '  ' + codeRef.current.slice(end);
      setCode(newVal);
      codeRef.current = newVal;
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
      sendCodeUpdate(newVal, cursorLine, cursorCol + 2);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runCode();
    }
  }, [cursorLine, cursorCol, sendCodeUpdate]);

  const handleCursorMove = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const pos = ta.selectionStart;
    const lines = codeRef.current.slice(0, pos).split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    setCursorLine(line);
    setCursorCol(col);
  }, []);

  const runCode = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setConsoleEntries([]);
    const escaped = codeRef.current.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<script>
window.onerror = function(msg, src, line, col) {
  parent.postMessage({type:'error', msg: msg + ' (line ' + line + ')'}, '*');
  return true;
};
var _origLog = console.log;
console.log = function() {
  var args = Array.prototype.slice.call(arguments);
  parent.postMessage({type:'log', msg: args.map(function(a){return typeof a==='object'?JSON.stringify(a):String(a);}).join(' ')}, '*');
  _origLog.apply(console, arguments);
};
console.error = function() {
  var args = Array.prototype.slice.call(arguments);
  parent.postMessage({type:'error', msg: args.map(String).join(' ')}, '*');
};
<\/script>
<script>
try {
${codeRef.current}
} catch(e) {
  parent.postMessage({type:'error', msg: e.message}, '*');
}
<\/script>
</body></html>`;
    iframe.srcdoc = html;
    logger.info('Running code...');
  }, [logger]);

  const setupDataChannel = useCallback((dc: RTCDataChannel) => {
    dc.onopen = () => {
      setPeerConnected(true);
      logger.success('Peer data channel open');
      // Send current code to new peer
      dc.send(JSON.stringify({
        type: 'code-update',
        code: codeRef.current,
        cursorLine: 1,
        cursorCol: 1,
        seq: ++localSeqRef.current,
      }));
    };
    dc.onclose = () => { setPeerConnected(false); logger.info('Peer disconnected'); };
    dc.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as { type: string; code: string; cursorLine: number; cursorCol: number; seq: number };
      if (msg.type === 'code-update' && msg.seq > remoteSeqRef.current) {
        remoteSeqRef.current = msg.seq;
        isRemoteUpdateRef.current = true;
        setCode(msg.code);
        codeRef.current = msg.code;
        setPeerCursor({ line: msg.cursorLine, col: msg.cursorCol });
        requestAnimationFrame(() => { isRemoteUpdateRef.current = false; });
      }
    };
  }, [logger]);

  const connectLoopback = useCallback(async () => {
    if (pcRef.current) {
      pcRef.current.close();
      pc2Ref.current?.close();
    }

    const pc1 = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pc2 = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc1;
    pc2Ref.current = pc2;

    const dc1 = pc1.createDataChannel('collab');
    dcRef.current = dc1;
    setupDataChannel(dc1);

    pc2.ondatachannel = (ev) => {
      remoteDcRef.current = ev.channel;
      setupDataChannel(ev.channel);
    };

    pc1.onicecandidate = e => { if (e.candidate) pc2.addIceCandidate(e.candidate); };
    pc2.onicecandidate = e => { if (e.candidate) pc1.addIceCandidate(e.candidate); };

    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(offer);
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(answer);

    setConnected(true);
    logger.success('Loopback RTCPeerConnection established');
  }, [logger, setupDataChannel]);

  const disconnect = useCallback(() => {
    dcRef.current?.close();
    remoteDcRef.current?.close();
    pcRef.current?.close();
    pc2Ref.current?.close();
    pcRef.current = null;
    pc2Ref.current = null;
    dcRef.current = null;
    remoteDcRef.current = null;
    setConnected(false);
    setPeerConnected(false);
    logger.info('Disconnected');
  }, [logger]);

  useEffect(() => {
    return () => {
      dcRef.current?.close();
      remoteDcRef.current?.close();
      pcRef.current?.close();
      pc2Ref.current?.close();
    };
  }, []);

  const lines = code.split('\n');
  const totalLines = lines.length;

  return (
    <DemoLayout
      title="Live Code Collab"
      difficulty="advanced"
      description="Real-time collaborative JavaScript editor over RTCDataChannel. Both peers edit code simultaneously, run it in a sandboxed iframe, and see each other's cursors."
      explanation={
        <div className="space-y-3 text-sm">
          <p>Full collaborative code editing usually requires complex <strong>operational transforms</strong> or CRDTs. This demo uses a simplified <strong>last-write-wins per sequence number</strong> approach — each update carries an incrementing sequence number, and stale updates are discarded.</p>
          <p>Code execution happens inside a sandboxed <strong>iframe with srcdoc</strong>. The iframe's <code>console.log</code> and <code>window.onerror</code> are overridden to <code>postMessage</code> output back to the parent, so you see logs without any CSP issues.</p>
          <p>Cursor positions are transmitted alongside each code update, letting you see where your collaborator's caret is. In a production system you'd overlay a blinking cursor element; here we show the line/col in a badge.</p>
        </div>
      }
      demo={
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            {!connected ? (
              <button
                onClick={connectLoopback}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg"
              >
                Connect Loopback
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm font-medium rounded-lg"
              >
                Disconnect
              </button>
            )}
            <button
              onClick={runCode}
              className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm font-medium rounded-lg"
            >
              Run (Ctrl+Enter)
            </button>
            <button
              onClick={() => setConsoleEntries([])}
              className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium rounded-lg"
            >
              Clear Output
            </button>
            <button
              onClick={() => setWordWrap(w => !w)}
              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${wordWrap ? 'bg-amber-700 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-white'}`}
            >
              Word Wrap
            </button>
            <div className="ml-auto flex items-center gap-2">
              {peerConnected && (
                <span className="flex items-center gap-1.5 text-xs px-2 py-1 bg-green-900 text-green-300 rounded-full font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  Peer connected
                </span>
              )}
              {peerCursor && (
                <span className="text-xs px-2 py-1 bg-purple-900 text-purple-300 rounded-full font-mono">
                  Peer: L{peerCursor.line}:C{peerCursor.col}
                </span>
              )}
            </div>
          </div>

          {/* Editor + Output */}
          <div className="grid grid-cols-5 gap-3" style={{ minHeight: '400px' }}>
            {/* Code editor */}
            <div className="col-span-3 flex flex-col rounded-lg overflow-hidden border border-zinc-700 bg-zinc-950">
              {/* Editor header */}
              <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
                <span className="text-xs text-zinc-400 font-mono">script.js</span>
                <span className="text-xs text-zinc-500 font-mono">L{cursorLine}:C{cursorCol}</span>
              </div>
              {/* Line numbers + textarea */}
              <div className="flex flex-1 overflow-hidden relative">
                {/* Line numbers */}
                <div
                  className="flex-shrink-0 w-10 bg-zinc-900 border-r border-zinc-800 overflow-hidden select-none"
                  aria-hidden
                >
                  <div className="py-2 px-1 text-right font-mono text-xs leading-6 text-zinc-600">
                    {Array.from({ length: Math.max(totalLines, 20) }, (_, i) => (
                      <div
                        key={i}
                        className={i + 1 === cursorLine ? 'text-zinc-300' : ''}
                        style={{ lineHeight: '1.5rem' }}
                      >
                        {i + 1}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  value={code}
                  onChange={handleCodeChange}
                  onKeyDown={handleKeyDown}
                  onClick={handleCursorMove}
                  onKeyUp={handleCursorMove}
                  spellCheck={false}
                  className="flex-1 resize-none bg-transparent text-zinc-200 font-mono text-xs leading-6 py-2 px-3 outline-none border-none"
                  style={{
                    whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
                    overflowWrap: wordWrap ? 'break-word' : 'normal',
                    overflowX: wordWrap ? 'hidden' : 'auto',
                    caretColor: '#60a5fa',
                    minHeight: '100%',
                  }}
                  placeholder="Write JavaScript here..."
                />
              </div>
            </div>

            {/* Output panel */}
            <div className="col-span-2 flex flex-col gap-2">
              {/* iframe preview */}
              <div className="rounded-lg overflow-hidden border border-zinc-700 flex-shrink-0">
                <div className="text-xs text-zinc-500 px-2 py-1 bg-zinc-900 border-b border-zinc-800">Output</div>
                <iframe
                  ref={iframeRef}
                  sandbox="allow-scripts"
                  title="Code output"
                  className="w-full bg-white"
                  style={{ height: '120px', display: 'block' }}
                />
              </div>

              {/* Console output */}
              <div className="flex-1 rounded-lg border border-zinc-700 overflow-hidden flex flex-col">
                <div className="text-xs text-zinc-500 px-2 py-1 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
                  <span>Console</span>
                  <span className="text-zinc-600">{consoleEntries.length} line(s)</span>
                </div>
                <div
                  ref={consoleRef}
                  className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono text-xs"
                  style={{ maxHeight: '240px' }}
                >
                  {consoleEntries.length === 0 ? (
                    <div className="text-zinc-600 italic">No output yet — click Run or press Ctrl+Enter</div>
                  ) : (
                    consoleEntries.map(entry => (
                      <div
                        key={entry.id}
                        className={`py-0.5 px-1 rounded ${entry.isError ? 'text-red-400 bg-red-950/30' : 'text-green-300'}`}
                      >
                        <span className={`mr-1 ${entry.isError ? 'text-red-500' : 'text-zinc-600'}`}>
                          {entry.isError ? '✗' : '>'}
                        </span>
                        {entry.text}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Status bar */}
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{totalLines} lines</span>
            <span>{code.length} chars</span>
            <span className={connected ? 'text-green-400' : 'text-zinc-500'}>
              {connected ? 'DataChannel open' : 'Not connected'}
            </span>
            {peerCursor && (
              <span className="text-purple-400">
                Collaborator at line {peerCursor.line}, col {peerCursor.col}
              </span>
            )}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Code sync + sandboxed execution' }}
      hints={[
        'Ctrl+Enter (or Cmd+Enter) runs the code from the editor',
        'Tab inserts 2 spaces — standard editor behavior',
        'The loopback simulates two peers: edits on one side appear on the other instantly',
        'iframe sandbox="allow-scripts" prevents the executed code from accessing the parent page',
        'Sequence numbers prevent older updates from overwriting newer ones',
      ]}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'HTMLIFrameElement.srcdoc', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/srcdoc' },
        { label: 'Window: postMessage()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage' },
      ]}
    />
  );
}
