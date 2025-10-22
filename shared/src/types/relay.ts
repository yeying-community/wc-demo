/**
 * Relay 协议配置
 */
export interface RelayProtocol {
  protocol: string;  // 'waku'
  data?: string;     // 可选的额外配置
}

/**
 * Relay 消息
 */
export interface RelayMessage {
  topic: string;
  payload: string;  // 加密后的 JSON 字符串
  publishedAt: number;
}

/**
 * 消息订阅回调
 */
export type MessageCallback = (message: RelayMessage) => void;

/**
 * Relay 接口
 */
export interface IRelay {
  // 生命周期
  init(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;

  // 消息发布/订阅
  publish(topic: string, payload: string): Promise<void>;
  subscribe(topic: string, callback: MessageCallback): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  
  // 状态查询
  isConnected(): boolean;
  getProtocol(): RelayProtocol;
}

/**
 * Relay 配置
 */
export interface RelayConfig {
  protocol: 'waku';
  clusterId?: number;          // Waku cluster id
  bootstrapPeers?: string[];   // Waku 启动节点
  pubsubTopic?: string;        // Waku pubsub网络主题
  contentTopicPrefix?: string; // Waku 内容主题前缀
  connectionTimeout: number,   // Waku 连接超时
}

