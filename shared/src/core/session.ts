// src/core/Session.ts

import { WakuTransport } from '../transport/waku-transport';
import { EventEmitter } from '../utils/event-emitter';
import { Logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface SessionConfig {
  clusterId?: number;
  wakuNodes?: string[];
  enableMessageQueue?: boolean;
  enableHealthCheck?: boolean;
  sessionTimeout?: number;
  autoReconnect?: boolean;
}

export interface SessionMetadata {
  id: string;
  topic: string;
  createdAt: number;
  lastActivity: number;
  peerInfo?: {
    peerId: string;
    metadata?: any;
  };
}

export enum SessionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  EXPIRED = 'expired',
}

export class Session extends EventEmitter {
  private transport: WakuTransport;
  private logger: Logger;
  private topic: string;
  private sessionId: string;
  private status: SessionStatus = SessionStatus.DISCONNECTED;
  private sessionTimeout: number;
  private timeoutTimer?: NodeJS.Timeout;
  private metadata: SessionMetadata;
  private autoReconnect: boolean;
  private messageHandlers: Map<string, (message: any) => void> = new Map();

  constructor(config: SessionConfig = {}) {
    super();
    this.logger = new Logger('Session');
    this.sessionId = uuidv4();
    this.topic = `walletconnect-v3/${this.sessionId}`;
    this.sessionTimeout = config.sessionTimeout || 300000; // 5分钟默认超时
    this.autoReconnect = config.autoReconnect ?? true;

    // 初始化传输层
    this.transport = new WakuTransport({
      clusterId: config.clusterId || 1,
      nodes: config.wakuNodes,
      enableMessageQueue: config.enableMessageQueue ?? true,
      enableHealthCheck: config.enableHealthCheck ?? true,
    });

    // 初始化元数据
    this.metadata = {
      id: this.sessionId,
      topic: this.topic,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.setupTransportListeners();
  }

  /**
   * 设置传输层监听器
   */
  private setupTransportListeners(): void {
    this.transport.on('connected', () => {
      this.logger.info('Transport connected');
      this.emit('transport:connected');
    });

    this.transport.on('disconnected', () => {
      this.logger.warn('Transport disconnected');
      this.emit('transport:disconnected');

      if (this.autoReconnect && this.status === SessionStatus.CONNECTED) {
        this.handleReconnect();
      }
    });

    this.transport.on('health-check-failed', () => {
      this.logger.warn('Transport health check failed');
      this.emit('transport:health-check-failed');
    });
  }

  /**
   * 连接会话
   */
  async connect(): Promise<void> {
    if (this.status === SessionStatus.CONNECTED) {
      this.logger.warn('Session already connected');
      return;
    }

    try {
      this.status = SessionStatus.CONNECTING;
      this.emit('status:changed', this.status);

      // 连接传输层
      await this.transport.connect();

      // 订阅会话主题
      await this.transport.subscribe(this.topic, this.handleIncomingMessage.bind(this));

      this.status = SessionStatus.CONNECTED;
      this.metadata.lastActivity = Date.now();

      this.emit('status:changed', this.status);
      this.emit('connected', this.metadata);

      this.startSessionTimeout();

      this.logger.info(`Session connected: ${this.sessionId}`);
    } catch (error) {
      this.status = SessionStatus.DISCONNECTED;
      this.emit('status:changed', this.status);
      this.logger.error('Failed to connect session:', error);
      throw error;
    }
  }

  /**
   * 断开会话
   */
  async disconnect(): Promise<void> {
    try {
      this.stopSessionTimeout();

      await this.transport.unsubscribe(this.topic);
      await this.transport.disconnect();

      this.status = SessionStatus.DISCONNECTED;
      this.emit('status:changed', this.status);
      this.emit('disconnected', { sessionId: this.sessionId });

      this.logger.info(`Session disconnected: ${this.sessionId}`);
    } catch (error) {
      this.logger.error('Failed to disconnect session:', error);
      throw error;
    }
  }

  /**
   * 处理重连
   */
  private async handleReconnect(): Promise<void> {
    if (this.status === SessionStatus.RECONNECTING) {
      return;
    }

    try {
      this.status = SessionStatus.RECONNECTING;
      this.emit('status:changed', this.status);
      this.emit('reconnecting');

      await this.transport.reconnect();

      this.status = SessionStatus.CONNECTED;
      this.emit('status:changed', this.status);
      this.emit('reconnected');

      this.logger.info('Session reconnected successfully');
    } catch (error) {
      this.logger.error('Failed to reconnect session:', error);
      this.status = SessionStatus.DISCONNECTED;
      this.emit('status:changed', this.status);
      this.emit('reconnect:failed', error);
    }
  }

  /**
   * 发送消息
   */
  async send(message: any): Promise<void> {
    if (this.status !== SessionStatus.CONNECTED) {
      throw new Error('Session not connected');
    }

    try {
      const envelope = {
        id: uuidv4(),
        sessionId: this.sessionId,
        timestamp: Date.now(),
        payload: message,
      };

      await this.transport.publish(this.topic, JSON.stringify(envelope), true);

      this.updateActivity();
      this.emit('message:sent', envelope);

      this.logger.debug(`Message sent to ${this.topic}:`, envelope.id);
    } catch (error) {
      this.logger.error('Failed to send message:', error);
      throw error;
    }
  }

  /**
   * 处理接收到的消息
   */
  private handleIncomingMessage(rawMessage: string): void {
    try {
      const envelope = JSON.parse(rawMessage);

      // 忽略自己发送的消息
      if (envelope.sessionId === this.sessionId) {
        return;
      }

      this.updateActivity();
      this.emit('message:received', envelope);

      // 调用注册的消息处理器
      const handler = this.messageHandlers.get(envelope.payload?.type);
      if (handler) {
        handler(envelope.payload);
      }

      this.logger.debug('Message received:', envelope.id);
    } catch (error) {
      this.logger.error('Failed to handle incoming message:', error);
      this.emit('message:error', error);
    }
  }

  /**
   * 注册消息处理器
   */
  public onMessage(type: string, handler: (message: any) => void): void {
    this.messageHandlers.set(type, handler);
    this.logger.debug(`Message handler registered for type: ${type}`);
  }

  /**
   * 移除消息处理器
   */
  public offMessage(type: string): void {
    this.messageHandlers.delete(type);
    this.logger.debug(`Message handler removed for type: ${type}`);
  }

  /**
   * 更新活动时间
   */
  private updateActivity(): void {
    this.metadata.lastActivity = Date.now();
    this.resetSessionTimeout();
  }

  /**
   * 启动会话超时计时器
   */
  private startSessionTimeout(): void {
    this.stopSessionTimeout();
    this.timeoutTimer = setTimeout(() => {
      this.handleSessionTimeout();
    }, this.sessionTimeout);
  }

  /**
   * 重置会话超时计时器
   */
  private resetSessionTimeout(): void {
    this.startSessionTimeout();
  }

  /**
   * 停止会话超时计时器
   */
  private stopSessionTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
  }

  /**
   * 处理会话超时
   */
  private async handleSessionTimeout(): Promise<void> {
    this.logger.warn('Session timeout');
    this.status = SessionStatus.EXPIRED;
    this.emit('status:changed', this.status);
    this.emit('expired', { sessionId: this.sessionId });
    await this.disconnect();
  }

  /**
   * 获取会话状态
   */
  public getStatus(): SessionStatus {
    return this.status;
  }

  /**
   * 获取会话元数据
   */
  public getMetadata(): SessionMetadata {
    return { ...this.metadata };
  }

  /**
   * 获取会话ID
   */
  public getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 获取会话主题
   */
  public getTopic(): string {
    return this.topic;
  }

  /**
   * 检查会话是否已连接
   */
  public isConnected(): boolean {
    return this.status === SessionStatus.CONNECTED;
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    this.stopSessionTimeout();
    this.messageHandlers.clear();
    await this.disconnect();
    this.removeAllListeners();
  }

  /**
   * 获取传输层统计信息
   */
  public getTransportStats() {
    return this.transport.getStats();
  }
}

