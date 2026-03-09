export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug';

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: unknown;
}

const MAX_ENTRIES = 200;
let _idCounter = 0;

export class Logger {
  private entries: LogEntry[] = [];
  private listeners = new Set<(entries: LogEntry[]) => void>();

  private push(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      id: ++_idCounter,
      timestamp: Date.now(),
      level,
      message,
      data,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    this.notify();
  }

  info(msg: string, data?: unknown): void { this.push('info', msg, data); }
  warn(msg: string, data?: unknown): void { this.push('warn', msg, data); }
  error(msg: string, data?: unknown): void { this.push('error', msg, data); }
  success(msg: string, data?: unknown): void { this.push('success', msg, data); }
  debug(msg: string, data?: unknown): void { this.push('debug', msg, data); }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
    this.notify();
  }

  subscribe(fn: (entries: LogEntry[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.getEntries());
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const snapshot = this.getEntries();
    this.listeners.forEach((fn) => fn(snapshot));
  }
}
