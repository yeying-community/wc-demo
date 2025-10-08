import { WakuClient, WakuMessage, ConnectionRequest, ConnectionResponse, SignRequest, SignResponse, Session, createBaseMessage, ServerAuthRequest, ServerAuthResponse } from 'walletconnect-waku-sdk';

export class Wallet {
  private client: WakuClient;
  private _address: string;
  private privateKey: string;
  private sessions: Map<string, Session> = new Map();
  private pendingRequests: Map<string, any> = new Map();
  private authHistory: Array<{
    timestamp: number;
    serverUrl: string;
    success: boolean;
    dappName?: string;
  }> = [];

  constructor(address?: string, privateKey?: string) {
    // 如果没有提供参数，生成默认值
    this._address = address || `wallet_${Date.now()}`;
    this.privateKey = privateKey || this.generatePrivateKey();
    const clusterId = import.meta.env.VITE_CLUSTER_ID ? parseInt(import.meta.env.VITE_CLUSTER_ID) : 5432;
    this.client = new WakuClient(clusterId);

    // 加载认证历史
    this.loadAuthHistory();
  }

  // 添加 address 的 getter
  get address(): string {
    return this._address;
  }

  private generatePrivateKey(): string {
    // 生成一个简单的私钥（实际应用中应该使用加密安全的方法）
    return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  private loadAuthHistory(): void {
    const stored = localStorage.getItem(`auth-history-${this._address}`);
    if (stored) {
      try {
        this.authHistory = JSON.parse(stored);
      } catch (error) {
        console.error('Failed to load auth history:', error);
        this.authHistory = [];
      }
    }
  }

  private saveAuthHistory(): void {
    localStorage.setItem(`auth-history-${this._address}`, JSON.stringify(this.authHistory));
  }

  async initialize(): Promise<void> {
    const BOOTSTRAP_PEERS = import.meta.env.VITE_WAKU_BOOTSTRAP_PEERS?.split(',') || [];
    try {
      await this.client.start(BOOTSTRAP_PEERS)
    } catch (err) {
      console.error('Fail to start waku for wallet', err)
    }

    this.client.setAddress(this._address);
    this.setupMessageHandlers();
    console.log('Wallet initialized with address:', this._address);

    // 初始化UI
    this.updateAuthHistoryUI();
  }

  private setupMessageHandlers(): void {
    // 处理连接请求
    this.client.onMessage('connection_request', (message: WakuMessage) => {
      console.log('Connection request received:', message);
      const request = message as ConnectionRequest;
      this.handleConnectionRequest(request);
    });

    // 处理签名请求
    this.client.onMessage('sign_request', (message: WakuMessage) => {
      console.log('Sign request received:', message);
      const request = message as SignRequest;
      this.handleSignRequest(request);
    });

    // 处理服务器认证请求
    this.client.onMessage('server_auth_request', (message: WakuMessage) => {
      console.log('Server auth request received:', message);
      const request = message as ServerAuthRequest;
      this.handleServerAuthRequest(request);
    });
  }

  private handleConnectionRequest(request: ConnectionRequest): void {
    this.pendingRequests.set(request.sessionId, request);
    this.showConnectionRequest(request);
  }

  private showConnectionRequest(request: ConnectionRequest): void {
    const requestsDiv = document.getElementById('requests');
    if (!requestsDiv) return;

    const requestDiv = document.createElement('div');
    requestDiv.className = 'request';
    requestDiv.innerHTML = `
      <h3>Connection Request</h3>
      <p><strong>From:</strong> ${request.data.metadata.name}</p>
      <p><strong>Description:</strong> ${request.data.metadata.description}</p>
      <p><strong>URL:</strong> ${request.data.metadata.url}</p>
      <p><strong>Required Chains:</strong> ${Object.keys(request.data.requiredNamespaces).join(', ')}</p>
      <div class="request-actions">
        <button onclick="wallet.approveConnection('${request.sessionId}')">Approve</button>
        <button onclick="wallet.rejectConnection('${request.sessionId}')">Reject</button>
      </div>
    `;

    requestsDiv.appendChild(requestDiv);
  }

  async approveConnection(sessionId: string): Promise<void> {
    const request = this.pendingRequests.get(sessionId) as ConnectionRequest;
    if (!request) return;

    // 创建会话 - 适配新的 Session 接口
    const session: Session = {
      id: sessionId,
      topic: `topic_${sessionId}`,
      accounts: [this._address],
      namespaces: {
        eip155: {
          chains: ['eip155:1', 'eip155:137'],
          methods: ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'],
          events: ['accountsChanged', 'chainChanged']
        }
      },
      metadata: request.data.metadata,
      createdAt: Date.now(),
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7天后过期
      active: true
    };

    this.sessions.set(sessionId, session);

    // 发送批准响应
    const response: ConnectionResponse = createBaseMessage(
      'connection_response',
      this._address,
      request.from,
      sessionId,
      {
        approved: true,
        session: session
      }
    ) as ConnectionResponse;

    await this.client.sendMessage(response);
    this.pendingRequests.delete(sessionId);
    this.removeRequestFromUI(sessionId);

    console.log('Connection approved for session:', sessionId);
    this.updateUI(`Connection approved for ${request.data.metadata.name}`);
    this.showNotification(`Connected to ${request.data.metadata.name}`, 'success');
  }

  async rejectConnection(sessionId: string): Promise<void> {
    const request = this.pendingRequests.get(sessionId) as ConnectionRequest;
    if (!request) return;

    // 发送拒绝响应
    const response: ConnectionResponse = createBaseMessage(
      'connection_response',
      this._address,
      request.from,
      sessionId,
      {
        approved: false,
        error: 'User rejected the connection request'
      }
    ) as ConnectionResponse;

    await this.client.sendMessage(response);
    this.pendingRequests.delete(sessionId);
    this.removeRequestFromUI(sessionId);

    console.log('Connection rejected for session:', sessionId);
    this.updateUI(`Connection rejected for ${request.data.metadata.name}`);
  }

  private handleSignRequest(request: SignRequest): void {
    this.pendingRequests.set(request.sessionId, request);
    this.showSignRequest(request);
  }

  private showSignRequest(request: SignRequest): void {
    const requestsDiv = document.getElementById('requests');
    if (!requestsDiv) return;

    const requestDiv = document.createElement('div');
    requestDiv.className = 'request';
    requestDiv.innerHTML = `
      <h3>Sign Request</h3>
      <p><strong>Method:</strong> ${request.data.method}</p>
      <p><strong>Message:</strong> ${request.data.params[0]}</p>
      <p><strong>Address:</strong> ${request.data.params[1]}</p>
      <div class="request-actions">
        <button onclick="wallet.approveSign('${request.sessionId}', '${request.data.params[0]}')">Sign</button>
        <button onclick="wallet.rejectSign('${request.sessionId}')">Reject</button>
      </div>
    `;

    requestsDiv.appendChild(requestDiv);
  }

  async approveSign(sessionId: string, message: string): Promise<void> {
    const request = this.pendingRequests.get(sessionId) as SignRequest;
    if (!request) return;

    try {
      // 模拟签名过程
      const signature = this.signMessage(message);

      // 发送签名响应
      const response: SignResponse = createBaseMessage(
        'sign_response',
        this._address,
        request.from,
        sessionId,
        {
          signature: signature
        }
      ) as SignResponse;

      await this.client.sendMessage(response);
      this.pendingRequests.delete(sessionId);
      this.removeRequestFromUI(sessionId);

      console.log('Message signed:', signature);
      this.updateUI('Message signed successfully');
      this.showNotification('Message signed successfully', 'success');
    } catch (error) {
      console.error('Failed to sign message:', error);
      await this.rejectSign(sessionId);
    }
  }

  async rejectSign(sessionId: string): Promise<void> {
    const request = this.pendingRequests.get(sessionId) as SignRequest;
    if (!request) return;

    // 发送拒绝响应
    const response: SignResponse = createBaseMessage(
      'sign_response',
      this._address,
      request.from,
      sessionId,
      {
        error: 'User rejected the sign request'
      }
    ) as SignResponse;

    await this.client.sendMessage(response);
    this.pendingRequests.delete(sessionId);
    this.removeRequestFromUI(sessionId);

    console.log('Sign request rejected');
    this.updateUI('Sign request rejected');
  }

  private signMessage(message: string): string {
    // 这里应该使用真实的签名逻辑
    // 为了演示，我们返回一个模拟的签名
    const hash = this.simpleHash(message + this.privateKey);
    return `0x${hash}`;
  }

  private simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }

  private removeRequestFromUI(sessionId: string): void {
    const requestsDiv = document.getElementById('requests');
    if (!requestsDiv) return;

    const requestDivs = requestsDiv.querySelectorAll('.request');
    requestDivs.forEach(div => {
      if (div.innerHTML.includes(sessionId)) {
        div.remove();
      }
    });
  }

  private updateUI(message: string): void {
    const statusElement = document.getElementById('status');
    if (statusElement) {
      statusElement.textContent = message;
    }
    console.log('Status:', message);
  }

  // 处理服务器认证请求
  private handleServerAuthRequest(request: ServerAuthRequest): void {
    this.pendingRequests.set(request.sessionId, request);
    this.showServerAuthRequest(request);
  }

  private showServerAuthRequest(request: ServerAuthRequest): void {
    const requestsDiv = document.getElementById('requests');
    if (!requestsDiv) return;

    const requestDiv = document.createElement('div');
    requestDiv.className = 'request';
    requestDiv.innerHTML = `
      <h3>Server Authentication Request</h3>
      <p><strong>Server:</strong> ${request.data.serverUrl}</p>
      <p><strong>Challenge:</strong> ${request.data.challenge}</p>
      <div class="request-actions">
        <button onclick="wallet.approveServerAuth('${request.sessionId}')">Approve</button>
        <button onclick="wallet.rejectServerAuth('${request.sessionId}')">Reject</button>
      </div>
    `;

    requestsDiv.appendChild(requestDiv);
  }

  async approveServerAuth(sessionId: string): Promise<void> {
    const request = this.pendingRequests.get(sessionId) as ServerAuthRequest;
    if (!request) return;
    try {
      // 签名挑战
      const signature = this.signMessage(request.data.challenge);

      // 发送认证响应
      const response: ServerAuthResponse = createBaseMessage(
        'server_auth_response',
        this._address,
        request.from,
        sessionId,
        {
          success: true,
          signature: signature,
          walletAddress: this._address
        }
      ) as ServerAuthResponse;

      await this.client.sendMessage(response);
      this.pendingRequests.delete(sessionId);
      this.removeRequestFromUI(sessionId);

      // 记录认证历史
      this.authHistory.push({
        timestamp: Date.now(),
        serverUrl: request.data.serverUrl,
        success: true
      });
      this.saveAuthHistory();
      this.updateAuthHistoryUI();

      console.log('Server authentication approved');
      this.updateUI('Server authentication approved');
      this.showNotification('Server authentication approved', 'success');
    } catch (error) {
      console.error('Failed to approve server auth:', error);
      await this.rejectServerAuth(sessionId);
    }
  }

  async rejectServerAuth(sessionId: string): Promise<void> {
    const request = this.pendingRequests.get(sessionId) as ServerAuthRequest;
    if (!request) return;

    // 发送拒绝响应
    const response: ServerAuthResponse = createBaseMessage(
      'server_auth_response',
      this._address,
      request.from,
      sessionId,
      {
        success: false,
        error: 'User rejected the server authentication request'
      }
    ) as ServerAuthResponse;

    await this.client.sendMessage(response);
    this.pendingRequests.delete(sessionId);
    this.removeRequestFromUI(sessionId);

    // 记录认证历史
    this.authHistory.push({
      timestamp: Date.now(),
      serverUrl: request.data.serverUrl,
      success: false
    });
    this.saveAuthHistory();
    this.updateAuthHistoryUI();

    console.log('Server authentication rejected');
    this.updateUI('Server authentication rejected');
  }

  // 添加缺少的方法
  getAuthHistory(): Array<{ timestamp: number; serverUrl: string; success: boolean; dappName?: string }> {
    return this.authHistory;
  }

  getConnections(): Session[] {
    return Array.from(this.sessions.values()).filter(session => session.active);
  }

  updateAuthHistoryUI(): void {
    const historyDiv = document.getElementById('auth-history');
    if (!historyDiv) return;

    if (this.authHistory.length === 0) {
      historyDiv.innerHTML = '<p class="no-data">No authentication history</p>';
      return;
    }

    const historyHTML = this.authHistory
      .sort((a, b) => b.timestamp - a.timestamp) // 最新的在前
      .map(entry => `
        <div class="history-item ${entry.success ? 'success' : 'failed'}">
          <div class="history-info">
            <strong>${entry.dappName || entry.serverUrl}</strong>
            <span class="timestamp">${new Date(entry.timestamp).toLocaleString()}</span>
          </div>
          <div class="history-status ${entry.success ? 'success' : 'failed'}">
            ${entry.success ? '✓ Approved' : '✗ Rejected'}
          </div>
        </div>
      `)
      .join('');

    historyDiv.innerHTML = historyHTML;
  }

  showNotification(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    // 检查是否启用通知
    const showNotifications = localStorage.getItem('show-notifications');
    if (showNotifications === 'false') return;

    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
      <span>${message}</span>
      <button class="close-btn" onclick="this.parentElement.remove()">×</button>
    `;

    // 添加到页面
    let notificationContainer = document.getElementById('notifications');
    if (!notificationContainer) {
      notificationContainer = document.createElement('div');
      notificationContainer.id = 'notifications';
      notificationContainer.className = 'notification-container';
      document.body.appendChild(notificationContainer);
    }

    notificationContainer.appendChild(notification);

    // 自动移除通知
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 5000);
  }

  getAddress(): string {
    return this._address;
  }

  getSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.active = false;
      this.sessions.delete(sessionId);
      this.updateUI(`Session ${sessionId} disconnected`);
      this.showNotification('Session disconnected', 'info');
    }
  }
}

// 全局变量供 HTML 使用
declare global {
  interface Window {
    wallet: Wallet;
  }
}
