import { createLightNode, LightNode, createDecoder, createEncoder, Protocols } from '@waku/sdk';
import {
  WakuMessage,
  ServerAuthRequest,
  ServerAuthResponse,
  LoginChallengeRequest,
  LoginChallengeResponse,
  LoginRequest,
  LoginResponse,
  TokenVerifyResponse,
  generateId,
  createBaseMessage,
} from '../types';
import { yamux } from '@chainsafe/libp2p-yamux';

/**
 * 待处理请求接口
 */
interface PendingRequest {
  /** 成功回调 */
  resolve: (response: any) => void;
  /** 失败回调 */
  reject: (error: Error) => void;
  /** 请求超时定时器 */
  timeout: NodeJS.Timeout;
}

/**
 * Waku客户端类
 * 负责处理基于Waku网络的消息通信
 */
export class WakuClient {
  /** Waku轻节点实例 */
  private node: LightNode | null = null;

  /** 集群ID */
  private clusterId: number;

  /** 发布订阅主题 */
  private pubsubTopic: string;

  /** 内容主题 */
  private contentTopic = '/walletconnect/1/session/proto';

  /** 消息处理器映射 */
  private messageHandlers: Map<string, (message: WakuMessage) => void> = new Map();

  /** 当前客户端地址 */
  public address: string | null = null;

  /** 已连接的钱包地址 */
  public connectedWallet: string | null = null;

  /** 待处理的请求映射 */
  private pendingRequests: Map<string, PendingRequest> = new Map();

  /** 默认请求超时时间 (毫秒) */
  private readonly DEFAULT_TIMEOUT = 60000;

  /**
   * 构造函数
   * @param clusterId Waku集群ID，默认为5432
   */
  constructor(clusterId: number = 5432) {
    this.clusterId = clusterId;
    this.pubsubTopic = `/waku/2/rs/${this.clusterId}/0`;
  }

  /**
   * 设置客户端地址
   * @param address 客户端地址
   */
  setAddress(address: string): void {
    this.address = address;
    console.log(`Client address set to: ${address}`);
  }

  /**
   * 设置已连接的钱包地址
   * @param walletAddress 钱包地址
   */
  setConnectedWallet(walletAddress: string): void {
    this.connectedWallet = walletAddress;
    console.log(`Connected wallet set to: ${walletAddress}`);
  }

  /**
 * 启动Waku客户端
 * @param wakuNodes Waku节点列表
 */
  async start(wakuNodes: string[]): Promise<void> {
    console.log('Starting Waku client...');
    console.log('Connecting to nodes:', wakuNodes);

    try {
      // 创建轻节点
      this.node = await createLightNode({
        networkConfig: {
          clusterId: this.clusterId,
        },
        defaultBootstrap: false,
        autoStart: true,
        bootstrapPeers: wakuNodes,
        numPeersToUse: 1,
        libp2p: {
          streamMuxers: [yamux()],
          filterMultiaddrs: false,
          hideWebSocketInfo: true,
          connectionManager: {
            dialTimeout: 5000,
            maxConnections: 10,
          }
        },
      });

      console.log(`Node=${this.node.peerId} started=${this.node.isStarted()}, waiting for peers...`);

      // 等待连接到对等节点
      await this.node.waitForPeers([Protocols.LightPush, Protocols.Filter], 5000);
      console.log(`Node connected=${this.node.isConnected()}`);

      // 创建解码器并订阅消息
      const decoder = createDecoder(this.contentTopic, {
        clusterId: this.clusterId,
        shardId: 0,
        pubsubTopic: this.pubsubTopic
      });

      const success = await this.node.filter.subscribe(
        [decoder],
        (wakuMessage) => {
          try {
            const payload = new TextDecoder().decode(wakuMessage.payload);
            const message: WakuMessage = JSON.parse(payload);
            console.log('Received message:', message.type, 'sessionId:', message.sessionId);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse Waku message:', error);
          }
        }
      );

      console.log(`Subscribe content topic=${this.contentTopic}, clusterId=${this.clusterId}, pubsubTopic=${this.pubsubTopic}, success=${success}`);

      if (!success) {
        throw new Error("Failed to subscribe to Waku messages");
      }

      console.log('Waku client started successfully');
    } catch (error) {
      console.error('Failed to start Waku client:', error);
      throw error;
    }
  }

  /**
   * 发布消息到Waku网络
   * @param message 要发布的消息
   */
  async publishMessage(message: WakuMessage): Promise<void> {
    if (!this.node) {
      throw new Error('Waku node not initialized');
    }

    try {
      const payload = new TextEncoder().encode(JSON.stringify(message));
      const encoder = createEncoder({
        contentTopic: this.contentTopic,
        routingInfo: {
          clusterId: this.clusterId,
          shardId: 0,
          pubsubTopic: this.pubsubTopic
        }
      });

      const result = await this.node.lightPush.send(encoder, {
        payload,
        timestamp: new Date(),
      }, {
        useLegacy: true,
      });

      console.log('Message published:', message.type, 'sessionId:', message.sessionId, 'Success:', result.successes.length > 0);

      if (result.failures.length > 0) {
        console.warn('Message publish failures:', result.failures);
      }
    } catch (error) {
      console.error('Failed to publish message:', error);
      throw error;
    }
  }

  /**
   * 发送消息 (publishMessage的别名)
   * @param message 要发送的消息
   */
  async sendMessage(message: WakuMessage): Promise<void> {
    return this.publishMessage(message);
  }

  /**
   * 注册消息处理器
   * @param type 消息类型
   * @param handler 处理函数
   */
  onMessage(type: string, handler: (message: WakuMessage) => void): void {
    this.messageHandlers.set(type, handler);
    console.log(`Message handler registered for type: ${type}`);
  }

  /**
   * 移除消息处理器
   * @param type 消息类型
   */
  offMessage(type: string): void {
    this.messageHandlers.delete(type);
    console.log(`Message handler removed for type: ${type}`);
  }

  /**
   * 处理接收到的消息
   * @param message 接收到的消息
   */
  private handleMessage(message: WakuMessage): void {
    console.log('Handling message:', message.type, 'sessionId:', message.sessionId);

    // 首先检查是否有待处理的请求响应
    if (message.type.endsWith('_response')) {
      const pendingRequest = this.pendingRequests.get(message.sessionId);
      if (pendingRequest) {
        console.log('Resolving pending request for sessionId:', message.sessionId);
        clearTimeout(pendingRequest.timeout);
        this.pendingRequests.delete(message.sessionId);
        pendingRequest.resolve(message);
        return;
      }
    }

    // 处理普通消息处理器
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      try {
        handler(message);
      } catch (error) {
        console.error(`Error in message handler for type ${message.type}:`, error);
      }
    } else {
      console.warn(`No handler registered for message type: ${message.type}`);
    }
  }

  /**
   * 发送请求并等待响应
   * @param request 请求消息
   * @param timeout 超时时间 (毫秒)
   * @returns 响应消息
   */
  private async sendRequestAndWaitForResponse<T>(
    request: WakuMessage,
    timeout: number = this.DEFAULT_TIMEOUT
  ): Promise<T> {
    return new Promise(async (resolve, reject) => {
      // 设置超时定时器
      const timeoutTimer = setTimeout(() => {
        this.pendingRequests.delete(request.sessionId);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      // 注册待处理请求
      this.pendingRequests.set(request.sessionId, {
        resolve: (response: T) => {
          clearTimeout(timeoutTimer);
          resolve(response);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutTimer);
          reject(error);
        },
        timeout: timeoutTimer
      });

      try {
        // 发送请求
        await this.sendMessage(request);
      } catch (error) {
        // 发送失败，清理待处理请求
        clearTimeout(timeoutTimer);
        this.pendingRequests.delete(request.sessionId);
        reject(error);
      }
    });
  }

  /**
   * 请求服务器认证
   * 完整的服务器认证流程：
   * 1. 从服务器获取挑战
   * 2. 通过Waku请求钱包签名
   * 3. 将签名发送给服务器获取token
   * 
   * @param serverUrl 服务器URL
   * @returns 认证token
   */
  async requestServerAuth(serverUrl: string): Promise<string> {
    console.log('Starting server auth process for:', serverUrl);

    if (!this.address) {
      throw new Error('Client address not set');
    }

    if (!this.connectedWallet) {
      throw new Error('No wallet connected');
    }

    try {
      // 步骤1: 从服务器获取挑战
      console.log('Step 1: Getting challenge from server');
      const challengeResponse = await this.getChallengeFromServer(serverUrl);

      // 步骤2: 通过Waku请求钱包签名
      console.log('Step 2: Requesting signature from wallet via Waku');
      const signature = await this.requestSignatureFromWallet(
        serverUrl,
        challengeResponse.challenge,
        challengeResponse.message
      );

      // 步骤3: 将签名发送给服务器获取token
      console.log('Step 3: Submitting signature to server');
      const token = await this.submitSignatureToServer(
        serverUrl,
        signature,
        challengeResponse.challenge
      );

      console.log('Server auth completed successfully');
      return token;
    } catch (error: any) {
      console.error('Server auth failed:', error.message);
      throw new Error(`Server auth failed: ${error.message}`);
    }
  }

  /**
   * 从服务器获取登录挑战
   * @param serverUrl 服务器URL
   * @returns 挑战数据
   */
  private async getChallengeFromServer(serverUrl: string): Promise<{ challenge: string; message: string }> {
    const challengeRequest: LoginChallengeRequest = {
      address: this.address!
    };

    const response = await fetch(`${serverUrl}/auth/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(challengeRequest)
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
    const r = await response.json()
    const challengeData = r as LoginChallengeResponse;

    if (!challengeData.success) {
      throw new Error(challengeData.error || 'Failed to get challenge from server');
    }

    if (!challengeData.data) {
      throw new Error('No challenge data received from server');
    }

    return challengeData.data;
  }


  /**
   * 通过Waku请求钱包签名
   * @param serverUrl 服务器URL
   * @param challenge 挑战字符串
   * @param message 签名消息
   * @returns 签名结果
   */
  private async requestSignatureFromWallet(
    serverUrl: string,
    challenge: string,
    message: string
  ): Promise<string> {
    const sessionId = generateId();
    const authRequest: ServerAuthRequest = createBaseMessage(
      'server_auth_request',
      this.address!,
      this.connectedWallet!,
      sessionId,
      {
        serverUrl,
        challenge,
        message,
        description: `Authenticate with ${new URL(serverUrl).hostname}`
      }
    ) as ServerAuthRequest;

    const response = await this.sendRequestAndWaitForResponse<ServerAuthResponse>(authRequest);

    if (response.data.error) {
      throw new Error(response.data.error);
    }

    if (!response.data.signature) {
      throw new Error('No signature received from wallet');
    }

    return response.data.signature;
  }

  /**
   * 将签名提交给服务器获取token
   * @param serverUrl 服务器URL
   * @param signature 签名结果
   * @param challenge 挑战字符串
   * @returns 认证token
   */
  private async submitSignatureToServer(
    serverUrl: string,
    signature: string,
    challenge: string
  ): Promise<string> {
    const loginRequest: LoginRequest = {
      address: this.address!,
      signature,
      challenge
    };

    const response = await fetch(`${serverUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(loginRequest)
    });

    if (!response.ok) {
      throw new Error(`Server login failed: ${response.status} ${response.statusText}`);
    }

    const r = await response.json()
    const loginData = r as LoginResponse;

    if (!loginData.success) {
      throw new Error(loginData.error || 'Login failed');
    }

    if (!loginData.data?.token) {
      throw new Error('No token received from server');
    }

    return loginData.data.token;
  }

  /**
   * 验证服务器token是否有效
   * @param serverUrl 服务器URL
   * @param token 认证token
   * @returns 是否有效
   */
  async verifyServerToken(serverUrl: string, token: string): Promise<boolean> {
    try {
      console.log('Verifying server token for:', serverUrl);

      const response = await fetch(`${serverUrl}/auth/verify`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.log('Token verification failed: HTTP', response.status);
        return false;
      }
      const r = await response.json();
      const data = r as TokenVerifyResponse;
      console.log('Token verification result:', data.success);

      return data.success;
    } catch (error) {
      console.error('Token verification error:', error);
      return false;
    }
  }

  /**
   * 获取当前活跃的会话数量
   * @returns 活跃会话数量
   */
  getActiveSessions(): number {
    return this.pendingRequests.size;
  }

  /**
   * 取消待处理的请求
   * @param sessionId 会话ID
   * @returns 是否成功取消
   */
  cancelPendingRequest(sessionId: string): boolean {
    const pendingRequest = this.pendingRequests.get(sessionId);
    if (pendingRequest) {
      clearTimeout(pendingRequest.timeout);
      this.pendingRequests.delete(sessionId);
      pendingRequest.reject(new Error('Request cancelled'));
      console.log('Cancelled pending request:', sessionId);
      return true;
    }
    return false;
  }

  /**
   * 取消所有待处理的请求
   */
  cancelAllPendingRequests(): void {
    console.log(`Cancelling ${this.pendingRequests.size} pending requests`);

    for (const [sessionId, pendingRequest] of this.pendingRequests.entries()) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(new Error('All requests cancelled'));
    }

    this.pendingRequests.clear();
  }

  /**
   * 停止Waku客户端
   */
  async stop(): Promise<void> {
    console.log('Stopping Waku client...');

    // 取消所有待处理的请求
    this.cancelAllPendingRequests();

    // 清理消息处理器
    this.messageHandlers.clear();

    // 停止Waku节点
    if (this.node) {
      await this.node.stop();
      this.node = null;
    }

    // 重置状态
    this.address = null;
    this.connectedWallet = null;

    console.log('Waku client stopped');
  }

  /**
   * 获取客户端状态信息
   * @returns 状态信息
   */
  getStatus(): {
    isStarted: boolean;
    isConnected: boolean;
    peerId: string | null;
    address: string | null;
    connectedWallet: string | null;
    pendingRequests: number;
    messageHandlers: number;
  } {
    return {
      isStarted: this.node?.isStarted() || false,
      isConnected: this.node?.isConnected() || false,
      peerId: this.node?.peerId?.toString() || null,
      address: this.address,
      connectedWallet: this.connectedWallet,
      pendingRequests: this.pendingRequests.size,
      messageHandlers: this.messageHandlers.size
    };
  }

  /**
   * 检查是否已连接到Waku网络
   * @returns 是否已连接
   */
  isConnected(): boolean {
    return this.node?.isConnected() || false;
  }

  /**
   * 检查是否已启动
   * @returns 是否已启动
   */
  isStarted(): boolean {
    return this.node?.isStarted() || false;
  }

  /**
   * 获取节点的Peer ID
   * @returns Peer ID字符串
   */
  getPeerId(): string | null {
    return this.node?.peerId?.toString() || null;
  }
}
