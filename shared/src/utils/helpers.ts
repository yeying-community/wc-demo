/**
 * 生成唯一 ID
 */
export function generateId(): number {
  return Date.now() + Math.floor(Math.random() * 1000000);
}

/**
 * 计算过期时间
 */
export function calcExpiry(seconds: number): number {
  return Date.now() + seconds * 1000;
}

export function generateTopic(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isExpired(expiry: number): boolean {
  return Date.now() >= expiry * 1000;
}

export function calculateExpiry(ttl: number): number {
  return Math.floor(Date.now() / 1000) + ttl;
}

export function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
