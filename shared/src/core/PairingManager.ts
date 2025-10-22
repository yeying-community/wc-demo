import { EventEmitter } from 'events';
import {
  Pairing,
  PairingStatus,
  PairingMethod,
  CreatePairingParams,
  CreatePairingResult,
  ActivatePairingParams,
  PairingApproveParams,
  PairingRejectParams,
  PairingDeleteParams,
  PairingUpdateParams,
  IPairingManager,
  IPairingStore,
  AppMetadata,
  Participant,
} from '../types/pairing';
import { PairingStore } from '../store/PairingStore';
import { PairingURIUtil } from '../utils/pairing-uri';
import { IRelay, MessageCallback, RelayMessage, RelayProtocol } from '../types/relay';
import { ICryptoManager } from '../types/crypto';
import { PairingEvent, SessionEvent } from '../types/common';
import { SessionMethod } from '../types/session';

/**
 * Pairing 管理器实现
 * 
 * 职责：
 * - 创建和激活 Pairing
 * - 处理 Pairing 协议消息
 * - 管理 Pairing 生命周期
 * - 发送事件通知
 */
export class PairingManager extends EventEmitter implements IPairingManager {
  private store: IPairingStore;
  private relay: IRelay;
  private cryptoManager: ICryptoManager;
  private appMetadata: AppMetadata;
  private initialized: boolean = false;

  // 等待批准的 Promise 映射
  private pendingApprovals: Map<string, {
    resolve: (pairing: Pairing) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  // Topic 订阅回调映射
  private topicCallbacks: Map<string, MessageCallback> = new Map();

  // 对称密钥存储（topic -> symKey）
  private symKeys: Map<string, string> = new Map();

  // 默认配置
  private static readonly DEFAULT_EXPIRY = 30 * 24 * 60 * 60; // 30 天
  private static readonly APPROVAL_TIMEOUT = 5 * 60 * 1000; // 5 分钟
  private static readonly EXPIRY_CHECK_INTERVAL = 60 * 60 * 1000; // 1 小时
  private static readonly DEFAULT_RELAY: RelayProtocol = {
    protocol: 'irn'
  };

  constructor(relay: IRelay, appMetadata: AppMetadata, cryptoManager: ICryptoManager, store?: IPairingStore) {
    super();
    this.cryptoManager = cryptoManager;
    this.relay = relay;
    this.appMetadata = appMetadata;
    this.store = store || new PairingStore();
  }

  /**
   * 初始化管理器
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // 初始化 relay
      if (!this.relay.isConnected()) {
        await this.relay.init();
        await this.relay.start();
      }

      // 恢复待处理的 Pairing
      await this.restorePendingPairings();

      // 启动过期检查定时器
      this.startExpiryTimer();

      this.initialized = true;
      console.log('[PairingManager] Initialized');
    } catch (error) {
      console.error('[PairingManager] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * 确保已初始化
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PairingManager not initialized. Call initialize() first.');
    }
  }

  /**
   * 创建新的 Pairing（DApp 端使用）
   */
  async create(params?: CreatePairingParams): Promise<CreatePairingResult> {
    this.ensureInitialized();

    try {
      // 生成密钥对
      const { publicKey } = await this.cryptoManager.generateKeyPair();

      // 生成对称密钥（用于初始加密）
      const symKey = await this.cryptoManager.generateSymmetricKey()

      // 生成 topic（使用公钥的哈希）
      const topic = await this.cryptoManager.hash(publicKey);

      // 计算过期时间
      const expiry = Math.floor(Date.now() / 1000) + (params?.expiry || PairingManager.DEFAULT_EXPIRY);

      // 创建 Pairing 对象
      const pairing: Pairing = {
        topic,
        relay: params?.relay || PairingManager.DEFAULT_RELAY,
        self: {
          publicKey,
          appMetadata: params?.appMetadata || this.appMetadata
        },
        peer: {
          publicKey: '', // 等待对方提供
          appMetadata: undefined
        },
        status: PairingStatus.PENDING,
        expiry,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        initiator: true
      };

      // 保存到存储
      await this.store.set(topic, pairing);

      // 保存对称密钥
      this.symKeys.set(topic, symKey);

      // 订阅 topic
      await this.subscribe(topic);

      // 生成 URI
      const uri = PairingURIUtil.encode(
        topic,
        symKey,
        pairing.relay
      );

      // 创建等待批准的 Promise
      const approval = new Promise<Pairing>((resolve, reject) => {
        // 设置超时
        const timeout = setTimeout(() => {
          if (this.pendingApprovals.has(topic)) {
            this.pendingApprovals.delete(topic);
            this.cleanupPairing(topic, 'Approval timeout');
            reject(new Error('Pairing approval timeout'));
          }
        }, PairingManager.APPROVAL_TIMEOUT);

        this.pendingApprovals.set(topic, { resolve, reject, timeout });
      });

      // 发送创建事件
      this.emit(PairingEvent.CREATED, pairing);

      console.log(`[PairingManager] Created: ${topic}`);

      return {
        topic,
        uri,
        pairing,
        approval: () => approval
      };
    } catch (error) {
      console.error('[PairingManager] Failed to create:', error);
      throw error;
    }
  }

  /**
   * 激活 Pairing（Wallet 端使用）
   */
  async activate(params: ActivatePairingParams): Promise<Pairing> {
    this.ensureInitialized();
    // 解析 URI
    const parsed = PairingURIUtil.decode(params.uri);
    // 检查是否已存在
    const existing = await this.store.get(parsed.topic);
    if (existing) {
      throw new Error('Pairing already exists');
    }

    try {
      // 生成密钥对
      const { publicKey, privateKey } = await this.cryptoManager.generateKeyPair();

      // 保存对称密钥
      this.symKeys.set(parsed.topic, parsed.symKey);

      // 订阅 topic
      await this.subscribe(parsed.topic);

      // 计算过期时间
      const expiry = Math.floor(Date.now() / 1000) +
        PairingManager.DEFAULT_EXPIRY;

      // 创建 Pairing 对象
      const pairing: Pairing = {
        topic: parsed.topic,
        relay: parsed.relay,
        self: {
          publicKey,
          appMetadata: params.appMetadata
        },
        peer: {
          publicKey: '', // 暂时为空，等待对方的 approve 消息
          appMetadata: undefined
        },
        status: PairingStatus.ACTIVE,
        expiry,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        initiator: false
      };

      // 保存到存储
      await this.store.set(parsed.topic, pairing);

      // 发送 approve 消息
      const approveParams: PairingApproveParams = {
        relay: parsed.relay,
        responder: {
          publicKey,
          appMetadata: params.appMetadata
        },
        expiry,
        state: {
          appMetadata: params.appMetadata
        }
      };

      await this.publishMessage(parsed.topic, {
        method: PairingMethod.APPROVE,
        params: approveParams
      });

      // 发送批准事件
      this.emit(PairingEvent.ACTIVATED, pairing);

      console.log(`[PairingManager] Activated: ${parsed.topic}`);

      return pairing;
    } catch (error) {
      this.store.delete(parsed.topic);
      console.error('[PairingManager] Failed to activate:', error);
      throw error;
    }
  }

  /**
   * 批准 Pairing（内部使用，处理 approve 消息）
   */
  async approve(topic: string, params: PairingApproveParams): Promise<void> {
    try {
      // 获取 Pairing
      const pairing = await this.store.get(topic);
      if (!pairing) {
        throw new Error('Pairing not found');
      }

      if (pairing.status !== PairingStatus.PENDING) {
        console.log(`Pairing is not pending, status=${pairing.status}`)
        return
      }

      // 更新 Pairing
      pairing.peer = params.responder;
      pairing.status = PairingStatus.ACTIVE;
      pairing.expiry = params.expiry;
      pairing.updatedAt = Date.now();

      // 保存更新
      await this.store.set(topic, pairing);

      // 解决等待的 Promise
      const pending = this.pendingApprovals.get(topic);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(pairing);
        this.pendingApprovals.delete(topic);
      }

      // 发送批准事件
      this.emit(PairingEvent.APPROVED, pairing);

      console.log(`[PairingManager] Approved: ${topic}`);
    } catch (error) {
      console.error('[PairingManager] Failed to approve:', error);
      throw error;
    }
  }

  /**
   * 拒绝 Pairing
   */
  async reject(topic: string, reason: string): Promise<void> {
    this.ensureInitialized();

    try {
      // 获取 Pairing
      const pairing = await this.store.get(topic);
      if (!pairing) {
        throw new Error('Pairing not found');
      }

      // 发送 reject 消息
      const rejectParams: PairingRejectParams = {
        reason: {
          code: 5000,
          message: reason
        }
      };

      await this.publishMessage(topic, {
        method: PairingMethod.REJECT,
        params: rejectParams
      });

      // 清理 Pairing
      await this.cleanupPairing(topic, reason);

      // 拒绝等待的 Promise
      const pending = this.pendingApprovals.get(topic);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(reason));
        this.pendingApprovals.delete(topic);
      }

      // 发送拒绝事件
      this.emit(PairingEvent.REJECTED, { topic, reason });

      console.log(`[PairingManager] Rejected: ${topic}`);
    } catch (error) {
      console.error('[PairingManager] Failed to reject:', error);
      throw error;
    }
  }

  /**
   * 删除 Pairing
   */
  async delete(topic: string, reason: string): Promise<void> {
    this.ensureInitialized();

    try {
      // 获取 Pairing
      const pairing = await this.store.get(topic);
      if (!pairing) {
        return; // 已经删除
      }

      // 发送 delete 消息
      const deleteParams: PairingDeleteParams = {
        reason: {
          code: 6000,
          message: reason
        }
      };

      try {
        await this.publishMessage(topic, {
          method: PairingMethod.DELETE,
          params: deleteParams
        });
      } catch (error) {
        // 忽略发送失败（对方可能已离线）
        console.warn('[PairingManager] Failed to send delete message:', error);
      }

      // 清理 Pairing
      await this.cleanupPairing(topic, reason);

      // 发送删除事件
      this.emit(PairingEvent.DELETED, { topic, reason });

      console.log(`[PairingManager] Deleted: ${topic}`);
    } catch (error) {
      console.error('[PairingManager] Failed to delete:', error);
      throw error;
    }
  }

  /**
   * 更新元数据
   */
  async update(topic: string, appMetadata: AppMetadata): Promise<void> {
    this.ensureInitialized();

    try {
      // 获取 Pairing
      const pairing = await this.store.get(topic);
      if (!pairing) {
        throw new Error('Pairing not found');
      }

      if (pairing.status !== PairingStatus.ACTIVE) {
        throw new Error('Pairing is not active');
      }

      // 更新元数据
      pairing.self.appMetadata = appMetadata;
      pairing.updatedAt = Date.now();

      // 保存更新
      await this.store.set(topic, pairing);

      // 发送 update 消息
      const updateParams: PairingUpdateParams = {
        appMetadata
      };

      await this.publishMessage(topic, {
        method: PairingMethod.UPDATE,
        params: updateParams
      });

      // 发送更新事件
      this.emit(PairingEvent.UPDATED, pairing);

      console.log(`[PairingManager] Updated: ${topic}`);
    } catch (error) {
      console.error('[PairingManager] Failed to update:', error);
      throw error;
    }
  }

  /**
   * 转发 Session 消息
   */
  async forward(topic: string, method: string, params: any): Promise<void> {
    this.ensureInitialized();

    try {
      const pairing = await this.store.get(topic);
      if (!pairing) {
        throw new Error('Pairing not found');
      }

      if (pairing.status !== PairingStatus.ACTIVE) {
        throw new Error('Pairing is not active');
      }

      // 发送消息
      await this.publishMessage(topic, {
        method: method,
        params: params,
      });

      console.log(`[PairingManager] Sent ${method} ${params.proposalId} on pairing: ${topic}`);
    } catch (error) {
      console.error('[PairingManager] Failed to send session propose:', error);
      throw error;
    }
  }

  /**
   * 发送 ping
   */
  async ping(topic: string): Promise<void> {
    this.ensureInitialized();

    try {
      // 获取 Pairing
      const pairing = await this.store.get(topic);
      if (!pairing) {
        throw new Error('Pairing not found');
      }

      if (pairing.status !== PairingStatus.ACTIVE) {
        throw new Error('Pairing is not active');
      }

      // 发送 ping 消息
      await this.publishMessage(topic, {
        method: PairingMethod.PING,
        params: {}
      });

      console.log(`[PairingManager] Sent ping: ${topic}`);
    } catch (error) {
      console.error('[PairingManager] Failed to ping:', error);
      throw error;
    }
  }

  /**
   * 获取 Pairing
   */
  async get(topic: string): Promise<Pairing | undefined> {
    return this.store.get(topic);
  }

  /**
   * 获取所有 Pairing
   */
  async getAll(): Promise<Pairing[]> {
    return this.store.getAll();
  }

  /**
   * 获取活跃的 Pairing
   */
  async getActive(): Promise<Pairing[]> {
    const all = await this.store.getAll();
    return all.filter(p => p.status === PairingStatus.ACTIVE);
  }

  /**
   * 订阅 topic
   */
  private async subscribe(topic: string): Promise<void> {
    // 创建消息回调
    const callback: MessageCallback = async (relayMessage: RelayMessage) => {
      await this.handleRelayMessage(topic, relayMessage.payload);
    };

    // 保存回调引用
    this.topicCallbacks.set(topic, callback);

    // 订阅 topic
    await this.relay.subscribe(topic, callback);

    console.log(`[PairingManager] Subscribed to topic: ${topic}`);
  }

  /**
   * 取消订阅 topic
   */
  private async unsubscribe(topic: string): Promise<void> {
    try {
      // 取消订阅
      await this.relay.unsubscribe(topic);

      // 删除回调引用
      this.topicCallbacks.delete(topic);

      console.log(`[PairingManager] Unsubscribed from topic: ${topic}`);
    } catch (error) {
      console.error(`[PairingManager] Failed to unsubscribe from topic ${topic}:`, error);
    }
  }

  /**
   * 发布消息到 topic
   */
  private async publishMessage(topic: string, message: any): Promise<void> {
    try {
      // 序列化消息
      const payload = JSON.stringify(message);

      // 发布消息
      await this.relay.publish(topic, payload);

      console.log(`[PairingManager] Published message to ${topic}:`, message.method);
    } catch (error) {
      console.error(`[PairingManager] Failed to publish message to ${topic}:`, error);
      throw error;
    }
  }

  /**
   * 处理中继消息
   */
  private async handleRelayMessage(topic: string, payload: string): Promise<void> {
    try {
      // 解析消息
      const message = JSON.parse(payload);

      // 获取 Pairing
      const pairing = await this.store.get(topic);
      if (!pairing) {
        console.warn(`[PairingManager] Received message for unknown topic: ${topic}`);
        return;
      }

      console.log(`[PairingManager] Received message on ${topic}:`, message.method);

      // 根据方法分发处理
      switch (message.method) {
        case PairingMethod.APPROVE:
          await this.handleApprove(topic, message.params);
          break;

        case PairingMethod.REJECT:
          await this.handleReject(topic, message.params);
          break;

        case PairingMethod.UPDATE:
          await this.handleUpdate(topic, message.params);
          break;

        case PairingMethod.DELETE:
          await this.handleDelete(topic, message.params);
          break;

        case PairingMethod.PING:
          await this.handlePing(topic, message.params);
          break;

        // Session 消息
        case SessionMethod.PROPOSE:
          await this.handleSessionPropose(topic, message.params);
          break;

        case SessionMethod.SETTLE:
          await this.handleSessionSettle(topic, message.params);
          break; 

        case SessionMethod.REJECT:
          await this.handleSessionReject(topic, message.params);
          break;

        case PairingEvent.PONG:
          await this.handlePong(topic, message.params);
          break;

        default:
          console.warn(`[PairingManager] Unknown method: ${message.method}`);
      }
    } catch (error) {
      console.error('[PairingManager] Failed to handle relay message:', error);
    }
  }

  /**
   * 处理 approve 消息
   */
  private async handleApprove(
    topic: string,
    params: PairingApproveParams
  ): Promise<void> {
    await this.approve(topic, params);
  }

  /**
   * 处理 reject 消息
   */
  private async handleReject(
    topic: string,
    params: PairingRejectParams
  ): Promise<void> {
    // 获取 Pairing
    const pairing = await this.store.get(topic);
    if (!pairing) {
      return;
    }

    // 清理 Pairing
    await this.cleanupPairing(topic, params.reason.message);

    // 拒绝等待的 Promise
    const pending = this.pendingApprovals.get(topic);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(params.reason.message));
      this.pendingApprovals.delete(topic);
    }

    // 发送拒绝事件
    this.emit(PairingEvent.REJECTED, {
      topic,
      reason: params.reason.message
    });

    console.log(`[PairingManager] Received reject: ${topic}`);
  }

  /**
   * 处理 update 消息
   */
  private async handleUpdate(
    topic: string,
    params: PairingUpdateParams
  ): Promise<void> {
    // 获取 Pairing
    const pairing = await this.store.get(topic);
    if (!pairing) {
      return;
    }

    // 更新对方元数据
    if (pairing.peer) {
      pairing.peer.appMetadata = params.appMetadata;
      pairing.updatedAt = Date.now();

      // 保存更新
      await this.store.set(topic, pairing);

      // 发送更新事件
      this.emit(PairingEvent.UPDATED, pairing);

      console.log(`[PairingManager] Received update: ${topic}`);
    }
  }

  /**
   * 处理 delete 消息
   */
  private async handleDelete(
    topic: string,
    params: PairingDeleteParams
  ): Promise<void> {
    // 清理 Pairing
    await this.cleanupPairing(topic, params.reason.message);

    // 发送删除事件
    this.emit(PairingEvent.DELETED, {
      topic,
      reason: params.reason.message
    });

    console.log(`[PairingManager] Received delete: ${topic}`);
  }

  /**
   * 处理 ping 消息
   */
  private async handlePing(topic: string, params: any): Promise<void> {
    // 获取 Pairing
    const pairing = await this.store.get(topic);
    if (!pairing) {
      return;
    }

    // 发送 pong 响应
    await this.publishMessage(topic, {
      method: 'pairing_pong',
      params: {}
    });

    console.log(`[PairingManager] Received ping: ${topic}`);
  }

  /**
   * 处理 Session Propose 消息（转发）
   */
  private async handleSessionPropose(pairingTopic: string, params: any): Promise<void> {
    console.log(`[PairingManager] Forwarding session_propose from pairing: ${pairingTopic}`);
    this.emit(SessionEvent.PROPOSAL, params);
  }

  /**
   * 处理 Session Settle 消息（转发）
   */
  private async handleSessionSettle(pairingTopic: string, params: any): Promise<void> {
    console.log(`[PairingManager] Forwarding session_settle from pairing: ${pairingTopic}`);
    this.emit(SessionEvent.SETTLED, params);
  }

  /**
   * 处理 Session Reject 消息（转发）
   */
  private async handleSessionReject(pairingTopic: string, params: any): Promise<void> {
    console.log(`[PairingManager] Forwarding session_reject from pairing: ${pairingTopic}`);
    this.emit(SessionEvent.REJECTED, params);
  }

  /**
   * 处理 pong 消息
   */
  private async handlePong(topic: string, params: any): Promise<void> {
    console.log(`[PairingManager] Received pong: ${topic}`);
  }

  /**
   * 清理 Pairing 资源
   */
  private async cleanupPairing(topic: string, reason: string): Promise<void> {
    try {
      // 删除存储
      await this.store.delete(topic);

      // 取消订阅
      await this.unsubscribe(topic);

      // 删除对称密钥
      this.symKeys.delete(topic);

      console.log(`[PairingManager] Cleaned up pairing: ${topic}, reason: ${reason}`);
    } catch (error) {
      console.error(`[PairingManager] Failed to cleanup pairing ${topic}:`, error);
    }
  }

  /**
   * 恢复待处理的 Pairing
   */
  private async restorePendingPairings(): Promise<void> {
    try {
      const pairings = await this.store.getAll();

      for (const pairing of pairings) {
        // 检查是否过期
        if (this.isExpired(pairing)) {
          await this.cleanupPairing(pairing.topic, 'Expired');
          continue;
        }

        // 重新订阅活跃的 Pairing
        if (pairing.status === PairingStatus.ACTIVE) {
          // 注意：这里需要从安全存储中恢复 symKey
          // 实际实现中，symKey 应该被持久化存储
          // 这里假设 symKey 已经在 this.symKeys 中
          const symKey = this.symKeys.get(pairing.topic);
          if (symKey) {
            await this.subscribe(pairing.topic);
            console.log(`[PairingManager] Restored: ${pairing.topic}`);
          } else {
            console.warn(`[PairingManager] Cannot restore ${pairing.topic}: symKey not found`);
            // 如果找不到 symKey，删除这个 pairing
            await this.cleanupPairing(pairing.topic, 'SymKey not found');
          }
        }
      }

      console.log(`[PairingManager] Restored ${pairings.length} pairings`);
    } catch (error) {
      console.error('[PairingManager] Failed to restore pairings:', error);
    }
  }

  /**
   * 启动过期检查定时器
   */
  private expiryTimer?: NodeJS.Timeout;

  private startExpiryTimer(): void {
    // 清除现有定时器
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
    }

    // 每小时检查一次
    this.expiryTimer = setInterval(async () => {
      try {
        const pairings = await this.store.getAll();

        for (const pairing of pairings) {
          if (this.isExpired(pairing)) {
            await this.delete(pairing.topic, 'Expired');
          }
        }
      } catch (error) {
        console.error('[PairingManager] Failed to check expiry:', error);
      }
    }, PairingManager.EXPIRY_CHECK_INTERVAL);

    console.log('[PairingManager] Started expiry timer');
  }

  /**
   * 停止过期检查定时器
   */
  private stopExpiryTimer(): void {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = undefined;
      console.log('[PairingManager] Stopped expiry timer');
    }
  }

  /**
   * 检查是否过期
   */
  private isExpired(pairing: Pairing): boolean {
    const now = Math.floor(Date.now() / 1000);
    return now >= pairing.expiry;
  }

  /**
   * 清理资源
   */
  async destroy(): Promise<void> {
    try {
      console.log('[PairingManager] Destroying...');

      // 停止过期检查定时器
      this.stopExpiryTimer();

      // 删除所有 Pairing
      const pairings = await this.store.getAll();

      for (const pairing of pairings) {
        try {
          await this.delete(pairing.topic, 'Client destroyed');
        } catch (error) {
          console.error(`[PairingManager] Failed to delete pairing ${pairing.topic}:`, error);
        }
      }

      // 清空待处理的批准
      for (const [topic, pending] of this.pendingApprovals) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Client destroyed'));
      }
      this.pendingApprovals.clear();

      // 清空对称密钥
      this.symKeys.clear();

      // 清空回调
      this.topicCallbacks.clear();

      // 停止 relay
      try {
        await this.relay.stop();
      } catch (error) {
        console.error('[PairingManager] Failed to stop relay:', error);
      }

      // 移除所有监听器
      this.removeAllListeners();

      this.initialized = false;

      console.log('[PairingManager] Destroyed');
    } catch (error) {
      console.error('[PairingManager] Failed to destroy:', error);
      throw error;
    }
  }

  /**
   * 获取对称密钥（用于测试或调试）
   */
  getSymKey(topic: string): string | undefined {
    return this.symKeys.get(topic);
  }

  /**
   * 设置对称密钥（用于恢复会话）
   */
  setSymKey(topic: string, symKey: string): void {
    this.symKeys.set(topic, symKey);
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 检查 relay 连接状态
   */
  isRelayConnected(): boolean {
    return this.relay.isConnected();
  }
}

