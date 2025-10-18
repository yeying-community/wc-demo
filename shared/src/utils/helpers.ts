import { Hex } from '../types';

export function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substring(2, 9);
}

export function generateTopic(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function createPairingUri(
  topic: string,
  publicKey: string,
  relay: string
): string {
  const params = new URLSearchParams({
    topic,
    publicKey,
    relay,
  });
  return `yeying:${params.toString()}`;
}

export function parsePairingUri(uri: string): {
  topic: string;
  publicKey: string;
  relay: string;
} | null {
  try {
    const url = uri.replace('yeying:', '');
    const params = new URLSearchParams(url);
    const topic = params.get('topic');
    const publicKey = params.get('publicKey');
    const relay = params.get('relay');

    if (!topic || !publicKey || !relay) {
      return null;
    }

    return { topic, publicKey, relay };
  } catch {
    return null;
  }
}

export function isExpired(expiry: number): boolean {
  return Date.now() >= expiry * 1000;
}

export function calculateExpiry(ttl: number): number {
  return Math.floor(Date.now() / 1000) + ttl;
}

export function hexToBytes(hex: Hex): Uint8Array {
  const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): Hex {
  return '0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

