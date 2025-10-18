// src/core/Client.ts

import { Session, SessionConfig, SessionStatus } from './session';
import { EventEmitter } from '../utils/event-emitter';
import { Logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface ClientConfig extends SessionConfig {
  name?: string;
  description?: string;
  url?: string;
  icons?: string[];
}

export interface ClientMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

export interface PairingRequest {
  id: string;
  topic: string;
  metadata: ClientMetadata;
  timestamp: number;
}

export interface PairingResponse {
  approved: boolean;
  topic?: string;
  metadata?: ClientMetadata;
  error?: string;
}

export abstract class Client extends EventEmitter {
  protected session: Session;
  protected logger: Logger;
  protected clientId: string;
  protected metadata: ClientMetadata;
  protected paired: boolean = false;
  protected peerMetadata?: ClientMetadata;

  constructor(config: ClientConfig = {}) {
    super();
    this.clientId = uuidv4();
    this.logger = new Logger('Client');
    
    // 设置客户端元数据
    this.metadata = {
      name: config.name || 'Unknown Client',
      description: config.description || '',
      url: config.url || '',
      icons: config.icons || [],
    };

    // 创建会话
    this.session = new Session(config);
    this.setupSessionListeners();
  }

  /**
   * 设置会话监听器
   */
  private setupSessionListeners(): void {
    this.session.on('connected', (metadata) => {
      this.logger.info('Session connected:', metadata);
      this.emit('session:connected', metadata);
    });

    this.session.on('disconnected', (data) => {
      this.logger.info('Session disconnected:', data);
      this.paired = false;
      this.emit('session:disconnected', data);
    });

    this.session.on('status:changed', (status: SessionStatus) => {
      this.logger.debug('Session status changed:', status);
      this.emit('session:status', status);
    });

    this.session.on('message:received', (envelope) => {
      this.handleMessage(envelope);
    });

    this.session.on('expired', (data) => {
      this.logger.warn('Session expired:', data);
      this.paired = false;
      this.emit('session:expired', data);
    });
  }

  /**
   * 连接客户端
   */
  async connect(): Promise<void> {
    try {
      await this.session.connect();
      this.logger.info(`Client connected: ${this.clientId}`);
    } catch (error) {
      this.logger.error('Failed to connect client:', error);
      throw error;
    }
  }

  /**
   * 断开客户端
   */
  async disconnect(): Promise<void> {
    try {
      await this.session.disconnect();
      this.paired = false;
      this.logger.info(`Client disconnected: ${this.clientId}`);
    } catch (error) {
      this.logger.error('Failed to disconnect client:', error);
      throw error;
    }
  }

  /**
   * 处理接收到的消息（由子类实现）
   */
  protected abstract handleMessage(envelope: any): void;

  /**
   * 发送消息
   */
  protected async sendMessage(type: string, payload: any): Promise<void> {
    const message = {
      type,
      payload,
      metadata: this.metadata,
    };

    await this.session.send(message);
  }

  /**
   * 获取客户端ID
   */
  public getClientId(): string {
    return this.clientId;
  }

  /**
   * 获取客户端元数据
   */
  public getMetadata(): ClientMetadata {
    return { ...this.metadata };
  }

  /**
   * 获取会话信息
   */
  public getSessionInfo() {
    return {
      sessionId: this.session.getSessionId(),
      topic: this.session.getTopic(),
      status: this.session.getStatus(),
      metadata: this.session.getMetadata(),
      paired: this.paired,
      peerMetadata: this.peerMetadata,
    };
  }

  /**
   * 检查是否已配对
   */
  public isPaired(): boolean {
    return this.paired;
  }

  /**
   * 检查是否已连接
   */
  public isConnected(): boolean {
    return this.session.isConnected();
  }

  /**
   * 获取传输层统计信息
   */
  public getStats() {
    return this.session.getTransportStats();
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    await this.session.cleanup();
    this.removeAllListeners();
  }
}

