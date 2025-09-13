import { WakuClient } from '../waku/client';
import { SessionManager } from '../walletconnect/session';
import { JWTManager } from '../utils/jwt';
import { WakuMessage, SignRequest } from '../types';

export class DApp {
  private wakuClient: WakuClient;
  private sessionManager: SessionManager;
  private jwtManager: JWTManager;
  private currentSession: string | null = null;

  constructor() {
    this.wakuClient = new WakuClient();
    this.sessionManager = new SessionManager();
    this.jwtManager = new JWTManager();
  }

  async initialize(): Promise<void> {
    try {
      await this.wakuClient.start([
        '/ip4/159.138.36.164/tcp/60000/p2p/16Uiu2HAkyt6wQkYk2EZPWsrot8aktLwya1UixWTstjGFrW4B63b5',
        // '/ip4/159.138.36.164/tcp/60001/ws/p2p/16Uiu2HAkyt6wQkYk2EZPWsrot8aktLwya1UixWTstjGFrW4B63b5',
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
        this.currentSession = message.sessionId;
        console.log('Session approved:', message.data);
        this.onSessionApproved(message.data);
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

  async connect(): Promise<void> {
    const request = this.sessionManager.createSessionRequest({
      name: 'Test DApp',
      description: 'A test DApp for WalletConnect',
      url: 'https://test-dapp.com',
      icons: ['https://test-dapp.com/icon.png']
    });

    const message: WakuMessage = {
      type: 'session_request',
      sessionId: request.id,
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
      sessionId: this.currentSession,
      method: 'personal_sign',
      params: [messageToSign, this.getConnectedAddress()]
    };

    const message: WakuMessage = {
      type: 'sign_request',
      sessionId: this.currentSession,
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

  private onSessionApproved(sessionData: any): void {
    console.log('Session approved with accounts:', sessionData.accounts);

    // 生成 JWT token
    const address = sessionData.accounts[0];
    const token = this.jwtManager.generateToken(address, this.currentSession!);
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

  private getConnectedAddress(): string {
    const session = this.sessionManager.getSession(this.currentSession!);
    return session?.accounts[0] || '';
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
