import { WalletClient, WalletConfig } from 'walletconnect-waku-sdk';
import { ethers } from 'ethers';

export interface AuthHistoryEntry {
  timestamp: number;
  dappName: string;
  dappUrl: string;
  action: 'pairing' | 'session' | 'request';
  method?: string;
  success: boolean;
  details?: string;
}

export class Wallet {
  private client: WalletClient;
  private _address: string;
  private privateKey: string;
  private wallet: ethers.Wallet | ethers.HDNodeWallet;
  private authHistory: AuthHistoryEntry[] = [];
  private autoApproveKnown: boolean = false;
  private knownDapps: Set<string> = new Set();

  constructor(address?: string, privateKey?: string) {
    // 如果没有提供私钥，生成新的钱包
    if (!privateKey) {
      this.wallet = ethers.Wallet.createRandom();
      this.privateKey = this.wallet.privateKey;
      this._address = this.wallet.address;
    } else {
      this.wallet = new ethers.Wallet(privateKey);
      this.privateKey = privateKey;
      this._address = address || this.wallet.address;
    }

    // 初始化 WalletClient
    const config: WalletConfig = {
      name: 'Waku Wallet',
      description: 'A decentralized wallet using Waku network',
      url: window.location.origin,
      icons: ['https://walletconnect.com/walletconnect-logo.png'],
      supportedChains: ['eip155:1', 'eip155:137', 'eip155:56'],
      supportedMethods: [
        'eth_sendTransaction',
        'eth_signTransaction',
        'eth_sign',
        'personal_sign',
        'eth_signTypedData',
        'eth_signTypedData_v4',
      ],
      accounts: [
        `eip155:1:${this._address}`,
        `eip155:137:${this._address}`,
        `eip155:56:${this._address}`,
      ],
      clusterId: import.meta.env.VITE_CLUSTER_ID ? parseInt(import.meta.env.VITE_CLUSTER_ID) : 5432,
      wakuNodes: import.meta.env.VITE_WAKU_BOOTSTRAP_PEERS?.split(',') || [],
    };

    this.client = new WalletClient(config);

    // 加载保存的数据
    this.loadAuthHistory();
    this.loadKnownDapps();
    this.loadSettings();
  }

  get address(): string {
    return this._address;
  }

  /**
   * 初始化钱包
   */
  async initialize(): Promise<void> {
    try {
      await this.client.connect();

      // 设置事件监听器
      this.setupEventListeners();

      console.log('Wallet initialized with address:', this._address);
      this.updateUI('Wallet initialized successfully');
      this.showNotification('Wallet ready', 'success');
    } catch (error) {
      console.error('Failed to initialize wallet:', error);
      this.updateUI('Failed to initialize wallet');
      this.showNotification('Failed to initialize wallet', 'error');
      throw error;
    }
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 配对请求
    this.client.on('pairing_request', (request: any) => {
      console.log('Pairing request received:', request);
      this.handlePairingRequest(request);
    });

    // 会话提案
    this.client.on('session_proposal', (proposal: any) => {
      console.log('Session proposal received:', proposal);
      this.handleSessionProposal(proposal);
    });

    // 会话请求
    this.client.on('session_request', (request: any) => {
      console.log('Session request received:', request);
      this.handleSessionRequest(request);
    });

    // 会话删除
    this.client.on('session_deleted', (event: any) => {
      console.log('Session deleted:', event);
      this.handleSessionDeleted(event);
    });

    // 配对批准
    this.client.on('pairing_approved', (event: any) => {
      console.log('Pairing approved:', event);
      this.showNotification('Pairing approved', 'success');
    });

    // 会话批准
    this.client.on('session_approved', (event: any) => {
      console.log('Session approved:', event);
      this.showNotification('Session approved', 'success');
      this.updateConnectionsUI();
    });
  }

  /**
   * 处理配对请求
   */
  private handlePairingRequest(request: any): void {
    this.showPairingRequest(request);
  }

  /**
   * 显示配对请求 UI
   */
  private showPairingRequest(request: any): void {
    const requestsDiv = document.getElementById('requests');
    if (!requestsDiv) return;

    const requestDiv = document.createElement('div');
    requestDiv.className = 'request-item';
    requestDiv.id = `pairing-${request.id}`;
    requestDiv.innerHTML = `
      <h3>🔗 Pairing Request</h3>
      <div class="request-details">
        <p><strong>DApp:</strong> ${request.metadata?.name || 'Unknown'}</p>
        <p><strong>Description:</strong> ${request.metadata?.description || 'N/A'}</p>
        <p><strong>URL:</strong> ${request.metadata?.url || 'N/A'}</p>
      </div>
      <div class="request-actions">
        <button class="success" onclick="wallet.approvePairing('${request.id}')">
          ✓ Approve
        </button>
        <button class="danger" onclick="wallet.rejectPairing('${request.id}')">
          ✗ Reject
        </button>
      </div>
    `;

    requestsDiv.appendChild(requestDiv);
    this.showNotification('New pairing request', 'info');
  }

  /**
   * 批准配对
   */
  async approvePairing(requestId: string): Promise<void> {
    try {
      await this.client.approvePairing(requestId);

      // 记录历史
      this.addAuthHistory({
        timestamp: Date.now(),
        dappName: 'DApp',
        dappUrl: '',
        action: 'pairing',
        success: true,
      });

      this.removeRequestFromUI(`pairing-${requestId}`);
      this.updateUI('Pairing approved');
    } catch (error) {
      console.error('Failed to approve pairing:', error);
      this.showNotification('Failed to approve pairing', 'error');
    }
  }

  /**
   * 拒绝配对
   */
  async rejectPairing(requestId: string): Promise<void> {
    try {
      await this.client.rejectPairing(requestId, 'User rejected pairing');

      // 记录历史
      this.addAuthHistory({
        timestamp: Date.now(),
        dappName: 'DApp',
        dappUrl: '',
        action: 'pairing',
        success: false,
      });

      this.removeRequestFromUI(`pairing-${requestId}`);
      this.updateUI('Pairing rejected');
    } catch (error) {
      console.error('Failed to reject pairing:', error);
      this.showNotification('Failed to reject pairing', 'error');
    }
  }

  /**
   * 处理会话提案
   */
  private handleSessionProposal(proposal: any): void {
    // 检查是否自动批准已知 DApp
    const dappUrl = proposal.proposer?.metadata?.url;
    if (this.autoApproveKnown && dappUrl && this.knownDapps.has(dappUrl)) {
      this.approveSessionAuto(proposal);
      return;
    }

    this.showSessionProposal(proposal);
  }

  /**
   * 显示会话提案 UI
   */
  private showSessionProposal(proposal: any): void {
    const requestsDiv = document.getElementById('requests');
    if (!requestsDiv) return;

    const metadata = proposal.proposer?.metadata || {};
    const requiredNamespaces = proposal.params?.requiredNamespaces || {};

    const requestDiv = document.createElement('div');
    requestDiv.className = 'request-item';
    requestDiv.id = `session-${proposal.id}`;
    requestDiv.innerHTML = `
      <h3>🔐 Session Proposal</h3>
      <div class="request-details">
        <p><strong>DApp:</strong> ${metadata.name || 'Unknown'}</p>
        <p><strong>Description:</strong> ${metadata.description || 'N/A'}</p>
        <p><strong>URL:</strong> ${metadata.url || 'N/A'}</p>
        <p><strong>Requested Chains:</strong></p>
        <ul>
          ${Object.keys(requiredNamespaces).map(key => `
            <li>${key}: ${requiredNamespaces[key].chains?.join(', ') || 'N/A'}</li>
          `).join('')}
        </ul>
        <p><strong>Requested Methods:</strong></p>
        <ul>
          ${Object.keys(requiredNamespaces).map(key => `
            <li>${requiredNamespaces[key].methods?.join(', ') || 'N/A'}</li>
          `).join('')}
        </ul>
      </div>
      <div class="request-actions">
        <button class="success" onclick="wallet.approveSession('${proposal.id}')">
          ✓ Approve
        </button>
        <button class="danger" onclick="wallet.rejectSession('${proposal.id}')">
          ✗ Reject
        </button>
      </div>
    `;

    requestsDiv.appendChild(requestDiv);
    this.showNotification('New session proposal', 'info');
  }

  /**
   * 批准会话
   */
  async approveSession(proposalId: string): Promise<void> {
    try {
      // 构建命名空间
      const namespaces = {
        eip155: {
          chains: ['eip155:1', 'eip155:137', 'eip155:56'],
          methods: this.client.getSupportedMethods(),
          events: ['accountsChanged', 'chainChanged'],
          accounts: [
            `eip155:1:${this._address}`,
            `eip155:137:${this._address}`,
            `eip155:56:${this._address}`,
          ],
        },
      };

      await this.client.approveSession(proposalId, namespaces);

      // 记录历史
      this.addAuthHistory({
        timestamp: Date.now(),
        dappName: 'DApp',
        dappUrl: '',
        action: 'session',
        success: true,
      });

      this.removeRequestFromUI(`session-${proposalId}`);
      this.updateUI('Session approved');
      this.updateConnectionsUI();
    } catch (error) {
      console.error('Failed to approve session:', error);
      this.showNotification('Failed to approve session', 'error');
    }
  }

  /**
   * 自动批准会话
   */
  private async approveSessionAuto(proposal: any): Promise<void> {
    console.log('Auto-approving session for known DApp');
    await this.approveSession(proposal.id);
  }

  /**
   * 拒绝会话
   */
  async rejectSession(proposalId: string): Promise<void> {
    try {
      await this.client.rejectSession(proposalId, 'User rejected session');

      // 记录历史
      this.addAuthHistory({
        timestamp: Date.now(),
        dappName: 'DApp',
        dappUrl: '',
        action: 'session',
        success: false,
      });

      this.removeRequestFromUI(`session-${proposalId}`);
      this.updateUI('Session rejected');
    } catch (error) {
      console.error('Failed to reject session:', error);
      this.showNotification('Failed to reject session', 'error');
    }
  }

  /**
   * 处理会话请求
   */
  private handleSessionRequest(request: any): void {
    this.showSessionRequest(request);
  }

  /**
   * 显示会话请求 UI
   */
  private showSessionRequest(request: any): void {
    const requestsDiv = document.getElementById('requests');
    if (!requestsDiv) return;

    const { method, params } = request.params;

    const requestDiv = document.createElement('div');
    requestDiv.className = 'request-item';
    requestDiv.id = `request-${request.id}`;
    requestDiv.innerHTML = `
      <h3>📝 ${this.getMethodDisplayName(method)}</h3>
      <div class="request-details">
        <p><strong>Method:</strong> ${method}</p>
        ${this.renderRequestParams(method, params)}
      </div>
      <div class="request-actions">
        <button class="success" onclick="wallet.approveRequest('${request.id}', '${method}', '${JSON.stringify(params).replace(/'/g, "\\'")}')">
          ✓ Approve
        </button>
        <button class="danger" onclick="wallet.rejectRequest('${request.id}')">
          ✗ Reject
        </button>
      </div>
    `;

    requestsDiv.appendChild(requestDiv);
    this.showNotification(`New ${method} request`, 'info');
  }

  /**
   * 获取方法显示名称
   */
  private getMethodDisplayName(method: string): string {
    const names: Record<string, string> = {
      'personal_sign': 'Sign Message',
      'eth_sign': 'Sign Message',
      'eth_signTypedData': 'Sign Typed Data',
      'eth_signTypedData_v4': 'Sign Typed Data V4',
      'eth_sendTransaction': 'Send Transaction',
      'eth_signTransaction': 'Sign Transaction',
    };
    return names[method] || method;
  }

  /**
   * 渲染请求参数
   */
  private renderRequestParams(method: string, params: any[]): string {
    if (method === 'personal_sign' || method === 'eth_sign') {
      return `
        <div class="message-preview">
          <strong>Message:</strong>
          <pre>${params[0]}</pre>
        </div>
        <p><strong>Address:</strong> <span class="address">${params[1]}</span></p>
      `;
    }

    if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
      return `
        <div class="message-preview">
          <strong>Typed Data:</strong>
          <pre>${JSON.stringify(JSON.parse(params[1]), null, 2)}</pre>
        </div>
        <p><strong>Address:</strong> <span class="address">${params[0]}</span></p>
      `;
    }

    if (method === 'eth_sendTransaction' || method === 'eth_signTransaction') {
      const tx = params[0];
      return `
        <div class="message-preview">
          <strong>Transaction:</strong>
          <p><strong>To:</strong> <span class="address">${tx.to || 'N/A'}</span></p>
          <p><strong>Value:</strong> ${tx.value || '0'} wei</p>
          <p><strong>Gas:</strong> ${tx.gas || 'N/A'}</p>
          <p><strong>Gas Price:</strong> ${tx.gasPrice || 'N/A'}</p>
          ${tx.data ? `<p><strong>Data:</strong> <pre>${tx.data}</pre></p>` : ''}
        </div>
      `;
    }

    return `<pre>${JSON.stringify(params, null, 2)}</pre>`;
  }

  /**
   * 批准请求
   */
  async approveRequest(requestId: string, method: string, paramsStr: string): Promise<void> {
    try {
      const params = JSON.parse(paramsStr);
      let result: any;

      // 根据方法类型处理请求
      switch (method) {
        case 'personal_sign':
        case 'eth_sign':
          result = await this.signMessage(params[0]);
          break;

        case 'eth_signTypedData':
        case 'eth_signTypedData_v4':
          result = await this.signTypedData(params[0], params[1]);
          break;

        case 'eth_sendTransaction':
          result = await this.sendTransaction(params[0]);
          break;

        case 'eth_signTransaction':
          result = await this.signTransaction(params[0]);
          break;

        default:
          throw new Error(`Unsupported method: ${method}`);
      }

      await this.client.approveSession(requestId, result);

      // 记录历史
      this.addAuthHistory({
        timestamp: Date.now(),
        dappName: 'DApp',
        dappUrl: '',
        action: 'request',
        method,
        success: true,
      });

      this.removeRequestFromUI(`request-${requestId}`);
      this.updateUI(`Request approved: ${method}`);
      this.showNotification('Request approved', 'success');
    } catch (error) {
      console.error('Failed to approve request:', error);
      this.showNotification('Failed to approve request', 'error');
      await this.rejectRequest(requestId);
    }
  }

  /**
   * 拒绝请求
   */
  async rejectRequest(requestId: string): Promise<void> {
    try {
      await this.client.rejectSession(requestId, 'User rejected request');

      // 记录历史
      this.addAuthHistory({
        timestamp: Date.now(),
        dappName: 'DApp',
        dappUrl: '',
        action: 'request',
        success: false,
      });

      this.removeRequestFromUI(`request-${requestId}`);
      this.updateUI('Request rejected');
    } catch (error) {
      console.error('Failed to reject request:', error);
      this.showNotification('Failed to reject request', 'error');
    }
  }

  /**
   * 签名消息
   */
  private async signMessage(message: string): Promise<string> {
    // 移除 0x 前缀（如果有）
    const messageToSign = message.startsWith('0x') ? ethers.getBytes(message) : message;
    return await this.wallet.signMessage(messageToSign);
  }

  /**
   * 签名类型化数据
   */
  private async signTypedData(address: string, typedData: string): Promise<string> {
    const data = JSON.parse(typedData);
    const { domain, types, message } = data;

    // 移除 EIP712Domain 类型（ethers 会自动处理）
    const filteredTypes = { ...types };
    delete filteredTypes.EIP712Domain;

    return await this.wallet.signTypedData(domain, filteredTypes, message);
  }

  /**
   * 发送交易
   */
  private async sendTransaction(transaction: any): Promise<string> {
    // 注意：这里需要连接到实际的 RPC 提供者
    // 为了演示，我们只返回签名的交易
    const signedTx = await this.wallet.signTransaction(transaction);

    // 在实际应用中，这里应该广播交易到网络
    // const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    // const tx = await provider.sendTransaction(signedTx);
    // return tx.hash;

    // 模拟交易哈希
    return ethers.keccak256(signedTx);
  }

  /**
   * 签名交易
   */
  private async signTransaction(transaction: any): Promise<string> {
    return await this.wallet.signTransaction(transaction);
  }

  /**
   * 处理会话删除
   */
  private handleSessionDeleted(event: any): void {
    console.log('Session deleted:', event);
    this.updateConnectionsUI();
    this.showNotification('Session disconnected', 'info');
  }

  /**
   * 断开会话
   */
  async disconnect(topic: string): Promise<void> {
    try {
      await this.client.disconnect();
      this.updateConnectionsUI();
      this.showNotification('Session disconnected', 'success');
    } catch (error) {
      console.error('Failed to disconnect session:', error);
      this.showNotification('Failed to disconnect session', 'error');
    }
  }

  /**
   * 获取活动会话
   */
  getActiveSessions(): any[] {
    return [...this.client.getActiveSessions().values()];
  }

  /**
   * 获取认证历史
   */
  getAuthHistory(): AuthHistoryEntry[] {
    return this.authHistory;
  }

  /**
   * 添加认证历史
   */
  private addAuthHistory(entry: AuthHistoryEntry): void {
    this.authHistory.unshift(entry);

    // 限制历史记录数量
    if (this.authHistory.length > 100) {
      this.authHistory = this.authHistory.slice(0, 100);
    }

    this.saveAuthHistory();
    this.updateAuthHistoryUI();
  }

  /**
   * 加载认证历史
   */
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

  /**
   * 保存认证历史
   */
  private saveAuthHistory(): void {
    localStorage.setItem(`auth-history-${this._address}`, JSON.stringify(this.authHistory));
  }

  /**
   * 加载已知 DApps
   */
  private loadKnownDapps(): void {
    const stored = localStorage.getItem(`known-dapps-${this._address}`);
    if (stored) {
      try {
        this.knownDapps = new Set(JSON.parse(stored));
      } catch (error) {
        console.error('Failed to load known dapps:', error);
        this.knownDapps = new Set();
      }
    }
  }

  /**
   * 保存已知 DApps
   */
  private saveKnownDapps(): void {
    localStorage.setItem(
      `known-dapps-${this._address}`,
      JSON.stringify(Array.from(this.knownDapps))
    );
  }

  /**
   * 加载设置
   */
  private loadSettings(): void {
    const autoApprove = localStorage.getItem('auto-approve-known');
    this.autoApproveKnown = autoApprove === 'true';
  }

  /**
   * 更新连接 UI
   */
  updateConnectionsUI(): void {
    const connectionsDiv = document.getElementById('connections-list');
    if (!connectionsDiv) return;

    const sessions = this.getActiveSessions();

    if (sessions.length === 0) {
      connectionsDiv.innerHTML = '<p class="empty-state">No active connections</p>';

      // 更新连接数
      const countElement = document.getElementById('connected-dapps');
      if (countElement) {
        countElement.textContent = '0';
      }
      return;
    }

    const connectionsHTML = sessions.map(session => {
      const metadata = session.peer?.metadata || {};
      return `
        <div class="session-item">
          <div class="session-info">
            <h4>${metadata.name || 'Unknown DApp'}</h4>
            <p class="session-url">${metadata.url || 'N/A'}</p>
            <p class="session-description">${metadata.description || ''}</p>
            <p class="session-time">Connected: ${new Date(session.expiry * 1000).toLocaleString()}</p>
          </div>
          <div class="session-actions">
            <button class="danger" onclick="wallet.disconnect('${session.topic}')">
              Disconnect
            </button>
          </div>
        </div>
      `;
    }).join('');

    connectionsDiv.innerHTML = connectionsHTML;

    // 更新连接数
    const countElement = document.getElementById('connected-dapps');
    if (countElement) {
      countElement.textContent = sessions.length.toString();
    }
  }

  /**
   * 更新认证历史 UI
   */
  updateAuthHistoryUI(): void {
    const historyDiv = document.getElementById('auth-history');
    if (!historyDiv) return;

    if (this.authHistory.length === 0) {
      historyDiv.innerHTML = '<p class="empty-state">No authentication history</p>';
      return;
    }

    const historyHTML = this.authHistory.map(entry => `
      <div class="auth-item ${entry.success ? 'approved' : 'rejected'}">
        <div class="auth-header">
          <span class="auth-type">${this.getActionDisplayName(entry.action, entry.method)}</span>
          <span class="auth-status ${entry.success ? 'approved' : 'rejected'}">
            ${entry.success ? 'Approved' : 'Rejected'}
          </span>
        </div>
        <div class="auth-details">
          <p><strong>DApp:</strong> ${entry.dappName}</p>
          ${entry.dappUrl ? `<p><strong>URL:</strong> ${entry.dappUrl}</p>` : ''}
          ${entry.method ? `<p><strong>Method:</strong> ${entry.method}</p>` : ''}
          <p><strong>Time:</strong> ${new Date(entry.timestamp).toLocaleString()}</p>
          ${entry.details ? `<p><strong>Details:</strong> ${entry.details}</p>` : ''}
        </div>
      </div>
    `).join('');

    historyDiv.innerHTML = historyHTML;
  }

  /**
   * 获取操作显示名称
   */
  private getActionDisplayName(action: string, method?: string): string {
    if (action === 'request' && method) {
      return this.getMethodDisplayName(method);
    }

    const names: Record<string, string> = {
      'pairing': 'Pairing',
      'session': 'Session Connection',
      'request': 'Request',
    };

    return names[action] || action;
  }

  /**
   * 从 UI 移除请求
   */
  private removeRequestFromUI(elementId: string): void {
    const element = document.getElementById(elementId);
    if (element) {
      element.remove();
    }
  }

  /**
   * 更新状态 UI
   */
  private updateUI(message: string): void {
    const statusElement = document.getElementById('wallet-status');
    if (statusElement) {
      statusElement.textContent = message;
    }
    console.log('Status:', message);
  }

  /**
   * 显示通知
   */
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

  /**
   * 清除认证历史
   */
  clearAuthHistory(): void {
    this.authHistory = [];
    this.saveAuthHistory();
    this.updateAuthHistoryUI();
  }

  /**
   * 导出钱包数据
   */
  exportWalletData(): any {
    return {
      address: this._address,
      authHistory: this.authHistory,
      activeSessions: this.getActiveSessions(),
      knownDapps: Array.from(this.knownDapps),
      exportTime: new Date().toISOString(),
    };
  }
}

// 全局类型声明
declare global {
  interface Window {
    wallet: Wallet;
  }
}
