/**
 * 密钥对
 */
export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * 加密数据
 */
export interface EncryptedData {
  iv: string;
  publicKey?: string;
  mac?: string;
  ciphertext: string;
}

/**
 * 加密接口
 */
export interface ICryptoManager {
  /**
   * 生成对称密钥
   */
  generateSymmetricKey(): Promise<string> 

  /**
   * 生成密钥对
   */
  generateKeyPair(): Promise<KeyPair>;

  /**
   * 获取密钥对
   */
  getKeyPair(publicKey: string): Promise<KeyPair>;

  /**
   * 设置密钥对
   */
  setKeyPair(publicKey: string, keyPair: KeyPair): Promise<void>;

  /**
   * 删除密钥对
   */
  deleteKeyPair(publicKey: string): Promise<void>;

 /**
   * 生成共享密钥
   */
  generateSharedKey(privateKey: string, publicKey: string): Promise<string>;

  /**
   * 加密数据
   */
  encrypt(data: string, sharedKey: string): Promise<EncryptedData>;

  /**
   * 解密数据
   */
  decrypt(encryptedData: EncryptedData, sharedKey: string): Promise<string>;

  /**
   * 生成随机主题
   */
  generateTopic(): Promise<string>;

  /**
   * 哈希数据
   */
  hash(data: string): Promise<string>;

  /**
   * 签名数据
   */
  sign(data: string, privateKey: string): Promise<string>;

  /**
   * 验证签名
   */
  verify(data: string, signature: string, publicKey: string): Promise<boolean>;

  /**
   * 清理
   */
  clear(): void;
}
