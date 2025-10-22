import {
  DappClient,
  ConnectionURI,
  SessionData,
  SessionNamespaces,
  SessionMetadata,
  SessionEvent,
  PairingEvent,
  RelayConfig
} from 'walletconnect-waku-sdk';

import QRCode from 'qrcode';

import { AuthService } from './services/AuthService';
import { LoadingOverlay } from './components/LoadingOverlay';
import { LoginFlowIndicator } from './components/LoginFlowIndicator';

/**
 * DApp 配置
 */
export interface DAppConfig {
  relayConfig: RelayConfig;
  metadata: SessionMetadata;
  requiredNamespaces?: SessionNamespaces;
  optionalNamespaces?: SessionNamespaces;
  requestTimeout?: number;
}

/**
 * DApp 封装类
 */
export class DApp {
  private client: DappClient;
  private currentSession?: SessionData;
  private currentConnectionURI?: ConnectionURI;
  private authService: AuthService;
  private loadingOverlay: LoadingOverlay;
  private loginFlowIndicator: LoginFlowIndicator;

  // 用于存储登录流程中的临时数据
  private pendingAuth?: {
    address: string;
    challenge: string;
    message: string;
  };

  constructor(config: DAppConfig) {
    // 初始化 DApp 客户端
    this.client = new DappClient({
      relayConfig: config.relayConfig,
      metadata: config.metadata,
      requiredNamespaces: config.requiredNamespaces,
      optionalNamespaces: config.optionalNamespaces,
      requestTimeout: config.requestTimeout
    });

    // 初始化认证服务
    this.authService = new AuthService();
    this.loadingOverlay = new LoadingOverlay();
    this.loginFlowIndicator = new LoginFlowIndicator();

    this.setupEventListeners();
  }

  /**
   * 初始化 DApp
   */
  async initialize(): Promise<void> {
    try {
      await this.client.init();
      console.log('[DApp] Initialized successfully');
      this.updateStatus('DApp initialized. Ready to connect.');

      // 检查是否有已保存的认证会话
      if (this.authService.isAuthenticated()) {
        const authSession = this.authService.getSession();
        console.log('[DApp] Found existing auth session:', authSession?.address);

        // 验证 token 是否仍然有效
        const isValid = await this.authService.verifyToken();
        if (isValid) {
          this.updateStatus('Restored previous authentication session');
          await this.showAuthenticatedState();
        } else {
          console.log('[DApp] Auth session invalid, logging out');
          this.authService.logout();
        }
      }

      // 恢复之前的会话
      const session = this.client.getActiveSession();
      if (session) {
        this.currentSession = session;
        this.showConnectedState();
        this.updateStatus('Restored previous session');
      }
    } catch (error) {
      console.error('[DApp] Failed to initialize:', error);
      this.updateStatus('Failed to initialize DApp');
      throw error;
    }
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // ==================== Pairing 事件 ====================

    // Pairing 创建
    this.client.on(PairingEvent.CREATED, (pairing: any) => {
      console.log('[DApp] Pairing created:', pairing.topic);
      this.updateStatus('Pairing created. Waiting for wallet to scan...');
    });

    // Pairing 批准
    this.client.on(PairingEvent.APPROVED, (pairing: any) => {
      console.log('[DApp] Pairing approved:', pairing.topic);
      this.updateStatus('Pairing approved. Proposing session...');
    });

    // Pairing 删除
    this.client.on(PairingEvent.DELETED, (data: any) => {
      console.log('[DApp] Pairing deleted:', data.topic);
      this.updateStatus('Pairing deleted');
    });

    // ==================== Session 事件 ====================

    // 显示 URI（用于生成二维码）
    this.client.on('display_uri', (connectionURI: ConnectionURI) => {
      console.log('[DApp] Display URI:', connectionURI.uri);
      this.currentConnectionURI = connectionURI;
      this.showQRCode(connectionURI.uri);
    });

    // Session 提案
    this.client.on(SessionEvent.PROPOSAL, (proposal: any) => {
      console.log('[DApp] Session proposal:', proposal.id);
      this.updateStatus('Session proposal sent. Please approve in your wallet.');
    });

    // Session 连接成功
    this.client.on(SessionEvent.SETTLED, async (session: SessionData) => {
      console.log('[DApp] Session connected:', session.topic);
      this.currentSession = session;
      this.updateStatus('Connected to wallet');
      this.updateStatus('Wallet connected. Starting authentication...');
      this.showConnectedState();
      this.hideQRCode();

      // 自动开始登录流程
      await this.startLoginFlow();
    });

    // Session 更新
    this.client.on(SessionEvent.UPDATED, (session: SessionData) => {
      console.log('[DApp] Session updated:', session.topic);
      this.currentSession = session;
      this.updateStatus('Session updated');
    });

    // Session 扩展
    this.client.on(SessionEvent.EXTENDED, (session: SessionData) => {
      console.log('[DApp] Session extended:', session.topic);
      this.currentSession = session;
      this.updateStatus('Session extended');
    });

    // Session 断开
    this.client.on(SessionEvent.DELETED, (data: any) => {
      console.log('[DApp] Session disconnected:', data.topic);
      this.currentSession = undefined;
      this.updateStatus('Disconnected from wallet');
      this.showDisconnectedState();
    });

    // Session 请求
    this.client.on('session_request', (request: any) => {
      console.log('[DApp] Session request:', request.id);
    });

    // Session 事件
    this.client.on('session_event', (event: any) => {
      console.log('[DApp] Session event:', event.event.name);
    });

    // Pairing 错误
    this.client.on('pairing_error', (error: any) => {
      console.error('[DApp] Pairing error:', error);
      this.updateStatus(`Pairing error: ${error.message}`);
      this.hideQRCode();
    });
  }

  /**
   * 创建连接（生成 QR 码）
   */
  async createConnection(): Promise<string> {
    try {
      this.updateStatus('Creating connection...');

      // 创建连接 URI
      const connectionURI = await this.client.connect();
      this.currentConnectionURI = connectionURI;

      this.updateStatus('Scan QR code with your wallet to connect');
      return connectionURI.uri;
    } catch (error: any) {
      console.error('[DApp] Failed to create connection:', error);
      this.updateStatus(`Failed to create connection: ${error.message}`);
      throw error;
    }
  }

  /**
   * 手动触发登录（用于重新登录）
   */
  async login(): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Please connect wallet first');
    }

    await this.startLoginFlow();
  }

  /**
   * 显示认证后的状态（增强版）
   */
  private async showAuthenticatedState(): Promise<void> {
    try {
      const profile = await this.authService.getUserProfile();
      
      const authInfo = document.getElementById('auth-info');
      if (authInfo) {
        const expiresIn = Math.floor(
          (this.authService.getSession()!.expiresAt - Date.now()) / 1000 / 60
        );

        authInfo.innerHTML = `
          <div class="user-profile-card">
            <div class="user-profile-header">
              <div class="user-avatar">
                👤
              </div>
              <div class="user-details">
                <h4>
                  ${this.formatAddress(profile.address)}
                  <span class="auth-badge verified">Verified</span>
                </h4>
                <p class="user-address">${profile.address}</p>
              </div>
            </div>
            
            <div class="user-stats">
              <div class="stat-item">
                <span class="stat-value">${profile.loginCount}</span>
                <span class="stat-label">Total Logins</span>
              </div>
              <div class="stat-item">
                <span class="stat-value">${expiresIn}m</span>
                <span class="stat-label">Token Valid</span>
              </div>
              <div class="stat-item">
                <span class="stat-value">${this.getDaysSince(profile.createdAt)}</span>
                <span class="stat-label">Days Member</span>
              </div>
            </div>

            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-color);">
              <div class="info-item">
                <span class="info-label">Last Login:</span>
                <span class="info-value">${new Date(profile.lastLogin).toLocaleString()}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Member Since:</span>
                <span class="info-value">${new Date(profile.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        `;
        authInfo.style.display = 'block';
      }

      // 启用受保护的功能
      const protectedSection = document.getElementById('protected-section');
      if (protectedSection) {
        protectedSection.style.display = 'block';
      }

      // 显示 Token 过期警告（如果快过期）
      this.checkTokenExpiry();

    } catch (error) {
      console.error('[DApp] Failed to show authenticated state:', error);
    }
  }

 /**
   * 检查 Token 过期时间并显示警告
   */
  private checkTokenExpiry(): void {
    const session = this.authService.getSession();
    if (!session) return;

    const expiresIn = session.expiresAt - Date.now();
    const minutesLeft = Math.floor(expiresIn / 1000 / 60);

    // 如果少于 10 分钟，显示警告
    if (minutesLeft < 10 && minutesLeft > 0) {
      const warningDiv = document.createElement('div');
      warningDiv.className = 'token-expiry-warning';
      warningDiv.innerHTML = `
        Your session will expire in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}. 
        Please re-login to continue.
      `;

      const authInfo = document.getElementById('auth-info');
      if (authInfo && !authInfo.querySelector('.token-expiry-warning')) {
        authInfo.insertBefore(warningDiv, authInfo.firstChild);
      }

      // 设置自动刷新警告
      setTimeout(() => {
        this.checkTokenExpiry();
      }, 60000); // 每分钟检查一次
    }
  }

    /**
     * 
   * 计算天数差
   */
  private getDaysSince(timestamp: number): number {
    const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    return days;
  }

  /**
   * 格式化地址显示
   */
  private formatAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  /**
   * 开始登录流程
   */
  async startLoginFlow(): Promise<void> {
    try {
      if (!this.currentSession) {
        throw new Error('No active wallet session');
      }

      // 获取账户地址
      const accounts = this.getAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts available');
      }

      const address = accounts[0].split(':')[2]; // 从 "eip155:1:0x..." 提取地址
      console.log('[DApp] Starting login flow for address:', address);

      // 显示登录流程指示器
      this.loginFlowIndicator.show('auth-info');
      this.loginFlowIndicator.setStep(0); // Connect Wallet (已完成)

      // 步骤 1: 获取挑战
      this.loginFlowIndicator.setStep(1); // Get Challenge
      this.loadingOverlay.show('Requesting authentication challenge...');
      this.updateStatus('Requesting authentication challenge...');

      const { challenge, message } = await this.authService.getChallenge(address);
      this.pendingAuth = { address, challenge, message };

      // 步骤 2: 请求签名
      this.loginFlowIndicator.setStep(2); // Sign Message
      this.loadingOverlay.updateMessage('Please sign the message in your wallet...');
      this.updateStatus('Please sign the message in your wallet...');

      const signature = await this.signMessage(message);

      // 步骤 3: 验证签名并登录
      this.loginFlowIndicator.setStep(3); // Verify & Login
      this.loadingOverlay.updateMessage('Verifying signature...');
      this.updateStatus('Verifying signature...');

      const session = await this.authService.verifyAndLogin(this.pendingAuth.address, signature, this.pendingAuth.challenge);

      console.log('[DApp] Login successful:', session);

      // 完成所有步骤
      this.loginFlowIndicator.complete();
      this.loadingOverlay.updateMessage('Login successful!');
      this.updateStatus('Login successful!');

      // 清除临时数据
      this.pendingAuth = undefined;

      // 显示认证后的状态
      await this.showAuthenticatedState();

      // 隐藏加载指示器
      setTimeout(() => {
        this.loadingOverlay.hide();
      }, 1000);
    } catch (error: any) {
      console.error('[DApp] Login flow failed:', error);
      this.updateStatus(`Login failed: ${error.message}`);
      this.pendingAuth = undefined;
      this.loadingOverlay.hide();
      this.loginFlowIndicator.hide();
      throw error;
    }
  }

  /**
   * 发送交易
   */
  async sendTransaction(params: {
    to: string;
    value: string;
    data?: string;
    gas?: string;
    gasPrice?: string;
  }): Promise<string> {
    try {
      if (!this.currentSession) {
        throw new Error('No active session. Please connect first.');
      }

      this.updateStatus('Sending transaction request...');

      // 获取账户和链 ID
      const accounts = this.getAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts available');
      }

      const chains = this.getChains();
      if (chains.length === 0) {
        throw new Error('No chains available');
      }

      // 从账户字符串中提取地址 (格式: "eip155:1:0x...")
      const from = accounts[0].split(':')[2];
      const chainId = chains[0]; // 使用第一个链

      // 发送交易请求
      const result = await this.client.request<string>({
        chainId,
        method: 'eth_sendTransaction',
        params: [{
          from,
          to: params.to,
          value: params.value,
          data: params.data || '0x',
          gas: params.gas,
          gasPrice: params.gasPrice
        }]
      });

      this.updateStatus('Transaction sent successfully');
      console.log('[DApp] Transaction hash:', result);
      return result;
    } catch (error: any) {
      console.error('[DApp] Failed to send transaction:', error);
      this.updateStatus(`Transaction failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 签名消息
   */
  async signMessage(message: string): Promise<string> {
    try {
      if (!this.currentSession) {
        throw new Error('No active session. Please connect first.');
      }

      this.updateStatus('Sending sign request...');

      // 获取账户和链 ID
      const accounts = this.getAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts available');
      }

      const chains = this.getChains();
      if (chains.length === 0) {
        throw new Error('No chains available');
      }

      const address = accounts[0].split(':')[2];
      const chainId = chains[0];

      // 发送签名请求
      const result = await this.client.request<string>({
        chainId,
        method: 'personal_sign',
        params: [message, address]
      });

      this.updateStatus('Message signed successfully');
      console.log('[DApp] Signature:', result);
      return result;
    } catch (error: any) {
      console.error('[DApp] Failed to sign message:', error);
      this.updateStatus(`Sign failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 签名类型化数据 (EIP-712)
   */
  async signTypedData(typedData: any): Promise<string> {
    try {
      if (!this.currentSession) {
        throw new Error('No active session. Please connect first.');
      }

      this.updateStatus('Sending typed data sign request...');

      // 获取账户和链 ID
      const accounts = this.getAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts available');
      }

      const chains = this.getChains();
      if (chains.length === 0) {
        throw new Error('No chains available');
      }

      const address = accounts[0].split(':')[2];
      const chainId = chains[0];

      // 发送签名请求
      const result = await this.client.request<string>({
        chainId,
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify(typedData)]
      });

      this.updateStatus('Typed data signed successfully');
      console.log('[DApp] Signature:', result);
      return result;
    } catch (error: any) {
      console.error('[DApp] Failed to sign typed data:', error);
      this.updateStatus(`Sign failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 切换链
   */
  async switchChain(chainId: string): Promise<void> {
    try {
      if (!this.currentSession) {
        throw new Error('No active session. Please connect first.');
      }

      this.updateStatus('Switching chain...');

      const currentChainId = this.getChains()[0];

      await this.client.request({
        chainId: currentChainId,
        method: 'wallet_switchEthereumChain',
        params: [{ chainId }]
      });

      this.updateStatus(`Switched to chain ${chainId}`);
    } catch (error: any) {
      console.error('[DApp] Failed to switch chain:', error);
      this.updateStatus(`Switch chain failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 添加链
   */
  async addChain(params: {
    chainId: string;
    chainName: string;
    nativeCurrency: {
      name: string;
      symbol: string;
      decimals: number;
    };
    rpcUrls: string[];
    blockExplorerUrls?: string[];
  }): Promise<void> {
    try {
      if (!this.currentSession) {
        throw new Error('No active session. Please connect first.');
      }

      this.updateStatus('Adding chain...');

      const currentChainId = this.getChains()[0];

      await this.client.request({
        chainId: currentChainId,
        method: 'wallet_addEthereumChain',
        params: [params]
      });

      this.updateStatus(`Chain ${params.chainName} added successfully`);
    } catch (error: any) {
      console.error('[DApp] Failed to add chain:', error);
      this.updateStatus(`Add chain failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 断开连接（包括登出）
   */
  async disconnect(): Promise<void> {
    try {
      if (this.currentSession) {
        this.updateStatus('Disconnecting...');
        await this.client.disconnect();
        this.currentSession = undefined;
        this.currentConnectionURI = undefined;
      }

      // 登出认证会话
      this.authService.logout();

      this.showDisconnectedState();
      this.hideAuthenticatedState();
      this.updateStatus('Disconnected and logged out');
    } catch (error: any) {
      console.error('[DApp] Failed to disconnect:', error);
      this.updateStatus(`Failed to disconnect: ${error.message}`);
      throw error;
    }
  }

  /**
   * 隐藏认证状态
   */
  private hideAuthenticatedState(): void {
    const authInfo = document.getElementById('auth-info');
    if (authInfo) {
      authInfo.style.display = 'none';
    }

    const protectedSection = document.getElementById('protected-section');
    if (protectedSection) {
      protectedSection.style.display = 'none';
    }
  }

  /**
   * 获取认证服务实例
   */
  getAuthService(): AuthService {
    return this.authService;
  }

  /**
   * 检查是否已认证
   */
  isAuthenticated(): boolean {
    return this.authService.isAuthenticated();
  }

  /**
   * 发送 ping
   */
  async ping(): Promise<void> {
    try {
      if (!this.currentSession) {
        throw new Error('No active session');
      }

      await this.client.ping();
      this.updateStatus('Ping sent successfully');
    } catch (error: any) {
      console.error('[DApp] Failed to send ping:', error);
      this.updateStatus(`Ping failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取当前账户列表
   */
  getAccounts(chainId?: string): string[] {
    return this.client.getAccounts(chainId);
  }

  /**
   * 获取支持的链列表
   */
  getChains(): string[] {
    return this.client.getChains();
  }

  /**
   * 获取支持的方法列表
   */
  getMethods(chainId?: string): string[] {
    return this.client.getMethods(chainId);
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.client.isConnected();
  }

  /**
   * 获取会话信息
   */
  getSession(): SessionData | undefined {
    return this.client.getActiveSession();
  }

  /**
   * 获取连接 URI
   */
  getConnectionURI(): ConnectionURI | undefined {
    return this.currentConnectionURI;
  }

  // ==================== UI 辅助方法 ====================

  /**
   * 更新状态显示
   */
  private updateStatus(message: string): void {
    const statusElement = document.getElementById('status');
    if (statusElement) {
      statusElement.textContent = message;

      // 根据消息内容设置样式
      statusElement.className = 'status';
      if (message.includes('success') || message.includes('Connected') || message.includes('approved')) {
        statusElement.classList.add('success');
      } else if (message.includes('failed') || message.includes('error') || message.includes('rejected')) {
        statusElement.classList.add('error');
      } else if (message.includes('Waiting') || message.includes('Scan')) {
        statusElement.classList.add('warning');
      }
    }
    console.log('[DApp] Status:', message);
  }

  /**
   * 显示 QR 码
   */
  private showQRCode(uri: string): void {
    const qrContainer = document.getElementById('qr-container');
    const qrCode = document.getElementById('qr-code');

    if (qrContainer && qrCode) {
      qrContainer.style.display = 'block';

      // 使用 QRCode 库生成二维码
      QRCode.toCanvas(qrCode as HTMLCanvasElement, uri, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      }).catch(error => {
        console.error('[DApp] Failed to generate QR code:', error);
      });

      // 显示 URI 文本
      const uriText = document.getElementById('uri-text');
      if (uriText) {
        uriText.textContent = uri;
      }
    }
  }

  /**
   * 隐藏 QR 码
   */
  private hideQRCode(): void {
    const qrContainer = document.getElementById('qr-container');
    if (qrContainer) {
      qrContainer.style.display = 'none';
    }
  }

  /**
   * 显示已连接状态
   */
  private showConnectedState(): void {
    const connectButton = document.getElementById('connect-button') as HTMLButtonElement;
    const disconnectButton = document.getElementById('disconnect-button') as HTMLButtonElement;
    const actionsSection = document.getElementById('actions-section');
    const accountInfo = document.getElementById('account-info');

    if (connectButton) {
      connectButton.disabled = true;
      connectButton.textContent = 'Connected';
    }

    if (disconnectButton) {
      disconnectButton.disabled = false;
    }

    if (actionsSection) {
      actionsSection.style.display = 'block';
    }

    if (accountInfo) {
      const accounts = this.getAccounts();
      const chains = this.getChains();

      accountInfo.innerHTML = `
        <h3>Connection Info</h3>
        <div class="info-item">
          <span class="info-label">Account:</span>
          <span class="info-value">${accounts[0] || 'N/A'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Chain:</span>
          <span class="info-value">${chains[0] || 'N/A'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Session Topic:</span>
          <span class="info-value">${this.currentSession?.topic || 'N/A'}</span>
        </div>
      `;
      accountInfo.style.display = 'block';
    }
  }

  /**
   * 显示未连接状态
   */
  private showDisconnectedState(): void {
    const connectButton = document.getElementById('connect-button') as HTMLButtonElement;
    const disconnectButton = document.getElementById('disconnect-button') as HTMLButtonElement;
    const actionsSection = document.getElementById('actions-section');
    const accountInfo = document.getElementById('account-info');

    if (connectButton) {
      connectButton.disabled = false;
      connectButton.textContent = 'Connect';
    }

    if (disconnectButton) {
      disconnectButton.disabled = true;
    }

    if (actionsSection) {
      actionsSection.style.display = 'none';
    }

    if (accountInfo) {
      accountInfo.style.display = 'none';
    }
  }

  /**
   * 销毁 DApp
   */
  async destroy(): Promise<void> {
    try {
      await this.client.destroy();
      this.currentSession = undefined;
      this.currentConnectionURI = undefined;
      console.log('[DApp] Destroyed');
    } catch (error) {
      console.error('[DApp] Failed to destroy:', error);
      throw error;
    }
  }
}

