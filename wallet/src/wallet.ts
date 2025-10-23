import {
  WalletClient,
  WalletClientConfig,
  SessionData,
  SessionNamespaces,
  SessionProposal,
  SessionRequest,
  SessionEvent,
  Pairing,
  PairingEvent,
  RelayConfig,
} from 'walletconnect-waku-sdk';

import { ethers } from 'ethers';

/**
 * 认证历史条目
 */
export interface AuthHistoryEntry {
  timestamp: number;
  dappName: string;
  dappUrl: string;
  dappIcon?: string;
  action: 'pairing' | 'session' | 'request';
  method?: string;
  success: boolean;
  details?: string;
}

/**
 * 待处理的请求
 */
interface PendingRequest {
  id: number;
  type: 'session_proposal' | 'session_request';
  data: SessionProposal | SessionRequest;
  session?: SessionData;
  timestamp: number;
}

/**
 * Wallet 类
 */
export class Wallet {
  private client: WalletClient;
  private _address: string;
  private wallet: ethers.Wallet | ethers.HDNodeWallet;
  private authHistory: AuthHistoryEntry[] = [];
  private autoApproveKnown: boolean = false;
  private knownDapps: Set<string> = new Set();
  private pendingRequests = new Map<number, PendingRequest>();

  constructor(privateKey?: string) {
    // 如果没有提供私钥,生成新的钱包
    if (!privateKey) {
      this.wallet = ethers.Wallet.createRandom();
            // 保存到本地存储
      localStorage.setItem('wallet-private-key', this.wallet.privateKey);
    } else {
      this.wallet = new ethers.Wallet(privateKey);
    }

    this._address = this.wallet.address;

    // 创建 Waku Relay
    const relayConfig: RelayConfig = {
      connectionTimeout: 5000,
      clusterId: import.meta.env.VITE_CLUSTER_ID ? parseInt(import.meta.env.VITE_CLUSTER_ID) : 5432,
      bootstrapPeers: import.meta.env.VITE_WAKU_BOOTSTRAP_PEERS?.split(',') || [],
      protocol: "waku",
    };

    // 定义支持的命名空间
    const supportedNamespaces: SessionNamespaces = {
      eip155: {
        chains: ['eip155:1', 'eip155:137', 'eip155:56', 'eip155:42161'],
        methods: [
          'eth_sendTransaction',
          'eth_signTransaction',
          'eth_sign',
          'personal_sign',
          'eth_signTypedData',
          'eth_signTypedData_v4',
          'wallet_switchEthereumChain',
          'wallet_addEthereumChain'
        ],
        events: ['chainChanged', 'accountsChanged'],
        accounts: [
          `eip155:1:${this._address}`,
          `eip155:137:${this._address}`,
          `eip155:56:${this._address}`,
          `eip155:42161:${this._address}`
        ]
      }
    };

    // 初始化 WalletClient
    const config: WalletClientConfig = {
      metadata: {
        name: 'Waku Wallet',
        description: 'A decentralized wallet using Waku network',
        url: window.location.origin,
        icons: ['https://walletconnect.com/walletconnect-logo.png']
      },
      supportedNamespaces,
      accounts: [
        `eip155:1:${this._address}`,
        `eip155:137:${this._address}`,
        `eip155:56:${this._address}`,
        `eip155:42161:${this._address}`
      ],
      relayConfig: relayConfig,
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
      await this.client.init();

      // 设置事件监听器
      this.setupEventListeners();

      console.log('[Wallet] Initialized with address:', this._address);
      this.updateUI('Wallet initialized successfully');
      this.showNotification('Wallet ready', 'success');

      // 恢复活跃的会话
      this.updateConnectionsUI();
    } catch (error) {
      console.error('[Wallet] Failed to initialize:', error);
      this.updateUI('Failed to initialize wallet');
      this.showNotification('Failed to initialize wallet', 'error');
      throw error;
    }
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // ==================== Pairing 事件 ====================

    this.client.on(PairingEvent.CREATED, (pairing: Pairing) => {
      console.log('[Wallet] Pairing created:', pairing.topic);
      this.showNotification('New pairing request', 'info');
    });

    this.client.on(PairingEvent.APPROVED, (pairing: Pairing) => {
      console.log('[Wallet] Pairing approved:', pairing.topic);
      this.addAuthHistory({
        timestamp: Date.now(),
        dappName: pairing.peer.appMetadata?.name || 'Unknown',
        dappUrl: pairing.peer.appMetadata?.url || '',
        dappIcon: pairing.peer.appMetadata?.icons?.[0],
        action: 'pairing',
        success: true
      });
      this.showNotification('Pairing approved', 'success');
    });

    this.client.on(PairingEvent.DELETED, (data: any) => {
      console.log('[Wallet] Pairing deleted:', data.topic);
    });

    // ==================== Session 事件 ====================

    // Session 提案
    this.client.on(SessionEvent.PROPOSAL, (proposal: SessionProposal) => {
      console.log('[Wallet] Session proposal received:', proposal.proposalId);

      const pending: PendingRequest = {
        id: proposal.proposalId,
        type: 'session_proposal',
        data: proposal,
        timestamp: Date.now()
      };

      this.pendingRequests.set(proposal.proposalId, pending);

      // 检查是否自动批准
      const dappUrl = proposal.proposer.metadata.url;
      if (this.autoApproveKnown && this.knownDapps.has(dappUrl)) {
        this.approveSessionAuto(proposal);
      } else {
        this.showSessionProposal(proposal);
      }
    });

    // Session 建立
    this.client.on(SessionEvent.SETTLED, (session: SessionData) => {
      console.log('[Wallet] Session settled:', session.topic);

      const metadata = session.peer.metadata;
      this.knownDapps.add(metadata.url);
      this.saveKnownDapps();

      this.addAuthHistory({
        timestamp: Date.now(),
        dappName: metadata.name,
        dappUrl: metadata.url,
        dappIcon: metadata.icons?.[0],
        action: 'session',
        success: true
      });

      this.updateConnectionsUI();
      this.showNotification(`Connected to ${metadata.name}`, 'success');
    });

    // Session 更新
    this.client.on(SessionEvent.UPDATED, (session: SessionData) => {
      console.log('[Wallet] Session updated:', session.topic);
      this.updateConnectionsUI();
    });

    // Session 扩展
    this.client.on(SessionEvent.EXTENDED, (session: SessionData) => {
      console.log('[Wallet] Session extended:', session.topic);
    });

    // Session 删除
    this.client.on(SessionEvent.DELETED, (data: { topic: string; reason: any }) => {
      console.log('[Wallet] Session deleted:', data.topic);

      // 清理相关的待处理请求
      for (const [id, pending] of this.pendingRequests.entries()) {
        if (pending.session?.topic === data.topic) {
          this.pendingRequests.delete(id);
          this.removeRequestFromUI(`request-${id}`);
        }
      }

      this.updateConnectionsUI();
      this.showNotification('Session disconnected', 'info');
    });

    // Session 请求
    this.client.on(SessionEvent.REQUEST, (data: any) => {
      console.log('[Wallet] Session request received:', data.request.id);

      const pending: PendingRequest = {
        id: data.request.id,
        type: 'session_request',
        data: data.request,
        session: data.session,
        timestamp: data.timestamp,
      };

      this.pendingRequests.set(data.request.id, pending);
      this.showSessionRequest(data.request, data.session);
    });

    // Session Ping
    this.client.on(SessionEvent.PING, (data: { topic: string; id: number }) => {
      console.log('[Wallet] Session ping received:', data.id);
    });

    // Session 事件
    this.client.on(SessionEvent.EVENT_RECEIVED, (event: any) => {
      console.log('[Wallet] Session event:', event.event.name);
    });
  }

  /**
   * 通过 URI 配对
   */
  async pair(uri: string): Promise<void> {
    try {
      await this.client.pair(uri);
      this.showNotification('Pairing initiated', 'success');
    } catch (error: any) {
      console.error('[Wallet] Failed to pair:', error);
      this.showNotification(`Pairing failed: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 显示 Session 提案
   */
  private showSessionProposal(proposal: SessionProposal): void {
    const requestsDiv = document.getElementById('requests');
    if (!requestsDiv) return;

    const metadata = proposal.proposer.metadata;
    const requiredNamespaces = proposal.requiredNamespaces;
    const optionalNamespaces = proposal.optionalNamespaces;

    // 提取所有请求的链
    const allChains = new Set<string>();
    const allMethods = new Set<string>();
    const allEvents = new Set<string>();

    for (const namespace of Object.values(requiredNamespaces)) {
      namespace.chains?.forEach(chain => allChains.add(chain));
      namespace.methods?.forEach(method => allMethods.add(method));
      namespace.events?.forEach(event => allEvents.add(event));
    }

    if (optionalNamespaces) {
      for (const namespace of Object.values(optionalNamespaces)) {
        namespace.chains?.forEach(chain => allChains.add(chain));
        namespace.methods?.forEach(method => allMethods.add(method));
        namespace.events?.forEach(event => allEvents.add(event));
      }
    }

    const requestDiv = document.createElement('div');
    requestDiv.className = 'request-item';
    requestDiv.id = `proposal-${proposal.proposalId}`;
    requestDiv.innerHTML = `
      <div class="request-header">
        <div class="dapp-info">
          ${metadata.icons?.[0] ? `<img src="${metadata.icons[0]}" alt="${metadata.name}" class="dapp-icon">` : ''}
          <div>
            <h3>🔐 Session Proposal</h3>
            <p class="dapp-name">${metadata.name}</p>
          </div>
        </div>
        <span class="request-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="request-details">
        <div class="detail-item">
          <strong>Description:</strong>
          <p>${metadata.description || 'N/A'}</p>
        </div>
        <div class="detail-item">
          <strong>URL:</strong>
          <p><a href="${metadata.url}" target="_blank">${metadata.url}</a></p>
        </div>
        <div class="detail-item">
          <strong>Requested Chains:</strong>
          <ul class="chain-list">
            ${Array.from(allChains).map(chain => `<li>${this.formatChainId(chain)}</li>`).join('')}
          </ul>
        </div>
        <div class="detail-item">
          <strong>Requested Methods:</strong>
          <ul class="method-list">
            ${Array.from(allMethods).map(method => `<li><code>${method}</code></li>`).join('')}
          </ul>
        </div>
        <div class="detail-item">
          <strong>Events:</strong>
          <ul class="event-list">
            ${Array.from(allEvents).map(event => `<li><code>${event}</code></li>`).join('')}
          </ul>
        </div>
      </div>
      <div class="request-actions">
        <button class="btn success" onclick="wallet.approveSession(${proposal.proposalId})">
          ✓ Approve
        </button>
        <button class="btn danger" onclick="wallet.rejectSession(${proposal.proposalId})">
          ✗ Reject
        </button>
      </div>
    `;

    requestsDiv.appendChild(requestDiv);

    // 移除空状态
    const emptyState = requestsDiv.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    this.showNotification(`New session proposal from ${metadata.name}`, 'info');
  }

  /**
   * 批准 Session
   */
  async approveSession(proposalId: number): Promise<void> {
    try {
      const pending = this.pendingRequests.get(proposalId);
      if (!pending || pending.type !== 'session_proposal') {
        throw new Error('Proposal not found');
      }

      const proposal = pending.data as SessionProposal;

      // 构建批准的命名空间
      const namespaces: SessionNamespaces = {};

      for (const [key, namespace] of Object.entries(proposal.requiredNamespaces)) {
        namespaces[key] = {
          chains: namespace.chains || [],
          methods: namespace.methods || [],
          events: namespace.events || [],
          accounts: (namespace.chains || []).map(chain => `${chain}:${this._address}`)
        };
      }

      // 批准 Session
      await this.client.approveSession({
        proposalId,
        namespaces
      });

      // 清理待处理请求
      this.pendingRequests.delete(proposalId);
      this.removeRequestFromUI(`proposal-${proposalId}`);

      this.updateUI('Session approved');
    } catch (error: any) {
      console.error('[Wallet] Failed to approve session:', error);
      this.showNotification(`Failed to approve session: ${error.message}`, 'error');
    }
  }

  /**
   * 自动批准 Session
   */
  private async approveSessionAuto(proposal: SessionProposal): Promise<void> {
    console.log('[Wallet] Auto-approving session for known DApp');
    await this.approveSession(proposal.proposalId);
  }

  /**
   * 拒绝 Session
   */
  async rejectSession(proposalId: number): Promise<void> {
    try {
      const pending = this.pendingRequests.get(proposalId);
      if (!pending || pending.type !== 'session_proposal') {
        throw new Error('Proposal not found');
      }

      const proposal = pending.data as SessionProposal;

      await this.client.rejectSession({
        proposalId,
        reason: 'User rejected session'
      });

      // 记录历史
      this.addAuthHistory({
        timestamp: Date.now(),
        dappName: proposal.proposer.metadata.name,
        dappUrl: proposal.proposer.metadata.url,
        dappIcon: proposal.proposer.metadata.icons?.[0],
        action: 'session',
        success: false
      });

      // 清理待处理请求
      this.pendingRequests.delete(proposalId);
      this.removeRequestFromUI(`proposal-${proposalId}`);

      this.updateUI('Session rejected');
    } catch (error: any) {
      console.error('[Wallet] Failed to reject session:', error);
      this.showNotification(`Failed to reject session: ${error.message}`, 'error');
    }
  }

  /**
   * 显示 Session 请求
   */
  private showSessionRequest(request: SessionRequest, session: SessionData): void {
    const requestsDiv = document.getElementById('requests');
    if (!requestsDiv) return;

    const metadata = session.peer.metadata;

    const requestDiv = document.createElement('div');
    requestDiv.className = 'request-item';
    requestDiv.id = `request-${request.id}`;
    requestDiv.innerHTML = `
      <div class="request-header">
        <div class="dapp-info">
          ${metadata.icons?.[0] ? `<img src="${metadata.icons[0]}" alt="${metadata.name}" class="dapp-icon">` : ''}
          <div>
            <h3>📝 ${this.getMethodDisplayName(request.method)}</h3>
            <p class="dapp-name">${metadata.name}</p>
          </div>
        </div>
        <span class="request-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="request-details">
        <div class="detail-item">
          <strong>Method:</strong>
          <p><code>${request.method}</code></p>
        </div>
        ${this.renderRequestParams(request.method, request.params)}
      </div>
      <div class="request-actions">
        <button class="btn success" onclick="wallet.approveRequest(${request.id})">
          ✓ Approve
        </button>
        <button class="btn danger" onclick="wallet.rejectRequest(${request.id})">
          ✗ Reject
        </button>
      </div>
    `;

    requestsDiv.appendChild(requestDiv);

    // 移除空状态
    const emptyState = requestsDiv.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    this.showNotification(`New ${request.method} request from ${metadata.name}`, 'info');
  }

 /**
   * 批准请求
   */
  async approveRequest(requestId: number): Promise<void> {
    try {
      const pending = this.pendingRequests.get(requestId);
      if (!pending || pending.type !== 'session_request') {
        throw new Error('Request not found');
      }

      const request = pending.data as SessionRequest;
      const session = pending.session!;

      let result: any;

      // 根据方法类型处理请求
      switch (request.method) {
        case 'personal_sign':
          result = await this.signMessage(request.params[0]);
          break;

        case 'eth_sign':
          result = await this.signMessage(request.params[1]);
          break;

        case 'eth_signTypedData':
        case 'eth_signTypedData_v4':
          result = await this.signTypedData(request.params[0], request.params[1]);
          break;

        case 'eth_sendTransaction':
          result = await this.sendTransaction(request.params[0]);
          break;

        case 'eth_signTransaction':
          result = await this.signTransaction(request.params[0]);
          break;

        case 'wallet_switchEthereumChain':
          result = await this.switchChain(request.params[0].chainId);
          break;

        case 'wallet_addEthereumChain':
          result = null; // 简单返回 null 表示成功
          break;

        default:
          throw new Error(`Unsupported method: ${request.method}`);
      }

      // 发送响应
      await this.client.respondRequest({
        requestId: request.id,
        result
      });

      // 记录历史
      this.addAuthHistory({
        timestamp: Date.now(),
        dappName: session.peer.metadata.name,
        dappUrl: session.peer.metadata.url,
        dappIcon: session.peer.metadata.icons?.[0],
        action: 'request',
        method: request.method,
        success: true
      });

      // 清理待处理请求
      this.pendingRequests.delete(requestId);
      this.removeRequestFromUI(`request-${requestId}`);

      this.updateUI(`Request approved: ${request.method}`);
      this.showNotification('Request approved', 'success');

    } catch (error: any) {
      console.error('[Wallet] Failed to approve request:', error);
      this.showNotification(`Failed to approve request: ${error.message}`, 'error');

      // 尝试拒绝请求
      try {
        await this.rejectRequest(requestId);
      } catch (rejectError) {
        console.error('[Wallet] Failed to reject request after error:', rejectError);
      }
    }
  }

  /**
   * 拒绝请求
   */
  async rejectRequest(requestId: number): Promise<void> {
    try {
      const pending = this.pendingRequests.get(requestId);
      if (!pending || pending.type !== 'session_request') {
        throw new Error('Request not found');
      }

      const request = pending.data as SessionRequest;
      const session = pending.session!;

      await this.client.rejectRequest({
        requestId: request.id,
        error: {
          code: 5000,
          message: 'User rejected request'
        }
      });

      // 记录历史
      this.addAuthHistory({
        timestamp: Date.now(),
        dappName: session.peer.metadata.name,
        dappUrl: session.peer.metadata.url,
        dappIcon: session.peer.metadata.icons?.[0],
        action: 'request',
        method: request.method,
        success: false
      });

      // 清理待处理请求
      this.pendingRequests.delete(requestId);
      this.removeRequestFromUI(`request-${requestId}`);

      this.updateUI('Request rejected');
    } catch (error: any) {
      console.error('[Wallet] Failed to reject request:', error);
      this.showNotification(`Failed to reject request: ${error.message}`, 'error');
    }
  }

 /**
   * 签名消息
   */
  private async signMessage(message: string): Promise<string> {
    // 移除 0x 前缀（如果有）
    const messageToSign = message.startsWith('0x')
      ? ethers.getBytes(message)
      : message;
    return await this.wallet.signMessage(messageToSign);
  }

  /**
   * 签名类型化数据
   */
  private async signTypedData(address: string, typedData: string): Promise<string> {
    console.log(`sign type data=${address}`)
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
    // const provider = new ethers.JsonRpcProvider(RPC_URL);
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
   * 切换链
   */
  private async switchChain(chainId: string): Promise<null> {
    // 在实际应用中，这里应该更新当前链
    console.log('[Wallet] Switching to chain:', chainId);

    // 发送链变更事件到所有活跃的会话
    const sessions = this.client.getActiveSessions();
    for (const session of sessions) {
      await this.client.updateChain({
        topic: session.topic,
        chainId
      });
    }

    return null;
  }

  /**
   * 断开会话
   */
  async disconnect(topic: string): Promise<void> {
    try {
      await this.client.disconnectSession({
        topic,
        reason: 'User disconnected'
      });

      this.updateConnectionsUI();
      this.showNotification('Session disconnected', 'success');
    } catch (error: any) {
      console.error('[Wallet] Failed to disconnect session:', error);
      this.showNotification(`Failed to disconnect: ${error.message}`, 'error');
    }
  }

  /**
   * 更新账户
   */
  async updateAccounts(accounts: string[]): Promise<void> {
    try {
      await this.client.updateAccounts(accounts);
      this.showNotification('Accounts updated', 'success');
    } catch (error: any) {
      console.error('[Wallet] Failed to update accounts:', error);
      this.showNotification(`Failed to update accounts: ${error.message}`, 'error');
    }
  }

  /**
   * 获取活动会话
   */
  getActiveSessions(): SessionData[] {
    return this.client.getActiveSessions();
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
        console.error('[Wallet] Failed to load auth history:', error);
        this.authHistory = [];
      }
    }
  }

  /**
   * 保存认证历史
   */
  private saveAuthHistory(): void {
    localStorage.setItem(
      `auth-history-${this._address}`,
      JSON.stringify(this.authHistory)
    );
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
        console.error('[Wallet] Failed to load known dapps:', error);
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
      const metadata = session.peer.metadata;
      const chains = new Set<string>();

      for (const namespace of Object.values(session.namespaces)) {
        namespace.chains?.forEach(chain => chains.add(chain));
      }

      return `
        <div class="session-item">
          <div class="session-header">
            ${metadata.icons?.[0] ? `<img src="${metadata.icons[0]}" alt="${metadata.name}" class="dapp-icon">` : ''}
            <div class="session-info">
              <h4>${metadata.name}</h4>
              <p class="session-url">${metadata.url}</p>
            </div>
          </div>
          <div class="session-details">
            <p class="session-description">${metadata.description || ''}</p>
            <div class="session-meta">
              <span class="session-chains">
                <strong>Chains:</strong> ${Array.from(chains).map(c => this.formatChainId(c)).join(', ')}
              </span>
              <span class="session-time">
                <strong>Expires:</strong> ${new Date(session.expiry * 1000).toLocaleString()}
              </span>
            </div>
          </div>
          <div class="session-actions">
            <button class="btn secondary" onclick="wallet.ping('${session.topic}')">
              🏓 Ping
            </button>
            <button class="btn danger" onclick="wallet.disconnect('${session.topic}')">
              🔌 Disconnect
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
   * Ping 会话
   */
  async ping(topic: string): Promise<void> {
    try {
      await this.client.ping(topic);
      this.showNotification('Ping sent successfully', 'success');
    } catch (error: any) {
      console.error('[Wallet] Failed to ping:', error);
      this.showNotification(`Ping failed: ${error.message}`, 'error');
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
      <div class="auth-item ${entry.success ? 'success' : 'rejected'}">
        <div class="auth-header">
          <div class="dapp-info">
            ${entry.dappIcon ? `<img src="${entry.dappIcon}" alt="${entry.dappName}" class="dapp-icon-small">` : ''}
            <div>
              <span class="auth-type">${this.getActionDisplayName(entry.action, entry.method)}</span>
              <span class="dapp-name">${entry.dappName}</span>
            </div>
          </div>
          <span class="auth-status ${entry.success ? 'success' : 'rejected'}">
            ${entry.success ? '✓ Approved' : '✗ Rejected'}
          </span>
        </div>
        <div class="auth-details">
          ${entry.dappUrl ? `<p><strong>URL:</strong> <a href="${entry.dappUrl}" target="_blank">${entry.dappUrl}</a></p>` : ''}
          ${entry.method ? `<p><strong>Method:</strong> <code>${entry.method}</code></p>` : ''}
          <p><strong>Time:</strong> ${new Date(entry.timestamp).toLocaleString()}</p>
          ${entry.details ? `<p><strong>Details:</strong> ${entry.details}</p>` : ''}
        </div>
      </div>
    `).join('');

    historyDiv.innerHTML = historyHTML;
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
      'wallet_switchEthereumChain': 'Switch Chain',
      'wallet_addEthereumChain': 'Add Chain'
    };

    return names[method] || method;
  }

  /**
   * 获取操作显示名称
   */
  private getActionDisplayName(action: string, method?: string): string {
    if (action === 'request' && method) {
      return this.getMethodDisplayName(method);
    }

    const names: Record<string, string> = {
      'pairing': '🔗 Pairing',
      'session': '🔐 Session Connection',
      'request': '📝 Request'
    };

    return names[action] || action;
  }

  /**
   * 渲染请求参数
   */
  private renderRequestParams(method: string, params: any[]): string {
    if (method === 'personal_sign') {
      return `
        <div class="detail-item">
          <strong>Message:</strong>
          <div class="message-preview">
            <pre>${this.formatMessage(params[0])}</pre>
          </div>
        </div>
        <div class="detail-item">
          <strong>Address:</strong>
          <p><code class="address">${params[1]}</code></p>
        </div>
      `;
    }

    if (method === 'eth_sign') {
      return `
        <div class="detail-item">
          <strong>Address:</strong>
          <p><code class="address">${params[0]}</code></p>
        </div>
        <div class="detail-item">
          <strong>Message:</strong>
          <div class="message-preview">
            <pre>${this.formatMessage(params[1])}</pre>
          </div>
        </div>
      `;
    }

    if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
      let typedData;
      try {
        typedData = JSON.parse(params[1]);
      } catch {
        typedData = params[1];
      }

      return `
        <div class="detail-item">
          <strong>Address:</strong>
          <p><code class="address">${params[0]}</code></p>
        </div>
        <div class="detail-item">
          <strong>Typed Data:</strong>
          <div class="message-preview">
            <pre>${JSON.stringify(typedData, null, 2)}</pre>
          </div>
        </div>
      `;
    }

    if (method === 'eth_sendTransaction' || method === 'eth_signTransaction') {
      const tx = params[0];
      return `
        <div class="detail-item">
          <strong>Transaction:</strong>
          <div class="transaction-details">
            ${tx.from ? `<p><strong>From:</strong> <code class="address">${tx.from}</code></p>` : ''}
            ${tx.to ? `<p><strong>To:</strong> <code class="address">${tx.to}</code></p>` : ''}
            ${tx.value ? `<p><strong>Value:</strong> ${ethers.formatEther(tx.value)} ETH</p>` : ''}
            ${tx.gas ? `<p><strong>Gas Limit:</strong> ${tx.gas}</p>` : ''}
            ${tx.gasPrice ? `<p><strong>Gas Price:</strong> ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei</p>` : ''}
            ${tx.maxFeePerGas ? `<p><strong>Max Fee:</strong> ${ethers.formatUnits(tx.maxFeePerGas, 'gwei')} Gwei</p>` : ''}
            ${tx.maxPriorityFeePerGas ? `<p><strong>Priority Fee:</strong> ${ethers.formatUnits(tx.maxPriorityFeePerGas, 'gwei')} Gwei</p>` : ''}
            ${tx.data && tx.data !== '0x' ? `
              <div class="data-preview">
                <strong>Data:</strong>
                <pre>${tx.data.slice(0, 100)}${tx.data.length > 100 ? '...' : ''}</pre>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    if (method === 'wallet_switchEthereumChain') {
      return `
        <div class="detail-item">
          <strong>Chain ID:</strong>
          <p>${this.formatChainId(params[0].chainId)}</p>
        </div>
      `;
    }

    if (method === 'wallet_addEthereumChain') {
      const chain = params[0];
      return `
        <div class="detail-item">
          <strong>Chain Details:</strong>
          <div class="chain-details">
            <p><strong>Chain ID:</strong> ${chain.chainId}</p>
            <p><strong>Name:</strong> ${chain.chainName}</p>
            ${chain.rpcUrls ? `<p><strong>RPC URLs:</strong> ${chain.rpcUrls.join(', ')}</p>` : ''}
            ${chain.nativeCurrency ? `
              <p><strong>Currency:</strong> ${chain.nativeCurrency.name} (${chain.nativeCurrency.symbol})</p>
            ` : ''}
            ${chain.blockExplorerUrls ? `<p><strong>Explorer:</strong> ${chain.blockExplorerUrls[0]}</p>` : ''}
          </div>
        </div>
      `;
    }

    return `
      <div class="detail-item">
        <strong>Parameters:</strong>
        <div class="message-preview">
          <pre>${JSON.stringify(params, null, 2)}</pre>
        </div>
      </div>
    `;
  }

  /**
   * 格式化消息
   */
  private formatMessage(message: string): string {
    if (message.startsWith('0x')) {
      try {
        // 尝试将十六进制转换为 UTF-8
        const bytes = ethers.getBytes(message);
        const text = ethers.toUtf8String(bytes);
        return text;
      } catch {
        return message;
      }
    }
    return message;
  }

  /**
   * 格式化链 ID
   */
  private formatChainId(chainId: string): string {
    const chains: Record<string, string> = {
      'eip155:1': 'Ethereum Mainnet',
      'eip155:5': 'Goerli Testnet',
      'eip155:11155111': 'Sepolia Testnet',
      'eip155:137': 'Polygon Mainnet',
      'eip155:80001': 'Mumbai Testnet',
      'eip155:56': 'BSC Mainnet',
      'eip155:97': 'BSC Testnet',
      'eip155:42161': 'Arbitrum One',
      'eip155:421613': 'Arbitrum Goerli',
      'eip155:10': 'Optimism',
      'eip155:420': 'Optimism Goerli',
      'eip155:43114': 'Avalanche C-Chain',
      'eip155:43113': 'Avalanche Fuji'
    };

    return chains[chainId] || chainId;
  }

  /**
   * 从 UI 移除请求
   */
  private removeRequestFromUI(elementId: string): void {
    const element = document.getElementById(elementId);
    if (element) {
      element.remove();
    }

    // 检查是否还有其他请求
    const requestsDiv = document.getElementById('requests');
    if (requestsDiv && requestsDiv.children.length === 0) {
      requestsDiv.innerHTML = '<p class="empty-state">No pending requests</p>';
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
    console.log('[Wallet] Status:', message);
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

    const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';

    notification.innerHTML = `
      <span class="notification-icon">${icon}</span>
      <span class="notification-message">${message}</span>
      <button class="notification-close" onclick="this.parentElement.remove()">×</button>
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
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
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
      activeSessions: this.getActiveSessions().map(session => ({
        topic: session.topic,
        dappName: session.peer.metadata.name,
        dappUrl: session.peer.metadata.url,
        expiry: session.expiry
      })),
      knownDapps: Array.from(this.knownDapps),
      exportTime: new Date().toISOString()
    };
  }

  /**
   * 销毁钱包
   */
  async destroy(): Promise<void> {
    try {
      await this.client.destroy();
      console.log('[Wallet] Destroyed');
    } catch (error) {
      console.error('[Wallet] Failed to destroy:', error);
    }
  }
}

// 全局类型声明
declare global {
  interface Window {
    wallet: Wallet;
  }
}
