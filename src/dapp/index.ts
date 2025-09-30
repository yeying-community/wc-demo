import { WakuClient } from '../waku/client';
import { JWTManager } from '../utils/jwt';
import { WakuMessage, SignRequest, AppMetadata, SessionRequest, Session } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class DApp {
  private wakuClient: WakuClient;
  private jwtManager: JWTManager;
  private currentSession: Session | null = null;

  constructor() {
    this.wakuClient = new WakuClient();
    this.jwtManager = new JWTManager();
  }

  async initialize(): Promise<void> {
    try {
      await this.wakuClient.start([
      ]);
    } catch (err) {
      console.error('Fail to start waku for dapp', err)
    }
    this.setupMessageHandlers();
    console.log('DApp initialized');
  }

  private setupMessageHandlers(): void {
    this.wakuClient.onMessage('session_response', (message: WakuMessage) => {
      if (message.data.approved) {
        console.log('Session approved:', message.data);
        this.onSessionApproved(message.data.session as Session, message.data.accounts);
      } else {
        console.log('Session rejected');
        this.onSessionRejected(() => { });
      }
    });

    this.wakuClient.onMessage('sign_response', (message: WakuMessage) => {
      console.log('Sign response received:', message.data);
      this.onSignResponse(message.data);
    });
  }

  // 添加缺失的方法
  onSessionRejected(callback: () => void): void {
    // 实现会话拒绝处理
    console.log('Session rejected callback registered');
  }

  private generateTopic(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // 发起创建回话请求，向钱包索要权限
  createSessionRequest(metadata: AppMetadata): SessionRequest {
    const id = uuidv4();
    const sessionId = uuidv4();
    const topic = this.generateTopic();

    const request: SessionRequest = {
      id,
      sessionId: sessionId,
      topic,
      method: 'wc_sessionPropose',
      params: {
        requiredNamespaces: {
          eip155: {
            chains: ['eip155:1', 'eip155:137'], // Ethereum, Polygon
            methods: ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'],
            events: ['accountsChanged', 'chainChanged']
          }
        }
      },
      metadata
    };

    return request;
  }

  // web3应用发起连接请求
  async connect(): Promise<void> {
    // 发起创建和钱包之间的会话
    const request = this.createSessionRequest({
      name: 'Test DApp',
      description: 'A test DApp for WalletConnect',
      url: 'https://test-dapp.com',
      icons: ['https://test-dapp.com/icon.png']
    });

    const message: WakuMessage = {
      type: 'session_request',
      sessionId: request.sessionId,
      data: request,
      timestamp: Date.now()
    };

    await this.wakuClient.publishMessage(message);
    console.log('Connection request sent');

    // 显示连接 URI
    this.displayConnectionURI(request.topic, request.id);
  }

  async signMessage(messageToSign: string): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const signRequest: SignRequest = {
      id: crypto.randomUUID(),
      sessionId: this.currentSession.id,
      method: 'personal_sign',
      params: [messageToSign, this.currentSession.accounts]
    };

    const message: WakuMessage = {
      type: 'sign_request',
      sessionId: this.currentSession.id,
      data: signRequest,
      timestamp: Date.now()
    };

    await this.wakuClient.publishMessage(message);
    console.log('Sign request sent');
  }

  private displayConnectionURI(topic: string, sessionId: string): void {
    const uri = `wc:${topic}@2?relay-protocol=waku&symKey=${sessionId}`;
    console.log('Connection URI:', uri);

    // 在页面上显示 URI 或二维码
    const uriElement = document.getElementById('connection-uri');
    if (uriElement) {
      uriElement.textContent = uri;
    }
  }

  private onSessionApproved(session: Session, accounts: string[]): void {
    console.log('Session approved with accounts:', accounts);
    this.currentSession = session;
    // 生成 JWT token
    const address = accounts[0];
    const token = this.jwtManager.generateToken(address, session.id!);
    console.log('JWT Token generated:', token);

    // 更新 UI
    this.updateUI('connected', { address, token });
  }

  private onSignResponse(signData: any): void {
    if (signData.signature) {
      console.log('Message signed successfully:', signData.signature);
      this.updateUI('signed', { signature: signData.signature });
    } else {
      console.log('Sign request rejected');
      this.updateUI('sign_rejected');
    }
  }

  private updateUI(status: string, data?: any): void {
    const statusElement = document.getElementById('status');
    const dataElement = document.getElementById('data');

    if (statusElement) {
      statusElement.textContent = status;
    }

    if (dataElement && data) {
      dataElement.textContent = JSON.stringify(data, null, 2);
    }
  }

  async disconnect(): Promise<void> {
    this.currentSession = null;
    console.log('Disconnected');
    this.updateUI('disconnected');
  }
}

export default DApp;
