// src/transport/WakuTransport.ts
import { ITransport } from '../types/index';
import { Logger } from '../utils/logger';
import { EventEmitter } from '../utils/event-emitter';
import {
  createLightNode,
  LightNode,
  createDecoder,
  createEncoder,
  Protocols,
  IDecodedMessage,
  Decoder,
} from '@waku/sdk';
import { MessageQueue } from './message-queue';

export interface WakuConfig {
  clusterId?: number;
  nodes?: string[];
  contentTopic?: string;
  pubsubTopic?: string;
  connectionTimeout?: number;
  numPeersToUse?: number;
  enableMessageQueue?: boolean;
  enableHealthCheck?: boolean;
  messageRetries?: number;
  healthCheckInterval?: number;
}

interface Subscription {
  topic: string;
  callback: (message: string) => void;
  decoders: Decoder[];
}

export class WakuTransport extends EventEmitter implements ITransport {
  private logger: Logger;
  private config: WakuConfig;
  private connected: boolean = false;
  private subscriptions: Map<string, Subscription> = new Map();
  private node?: LightNode;
  private messageQueue?: MessageQueue;

 /**
 * 健康检查 - 定期检查连接状态
 */
  private healthCheckInterval?: NodeJS.Timeout;
  private healthCheckIntervalMs: number = 30000; // 30秒

  constructor(config: WakuConfig = {}) {
    super();
    this.config = {
      clusterId: config.clusterId,
      contentTopic: '/yeying/2/wallet-connect/proto',
      pubsubTopic: `/waku/2/rs/${config.clusterId}/0`,
      connectionTimeout: 10000,
      numPeersToUse: 1,
      enableMessageQueue: true,
      enableHealthCheck: true,
      messageRetries: 3,
      healthCheckInterval: 30000,
      ...config,
    };

    this.logger = new Logger('WakuTransport');
    if (this.config.enableMessageQueue) {
      this.messageQueue = new MessageQueue(this);
    }
  }

  async connect(): Promise<void> {
    if (this.connected) {
      this.logger.warn('Already connected');
      return;
    }

    try {
      this.logger.info('Initializing Waku light node...');

      // 创建轻节点
      this.node = await createLightNode({
        networkConfig: {
          clusterId: this.config.clusterId!,
        },
        defaultBootstrap: false,
        autoStart: true,
        bootstrapPeers: this.config.nodes,
        numPeersToUse: this.config.numPeersToUse,
        libp2p: {
          filterMultiaddrs: false,
          hideWebSocketInfo: true,
          connectionManager: {
            dialTimeout: 5000,
            maxConnections: 10,
          }
        },
      });

      this.logger.info(`Node=${this.node.peerId} started=${this.node.isStarted()}, waiting for peers...`);

      // 等待连接到对等节点
      await this.node.waitForPeers([Protocols.LightPush, Protocols.Filter], this.config.connectionTimeout);

      const connections = this.node.libp2p.getConnections();
      this.logger.info(`Node connected to ${connections.length} peers`);

      this.connected = true;
      this.emit('connected');
      this.logger.info('Successfully connected to Waku network');
    } catch (error) {
      this.logger.error('Failed to connect to Waku network:', error);
      if (this.node) {
        await this.node.stop().catch(e => this.logger.error('Error stopping node:', e));
        this.node = undefined;
      }
      throw error;
    }

    if (this.config.enableHealthCheck) {
      this.startHealthCheck();
    }

    // 监听连接事件
    this.on('health-check-failed', () => {
      this.logger.warn('Health check failed, attempting reconnection...');
    });

    this.on('disconnected', () => {
      this.stopHealthCheck();
    });
  }

  async disconnect(): Promise<void> {

    this.stopHealthCheck();

    if (!this.connected) {
      return;
    }

    try {
      // 清理所有订阅
      this.node?.filter.unsubscribeAll()

      // 停止节点
      if (this.node) {
        await this.node.stop();
        this.node = undefined;
      }

      this.connected = false;
      this.emit('disconnected');
      this.logger.info('Disconnected from Waku network');
    } catch (error) {
      this.logger.error('Failed to disconnect:', error);
      throw error;
    }
  }

  public startHealthCheck(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        if (!this.connected || !this.node) {
          this.logger.warn('Health check failed: not connected');
          this.emit('health-check-failed');
          return;
        }

        const peerCount = this.getPeerCount();
        if (peerCount === 0) {
          this.logger.warn('Health check failed: no peers connected');
          this.emit('health-check-failed');

          // 尝试重连
          await this.reconnect();
        } else {
          this.logger.debug(`Health check passed: ${peerCount} peers connected`);
          this.emit('health-check-passed', { peerCount });
        }
      } catch (error) {
        this.logger.error('Health check error:', error);
        this.emit('health-check-error', error);
      }
    }, this.healthCheckIntervalMs);

    this.logger.info('Health check started');
  }

  public stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
      this.logger.info('Health check stopped');
    }
  }

  async publish(topic: string, message: string, useQueue: boolean = false): Promise<void> {
    if (!this.connected || !this.node) {
      throw new Error('Not connected to Waku network');
    }

    if (useQueue && this.messageQueue) {
      this.messageQueue.enqueue(topic, message, this.config.messageRetries);
      return;
    }

    try {
      const contentTopic = this.config.contentTopic || ""
      const encoder = createEncoder({
        contentTopic,
        routingInfo: {
          pubsubTopic: this.config.pubsubTopic || '',
          clusterId: this.config.clusterId || 5432,
          shardId: 0,
        }
      });

      // 将字符串转换为 Uint8Array
      const payload = new TextEncoder().encode(message);

      // 发送消息
      const result = await this.node.lightPush.send(encoder, {
        payload,
        timestamp: new Date()
      });

      // 检查发送结果
      if (!result.successes || result.successes.length === 0) {
        const errors = result.failures?.map(f => f.error).join(', ') || 'Unknown error';
        throw new Error(`Failed to publish message: ${errors}`);
      }

      this.logger.debug(`Published message to topic: ${topic}, sent to ${result.successes.length} peers`);
    } catch (error) {
      this.logger.error(`Failed to publish to topic ${topic}:`, error);
      // 如果启用了队列且直接发送失败，则加入队列
      if (this.messageQueue) {
        this.logger.warn('Direct publish failed, adding to queue');
        this.messageQueue.enqueue(topic, message, this.config.messageRetries);
      } else {
        throw error;
      }
    }
  }

  async subscribe(topic: string, callback: (message: string) => void): Promise<void> {
    if (!this.connected || !this.node) {
      throw new Error('Not connected to Waku network');
    }

    if (this.subscriptions.has(topic)) {
      this.logger.warn(`Already subscribed to topic: ${topic}`);
      return;
    }

    try {
      const contentTopic = this.config.contentTopic || "";
      const decoder = createDecoder(contentTopic, {
        pubsubTopic: this.config.pubsubTopic || '',
        clusterId: this.config.clusterId || 5432,
        shardId: 0,
      });

      // 创建消息处理回调
      const messageCallback = (wakuMessage: IDecodedMessage) => {
        if (wakuMessage.payload) {
          try {
            // 将 Uint8Array 转换为字符串
            const message = new TextDecoder().decode(wakuMessage.payload);
            callback(message);
            this.logger.debug(`Received message on topic ${topic}`);
          } catch (error) {
            this.logger.error('Failed to decode message:', error);
          }
        }
      };

      const decoders = [decoder]
      // 订阅主题
      const success = await this.node.filter.subscribe(
        decoders,
        messageCallback
      );

      if (!success) {
        throw new Error("Failed to subscribe to Waku messages");
      }

      // 保存订阅信息
      const subscription: Subscription = {
        topic,
        callback,
        decoders,
      };

      this.subscriptions.set(topic, subscription);
      this.logger.debug(`Subscribed to topic: ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to subscribe to topic ${topic}:`, error);
      throw error;
    }
  }

  async unsubscribe(topic: string): Promise<void> {
    const subscription = this.subscriptions.get(topic);
    if (!subscription) {
      this.logger.warn(`Not subscribed to topic: ${topic}`);
      return;
    }

    try {
      await this.node?.filter.unsubscribe(subscription.decoders)
      this.subscriptions.delete(topic);
      this.logger.debug(`Unsubscribed from topic: ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to unsubscribe from topic ${topic}:`, error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected && this.node !== undefined;
  }


  private getContentTopic(topic: string): string {
    // 将会话主题转换为 Waku content topic
    return `${this.config.contentTopic}/${topic}`;
  }

  /**
   * 获取当前连接的对等节点数量
   */
  public getPeerCount(): number {
    if (!this.node) {
      return 0;
    }
    return this.node.libp2p.getConnections().length;
  }

  /**
   * 获取节点的 Peer ID
   */
  public getPeerId(): string | undefined {
    return this.node?.peerId?.toString();
  }

  /**
   * 获取当前订阅数量
   */
  public getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * 获取所有订阅的主题
   */
  public getSubscribedTopics(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * 检查是否订阅了特定主题
   */
  public isSubscribed(topic: string): boolean {
    return this.subscriptions.has(topic);
  }

  /**
   * 重新连接到 Waku 网络
   */
  public async reconnect(): Promise<void> {
    this.logger.info('Reconnecting to Waku network...');

    if (this.connected) {
      await this.disconnect();
    }

    await this.connect();

    // 重新订阅之前的主题
    const topics = Array.from(this.subscriptions.entries());
    this.subscriptions.clear();

    for (const [topic, { callback }] of topics) {
      try {
        await this.subscribe(topic, callback);
      } catch (error) {
        this.logger.error(`Failed to resubscribe to topic ${topic}:`, error);
      }
    }
  }

  /**
   * 获取消息队列大小
   */
  public getQueueSize(): number {
    return this.messageQueue?.size() ?? 0;
  }

  /**
   * 清空消息队列
   */
  public clearQueue(): void {
    this.messageQueue?.clear();
  }

  /**
   * 获取网络统计信息
   */
  public getNetworkStats(): {
    connected: boolean;
    peerCount: number;
    peerId?: string;
    subscriptionCount: number;
    subscribedTopics: string[];
  } {
    return {
      connected: this.connected,
      peerCount: this.getPeerCount(),
      peerId: this.getPeerId(),
      subscriptionCount: this.getSubscriptionCount(),
      subscribedTopics: this.getSubscribedTopics(),
    };
  }

  /**
 * 获取网络统计信息
 */
  public getStats() {
    return {
      ...this.getNetworkStats(),
      queueSize: this.getQueueSize(),
      queueEnabled: this.config.enableMessageQueue,
      healthCheckEnabled: this.config.enableHealthCheck,
    };
  }
}
