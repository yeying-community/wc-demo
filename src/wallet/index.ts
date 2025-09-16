import { WakuClient } from '../waku/client';
import { SessionManager } from '../walletconnect/session';
import { WalletConnectCrypto } from '../walletconnect/crypto';
import { JWTManager } from '../utils/jwt';
import { WakuMessage, SessionRequest, SignRequest } from '../types';
import { ethers } from 'ethers';

export class Wallet {
  private wakuClient: WakuClient;
  private sessionManager: SessionManager;
  private jwtManager: JWTManager;
  private wallet: ethers.Wallet;
  private pendingRequests: Map<string, any> = new Map();

  constructor() {
    this.wakuClient = new WakuClient();
    this.sessionManager = new SessionManager();
    this.jwtManager = new JWTManager();

    // 创建或加载钱包
    this.wallet = this.loadOrCreateWallet();
  }
  async initialize(): Promise<void> {
    try {
      await this.wakuClient.start([
      ]);
    } catch (err) {
      console.error('Fail to start waku for wallet', err)
    }
    this.setupMessageHandlers();
    console.log('Wallet initialized with address:', this.wallet.address);
  }

  private loadOrCreateWallet(): ethers.Wallet {
    const savedKey = localStorage.getItem('wallet_private_key');
    if (savedKey) {
      return new ethers.Wallet(savedKey);
    } else {
      const newWallet = ethers.Wallet.createRandom();
      localStorage.setItem('wallet_private_key', newWallet.privateKey);
      return new ethers.Wallet(newWallet.privateKey);
    }
  }
  private setupMessageHandlers(): void {
    this.wakuClient.onMessage('session_request', (message: WakuMessage) => {
      console.log('Session request received:', message.data);
      this.handleSessionRequest(message.data as SessionRequest);
    });

    this.wakuClient.onMessage('sign_request', (message: WakuMessage) => {
      console.log('Sign request received:', message.data);
      this.handleSignRequest(message.data as SignRequest);
    });
  }

  private handleSessionRequest(request: SessionRequest): void {
    this.pendingRequests.set(request.id, request);
    this.displaySessionRequest(request);
  }

  private handleSignRequest(request: SignRequest): void {
    this.pendingRequests.set(request.id, request);
    this.displaySignRequest(request);
  }

  private displaySessionRequest(request: SessionRequest): void {
    const container = document.getElementById('requests-container');
    if (!container) return;

    const requestDiv = document.createElement('div');
    requestDiv.className = 'request-item';
    requestDiv.innerHTML = `
      <div class="request-header">
        <h3>Connection Request</h3>
        <p>From: ${request.metadata.name}</p>
        <p>URL: ${request.metadata.url}</p>
        <p>Description: ${request.metadata.description}</p>
      </div>
      <div class="request-details">
        <p>Chains: ${request.params.requiredNamespaces.eip155?.chains.join(', ')}</p>
        <p>Methods: ${request.params.requiredNamespaces.eip155?.methods.join(', ')}</p>
      </div>
      <div class="request-actions">
        <button onclick="wallet.approveSession('${request.id}')">Approve</button>
        <button onclick="wallet.rejectSession('${request.id}')">Reject</button>
      </div>
    `;

    container.appendChild(requestDiv);
  }

  private displaySignRequest(request: SignRequest): void {
    const container = document.getElementById('requests-container');
    if (!container) return;

    const requestDiv = document.createElement('div');
    requestDiv.className = 'request-item';
    requestDiv.innerHTML = `
      <div class="request-header">
        <h3>Sign Request</h3>
        <p>Method: ${request.method}</p>
      </div>
      <div class="request-details">
        <p>Message: ${request.params[0]}</p>
        <p>Address: ${request.params[1]}</p>
      </div>
      <div class="request-actions">
        <button onclick="wallet.approveSign('${request.id}')">Sign</button>
        <button onclick="wallet.rejectSign('${request.id}')">Reject</button>
      </div>
    `;

    container.appendChild(requestDiv);
  }

  async approveSession(requestId: string): Promise<void> {
    const request = this.pendingRequests.get(requestId) as SessionRequest;
    if (!request) return;

    const session = this.sessionManager.approveSession(requestId, [this.wallet.address]);

    const response: WakuMessage = {
      type: 'session_response',
      sessionId: request.id,
      data: {
        approved: true,
        accounts: [this.wallet.address],
        session
      },
      timestamp: Date.now()
    };

    await this.wakuClient.publishMessage(response);
    this.pendingRequests.delete(requestId);
    this.removeRequestFromUI(requestId);

    console.log('Session approved');
  }

  async rejectSession(requestId: string): Promise<void> {
    const request = this.pendingRequests.get(requestId) as SessionRequest;
    if (!request) return;

    const response: WakuMessage = {
      type: 'session_response',
      sessionId: request.id,
      data: {
        approved: false,
        error: 'User rejected'
      },
      timestamp: Date.now()
    };

    await this.wakuClient.publishMessage(response);
    this.pendingRequests.delete(requestId);
    this.removeRequestFromUI(requestId);

    console.log('Session rejected');
  }

  async approveSign(requestId: string): Promise<void> {
    const request = this.pendingRequests.get(requestId) as SignRequest;
    if (!request) return;

    try {
      const message = request.params[0];
      const signature = await this.wallet.signMessage(message);

      const response: WakuMessage = {
        type: 'sign_response',
        sessionId: request.sessionId,
        data: {
          id: request.id,
          signature,
          success: true
        },
        timestamp: Date.now()
      };

      await this.wakuClient.publishMessage(response);
      this.pendingRequests.delete(requestId);
      this.removeRequestFromUI(requestId);

      console.log('Message signed:', signature);
    } catch (error) {
      console.error('Failed to sign message:', error);
      await this.rejectSign(requestId);
    }
  }

  async rejectSign(requestId: string): Promise<void> {
    const request = this.pendingRequests.get(requestId) as SignRequest;
    if (!request) return;

    const response: WakuMessage = {
      type: 'sign_response',
      sessionId: request.sessionId,
      data: {
        id: request.id,
        error: 'User rejected',
        success: false
      },
      timestamp: Date.now()
    };

    await this.wakuClient.publishMessage(response);
    this.pendingRequests.delete(requestId);
    this.removeRequestFromUI(requestId);

    console.log('Sign request rejected');
  }

  private removeRequestFromUI(requestId: string): void {
    const requestElement = document.querySelector(`[data-request-id="${requestId}"]`);
    if (requestElement) {
      requestElement.remove();
    }
  }

  getAddress(): string {
    return this.wallet.address;
  }

  getBalance(): string {
    // 模拟余额
    return '1.5 ETH';
  }
}

export default Wallet;
