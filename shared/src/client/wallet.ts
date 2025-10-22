import { EventEmitter } from 'events';
import { CryptoManager } from '../core/CryptoManager';
import { SessionManager } from '../core/SessionManager';
import { PairingManager } from '../core/PairingManager';
import { IRelay, RelayConfig } from '../types/relay';
import {
  SessionData,
  SessionMetadata,
  SessionNamespaces,
  SessionProposal,
  ApproveSessionParams,
  RejectSessionParams,
  SessionRequest,
  SessionResponse,
} from '../types/session';
import { Pairing } from '../types/pairing';
import { ICryptoManager } from '../types/crypto';
import { WakuRelay } from '../relay/waku';
import { PairingEvent, SessionEvent } from '../types/common';

/**
 * Wallet Client 配置
 */
export interface WalletClientConfig {
  metadata: SessionMetadata;
  supportedNamespaces?: SessionNamespaces;
  accounts?: string[];
  relayConfig: RelayConfig;
}

/**
 * 待处理的请求
 */
interface PendingRequest {
  request: SessionRequest;
  session: SessionData;
  timestamp: number;
}

/**
 * Wallet Client 实现
 */
export class WalletClient extends EventEmitter {
  private cryptoManager: ICryptoManager;
  private sessionManager: SessionManager;
  private pairingManager: PairingManager;
  private relay: IRelay;
  private metadata: SessionMetadata;
  private supportedNamespaces?: SessionNamespaces;
  private accounts: string[];
  private initialized = false;

  // 待处理的提案和请求
  private pendingProposals = new Map<number, SessionProposal>();
  private pendingRequests = new Map<number, PendingRequest>();
  private activeSessions = new Map<string, SessionData>();

  constructor(config: WalletClientConfig) {
    super();

    this.relay = new WakuRelay(config.relayConfig);
    this.metadata = config.metadata;
    this.supportedNamespaces = config.supportedNamespaces;
    this.accounts = config.accounts || [];

    // 初始化管理器
    this.cryptoManager = new CryptoManager();
    this.sessionManager = new SessionManager(this.metadata, this.cryptoManager);
    this.pairingManager = new PairingManager(this.relay, this.metadata, this.cryptoManager);
    this.sessionManager.setPairingManager(this.pairingManager, true);
    this.setupEventHandlers();
  }

 /**
   * 初始化
   */
  async init(): Promise<void> {
    if (this.initialized) {
      console.warn('[WalletClient] Already initialized');
      return;
    }

    // 初始化 Relay
    await this.relay.init();
    await this.relay.start();

    // 初始化管理器
    await this.pairingManager.initialize();
    await this.sessionManager.init(this.relay);

    // 恢复活跃的 Sessions
    await this.restoreActiveSessions();

    this.initialized = true;
    console.log('[WalletClient] Initialized');
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    this.pairingManager.on(PairingEvent.CREATED, (pairing: Pairing) => {
      console.log('[WalletClient] Pairing created:', pairing.topic);
      this.emit(PairingEvent.CREATED, pairing);
    });

    this.pairingManager.on(PairingEvent.DELETED, (data: any) => {
      console.log('[WalletClient] Pairing deleted:', data.topic);
      this.emit(PairingEvent.DELETED, data);
    });

    // Session 提案（使用枚举）
    this.sessionManager.on(SessionEvent.PROPOSAL, (proposal: SessionProposal) => {
      console.log('[WalletClient] Session proposal received:', proposal.proposalId);
      this.pendingProposals.set(proposal.proposalId, proposal);
      this.emit(SessionEvent.PROPOSAL, proposal);
    });

    // Session 更新（使用枚举）
    this.sessionManager.on(SessionEvent.UPDATED, (session: SessionData) => {
      console.log('[WalletClient] Session updated:', session.topic);
      this.activeSessions.set(session.topic, session);
      this.emit(SessionEvent.UPDATED, session);
    });

    // Session 扩展（使用枚举）
    this.sessionManager.on(SessionEvent.EXTENDED, (session: SessionData) => {
      console.log('[WalletClient] Session extended:', session.topic);
      this.activeSessions.set(session.topic, session);
      this.emit(SessionEvent.EXTENDED, session);
    });

    // Session 删除（使用枚举）
    this.sessionManager.on(SessionEvent.DELETED, (data: { topic: string; reason: any }) => {
      console.log('[WalletClient] Session deleted:', data.topic);

      // 删除 Session
      this.activeSessions.delete(data.topic);

      // 清理相关的待处理请求
      for (const [id, pending] of this.pendingRequests.entries()) {
        if (pending.session.topic === data.topic) {
          this.pendingRequests.delete(id);
        }
      }

      this.emit(SessionEvent.DELETED, data);
    });

    // Session 请求（使用枚举）
    this.sessionManager.on(SessionEvent.REQUEST, (request: SessionRequest) => {
      console.log('[WalletClient] Session request received:', request.id);

      const session = this.activeSessions.get(request.topic);
      if (session) {
        const pending: PendingRequest = {
          request: request,
          session,
          timestamp: Date.now()
        };
        this.pendingRequests.set(request.id, pending);
        this.emit(SessionEvent.REQUEST, pending);
      }
    });

    // Session Ping（使用枚举）
    this.sessionManager.on(SessionEvent.PING, (data: { topic: string; id: number }) => {
      console.log('[WalletClient] Session ping received:', data.id);
      this.emit(SessionEvent.PING, data);
    });

    // Session 事件（使用枚举）
    this.sessionManager.on(SessionEvent.EVENT_RECEIVED, (event: any) => {
      console.log('[WalletClient] Session event:', event.event.name);
      this.emit(SessionEvent.EVENT_RECEIVED, event);
    });
  }

  /**
   * 通过 URI 配对
   */
  async pair(uri: string): Promise<Pairing> {
    this.ensureInitialized();

    // 激活 Pairing
    const pairing = await this.pairingManager.activate({
      uri: uri,
      appMetadata: this.metadata,
    });

    return pairing;
  }

  /**
   * 批准 Session 提案
   */
  async approveSession(params: {
    proposalId: number;
    namespaces: SessionNamespaces;
  }): Promise<SessionData> {
    this.ensureInitialized();

    const proposal = this.pendingProposals.get(params.proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${params.proposalId}`);
    }

    // 验证 namespaces 是否满足要求
    this.validateNamespaces(proposal.requiredNamespaces, params.namespaces);

    // 批准 Session
    const session = await this.sessionManager.approve({
      proposalId: params.proposalId,
      namespaces: params.namespaces,
      relayProtocol: this.relay.getProtocol().protocol
    });

    this.activeSessions.set(session.topic, session);
    this.pendingProposals.delete(params.proposalId);

    console.log('[WalletClient] Session approved:', session.topic);
    return session;
  }

  /**
   * 拒绝 Session 提案
   */
  async rejectSession(params: {
    proposalId: number;
    reason: string;
  }): Promise<void> {
    this.ensureInitialized();

    const proposal = this.pendingProposals.get(params.proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${params.proposalId}`);
    }

    // 拒绝 Session
    await this.sessionManager.reject({
      proposalId: params.proposalId,
      reason: {
        code: 5000,
        message: params.reason
      }
    });

    this.pendingProposals.delete(params.proposalId);

    console.log('[WalletClient] Session rejected:', params.proposalId);
  }

  /**
   * 响应 Session 请求
   */
  async respondRequest(params: {
    requestId: number;
    result: any;
  }): Promise<void> {
    this.ensureInitialized();

    const pending = this.pendingRequests.get(params.requestId);
    if (!pending) {
      throw new Error(`Request not found: ${params.requestId}`);
    }

    // 发送响应
    await this.sessionManager.respond({
      id: pending.request.id,
      topic: pending.session.topic,
      result: params.result
    });

    this.pendingRequests.delete(params.requestId);

    console.log('[WalletClient] Request responded:', params.requestId);
  }

  /**
   * 拒绝 Session 请求
   */
  async rejectRequest(params: {
    requestId: number;
    error: {
      code: number;
      message: string;
    };
  }): Promise<void> {
    this.ensureInitialized();

    const pending = this.pendingRequests.get(params.requestId);
    if (!pending) {
      throw new Error(`Request not found: ${params.requestId}`);
    }

    // 发送错误响应
    await this.sessionManager.respond({
      id: pending.request.id,
      topic: pending.session.topic,
      error: params.error,
    });

    this.pendingRequests.delete(params.requestId);

    console.log('[WalletClient] Request rejected:', params.requestId);
  }

  /**
   * 更新 Session
   */
  async updateSession(params: {
    topic: string;
    namespaces: SessionNamespaces;
  }): Promise<void> {
    this.ensureInitialized();

    const session = this.activeSessions.get(params.topic);
    if (!session) {
      throw new Error(`Session not found: ${params.topic}`);
    }

    // 更新 Session
    await this.sessionManager.update({
      topic: params.topic,
      namespaces: params.namespaces
    });

    console.log('[WalletClient] Session updated:', params.topic);
  }

  /**
   * 扩展 Session
   */
  async extendSession(topic: string, expiry: number): Promise<void> {
    this.ensureInitialized();

    const session = this.activeSessions.get(topic);
    if (!session) {
      throw new Error(`Session not found: ${topic}`);
    }

    // 扩展 Session
    await this.sessionManager.extend({ topic, expiry: expiry });

    console.log('[WalletClient] Session extended:', topic);
  }

  /**
   * 发送 Session 事件
   */
  async emitSessionEvent(params: {
    topic: string;
    event: {
      name: string;
      data: any;
    };
    chainId: string;
  }): Promise<void> {
    this.ensureInitialized();

    const session = this.activeSessions.get(params.topic);
    if (!session) {
      throw new Error(`Session not found: ${params.topic}`);
    }

    // 发送事件
    this.sessionManager.emit(params.event.name, {
      topic: params.topic,
      event: params.event,
      chainId: params.chainId
    });

    console.log('[WalletClient] Event emitted:', params.event.name);
  }

  /**
   * 断开 Session
   */
  async disconnectSession(params: {
    topic: string;
    reason: string;
  }): Promise<void> {
    this.ensureInitialized();

    const session = this.activeSessions.get(params.topic);
    if (!session) {
      throw new Error(`Session not found: ${params.topic}`);
    }

    // 断开 Session
    await this.sessionManager.disconnect({
      topic: params.topic,
      reason: {
        code: 6000,
        message: params.reason
      }
    });

    this.activeSessions.delete(params.topic);

    console.log('[WalletClient] Session disconnected:', params.topic);
  }

  /**
   * Ping Session
   */
  async ping(topic: string): Promise<void> {
    this.ensureInitialized();

    const session = this.activeSessions.get(topic);
    if (!session) {
      throw new Error(`Session not found: ${topic}`);
    }

    await this.sessionManager.ping(topic);
  }

  /**
   * 更新账户
   */
  async updateAccounts(accounts: string[]): Promise<void> {
    this.accounts = accounts;

    // 更新所有活跃 Session 的账户
    for (const [topic, session] of this.activeSessions.entries()) {
      const updatedNamespaces = { ...session.namespaces };

      // 更新每个 namespace 的账户
      for (const [key, namespace] of Object.entries(updatedNamespaces)) {
        if (namespace.chains) {
          updatedNamespaces[key] = {
            ...namespace,
            accounts: namespace.chains.flatMap(chain =>
              accounts.map(acc => `${chain}:${acc}`)
            )
          };
        }
      }

      await this.updateSession({
        topic,
        namespaces: updatedNamespaces
      });

      // 发送账户变更事件
      for (const [key, namespace] of Object.entries(updatedNamespaces)) {
        if (namespace.chains) {
          for (const chain of namespace.chains) {
            await this.emitSessionEvent({
              topic,
              event: {
                name: 'accountsChanged',
                data: accounts
              },
              chainId: chain
            });
          }
        }
      }
    } 

    this.emit('accounts_updated', accounts);
    console.log('[WalletClient] Accounts updated:', accounts);
  }

  /**
   * 更新链
   */
  async updateChain(params: {
    topic: string;
    chainId: string;
  }): Promise<void> {
    this.ensureInitialized();

    const session = this.activeSessions.get(params.topic);
    if (!session) {
      throw new Error(`Session not found: ${params.topic}`);
    }

    // 发送链变更事件
    await this.emitSessionEvent({
      topic: params.topic,
      event: {
        name: 'chainChanged',
        data: params.chainId
      },
      chainId: params.chainId
    });

    console.log('[WalletClient] Chain updated:', params.chainId);
  }

  /**
   * 获取所有活跃的 Sessions
   */
  getActiveSessions(): SessionData[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * 获取特定 Session
   */
  getSession(topic: string): SessionData | undefined {
    return this.activeSessions.get(topic);
  }

  /**
   * 获取所有待处理的提案
   */
  getPendingProposals(): SessionProposal[] {
    return Array.from(this.pendingProposals.values());
  }

  /**
   * 获取账户
   */
  getAccounts(): string[] {
    return [...this.accounts];
  }

  /**
   * 获取支持的命名空间
   */
  getSupportedNamespaces(): SessionNamespaces | undefined {
    return this.supportedNamespaces ? { ...this.supportedNamespaces } : undefined;
  }

  /**
   * 恢复活跃的 Sessions
   */
  private async restoreActiveSessions(): Promise<void> {
    const sessions = this.sessionManager.getAll();

    // 过滤活跃的 Sessions
    const activeSessions = sessions.filter(s => Date.now() < s.expiry * 1000);

    for (const session of activeSessions) {
      this.activeSessions.set(session.topic, session);
      console.log('[WalletClient] Restored active session:', session.topic);
    }

    console.log(`[WalletClient] Restored ${activeSessions.length} active sessions`);
  }

  /**
   * 验证命名空间
   */
  private validateNamespaces(
    required: SessionNamespaces,
    provided: SessionNamespaces
  ): void {
    for (const [key, requiredNamespace] of Object.entries(required)) {
      const providedNamespace = provided[key];

      if (!providedNamespace) {
        throw new Error(`Missing required namespace: ${key}`);
      }

      // 验证链
      if (requiredNamespace.chains) {
        for (const chain of requiredNamespace.chains) {
          if (!providedNamespace.chains?.includes(chain)) {
            throw new Error(`Missing required chain: ${chain}`);
          }
        }
      }

      // 验证方法
      if (requiredNamespace.methods) {
        for (const method of requiredNamespace.methods) {
          if (!providedNamespace.methods?.includes(method)) {
            throw new Error(`Missing required method: ${method}`);
          }
        }
      }

      // 验证事件
      if (requiredNamespace.events) {
        for (const event of requiredNamespace.events) {
          if (!providedNamespace.events?.includes(event)) {
            throw new Error(`Missing required event: ${event}`);
          }
        }
      }
    }
  }

  /**
   * 确保已初始化
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('WalletClient not initialized. Call init() first.');
    }
  }

  /**
   * 销毁客户端
   */
  async destroy(): Promise<void> {
    // 断开所有活跃的 Sessions
    for (const [topic] of this.activeSessions) {
      try {
        await this.disconnectSession({
          topic,
          reason: 'Client destroyed'
        });
      } catch (error) {
        console.error(`[WalletClient] Failed to disconnect session ${topic}:`, error);
      }
    }

    await this.sessionManager.destroy();
    await this.pairingManager.destroy();
    await this.relay.stop();

    this.activeSessions.clear();
    this.pendingProposals.clear();
    this.pendingRequests.clear();
    this.initialized = false;
    this.removeAllListeners();

    console.log('[WalletClient] Destroyed');
  }
}
