import {
  createLightNode,
  LightNode,
  createDecoder,
  createEncoder,
  Protocols,
  IDecodedMessage,
  Decoder,
  Encoder,
} from '@waku/sdk';
import { IRelay, RelayConfig, RelayMessage, MessageCallback, RelayProtocol } from '../types/relay';

/**
 * 基于 Waku 的 Relay 实现
 */
export class WakuRelay implements IRelay {
  private node: LightNode | null = null;
  private config: RelayConfig;
  private subscriptions: Map<string, MessageCallback> = new Map();
  private decoders: Map<string, Decoder> = new Map();
  private encoders: Map<string, Encoder> = new Map();
  private isInitialized = false;
  private isStarted = false;

  // 默认配置
  private static readonly DEFAULT_CONNECTION_TIMEOUT = 5000;
  private static readonly DEFAULT_CLUSTER_ID = 5432;
  private static readonly DEFAULT_CONTENT_TOPIC_PREFIX = '/walletconnect/1';
  private static readonly DEFAULT_BOOTSTRAP_PEERS = [];

  constructor(config: Partial<RelayConfig> = {}) {
    const clusterId = config.clusterId || WakuRelay.DEFAULT_CLUSTER_ID
    this.config = {
      protocol: 'waku',
      connectionTimeout: config.connectionTimeout || WakuRelay.DEFAULT_CONNECTION_TIMEOUT,
      clusterId: clusterId,
      bootstrapPeers: config.bootstrapPeers || WakuRelay.DEFAULT_BOOTSTRAP_PEERS,
      pubsubTopic: config.pubsubTopic || `/waku/2/rs/${clusterId}/0`,
      contentTopicPrefix: config.contentTopicPrefix || WakuRelay.DEFAULT_CONTENT_TOPIC_PREFIX
    };
  }

  /**
   * 初始化 Waku 节点
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      console.warn('[WakuRelay] Already initialized');
      return;
    }

    try {
      console.log('[WakuRelay] Initializing Waku node...');
      const relayConfig = {
        defaultBootstrap: false,
        networkConfig: {
          clusterId: this.config.clusterId!,
        },
        autoStart: true,
        bootstrapPeers: this.config.bootstrapPeers,
        numPeersToUse: 1,
        libp2p: {
          filterMultiaddrs: false,
          hideWebSocketInfo: true,
          connectionManager: {
            dialTimeout: 5000,
            maxConnections: 10,
          }
        },
      };

      // 创建 Light Node
      this.node = await createLightNode(relayConfig);

      // 等待连接到对等节点
      await this.node.waitForPeers([Protocols.LightPush, Protocols.Filter], this.config.connectionTimeout);

      this.isInitialized = true;
      console.log('[WakuRelay] Waku node initialized');
    } catch (error) {
      console.error('[WakuRelay] Failed to initialize:', error);
      throw new Error(`Failed to initialize Waku relay: ${error}`);
    }
  }

  /**
   * 启动 Waku 节点并连接到网络
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Relay not initialized. Call init() first.');
    }

    if (this.isStarted) {
      console.warn('[WakuRelay] Already started');
      return;
    }

    try {
      console.log('[WakuRelay] Starting Waku node...');

      // 启动节点
      await this.node!.start();

      // 连接到 bootstrap 节点
      if (this.config.bootstrapPeers && this.config.bootstrapPeers.length > 0) {
        console.log('[WakuRelay] Connecting to bootstrap peers...');

        for (const peer of this.config.bootstrapPeers) {
          try {
            await this.node!.dial(peer);
            console.log(`[WakuRelay] Connected to peer: ${peer}`);
          } catch (error) {
            console.warn(`[WakuRelay] Failed to connect to peer ${peer}:`, error);
          }
        }
      }

      // 等待至少一个远程节点支持所需协议
      console.log('[WakuRelay] Waiting for remote peers...');
      await this.node?.waitForPeers([Protocols.LightPush, Protocols.Filter]);

      this.isStarted = true;
      console.log('[WakuRelay] Waku node started and connected');
    } catch (error) {
      console.error('[WakuRelay] Failed to start:', error);
      throw new Error(`Failed to start Waku relay: ${error}`);
    }
  }

  /**
   * 停止 Waku 节点
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      console.log('[WakuRelay] Stopping Waku node...');

      // 取消所有订阅
      for (const topic of this.subscriptions.keys()) {
        await this.unsubscribe(topic);
      }

      // 停止节点
      if (this.node) {
        await this.node.stop();
        this.node = null;
      }

      this.isStarted = false;
      this.isInitialized = false;
      console.log('[WakuRelay] Waku node stopped');
    } catch (error) {
      console.error('[WakuRelay] Failed to stop:', error);
      throw new Error(`Failed to stop Waku relay: ${error}`);
    }
  }

  /**
   * 获取或创建指定 topic 的 encoder
   */
  private getOrCreateEncoder(topic: string): Encoder {
    // 检查是否已存在
    if (this.encoders.has(topic)) {
      return this.encoders.get(topic)!;
    }

    // 创建新的 encoder
    const contentTopic = this.getContentTopicForTopic(topic);
    const encoder = createEncoder({
      contentTopic,
      routingInfo: {
        pubsubTopic: this.config.pubsubTopic || '',
        clusterId: this.config.clusterId || 5432,
        shardId: 0,
      }
    });

    // 缓存
    this.encoders.set(topic, encoder);

    console.log(`[WakuRelay] Created encoder for topic: ${topic}, contentTopic: ${contentTopic}`);

    return encoder;
  }

  /**
   * 获取或创建指定 topic 的 decoder
   */
  private getOrCreateDecoder(topic: string): Decoder {
    // 检查是否已存在
    if (this.decoders.has(topic)) {
      return this.decoders.get(topic)!;
    }

    // 创建新的 decoder
    const contentTopic = this.getContentTopicForTopic(topic);
    const routingInfo = {
      pubsubTopic: this.config.pubsubTopic || '',
      clusterId: this.config.clusterId || 5432,
      shardId: 0,
    };

    const decoder = createDecoder(contentTopic, routingInfo);

    // 缓存
    this.decoders.set(topic, decoder);

    console.log(`[WakuRelay] Created decoder for topic: ${topic}, contentTopic: ${contentTopic}`);

    return decoder;
  }

  /**
   * 发布消息到指定 topic
   */
  async publish(topic: string, payload: string): Promise<void> {
    if (!this.isStarted || !this.node) {
      throw new Error('Relay not started. Call start() first.');
    }

    try {
      console.log(`[WakuRelay] Publishing to topic: ${topic}`);

      // 创建消息
      const message: RelayMessage = {
        topic,
        payload,
        publishedAt: Date.now()
      };

      // 获取该 topic 的 encoder
      const encoder = this.getOrCreateEncoder(topic);

      // 使用 LightPush 发送消息
      const result = await this.node.lightPush.send(encoder, {
        payload: new TextEncoder().encode(JSON.stringify(message))
      });

      if (!result.successes || result.successes.length === 0) {
        throw new Error('Failed to publish message to any peer');
      }

      console.log(`[WakuRelay] Message published successfully to ${result.successes.length} peer(s)`);
    } catch (error) {
      console.error(`[WakuRelay] Failed to publish to topic ${topic}:`, error);
      throw new Error(`Failed to publish message: ${error}`);
    }
  }

  /**
   * 订阅指定 topic 的消息
   */
  async subscribe(topic: string, callback: MessageCallback): Promise<void> {
    if (!this.isStarted || !this.node) {
      throw new Error('Relay not started. Call start() first.');
    }

    if (this.subscriptions.has(topic)) {
      console.warn(`[WakuRelay] Already subscribed to topic: ${topic}`);
      return;
    }

    try {
      console.log(`[WakuRelay] Subscribing to topic: ${topic}`);

      // 获取该 topic 的 decoder
      const decoder = this.getOrCreateDecoder(topic);

      // 创建消息处理器
      const messageHandler = (wakuMessage: IDecodedMessage) => {
        try {
          if (!wakuMessage.payload) {
            console.warn('[WakuRelay] Received message without payload');
            return;
          }

          // 解码消息
          const messageStr = new TextDecoder().decode(wakuMessage.payload);
          const relayMessage: RelayMessage = JSON.parse(messageStr);

          // 验证 topic
          if (relayMessage.topic !== topic) {
            console.warn(`[WakuRelay] Topic mismatch: expected ${topic}, got ${relayMessage.topic}`);
            return;
          }

          console.log(`[WakuRelay] Received message on topic: ${topic}`);

          // 调用回调
          callback(relayMessage);
        } catch (error) {
          console.error('[WakuRelay] Failed to process message:', error);
        }
      };

      // 使用 Filter 订阅
      await this.node.filter.subscribe([decoder], messageHandler);

      // 保存订阅
      this.subscriptions.set(topic, callback);

      console.log(`[WakuRelay] Successfully subscribed to topic: ${topic}`);
    } catch (error) {
      console.error(`[WakuRelay] Failed to subscribe to topic ${topic}:`, error);
      throw new Error(`Failed to subscribe: ${error}`);
    }
  }

  /**
   * 取消订阅指定 topic
   */
  async unsubscribe(topic: string): Promise<void> {
    if (!this.subscriptions.has(topic)) {
      console.warn(`[WakuRelay] Not subscribed to topic: ${topic}`);
      return;
    }

    try {
      console.log(`[WakuRelay] Unsubscribing from topic: ${topic}`);

      const decoder = this.decoders.get(topic);
      if (decoder && this.node) {
        // 取消 Filter 订阅
        await this.node.filter.unsubscribe([decoder]);
      }

      // 清理
      this.subscriptions.delete(topic);
      this.decoders.delete(topic);
      this.encoders.delete(topic);

      console.log(`[WakuRelay] Successfully unsubscribed from topic: ${topic}`);
    } catch (error) {
      console.error(`[WakuRelay] Failed to unsubscribe from topic ${topic}:`, error);
      throw new Error(`Failed to unsubscribe: ${error}`);
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.isStarted && this.node !== null;
  }

  /**
   * 获取协议信息
   */
  getProtocol(): RelayProtocol {
    return {
      protocol: this.config.protocol,
      data: JSON.stringify({
        pubsubTopic: this.config.pubsubTopic,
        contentTopicPrefix: this.config.contentTopicPrefix
      })
    };
  }

  /**
   * 为 topic 生成 Waku content topic
   * 格式: /walletconnect/1/{topic}/proto
   */
  private getContentTopicForTopic(topic: string): string {
    return `${this.config.contentTopicPrefix}/${topic}/proto`;
  }

  /**
   * 获取连接的节点数量
   */
  getConnectedPeersCount(): number {
    if (!this.node) return 0;

    try {
      const peers = this.node.libp2p.getPeers();
      return peers.length;
    } catch {
      return 0;
    }
  }

  /**
   * 获取订阅的 topic 列表
   */
  getSubscribedTopics(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    console.log('[WakuRelay] Cleaning up resources...');

    // 清理所有 encoder 和 decoder
    this.encoders.clear();
    this.decoders.clear();
    this.subscriptions.clear();

    console.log('[WakuRelay] Resources cleaned up');
  }
}
