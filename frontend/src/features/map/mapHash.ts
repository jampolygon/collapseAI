import { sha256 } from '@noble/hashes/sha256.js';

export const createMapHash = () => sha256.create();
export const mapHashHex = (digest: Uint8Array) => Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');

export async function hashMapBlob(blob: Blob, signal: AbortSignal): Promise<string> {
  const hash = createMapHash();
  try {
    for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
      if (signal.aborted) throw new DOMException('Map download cancelled.', 'AbortError');
      hash.update(new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer()));
    }
    return mapHashHex(hash.digest());
  } finally {
    hash.destroy();
  }
}
