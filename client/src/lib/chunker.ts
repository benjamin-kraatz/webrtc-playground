export const CHUNK_SIZE = 16 * 1024; // 16KB
export const HIGH_WATERMARK = 1024 * 1024; // 1MB
export const LOW_WATERMARK = 256 * 1024;   // 256KB

export interface Chunk {
  seq: number;
  total: number;
  data: ArrayBuffer;
}

export interface FileHeader {
  name: string;
  size: number;
  type: string;
  totalChunks: number;
}

export async function fileToChunks(file: File): Promise<Chunk[]> {
  const buffer = await file.arrayBuffer();
  const chunks: Chunk[] = [];
  const total = Math.ceil(buffer.byteLength / CHUNK_SIZE);

  for (let seq = 0; seq < total; seq++) {
    const start = seq * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
    chunks.push({ seq, total, data: buffer.slice(start, end) });
  }

  return chunks;
}

export function encodeChunk(chunk: Chunk): ArrayBuffer {
  // Header: 4 bytes seq + 4 bytes total = 8 bytes prefix
  const header = new Uint32Array([chunk.seq, chunk.total]);
  const combined = new Uint8Array(8 + chunk.data.byteLength);
  combined.set(new Uint8Array(header.buffer), 0);
  combined.set(new Uint8Array(chunk.data), 8);
  return combined.buffer;
}

export function decodeChunk(buffer: ArrayBuffer): Chunk {
  const header = new Uint32Array(buffer.slice(0, 8));
  return {
    seq: header[0],
    total: header[1],
    data: buffer.slice(8),
  };
}

export function assembleChunks(chunks: Chunk[]): ArrayBuffer {
  const sorted = [...chunks].sort((a, b) => a.seq - b.seq);
  const totalBytes = sorted.reduce((acc, c) => acc + c.data.byteLength, 0);
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of sorted) {
    result.set(new Uint8Array(chunk.data), offset);
    offset += chunk.data.byteLength;
  }
  return result.buffer;
}
