import { Client, ClientConfig, PairingRequest, PairingResponse } from '../core/client';
import { SessionRequest } from '../types';
import { Logger } from '../utils/logger';

export interface WalletConfig extends ClientConfig {
  // 钱包特定配置
  supportedChains?: string[];
  supportedMethods?: string[];
  accounts?: string[];
}

export class WalletClient extends Client {
  private supportedChains: string[];
  private supportedMethods: string[];
  private accounts: string[];
  private pendingRequests: Map<string, SessionRequest> = new Map();
  private activeSessions: Map<string, any> = new Map();

  constructor(config: WalletConfig = {}) {
    super(config);
    this.logger = new Logger('WalletClient');

    this.supportedChains = config.supportedChains || ['eip155:1'];
    this.supportedMethods = config.supportedMethods || [
      'eth_sendTransaction',
      'eth_signTransaction',
      'eth_sign',
      'personal_sign',
      'eth_signTypedData',
    ];
    this.accounts = config.accounts || [];

    this.setupMessageHandlers();
  }

  /**
   * 设置消息处理器
   */
  private setupMessageHandlers(): void {
    this.session.onMessage('pairing_request', this.handlePairingRequest.bind(this));
    this.session.onMessage('session_proposal', this.handleSessionProposal.bind(this));
    this.session.onMessage('session_request', this.handleSessionRequest.bind(this));
    this.session.onMessage('session_delete', this.handleSessionDelete.bind(this));
    this.session.onMessage('session_ping', this.handleSessionPing.bind(this));
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
   * 处理配对请求
   */
  private async handlePairingRequest(message: any): Promise<void> {
    this.logger.info('Received pairing request:', message);

    const request: PairingRequest = {
      id: message.id,
      topic: message.topic,
      metadata: message.metadata,
      timestamp: Date.now(),
    };

    this.emit('pairing_request', request);
  }

  /**
   * 批准配对请求
   */
  async approvePairing(requestId: string): Promise<void> {
    try {
      const response: PairingResponse = {
        approved: true,
        topic: this.session.getTopic(),
        metadata: this.metadata,
      };

      await this.sendMessage('pairing_response', {
        id: requestId,
        ...response,
      });

      this.paired = true;
      this.emit('pairing_approved', { requestId, topic: this.session.getTopic() });

      this.logger.info('Pairing approved:', requestId);
    } catch (error) {
      this.logger.error('Failed to approve pairing:', error);
      throw error;
    }
  }

  /**
   * 拒绝配对请求
   */
  async rejectPairing(requestId: string, reason?: string): Promise<void> {
    try {
      const response: PairingResponse = {
        approved: false,
        error: reason || 'User rejected pairing',
      };

      await this.sendMessage('pairing_response', {
        id: requestId,
        ...response,
      });

      this.emit('pairing_rejected', { requestId, reason });

      this.logger.info('Pairing rejected:', requestId);
    } catch (error) {
      this.logger.error('Failed to reject pairing:', error);
      throw error;
    }
  }

  /**
   * 处理会话提案
   */
  private async handleSessionProposal(message: any): Promise<void> {
    this.logger.info('Received session proposal:', message);

    // const proposal: SessionProposal = {
    //   id: message.id,
    //   params: message.params,
    //   proposer: message.proposer,
    // };

    this.emit('session_proposal', message);
  }

  /**
   * 批准会话提案
   */
  async approveSession(proposalId: string, namespaces: Record<string, any>): Promise<void> {
    try {
      const sessionTopic = this.session.getTopic();

      const approval = {
        id: proposalId,
        namespaces,
        relay: { protocol: 'waku' },
        responder: {
          publicKey: this.clientId,
          metadata: this.metadata,
        },
      };

      await this.sendMessage('session_approve', approval);

      // 保存活动会话
      this.activeSessions.set(sessionTopic, {
        topic: sessionTopic,
        namespaces,
        createdAt: Date.now(),
      });

      this.emit('session_approved', { proposalId, topic: sessionTopic });

      this.logger.info('Session approved:', proposalId);
    } catch (error) {
      this.logger.error('Failed to approve session:', error);
      throw error;
    }
  }

  /**
   * 拒绝会话提案
   */
  async rejectSession(proposalId: string, reason?: string): Promise<void> {
    try {
      await this.sendMessage('session_reject', {
        id: proposalId,
        reason: reason || 'User rejected session',
      });

      this.emit('session_rejected', { proposalId, reason });

      this.logger.info('Session rejected:', proposalId);
    } catch (error) {
      this.logger.error('Failed to reject session:', error);
      throw error;
    }
  }

  /**
   * 处理会话请求
   */
  private async handleSessionRequest(message: any): Promise<void> {
    this.logger.info('Received session request:', message);

    const request: SessionRequest = {
      id: message.id,
      topic: message.topic,
      params: message.params,
    };

    // 保存待处理请求
    this.pendingRequests.set(request.id, request);

    this.emit('session_request', request);
  }

  /**
   * 响应会话请求
   */
  async respondToRequest(requestId: string, result: any): Promise<void> {
    try {
      const request = this.pendingRequests.get(requestId);
      if (!request) {
        throw new Error(`Request not found: ${requestId}`);
      }

      await this.sendMessage('session_response', {
        id: requestId,
        result,
      });

      this.pendingRequests.delete(requestId);
      this.emit('request_responded', { requestId, result });

      this.logger.info('Request responded:', requestId);
    } catch (error) {
      this.logger.error('Failed to respond to request:', error);
      throw error;
    }
  }

  /**
   * 拒绝会话请求
   */
  async rejectRequest(requestId: string, error: string): Promise<void> {
    try {
      const request = this.pendingRequests.get(requestId);
      if (!request) {
        throw new Error(`Request not found: ${requestId}`);
      }

      await this.sendMessage('session_response', {
        id: requestId,
        error: {
          code: -32000,
          message: error,
        },
      });

      this.pendingRequests.delete(requestId);
      this.emit('request_rejected', { requestId, error });

      this.logger.info('Request rejected:', requestId);
    } catch (error) {
      this.logger.error('Failed to reject request:', error);
      throw error;
    }
  }

  /**
   * 处理会话删除
   */
  private async handleSessionDelete(message: any): Promise<void> {
    this.logger.info('Received session delete:', message);

    const { topic } = message;
    this.activeSessions.delete(topic);

    this.emit('session_deleted', { topic });
  }

  /**
   * 删除会话
   */
  async deleteSession(topic: string): Promise<void> {
    try {
      await this.sendMessage('session_delete', {
        topic,
        reason: 'User disconnected',
      });

      this.activeSessions.delete(topic);
      this.emit('session_deleted', { topic });

      this.logger.info('Session deleted:', topic);
    } catch (error) {
      this.logger.error('Failed to delete session:', error);
      throw error;
    }
  }

  /**
   * 处理会话 ping
   */
  private async handleSessionPing(message: any): Promise<void> {
    this.logger.debug('Received session ping:', message);

    await this.sendMessage('session_pong', {
      id: message.id,
    });
  }

  /**
   * 发送会话 ping
   */
  async ping(topic: string): Promise<void> {
    try {
      const pingId = Date.now().toString();

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
   * 更新账户
   */
  async updateAccounts(accounts: string[]): Promise<void> {
    this.accounts = accounts;

    // 通知所有活动会话
    for (const [topic, session] of this.activeSessions) {
      await this.sendMessage('session_update', {
        topic,
        namespaces: {
          eip155: {
            accounts: accounts.map(acc => `eip155:1:${acc}`),
          },
        },
      });
    }

    this.emit('accounts_updated', accounts);
    this.logger.info('Accounts updated:', accounts);
  }

  /**
   * 获取活动会话
   */
  getActiveSessions(): Map<string, any> {
    return new Map(this.activeSessions);
  }

  /**
   * 获取待处理请求
   */
  getPendingRequests(): Map<string, SessionRequest> {
    return new Map(this.pendingRequests);
  }

  /**
   * 获取支持的链
   */
  getSupportedChains(): string[] {
    return [...this.supportedChains];
  }

  /**
   * 获取支持的方法
   */
  getSupportedMethods(): string[] {
    return [...this.supportedMethods];
  }

  /**
   * 获取账户
   */
  getAccounts(): string[] {
    return [...this.accounts];
  }
}

