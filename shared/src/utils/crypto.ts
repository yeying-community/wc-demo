import { hexToBytes, bytesToHex } from './helpers';

export class Crypto {
  /**
   * 生成密钥对
   */
  static async generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      ['deriveKey', 'deriveBits']
    );

    const publicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    return {
      publicKey: bytesToHex(new Uint8Array(publicKey)),
      privateKey: bytesToHex(new Uint8Array(privateKey)),
    };
  }

  /**
   * 派生共享密钥
   */
  static async deriveSharedKey(
    privateKey: string,
    peerPublicKey: string
  ): Promise<string> {
    const privateKeyBytes = hexToBytes(privateKey);
    const publicKeyBytes = hexToBytes(peerPublicKey);

    const importedPrivateKey = await crypto.subtle.importKey(
      'pkcs8',
      privateKeyBytes,
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      false,
      ['deriveKey', 'deriveBits']
    );

    const importedPublicKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      false,
      []
    );

    const sharedKey = await crypto.subtle.deriveKey(
      {
        name: 'ECDH',
        public: importedPublicKey,
      },
      importedPrivateKey,
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );

    const exportedKey = await crypto.subtle.exportKey('raw', sharedKey);
    return bytesToHex(new Uint8Array(exportedKey));
  }

  /**
   * 加密消息
   */
  static async encrypt(message: string, sharedKey: string): Promise<string> {
    const keyBytes = hexToBytes(sharedKey);
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(message);

    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      encoded
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return bytesToHex(combined);
  }

  /**
   * 解密消息
   */
  static async decrypt(encryptedMessage: string, sharedKey: string): Promise<string> {
    const keyBytes = hexToBytes(sharedKey);
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['decrypt']
    );

    const combined = hexToBytes(encryptedMessage);
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      encrypted
    );

    return new TextDecoder().decode(decrypted);
  }

  /**
   * 生成哈希
   */
  static async hash(data: string): Promise<string> {
    const encoded = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return bytesToHex(new Uint8Array(hashBuffer));
  }
}

