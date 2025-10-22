import { ICryptoManager, KeyPair, EncryptedData } from '../types/crypto';
import { hexToBytes, bytesToHex } from '../utils/helpers';

/**
 * 浏览器环境加密实现
 * 使用 Web Crypto API
 */
export class CryptoManager implements ICryptoManager {
  private keyPairs: Map<string, KeyPair> = new Map();

  /**
   * 生成随机对称密钥（用于初始 Pairing）
   */
  async generateSymmetricKey(): Promise<string> {
    const key = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );

    const exportedKey = await crypto.subtle.exportKey('raw', key);
    return bytesToHex(new Uint8Array(exportedKey));
  }

  /**
   * 生成密钥对
   */
  async generateKeyPair(): Promise<KeyPair> {
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
    const pair: KeyPair = {
      publicKey: bytesToHex(new Uint8Array(publicKey)),
      privateKey: bytesToHex(new Uint8Array(privateKey)),
    };

    // 缓存密钥对
    this.keyPairs.set(pair.publicKey, pair);

    return pair;
  }

  /**
   * 获取密钥对
   */
  async getKeyPair(publicKey: string): Promise<KeyPair> {
    const keyPair = this.keyPairs.get(publicKey);
    if (!keyPair) {
      throw new Error(`Key pair not found for public key: ${publicKey}`);
    }
    return keyPair;
  }

  /**
   * 设置密钥对
   */
  async setKeyPair(publicKey: string, keyPair: KeyPair): Promise<void> {
    this.keyPairs.set(publicKey, keyPair);
  }

  /**
   * 删除密钥对
   */
  async deleteKeyPair(publicKey: string): Promise<void> {
    this.keyPairs.delete(publicKey);
  }

  /**
   * 生成共享密钥
   */
  async generateSharedKey(privateKey: string, peerPublicKey: string): Promise<string> {
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
   * 加密数据
   */
  async encrypt(message: string, sharedKey: string): Promise<EncryptedData> {
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

    return {
      iv: bytesToHex(iv),
      ciphertext: bytesToHex(new Uint8Array(encrypted)),
    };
  }

  /**
   * 解密数据
   */
  async decrypt(encryptedData: EncryptedData, sharedKey: string): Promise<string> {
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

    const iv = hexToBytes(encryptedData.iv);
    const ciphertext = hexToBytes(encryptedData.ciphertext);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  /**
   * 生成随机主题
   */
  async generateTopic(): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return bytesToHex(bytes);
  }

  /**
   * 哈希数据
   */
  async hash(data: string): Promise<string> {
    const encoded = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return bytesToHex(new Uint8Array(hashBuffer));
  }

  /**
   * 签名数据
   * 注意：Web Crypto API 的 ECDH 不支持签名，需要使用 ECDSA
   */
  async sign(data: string, privateKey: string): Promise<string> {
    // 需要使用 ECDSA 密钥对
    throw new Error('Sign not implemented for browser crypto. Use ECDSA key pair.');
  }

  /**
   * 验证签名
   */
  async verify(data: string, signature: string, publicKey: string): Promise<boolean> {
    throw new Error('Verify not implemented for browser crypto. Use ECDSA key pair.');
  }

  /**
   * 清理
   */
  clear(): void {
    this.keyPairs.clear();
  }
}
