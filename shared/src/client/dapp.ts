import { EventEmitter } from 'events';
import { CryptoManager } from '../core/CryptoManager';
import { SessionManager } from '../core/SessionManager';
import { PairingManager } from '../core/PairingManager';
import { IRelay, RelayConfig, RelayProtocol } from '../types/relay';
import {
  SessionData,
  SessionRequest,
  SessionErrorCode,
  SessionError,
  SessionMetadata,
  SessionNamespaces
} from '../types/session';
import { CreatePairingResult, Pairing } from '../types/pairing';
import { WakuRelay } from '../relay/waku';
import { PairingEvent, SessionEvent } from '../types/common';

/**
 * DApp Client 配置
 */
export interface DappClientConfig {
  metadata: SessionMetadata;
  relayConfig: RelayConfig;
  requiredNamespaces?: SessionNamespaces;
  optionalNamespaces?: SessionNamespaces;
  requestTimeout?: number;
}

/**
 * 连接 URI
 */
export interface ConnectionURI {
  uri: string;                      // 完整的 WalletConnect URI
  topic: string;                    // Pairing topic
  version: number;                  // 协议版本（通常是 2）
  relay: RelayProtocol;             // 中继协议配置
  symKey?: string;                  // 对称密钥（可选，用于某些场景）
}

/**
 * 连接选项
 */
export interface ConnectOptions {
  pairingTopic?: string;  // 使用现有的 Pairing
  skipProposal?: boolean; // 跳过自动提议 Session
}

/**
 * DApp Client 实现
 */
export class DappClient extends EventEmitter {
  private cryptoManager: CryptoManager;
  private sessionManager: SessionManager;
  private pairingManager: PairingManager;
  private relay: IRelay;
  private metadata: SessionMetadata;
  private requiredNamespaces?: SessionNamespaces;
  private optionalNamespaces?: SessionNamespaces;
  private requestTimeout: number;
  private initialized = false;

  // 当前活跃的 Session
  private activeSession?: SessionData;
  // 当前的 Pairing
  private activePairing?: Pairing;

  constructor(config: DappClientConfig) {
    super();
    // 创建 Waku Relay
    this.relay = new WakuRelay(config.relayConfig);

    this.metadata = config.metadata;
    this.requiredNamespaces = config.requiredNamespaces;
    this.optionalNamespaces = config.optionalNamespaces;
    this.requestTimeout = config.requestTimeout || 60000;

    // 初始化管理器
    this.cryptoManager = new CryptoManager();
    this.sessionManager = new SessionManager(this.metadata, this.cryptoManager);
    this.pairingManager = new PairingManager(this.relay, this.metadata, this.cryptoManager);
    this.sessionManager.setPairingManager(this.pairingManager, false);
    this.setupEventHandlers();
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    if (this.initialized) {
      console.warn('[DappClient] Already initialized');
      return;
    }

    // 初始化 Relay
    await this.relay.init();

    // 初始化管理器
    await this.pairingManager.initialize();
    await this.sessionManager.init(this.relay);

    // 恢复活跃的 Session
    await this.restoreActiveSession();

    this.initialized = true;
    console.log('[DappClient] Initialized');
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    // Pairing 事件
    this.pairingManager.on(PairingEvent.DELETED, (data: any) => {
      console.log('[DappClient] Pairing deleted:', data.topic);
      this.emit(PairingEvent.DELETED, data);
    });

    this.pairingManager.on(PairingEvent.APPROVED, (pairing: any) => {
      console.log('[DappClient] Pairing approved:', pairing.topic);
      this.emit(PairingEvent.APPROVED, pairing);
    });

    this.pairingManager.on(PairingEvent.REJECTED, (data: any) => {
      console.log('[DappClient] Pairing rejected:', data.topic);
      this.emit(PairingEvent.REJECTED, data);
    });

    this.sessionManager.on(SessionEvent.SETTLED, (session: SessionData) => {
      console.log('[DappClient] Session settled:', session.topic);
      this.activeSession = session;
      this.emit(SessionEvent.SETTLED, session);
    });

    this.sessionManager.on(SessionEvent.REJECTED, (session: SessionData) => {
      console.log('[DappClient] Session rejected:', session.topic);
      if (this.activeSession?.topic === session.topic) {
        this.activeSession = undefined;
      }
      this.emit(SessionEvent.REJECTED, session);
    });

    this.sessionManager.on(SessionEvent.UPDATED, (session: SessionData) => {
      console.log('[DappClient] Session updated:', session.topic);
      if (this.activeSession?.topic === session.topic) {
        this.activeSession = session;
      }
      this.emit(SessionEvent.UPDATED, session);
    });

    this.sessionManager.on(SessionEvent.EXTENDED, (session: SessionData) => {
      console.log('[DappClient] Session extended:', session.topic);
      if (this.activeSession?.topic === session.topic) {
        this.activeSession = session;
      }
      this.emit(SessionEvent.EXTENDED, session);
    });

    this.sessionManager.on(SessionEvent.DELETED, (data: any) => {
      console.log('[DappClient] Session deleted:', data.topic);
      if (this.activeSession?.topic === data.topic) {
        this.activeSession = undefined;
      }
      this.emit(SessionEvent.DELETED, data);
    });

    this.sessionManager.on(SessionEvent.REQUEST, (request: any) => {
      console.log('[DappClient] Session request:', request.id);
      this.emit(SessionEvent.REQUEST, request);
    });

    this.sessionManager.on(SessionEvent.EVENT_RECEIVED, (event: any) => {
      console.log('[DappClient] Session event:', event.event.name);
      this.emit(SessionEvent.EVENT_RECEIVED, event);
    });
  }

  /**
   * 创建连接 URI
   */
  async connect(options?: ConnectOptions): Promise<ConnectionURI> {
    this.ensureInitialized();
    try {
      // 如果提供了 pairingTopic，使用现有的 Pairing
      if (options?.pairingTopic) {
        const pairing = await this.pairingManager.get(options.pairingTopic);
        if (!pairing) {
          throw new Error(`Pairing not found: ${options.pairingTopic}`);
        }

        this.activePairing = pairing;

        return {
          uri: '', // 已有 Pairing 不需要 URI
          topic: pairing.topic,
          version: 2,
          relay: pairing.relay,
        };
      }

      // 创建新的 Pairing
      const result = await this.pairingManager.create({
        appMetadata: this.metadata,
        relay: this.relay.getProtocol()
      });

      // 保存 Pairing 引用
      this.activePairing = result.pairing;

      // 构建返回对象
      const connectionURI: ConnectionURI = {
        uri: result.uri,
        topic: result.topic,
        version: 2,
        relay: result.pairing.relay
      };

      console.log('[DappClient] Connection URI created:', connectionURI.uri);
      this.emit('display_uri', connectionURI);

      // 异步等待批准（不阻塞返回）
      this.handlePairingApproval(result).catch(error => {
        console.error('[DappClient] Pairing approval error:', error);
        this.emit('pairing_error', error);
      });

      return connectionURI;
    } catch (error) {
      console.error('[DappClient] Failed to create connection:', error);
      throw error;
    }
  }

 /**
 * 处理 Pairing 批准
 */
  private async handlePairingApproval(result: CreatePairingResult): Promise<void> {
    try {
      const pairing = await result.approval();
      console.log('[DappClient] Pairing approved:', pairing.topic);

      this.activePairing = pairing;
      this.emit(PairingEvent.APPROVED, pairing);

      // Pairing 建立后，自动提议 Session
      if (this.requiredNamespaces) {
        await this.proposeSession();
      }
    } catch (error) {
      console.error('[DappClient] Pairing approval failed:', error);
      this.activePairing = undefined;
      throw error;
    }
  }

  /**
   * 提议 Session
   */
  async proposeSession(params?: {
    requiredNamespaces?: SessionNamespaces;
    optionalNamespaces?: SessionNamespaces;
  }): Promise<void> {
    this.ensureInitialized();

    if (!this.activePairing) {
      throw new Error('No active pairing. Call connect() or pair() first.');
    }

    const requiredNamespaces = params?.requiredNamespaces || this.requiredNamespaces;
    const optionalNamespaces = params?.optionalNamespaces || this.optionalNamespaces;

    if (!requiredNamespaces) {
      throw new Error('Required namespaces not specified');
    } 
    // 提议 Session
    const proposal = await this.sessionManager.propose({
      pairingTopic: this.activePairing.topic,
      requiredNamespaces,
      optionalNamespaces,
      relays: [{
        protocol: this.relay.getProtocol().protocol
      }]
    });

    console.log('[DappClient] Session proposed:', proposal.proposalId);
  }

  /**
   * 发送请求
   */
  async request<T = any>(params: {
    chainId: string;
    method: string;
    params: any[];
  }): Promise<T> {
    this.ensureInitialized();

    if (!this.activeSession) {
      throw new Error('No active session. Connect first.');
    }
    // 发送请求
    const result = await this.sessionManager.request({
      topic: this.activeSession.topic,
      chainId: params.chainId,
      method: params.method,
      params: params.params
    });

    return result as T;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.ensureInitialized();

    if (this.activeSession) {
      await this.sessionManager.disconnect({
        topic: this.activeSession.topic,
        reason: { code: 6000, message: 'User disconnected' }
      });
      this.activeSession = undefined;
    }

    if (this.activePairing) {
      await this.pairingManager.delete(this.activePairing.topic, 'User disconnected');
      this.activePairing = undefined;
    }
    console.log('[DappClient] Disconnected');
  }

  /**
   * Ping Session
   */
  async ping(): Promise<void> {
    this.ensureInitialized();

    if (!this.activeSession) {
      throw new Error('No active session');
    }

    await this.sessionManager.ping(this.activeSession.topic);
  }

  /**
   * 获取活跃的 Session
   */
  getActiveSession(): SessionData | undefined {
    return this.activeSession ? { ...this.activeSession } : undefined;
  }

  /**
   * 获取账户
   */
  getAccounts(chainId?: string): string[] {
    if (!this.activeSession) {
      return [];
    }

    const accounts: string[] = [];

    for (const [key, namespace] of Object.entries(this.activeSession.namespaces)) {
      if (namespace.accounts) {
        if (chainId) {
          // 过滤特定链的账户
          const filtered = namespace.accounts.filter(acc => acc.startsWith(chainId));
          accounts.push(...filtered);
        } else {
          accounts.push(...namespace.accounts);
        }
      }
    }

    return accounts;
  }

  /**
   * 获取支持的链
   */
  getChains(): string[] {
    if (!this.activeSession) {
      return [];
    }

    const chains: string[] = [];

    for (const namespace of Object.values(this.activeSession.namespaces)) {
      if (namespace.chains) {
        chains.push(...namespace.chains);
      }
    }

    return chains;
  }

  /**
   * 获取支持的方法
   */
  getMethods(chainId?: string): string[] {
    if (!this.activeSession) {
      return [];
    }

    const methods: string[] = [];
    for (const [key, namespace] of Object.entries(this.activeSession.namespaces)) {
      if (!chainId || namespace.chains?.some(c => c === chainId)) {
        methods.push(...namespace.methods);
      }
    }

    return [...new Set(methods)];
  }

  /**
   * 检查 Session 是否活跃
   */
  isConnected(): boolean {
    if (!this.activeSession) {
      return false;
    }

    return Date.now() < this.activeSession.expiry * 1000;
  }

  /**
   * 恢复活跃的 Session
   */
  private async restoreActiveSession(): Promise<void> {
    const sessions = this.sessionManager.getAll();

    // 找到最新的活跃 Session
    const activeSessions = sessions
      .filter(s => Date.now() < s.expiry * 1000)
      .sort((a, b) => b.createdAt - a.createdAt);

    if (activeSessions.length > 0) {
      this.activeSession = activeSessions[0];
      console.log('[DappClient] Restored active session:', this.activeSession.topic);
    }

    // 恢复 Pairing
    const pairings = await this.pairingManager.getAll();
    const activePairings = pairings
      .filter(p => p.status && Date.now() < p.expiry * 1000)
      .sort((a, b) => b.createdAt - a.createdAt);

    if (activePairings.length > 0) {
      this.activePairing = activePairings[0];
      console.log('[DappClient] Restored active pairing:', this.activePairing?.topic);
    }
  }

  /**
   * 确保已初始化
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('DappClient not initialized. Call init() first.');
    }
  }

  /**
   * 销毁客户端
   */
  async destroy(): Promise<void> {
    await this.disconnect();
    await this.sessionManager.destroy();
    await this.pairingManager.destroy();
    await this.relay.stop();

    this.initialized = false;
    this.removeAllListeners();
    console.log('[DappClient] Destroyed');
  }
}
