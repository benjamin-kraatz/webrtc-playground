declare module 'culori' {
  export function formatHex(value: unknown): string | undefined;
  export function interpolate(colors: string[], mode: string): (t: number) => unknown;
}
