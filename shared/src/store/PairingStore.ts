import { Pairing, PairingStatus, IPairingStore } from '../types/pairing';

/**
 * Pairing 存储实现
 * 
 * 职责：
 * - 持久化 Pairing 数据
 * - 提供查询接口
 * - 自动清理过期数据
 */
export class PairingStore implements IPairingStore {
  private readonly STORAGE_KEY = 'wc_pairings';
  private cache: Map<string, Pairing> = new Map();
  private initialized = false;

  constructor() {
    this.init();
  }

  /**
   * 初始化存储
   */
  private async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const pairings: Pairing[] = JSON.parse(stored);
        pairings.forEach(pairing => {
          this.cache.set(pairing.topic, pairing);
        });
      }
      this.initialized = true;
      
      // 启动时清理过期数据
      await this.deleteExpired();
    } catch (error) {
      console.error('Failed to initialize PairingStore:', error);
      this.cache.clear();
      this.initialized = true;
    }
  }

  /**
   * 持久化到 localStorage
   */
  private async persist(): Promise<void> {
    try {
      const pairings = Array.from(this.cache.values());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(pairings));
    } catch (error) {
      console.error('Failed to persist pairings:', error);
      throw new Error('Failed to save pairing data');
    }
  }

  /**
   * 设置 Pairing
   */
  async set(topic: string, pairing: Pairing): Promise<void> {
    await this.init();
    
    // 验证数据
    if (!topic || !pairing) {
      throw new Error('Invalid pairing data');
    }
    
    if (topic !== pairing.topic) {
      throw new Error('Topic mismatch');
    }

    // 更新时间戳
    pairing.updatedAt = Date.now();

    // 更新缓存
    this.cache.set(topic, pairing);

    // 持久化
    await this.persist();
  }

  /**
   * 获取 Pairing
   */
  async get(topic: string): Promise<Pairing | undefined> {
    await this.init();

    const pairing = this.cache.get(topic);
    
    // 检查是否过期
    if (pairing && this.isExpired(pairing)) {
      await this.delete(topic);
      return undefined;
    }
    
    return pairing;
  }

  /**
   * 删除 Pairing
   */
  async delete(topic: string): Promise<void> {
    await this.init();
    
    this.cache.delete(topic);
    await this.persist();
  }

  /**
   * 获取所有 Pairing
   */
  async getAll(): Promise<Pairing[]> {
    await this.init();

    // 过滤掉过期的
    const pairings = Array.from(this.cache.values()).filter(
      pairing => !this.isExpired(pairing)
    );
    
    return pairings;
  }

  /**
   * 获取所有激活的 Pairing
   */
  async getActive(): Promise<Pairing[]> {
    const all = await this.getAll();
    return all.filter(pairing => pairing.status === PairingStatus.ACTIVE);
  }

  /**
   * 获取所有待处理的 Pairing
   */
  async getPending(): Promise<Pairing[]> {
    const all = await this.getAll();
    return all.filter(pairing => pairing.status === PairingStatus.PENDING);
  }

  /**
   * 删除过期的 Pairing
   */
  async deleteExpired(): Promise<void> {
    await this.init();

    const now = Math.floor(Date.now() / 1000);
    const expired: string[] = [];

    for (const [topic, pairing] of this.cache.entries()) {
      if (pairing.expiry < now) {
        expired.push(topic);
      }
    }

    for (const topic of expired) {
      this.cache.delete(topic);
    }

    if (expired.length > 0) {
      await this.persist();
      console.log(`Deleted ${expired.length} expired pairings`);
    }
  }

  /**
   * 检查 Pairing 是否过期
   */
  private isExpired(pairing: Pairing): boolean {
    const now = Math.floor(Date.now() / 1000);
    return pairing.expiry < now;
  }

  /**
   * 清空所有数据（用于测试）
   */
  async clear(): Promise<void> {
    this.cache.clear();
    localStorage.removeItem(this.STORAGE_KEY);
  }
}

