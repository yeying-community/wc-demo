import { EventEmitter } from 'events';
import { IRelay, MessageCallback, RelayMessage, RelayProtocol } from '../types/relay';
import {
  ISessionManager,
  ISessionStore,
  SessionData,
  SessionProposal,
  SessionStatus,
  SessionRequest,
  SessionResponse,
  SessionUpdate,
  SessionExtend,
  SessionDisconnect,
  SessionError,
  SessionErrorCode,
  SessionMethod,
  SessionMetadata,
  ProposeSessionParams,
  ApproveSessionParams,
  SessionSettle,
  RejectSessionParams,
  SessionReject,
  SessionNamespaces
} from '../types/session';
import { SessionStore } from '../store/SessionStore';
import { ICryptoManager } from '../types/crypto';
import { IPairingManager } from '../types/pairing';
import { SessionEvent } from '../types/common';
import { calcExpiry, generateId } from '../utils/helpers';
import { METHODS } from 'http';

/**
 * Session Manager 实现
 */
export class SessionManager extends EventEmitter implements ISessionManager {
  private relay: IRelay | null = null;
  private cryptoManager: ICryptoManager;
  private pairingManager: IPairingManager | null = null; // 添加
  private store: ISessionStore;
  private sessionMetadata: SessionMetadata;

  private pendingRequests: Map<number, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  private initialized = false;
  private messageCallback: MessageCallback | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  // 常量
  private readonly SESSION_EXPIRY = 7 * 24 * 60 * 60; // 7 天
  private readonly PROPOSAL_EXPIRY = 5 * 60; // 5 分钟
  private readonly REQUEST_TIMEOUT = 5 * 60 * 1000; // 5 分钟
  private readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 小时

  constructor(
    sessionMetadata: SessionMetadata,
    cryptoManager: ICryptoManager,
    store?: ISessionStore,
  ) {
    super();
    this.sessionMetadata = sessionMetadata;
    this.cryptoManager = cryptoManager;
    this.store = store || new SessionStore();
  }

  /**
   * 设置 Pairing Manager（重要！）
   */
  setPairingManager(pairingManager: IPairingManager, isWallet: boolean): void {
    this.pairingManager = pairingManager;

    // 监听 Pairing 转发的 Session 消息
    if (isWallet) {
      pairingManager.on(SessionEvent.PROPOSAL, this.handleSessionProposeFromPairing.bind(this));
    } else {
      pairingManager.on(SessionEvent.SETTLED, this.handleSessionSettleFromPairing.bind(this));
      pairingManager.on(SessionEvent.REJECTED, this.handleSessionRejectFromPairing.bind(this));
    }
  }

  /**
   * 初始化
   */
  async init(relay: IRelay): Promise<void> {
    if (this.initialized) {
      console.warn('[SessionManager] Already initialized');
      return;
    }

    if (!this.pairingManager) {
      throw new Error('PairingManager not set. Call setPairingManager() first.');
    }

    this.relay = relay;

    // 设置消息监听
    await this.setupMessageHandlers();

    // 清理过期的 Session 和提议
    await this.cleanupExpired();

    // 启动清理定时器
    this.startCleanupTimer();

    this.initialized = true;
    console.log('[SessionManager] Initialized');
  }

  /**
   * 提议 Session
   */
  async propose(params: ProposeSessionParams): Promise<SessionProposal> {
    this.ensureInitialized();

    try {
      // 生成提议 ID
      const proposalId = generateId();

      // 生成密钥对
      const keyPair = await this.cryptoManager.generateKeyPair();

      // 获取 relay 协议
      const relay: RelayProtocol = params.relays?.[0] || {
        protocol: this.relay!.getProtocol().protocol
      };

      // 创建提议
      const proposal: SessionProposal = {
        proposalId,
        pairingTopic: params.pairingTopic,
        proposer: {
          publicKey: keyPair.publicKey,
          metadata: this.sessionMetadata
        },
        requiredNamespaces: params.requiredNamespaces,
        optionalNamespaces: params.optionalNamespaces,
        relay,                                    // 主 relay
        relays: params.relays,                    // 备用 relay 列表
        expiryTimestamp: calcExpiry(this.PROPOSAL_EXPIRY)
      };

      // 保存提议
      await this.store.setProposal(proposalId, proposal);

      // 通过 PairingManager 发送提议（在 Pairing Topic 上）
      if (this.pairingManager) {
        await this.pairingManager.forward(params.pairingTopic, SessionMethod.PROPOSE, proposal)
      }

      console.log('[SessionManager] Session proposed:', proposalId);

      return proposal;
    } catch (error) {
      console.error('[SessionManager] Failed to propose session:', error);
      throw error;
    }
  }

  /**
   * 批准 Session 提议（Wallet 端）
   */
  async approve(params: ApproveSessionParams): Promise<SessionData> {
    this.ensureInitialized();
    if (!this.pairingManager) {
      throw new Error('PairingManager not set');
    }

    try {
      // 获取提议（使用 proposalId）
      const proposal = await this.store.getProposal(params.proposalId);
      if (!proposal) {
        throw new SessionError(
          SessionErrorCode.PROPOSAL_NOT_FOUND,
          `Proposal not found: ${params.proposalId}`
        );
      }

      // 检查提议是否过期
      if (Date.now() > proposal.expiryTimestamp) {
        throw new SessionError(
          SessionErrorCode.PROPOSAL_EXPIRED,
          'Proposal has expired'
        );
      }

      // 验证命名空间
      this.validateNamespaces(params.namespaces, proposal.requiredNamespaces);

      // 生成密钥对
      const keyPair = await this.cryptoManager.generateKeyPair();

      // 生成 Session topic
      const sessionTopic = await this.cryptoManager.generateSharedKey(
        keyPair.privateKey,
        proposal.proposer.publicKey,
      );

      // 计算过期时间
      const expiry = calcExpiry(this.SESSION_EXPIRY);

      // 创建 Session 数据
      const session: SessionData = {
        topic: sessionTopic,
        pairingTopic: proposal.pairingTopic,
        relay: proposal.relay,
        expiry,
        acknowledged: false,
        controller: keyPair.publicKey,
        namespaces: params.namespaces,
        requiredNamespaces: proposal.requiredNamespaces,
        optionalNamespaces: proposal.optionalNamespaces,
        self: {
          publicKey: keyPair.publicKey,
          metadata: this.sessionMetadata
        },
        peer: {
          publicKey: proposal.proposer.publicKey,
          metadata: proposal.proposer.metadata
        },
        status: SessionStatus.SETTLED,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        proposalId: params.proposalId  // 保存 proposalId 用于追踪
      };

      // 保存 Session
      await this.store.set(sessionTopic, session);

      // 订阅 Session topic
      if (this.messageCallback) {
        await this.relay!.subscribe(sessionTopic, this.messageCallback);
      }

      // 通过 PairingManager 发送 settle 消息（在 Pairing Topic 上）
      const sessionSettle: SessionSettle = {
        proposalId: params.proposalId,
        pairingTopic: proposal.pairingTopic,
        relay: session.relay,
        namespaces: session.namespaces,
        requiredNamespaces: session.requiredNamespaces,
        optionalNamespaces: session.optionalNamespaces,
        controller: {
          publicKey: session.self.publicKey,
          metadata: session.self.metadata
        },
        expiry: session.expiry
      }

      await this.pairingManager.forward(proposal.pairingTopic, SessionMethod.SETTLE, sessionSettle);

      // 清理提议
      await this.store.deleteProposal(params.proposalId);

      console.log('[SessionManager] Session approved:', sessionTopic);

      return session;
    } catch (error) {
      console.error('[SessionManager] Failed to approve session:', error);
      throw error;
    }
  }

  /**
   * 拒绝 Session 提议（Wallet 端）
   */
  async reject(params: RejectSessionParams): Promise<void> {
    this.ensureInitialized();

    if (!this.pairingManager) {
      throw new SessionError(
        SessionErrorCode.UNKNOWN_ERROR,
        'PairingManager not set'
      );
    }

    try {
      // 获取提议
      const proposal = await this.store.getProposal(params.proposalId);
      if (!proposal) {
        throw new SessionError(
          SessionErrorCode.PROPOSAL_NOT_FOUND,
          `Proposal not found: ${params.proposalId}`
        );
      }

      // 通过 PairingManager 在 Pairing Topic 上发送错误响应
      const sessionReject: SessionReject = {
        proposalId: params.proposalId,
        reason: params.reason
      }

      await this.pairingManager.forward(proposal.pairingTopic, SessionMethod.REJECT, sessionReject);

      // 清理提议
      await this.store.deleteProposal(params.proposalId);

      console.log('[SessionManager] Session proposal rejected:', params.proposalId);

    } catch (error) {
      console.error('[SessionManager] Failed to reject session proposal:', error);
      throw error;
    }
  }

  /**
   * 更新 Session
   */
  async update(params: SessionUpdate): Promise<void> {
    this.ensureInitialized();

    const session = await this.store.get(params.topic);
    if (!session) {
      throw new SessionError(
        SessionErrorCode.SESSION_NOT_FOUND,
        `Session not found: ${params.topic}`
      );
    }

    // 检查 Session 状态
    if (session.status !== SessionStatus.SETTLED) {
      throw new SessionError(
        SessionErrorCode.SESSION_SETTLED,
        'Session is not settled'
      );
    }

    // 更新命名空间
    session.namespaces = params.namespaces;
    session.updatedAt = Date.now();

    // 保存更新
    await this.store.set(params.topic, session);

    // 发送更新消息
    await this.sendMessage(params.topic, {
      method: SessionMethod.UPDATE,
      params: {
        namespaces: params.namespaces
      }
    });

    console.log('[SessionManager] Session updated:', params.topic);
    super.emit(SessionEvent.UPDATED, session);
  }

  /**
   * 延长 Session
   */
  async extend(params: SessionExtend): Promise<void> {
    this.ensureInitialized();

    const session = await this.store.get(params.topic);
    if (!session) {
      throw new SessionError(
        SessionErrorCode.SESSION_NOT_FOUND,
        `Session not found: ${params.topic}`
      );
    }

    // 更新过期时间
    session.expiry = params.expiry;
    session.updatedAt = Date.now();

    // 保存更新
    await this.store.set(params.topic, session);

    // 发送延长消息
    await this.sendMessage(params.topic, {
      method: SessionMethod.EXTEND,
      params: {
        expiry: params.expiry
      }
    });

    console.log('[SessionManager] Session extended:', params.topic);
    super.emit(SessionEvent.EXTENDED, session);
  }

  /**
   * 断开 Session
   */
  async disconnect(params: SessionDisconnect): Promise<void> {
    this.ensureInitialized();

    const session = await this.store.get(params.topic);
    if (!session) {
      console.warn('[SessionManager] Session not found:', params.topic);
      return;
    }

    // 发送断开消息
    try {
      await this.sendMessage(params.topic, {
        method: SessionMethod.DELETE,
        params: {
          reason: params.reason
        }
      });
    } catch (error) {
      console.error('[SessionManager] Failed to send disconnect message:', error);
    }

    // 取消订阅
    await this.relay!.unsubscribe(params.topic);

    // 更新状态
    session.status = SessionStatus.DISCONNECTED;
    session.updatedAt = Date.now();
    await this.store.set(params.topic, session);

    // 删除 Session
    await this.store.delete(params.topic);

    console.log('[SessionManager] Session disconnected:', params.topic);
    super.emit(SessionEvent.DELETED, { topic: params.topic, reason: params.reason });
  }

  /**
   * Ping Session
   */
  async ping(topic: string): Promise<void> {
    this.ensureInitialized();

    const session = await this.store.get(topic);
    if (!session) {
      throw new SessionError(
        SessionErrorCode.SESSION_NOT_FOUND,
        `Session not found: ${topic}`
      );
    }

    const id = generateId();

    // 发送 Ping 消息
    await this.sendMessage(topic, {
      method: SessionMethod.PING,
      params: { id }
    });

    console.log('[SessionManager] Session pinged:', topic);
  }

  /**
   * 发送请求
   */
  async request(request: Omit<SessionRequest, 'id'>): Promise<any> {
    this.ensureInitialized();

    const session = await this.store.get(request.topic);
    if (!session) {
      throw new SessionError(
        SessionErrorCode.SESSION_NOT_FOUND,
        `Session not found: ${request.topic}`
      );
    }

    // 检查 Session 状态
    if (session.status !== SessionStatus.SETTLED) {
      throw new SessionError(
        SessionErrorCode.SESSION_SETTLED,
        'Session is not settled'
      );
    }

    // 验证方法是否支持
    const isSupported = Object.values(session.namespaces).some(
      ns => ns.methods.includes(request.method)
    );

    if (!isSupported) {
      throw new SessionError(
        SessionErrorCode.INVALID_METHOD,
        `Method not supported: ${request.method}`
      );
    }

    const id = generateId();

    // 创建 Promise 用于等待响应
    return new Promise((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new SessionError(
          SessionErrorCode.UNKNOWN_ERROR,
          'Request timeout'
        ));
      }, this.REQUEST_TIMEOUT);

      // 保存请求
      this.pendingRequests.set(id, { resolve, reject, timeout });

      // 发送请求消息
      this.sendMessage(request.topic, {
        method: SessionMethod.REQUEST,
        params: {
          id,
          method: request.method,
          params: request.params,
          chainId: request.chainId
        }
      }).catch(error => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      });

      console.log('[SessionManager] Request sent:', { id, method: request.method });
    });
  }

  /**
   * 响应请求
   */
  async respond(response: SessionResponse): Promise<void> {
    this.ensureInitialized();

    const session = await this.store.get(response.topic);
    if (!session) {
      throw new SessionError(
        SessionErrorCode.SESSION_NOT_FOUND,
        `Session not found: ${response.topic}`
      );
    }

    // 发送响应消息
    await this.sendMessage(response.topic, {
      method: SessionMethod.RESPONSE,
      params: {
        id: response.id,
        result: response.result,
        error: response.error
      }
    });

    console.log('[SessionManager] Response sent:', response.id);
  }

  /**
   * 获取 Session
   */
  get(topic: string): SessionData | undefined {
    // 同步方法，从内存缓存获取
    const sessions = (this.store as SessionStore)['sessions'];
    return sessions?.get(topic);
  }

  /**
   * 获取所有 Session
   */
  getAll(): SessionData[] {
    const sessions = (this.store as SessionStore)['sessions'];
    return sessions ? Array.from(sessions.values()) : [];
  }

  /**
   * 查找 Session
   */
  find(predicate: (session: SessionData) => boolean): SessionData | undefined {
    return this.getAll().find(predicate);
  }

  /**
   * 清理过期的 Session 和提议
   */
  async cleanup(): Promise<void> {
    await this.cleanupExpired();
  }

  /**
 * 处理从 Pairing 转发的 Session Propose
 */
  private async handleSessionProposeFromPairing(params: any): Promise<void> {
    try {
      const proposalId = params.proposalId
      const pairingTopic = params.pairingTopic

      // 创建提议对象
      const proposal: SessionProposal = {
        proposalId,
        pairingTopic,
        proposer: params.proposer,
        requiredNamespaces: params.requiredNamespaces,
        optionalNamespaces: params.optionalNamespaces,
        relay: params.relays[0],
        relays: params.relays,
        expiryTimestamp: params.expiryTimestamp
      };

      // 保存提议
      await this.store.setProposal(proposalId, proposal);

      console.log('[SessionManager] Session proposal received from pairing:', proposalId);

      // 触发事件
      this.emit(SessionEvent.PROPOSAL, proposal);
    } catch (error) {
      console.error('[SessionManager] Failed to handle session propose:', error);
    }
  }

  private async handleSessionRejectFromPairing(params: any): Promise<void> {
    try {
      const { proposalId, reason } = params;

      // 删除提议
      await this.store.deleteProposal(proposalId);

      console.log('[SessionManager] Session reject from pairing:', proposalId);

      // 触发事件
      this.emit(SessionEvent.REJECTED, reason);
    } catch (error) {
      console.error('[SessionManager] Failed to handle session reject:', error);
    }
  }

  /**
   * 处理从 Pairing 转发的 Session Settle
   */
  private async handleSessionSettleFromPairing(params: any): Promise<void> {
    try {
      const { proposalId, pairingTopic } = params;

      // 查找对应的提议
      const proposals = await this.store.getAllProposals();
      const proposal = proposals.find(p => p.proposalId === proposalId && p.pairingTopic === pairingTopic);

      if (!proposal) {
        console.warn('[SessionManager] No matching proposal found for settle:', proposalId);
        return;
      }

      // 生成 Session topic
      const keyPair = await this.cryptoManager.getKeyPair(proposal.proposer.publicKey);
      const sessionTopic = await this.cryptoManager.generateSharedKey(
        keyPair.privateKey,
        params.controller.publicKey
      );

      // 创建 Session
      const session: SessionData = {
        topic: sessionTopic,
        pairingTopic: proposal.pairingTopic,
        relay: params.relay,
        expiry: params.expiry,
        acknowledged: true,
        controller: params.controller.publicKey,
        namespaces: params.namespaces,
        requiredNamespaces: params.requiredNamespaces,
        optionalNamespaces: params.optionalNamespaces,
        self: {
          publicKey: proposal.proposer.publicKey,
          metadata: proposal.proposer.metadata
        },
        peer: {
          publicKey: params.controller.publicKey,
          metadata: params.controller.metadata
        },
        status: SessionStatus.SETTLED,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        proposalId: proposal.proposalId
      };

      // 保存 Session
      await this.store.set(sessionTopic, session);

      // 订阅 Session topic
      if (this.messageCallback) {
        await this.relay!.subscribe(sessionTopic, this.messageCallback);
      }

      // 删除提议
      await this.store.deleteProposal(proposal.proposalId);

      console.log('[SessionManager] Session settled from pairing:', sessionTopic);

      // 触发事件
      this.emit(SessionEvent.SETTLED, session);
    } catch (error) {
      console.error('[SessionManager] Failed to handle session settle:', error);
    }
  }

  /**
   * 设置消息处理器
   */
  private async setupMessageHandlers(): Promise<void> {
    if (!this.relay) return;

    this.messageCallback = async (message: RelayMessage) => {
      try {
        await this.handleRelayMessage(message.topic, message.payload);
      } catch (error) {
        console.error('[SessionManager] Failed to handle message:', error);
      }
    };

    // 恢复已有的 Session 订阅
    const sessions = this.getAll();
    console.log(`[SessionManager] Restoring ${sessions.length} session subscriptions`);

    for (const session of sessions) {
      try {
        // 只订阅已建立的 Session
        if (session.status === SessionStatus.SETTLED) {
          await this.relay.subscribe(session.topic, this.messageCallback);
          console.log('[SessionManager] Restored subscription for:', session.topic);
        }
      } catch (error) {
        console.error('[SessionManager] Failed to restore subscription:', session.topic, error);
      }
    }
  }

  /**
   * 处理 Relay 消息
   */
  private async handleRelayMessage(topic: string, payload: string): Promise<void> {
    try {
      const message = JSON.parse(payload);
      await this.handleMessage(topic, message);
    } catch (error) {
      console.error('[SessionManager] Failed to parse message:', error);
    }
  }

  /**
   * 处理消息
   */
  private async handleMessage(topic: string, message: any): Promise<void> {
    const { method, params } = message;

    switch (method) {
      case SessionMethod.UPDATE:
        await this.handleSessionUpdate(topic, params);
        break;

      case SessionMethod.EXTEND:
        await this.handleSessionExtend(topic, params);
        break;

      case SessionMethod.DELETE:
        await this.handleSessionDelete(topic, params);
        break;

      case SessionMethod.PING:
        await this.handleSessionPing(topic, params);
        break;

      case SessionMethod.REQUEST:
        await this.handleSessionRequest(topic, params);
        break;

      case SessionMethod.RESPONSE:
        await this.handleSessionResponse(params);
        break;

      case SessionMethod.EVENT:
        await this.handleSessionEvent(topic, params);
        break;

      default:
        console.warn('[SessionManager] Unknown message method:', method);
    }
  }

  /**
   * 处理 Session 更新
   */
  private async handleSessionUpdate(topic: string, data: any): Promise<void> {
    const session = await this.store.get(topic);
    if (!session) {
      console.warn('[SessionManager] Session not found:', topic);
      return;
    }

    // 更新命名空间
    session.namespaces = data.namespaces;
    session.updatedAt = Date.now();

    await this.store.set(topic, session);

    console.log('[SessionManager] Session updated:', topic);
    super.emit('session_updated', session);
  }

  /**
   * 处理 Session 延长
   */
  private async handleSessionExtend(topic: string, data: any): Promise<void> {
    const session = await this.store.get(topic);
    if (!session) {
      console.warn('[SessionManager] Session not found:', topic);
      return;
    }

    // 更新过期时间
    session.expiry = data.expiry;
    session.updatedAt = Date.now();

    await this.store.set(topic, session);

    console.log('[SessionManager] Session extended:', topic);
    super.emit('session_extended', session);
  }

  /**
   * 处理 Session 删除
   */
  private async handleSessionDelete(topic: string, data: any): Promise<void> {
    const session = await this.store.get(topic);
    if (!session) {
      console.warn('[SessionManager] Session not found:', topic);
      return;
    }

    // 取消订阅
    await this.relay!.unsubscribe(topic);

    // 删除 Session
    await this.store.delete(topic);

    console.log('[SessionManager] Session deleted:', topic);
    super.emit('session_deleted', { topic, reason: data.reason });
  }

  /**
   * 处理 Session Ping
   */
  private async handleSessionPing(topic: string, data: any): Promise<void> {
    // 发送 Pong 响应
    await this.sendMessage(topic, {
      type: 'session_pong',
      data: { id: data.id }
    });

    console.log('[SessionManager] Session ping received:', topic);
    super.emit('session_ping', { topic });
  }

  /**
   * 处理 Session 请求
   */
  private async handleSessionRequest(topic: string, params: any): Promise<void> {
    const session = await this.store.get(topic);
    if (!session) {
      console.warn('[SessionManager] Session not found:', topic);
      return;
    }

    console.log('[SessionManager] Session request received:', {
      id: params.id,
      method: params.method
    });

    super.emit(SessionEvent.REQUEST, {
      id: params.id,
      topic: topic,
      method: params.method,
      params: params.params,
      chainId: params.chainId,
    });
  }

  /**
   * 处理 Session 响应
   */
  private async handleSessionResponse(data: any): Promise<void> {
    const pending = this.pendingRequests.get(data.id);
    if (!pending) {
      console.warn('[SessionManager] No pending request found:', data.id);
      return;
    }

    // 清除超时
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(data.id);

    // 处理响应
    if (data.error) {
      pending.reject(new SessionError(
        SessionErrorCode.UNKNOWN_ERROR,
        data.error.message
      ));
    } else {
      pending.resolve(data.result);
    }

    console.log('[SessionManager] Session response received:', data.id);
  }

  /**
   * 处理 Session 事件
   */
  private async handleSessionEvent(topic: string, data: any): Promise<void> {
    const session = await this.store.get(topic);
    if (!session) {
      console.warn('[SessionManager] Session not found:', topic);
      return;
    }

    console.log('[SessionManager] Session event received:', data.event.name);
    super.emit('session_event', {
      topic,
      event: data.event,
      chainId: data.chainId
    });
  }

  /**
   * 发送消息
   */
  private async sendMessage(topic: string, message: any): Promise<void> {
    if (!this.relay) {
      throw new SessionError(
        SessionErrorCode.UNKNOWN_ERROR,
        'Relay not initialized'
      );
    }

    const payload = JSON.stringify(message);
    await this.relay.publish(topic, payload);
  }

  /**
   * 验证命名空间
   */
  private validateNamespaces(
    namespaces: SessionNamespaces,
    requiredNamespaces?: SessionNamespaces,
    optionalNamespaces?: SessionNamespaces
  ): void {
    // 验证必需的命名空间
    if (requiredNamespaces) {
      for (const [key, required] of Object.entries(requiredNamespaces)) {
        const namespace = namespaces[key];
        if (!namespace) {
          throw new SessionError(
            SessionErrorCode.UNSUPPORTED_CHAINS,
            `Required namespace missing: ${key}`
          );
        }

        // 验证链
        if (required.chains) {
          const missingChains = required.chains.filter(
            chain => !namespace.chains?.includes(chain)
          );
          if (missingChains.length > 0) {
            throw new SessionError(
              SessionErrorCode.UNSUPPORTED_CHAINS,
              `Missing required chains: ${missingChains.join(', ')}`
            );
          }
        }

        // 验证方法
        if (required.methods) {
          const missingMethods = required.methods.filter(
            method => !namespace.methods.includes(method)
          );
          if (missingMethods.length > 0) {
            throw new SessionError(
              SessionErrorCode.UNSUPPORTED_METHODS,
              `Missing required methods: ${missingMethods.join(', ')}`
            );
          }
        }

        // 验证事件
        if (required.events) {
          const missingEvents = required.events.filter(
            event => !namespace.events.includes(event)
          );
          if (missingEvents.length > 0) {
            throw new SessionError(
              SessionErrorCode.UNSUPPORTED_EVENTS,
              `Missing required events: ${missingEvents.join(', ')}`
            );
          }
        }
      }
    }

    // 验证账户格式
    for (const [key, namespace] of Object.entries(namespaces)) {
      if (namespace.accounts) {
        for (const account of namespace.accounts) {
          if (!this.isValidAccount(account)) {
            throw new SessionError(
              SessionErrorCode.UNSUPPORTED_ACCOUNTS,
              `Invalid account format: ${account}`
            );
          }
        }
      }
    }
  }

  /**
   * CAIP-10 账户格式验证
   * 格式: namespace:chainId:address
   * 示例: eip155:1:0xbc09cdb45b258ebf7e499ecddaa942222bb1a030
   */
  isValidAccount(account: string): boolean {
    if (!account || typeof account !== 'string') {
      return false;
    }

    const parts = account.split(':');

    // 必须是 3 部分
    if (parts.length !== 3) {
      return false;
    }

    const [namespace, chainId, address] = parts;

    // 验证 namespace (不能为空)
    if (!namespace || namespace.length === 0) {
      return false;
    }

    // 验证 chainId (不能为空)
    if (!chainId || chainId.length === 0) {
      return false;
    }

    // 验证 address (不能为空)
    if (!address || address.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * 清理过期的 Session 和提议
   */
  private async cleanupExpired(): Promise<void> {
    const now = Date.now();

    // 清理过期的 Session
    const sessions = this.getAll();
    for (const session of sessions) {
      if (now >= session.expiry * 1000) {
        console.log('[SessionManager] Cleaning up expired session:', session.topic);
        await this.disconnect({
          topic: session.topic,
          reason: { code: 0, message: 'Session expired' }
        });
      }
    }

    // 清理过期的提议
    const proposals = await this.store.getAllProposals();
    for (const proposal of proposals) {
      if (now >= proposal.expiryTimestamp) {
        console.log('[SessionManager] Cleaning up expired proposal:', proposal.proposalId);
        await this.store.deleteProposal(proposal.proposalId);
      }
    }
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired().catch(error => {
        console.error('[SessionManager] Cleanup failed:', error);
      });
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * 停止清理定时器
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 确保已初始化
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new SessionError(
        SessionErrorCode.UNKNOWN_ERROR,
        'SessionManager not initialized'
      );
    }
  }

  /**
   * 销毁管理器
   */
  async destroy(): Promise<void> {
    this.stopCleanupTimer();

    // 断开所有 Session
    const sessions = this.getAll();
    for (const session of sessions) {
      try {
        await this.disconnect({
          topic: session.topic,
          reason: { code: 0, message: 'Client destroyed' }
        });
      } catch (error) {
        console.error('[SessionManager] Failed to disconnect session:', error);
      }
    }

    // 清理待处理的请求
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new SessionError(
        SessionErrorCode.UNKNOWN_ERROR,
        'Client destroyed'
      ));
    }
    this.pendingRequests.clear();

    this.initialized = false;
    this.removeAllListeners();
    console.log('[SessionManager] Destroyed');
  }
}
