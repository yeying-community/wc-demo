import { Client, ClientConfig, PairingResponse } from '../core/client';
import { Logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface DappConfig extends ClientConfig {
  requiredChains?: string[];
  optionalChains?: string[];
  requiredMethods?: string[];
  optionalMethods?: string[];
}

export interface ConnectionURI {
  uri: string;
  topic: string;
  version: number;
}

export interface SessionData {
  topic: string;
  namespaces: Record<string, any>;
  peer: {
    publicKey: string;
    metadata: any;
  };
  expiry: number;
}

export class DappClient extends Client {
  private requiredChains: string[];
  private optionalChains: string[];
  private requiredMethods: string[];
  private optionalMethods: string[];
  private currentSession?: SessionData;
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private requestTimeout: number = 60000; // 60秒

  constructor(config: DappConfig = {}) {
    super(config);
    this.logger = new Logger('DappClient');

    this.requiredChains = config.requiredChains || ['eip155:1'];
    this.optionalChains = config.optionalChains || [];
    this.requiredMethods = config.requiredMethods || [
      'eth_sendTransaction',
      'personal_sign',
    ];
    this.optionalMethods = config.optionalMethods || [
      'eth_signTypedData',
    ];

    this.setupMessageHandlers();
  }

  /**
   * 设置消息处理器
   */
  private setupMessageHandlers(): void {
    this.session.onMessage('pairing_response', this.handlePairingResponse.bind(this));
    this.session.onMessage('session_approve', this.handleSessionApprove.bind(this));
    this.session.onMessage('session_reject', this.handleSessionReject.bind(this));
    this.session.onMessage('session_response', this.handleSessionResponse.bind(this));
    this.session.onMessage('session_update', this.handleSessionUpdate.bind(this));
    this.session.onMessage('session_delete', this.handleSessionDelete.bind(this));
    this.session.onMessage('session_pong', this.handleSessionPong.bind(this));
  }

  /**
   * 处理接收到的消息
   */
  protected handleMessage(envelope: any): void {
    const { type, payload } = envelope.payload;
    this.logger.debug(`Received message type: ${type}`);

    // 消息已通过 session.onMessage 注册的处理器处理
  }

  /**
   * 创建连接 URI
   */
  async createConnectionURI(): Promise<ConnectionURI> {
    try {
      if (!this.session.isConnected()) {
        await this.connect();
      }

      const topic = this.session.getTopic();
      const uri = `wc:${topic}@2?relay-protocol=waku&symKey=${this.clientId}`;

      const connectionURI: ConnectionURI = {
        uri,
        topic,
        version: 2,
      };

      this.logger.info('Connection URI created:', uri);
      return connectionURI;
    } catch (error) {
      this.logger.error('Failed to create connection URI:', error);
      throw error;
    }
  }

  /**
   * 发起配对请求
   */
  async pair(): Promise<void> {
    try {
      if (!this.session.isConnected()) {
        await this.connect();
      }

      // 发送配对请求
      await this.sendMessage('pairing_request', {
        id: uuidv4(),
        metadata: this.metadata,
      });

      this.logger.info('Pairing request sent');
    } catch (error) {
      this.logger.error('Failed to pair:', error);
      throw error;
    }
  }

  /**
   * 解析连接 URI
   */
  private parseURI(uri: string): { topic: string; symKey: string; relay: string } {
    try {
      // 格式: wc:topic@version?relay-protocol=waku&symKey=key
      const [protocol, rest] = uri.split(':');
      if (protocol !== 'wc') {
        throw new Error('Invalid URI protocol');
      }

      const [topicVersion, params] = rest.split('?');
      const [topic] = topicVersion.split('@');

      const searchParams = new URLSearchParams(params);
      const relay = searchParams.get('relay-protocol') || 'waku';
      const symKey = searchParams.get('symKey') || '';

      return { topic, symKey, relay };
    } catch (error) {
      this.logger.error('Failed to parse URI:', error);
      throw new Error('Invalid connection URI');
    }
  }

  /**
   * 处理配对响应
   */
  private async handlePairingResponse(message: any): Promise<void> {
    this.logger.info('Received pairing response:', message);

    const response: PairingResponse = message;

    if (response.approved) {
      this.paired = true;
      this.emit('pairing_approved', { topic: response.topic });

      // 自动发起会话提案
      await this.proposeSession();
    } else {
      this.emit('pairing_rejected', { error: response.error });
    }
  }

  /**
   * 提议会话
   */
  async proposeSession(): Promise<void> {
    try {
      if (!this.paired) {
        throw new Error('Not paired. Call pair() first.');
      }

      const proposalId = uuidv4();

      const requiredNamespaces: Record<string, any> = {};
      const optionalNamespaces: Record<string, any> = {};

      // 构建必需的命名空间
      if (this.requiredChains.length > 0) {
        requiredNamespaces.eip155 = {
          chains: this.requiredChains,
          methods: this.requiredMethods,
          events: ['chainChanged', 'accountsChanged'],
        };
      }

      // 构建可选的命名空间
      if (this.optionalChains.length > 0) {
        optionalNamespaces.eip155 = {
          chains: this.optionalChains,
          methods: this.optionalMethods,
          events: [],
        };
      }

      const proposal = {
        id: proposalId,
        params: {
          requiredNamespaces,
          optionalNamespaces,
          relays: [{ protocol: 'waku' }],
        },
        proposer: {
          publicKey: this.clientId,
          metadata: this.metadata,
        },
      };

      await this.sendMessage('session_proposal', proposal);

      this.emit('session_proposed', { proposalId });
      this.logger.info('Session proposal sent:', proposalId);
    } catch (error) {
      this.logger.error('Failed to propose session:', error);
      throw error;
    }
  }

  /**
   * 处理会话批准
   */
  private async handleSessionApprove(message: any): Promise<void> {
    this.logger.info('Received session approval:', message);

    this.currentSession = {
      topic: this.session.getTopic(),
      namespaces: message.namespaces,
      peer: message.responder,
      expiry: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7天
    };

    this.emit('session_approved', this.currentSession);
  }

  /**
   * 处理会话拒绝
   */
  private async handleSessionReject(message: any): Promise<void> {
    this.logger.info('Received session rejection:', message);

    this.emit('session_rejected', {
      id: message.id,
      reason: message.reason
    });
  }

  /**
   * 发送会话请求
   */
  async request(params: {
    chainId: string;
    method: string;
    params: any;
  }): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.currentSession) {
          throw new Error('No active session');
        }

        const requestId = uuidv4();

        // 设置超时
        const timeout = setTimeout(() => {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }, this.requestTimeout);

        // 保存待处理请求
        this.pendingRequests.set(requestId, {
          resolve,
          reject,
          timeout,
        });

        // 发送请求
        this.sendMessage('session_request', {
          id: requestId,
          topic: this.currentSession.topic,
          params: {
            request: {
              method: params.method,
              params: params.params,
            },
            chainId: params.chainId,
          },
        }).catch(error => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          reject(error);
        });

        this.logger.info('Session request sent:', requestId);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 处理会话响应
   */
  private async handleSessionResponse(message: any): Promise<void> {
    this.logger.info('Received session response:', message);

    const { id, result, error } = message;
    const pending = this.pendingRequests.get(id);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(id);

      if (error) {
        pending.reject(new Error(error.message || 'Request failed'));
      } else {
        pending.resolve(result);
      }
    }
  }

  /**
   * 处理会话更新
   */
  private async handleSessionUpdate(message: any): Promise<void> {
    this.logger.info('Received session update:', message);

    if (this.currentSession) {
      this.currentSession.namespaces = {
        ...this.currentSession.namespaces,
        ...message.namespaces,
      };

      this.emit('session_updated', this.currentSession);
    }
  }

  /**
   * 处理会话删除
   */
  private async handleSessionDelete(message: any): Promise<void> {
    this.logger.info('Received session delete:', message);

    this.currentSession = undefined;
    this.paired = false;

    // 拒绝所有待处理的请求
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Session deleted'));
    }
    this.pendingRequests.clear();

    this.emit('session_deleted', { topic: message.topic });
  }

  /**
   * 断开会话
   */
  async disconnectSession(): Promise<void> {
    try {
      if (!this.currentSession) {
        throw new Error('No active session');
      }

      await this.sendMessage('session_delete', {
        topic: this.currentSession.topic,
        reason: 'User disconnected',
      });

      this.currentSession = undefined;
      this.paired = false;

      this.emit('session_deleted', {});
      this.logger.info('Session disconnected');
    } catch (error) {
      this.logger.error('Failed to disconnect session:', error);
      throw error;
    }
  }

  /**
   * 处理会话 pong
   */
  private async handleSessionPong(message: any): Promise<void> {
    this.logger.debug('Received session pong:', message);
    this.emit('session_pong', { id: message.id });
  }

  /**
   * 发送 ping
   */
  async ping(): Promise<void> {
    try {
      if (!this.currentSession) {
        throw new Error('No active session');
      }

      const pingId = uuidv4();

      await this.sendMessage('session_ping', {
        id: pingId,
      });

      this.logger.debug('Session ping sent:', pingId);
    } catch (error) {
      this.logger.error('Failed to send ping:', error);
      throw error;
    }
  }

  /**
   * 获取当前会话
   */
  getSession(): SessionData | undefined {
    return this.currentSession ? { ...this.currentSession } : undefined;
  }

  /**
   * 获取账户
   */
  getAccounts(): string[] {
    if (!this.currentSession) {
      return [];
    }

    const accounts: string[] = [];
    for (const namespace of Object.values(this.currentSession.namespaces)) {
      if (namespace.accounts) {
        accounts.push(...namespace.accounts);
      }
    }

    return accounts;
  }

  /**
   * 获取当前链 ID
   */
  getChainId(): string | undefined {
    if (!this.currentSession) {
      return undefined;
    }

    const eip155 = this.currentSession.namespaces.eip155;
    if (eip155 && eip155.chains && eip155.chains.length > 0) {
      return eip155.chains[0];
    }

    return undefined;
  }

  /**
   * 检查会话是否活跃
   */
  isSessionActive(): boolean {
    if (!this.currentSession) {
      return false;
    }

    return Date.now() < this.currentSession.expiry;
  }

  /**
   * 设置请求超时时间
   */
  setRequestTimeout(timeout: number): void {
    this.requestTimeout = timeout;
  }
}

