import { 
  WakuClient, 
  WakuMessage, 
  ConnectionRequest, 
  ConnectionResponse,
  SignRequest, 
  SignResponse,
  Session,
  DAppMetadata,
  Namespace,
  generateSessionId,
  createBaseMessage
} from 'walletconnect-waku-sdk';

export class DApp {
  private serverUrl: string = 'http://localhost:3002';
  private _authToken: string | null = null;

  private wakuClient: WakuClient;
  private sessions: Map<string, Session> = new Map();
  private pendingRequests: Map<string, any> = new Map();

  constructor() {
    const clusterId = import.meta.env.VITE_CLUSTER_ID  ? parseInt(import.meta.env.VITE_CLUSTER_ID) : 5432 ;
    this.wakuClient = new WakuClient(clusterId);
  }

  // 添加 authToken 的 getter
  get authToken(): string | null {
    return this._authToken;
  }

  // 添加 isConnected 方法
  private isConnected(): boolean {
    return this.sessions.size > 0;
  }

  // 添加 updateStatus 方法
  private updateStatus(message: string): void {
    const statusElement = document.getElementById('server-auth-status');
    if (statusElement) {
      statusElement.textContent = message;
    }
    console.log('Status:', message);
  }

  async initialize(): Promise<void> {
    const BOOTSTRAP_PEERS = import.meta.env.VITE_WAKU_BOOTSTRAP_PEERS?.split(',') || [];
    try {
      await this.wakuClient.start(BOOTSTRAP_PEERS)
    } catch (err) {
      console.error('Fail to start waku for dapp', err)
    }
    this.setupMessageHandlers();
    console.log('DApp initialized');

    // 检查存储的服务器token
    const storedToken = localStorage.getItem('server-auth-token');
    if (storedToken) {
      // 验证token是否仍然有效
      const isValid = await this.wakuClient.verifyServerToken(this.serverUrl, storedToken);
      if (isValid) {
        this._authToken = storedToken;
      } else {
        localStorage.removeItem('server-auth-token');
      }
    }

    this.updateServerAuthUI();
  }

  private setupMessageHandlers(): void {
    // 处理连接响应
    this.wakuClient.onMessage('connection_response', (message: WakuMessage) => {
      console.log('Connection response received:', message.data);
      const response = message as ConnectionResponse;
      this.handleConnectionResponse(response);
    });

    // 处理签名响应
    this.wakuClient.onMessage('sign_response', (message: WakuMessage) => {
      console.log('Sign response received:', message.data);
      const response = message as SignResponse;
      this.handleSignResponse(response);
    });
  }

  async connect(): Promise<void> {
    const sessionId = generateSessionId();
    
    // 设置DApp地址
    const dappAddress = `dapp_${Date.now()}`;
    this.wakuClient.setAddress(dappAddress);

    // 定义DApp元数据
    const metadata: DAppMetadata = {
      name: 'WalletConnect Waku DApp',
      description: 'A sample DApp using WalletConnect over Waku',
      url: 'https://walletconnect-waku.example.com',
      icons: ['https://walletconnect-waku.example.com/icon.png']
    };

    // 定义所需的命名空间
    const requiredNamespaces = {
      eip155: {
        chains: ['eip155:1', 'eip155:137'],
        methods: ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'],
        events: ['accountsChanged', 'chainChanged']
      } as Namespace
    };

    // 创建连接请求 - 需要指定目标钱包地址
    const walletAddress = this.getWalletAddressFromUI(); // 需要从UI获取钱包地址
    if (!walletAddress) {
      throw new Error('Please specify wallet address to connect to');
    }

    const connectionRequest: ConnectionRequest = createBaseMessage(
      'connection_request',
      dappAddress,
      walletAddress,
      sessionId,
      {
        metadata,
        requiredNamespaces
      }
    ) as ConnectionRequest;

    this.pendingRequests.set(sessionId, connectionRequest);
    await this.wakuClient.sendMessage(connectionRequest);

    console.log('Connection request sent');
    this.updateUI('Connection request sent. Please check your wallet.');
  }

  private handleConnectionResponse(response: ConnectionResponse): void {
    const sessionId = response.sessionId;
    
    if (response.data.approved && response.data.session) {
      const session: Session = response.data.session;
      this.sessions.set(session.id, session);
      this.pendingRequests.delete(sessionId);
      // 设置钱包地址到 WakuClient
      if (session.accounts.length > 0) {
        this.wakuClient.setConnectedWallet(response.from); // 设置连接的钱包地址
      }

      console.log('Session approved:', session);
      this.updateUI(`Connected to wallet: ${session.accounts[0]}`);
      this.showConnectedState(session);
    } else {
      console.log('Session rejected:', response.data.error);
      this.updateUI('Connection rejected by wallet');
      this.pendingRequests.delete(sessionId);
    }
  }

  async signMessage(message: string): Promise<void> {
    const activeSession = Array.from(this.sessions.values())[0];
    if (!activeSession) {
      throw new Error('No active session');
    }

    const sessionId = generateSessionId();
    const walletAddress = this.getConnectedWalletAddress();
    
    if (!walletAddress) {
      throw new Error('No wallet connected');
    }

    const signRequest: SignRequest = createBaseMessage(
      'sign_request',
      this.wakuClient.address!,
      walletAddress,
      sessionId,
      {
        method: 'personal_sign' as const,
        params: [message, activeSession.accounts[0]],
        displayInfo: {
          description: 'Sign this message to verify your identity',
          messageType: 'message'
        }
      }
    ) as SignRequest;

    this.pendingRequests.set(sessionId, signRequest);
    await this.wakuClient.sendMessage(signRequest);

    console.log('Sign request sent');
    this.updateUI('Sign request sent. Please check your wallet.');
  }

  private handleSignResponse(response: SignResponse): void {
    const sessionId = response.sessionId;

    if (response.data.signature) {
      console.log('Message signed:', response.data.signature);
      this.updateUI(`Message signed: ${response.data.signature}`);
    } else {
      console.log('Sign request rejected:', response.data.error);
      this.updateUI('Sign request rejected by wallet');
    }
    this.pendingRequests.delete(sessionId);
  }

  private updateUI(message: string): void {
    const statusElement = document.getElementById('status');
    if (statusElement) {
      statusElement.textContent = message;
    }
  }

  private showConnectedState(session: Session): void {
    const connectButton = document.getElementById('connect-button') as HTMLButtonElement;
    const signButton = document.getElementById('sign-button') as HTMLButtonElement;
    const accountElement = document.getElementById('account');

    if (connectButton) {
      connectButton.textContent = 'Connected';
      connectButton.disabled = true;
    }

    if (signButton) {
      signButton.disabled = false;
    }

    if (accountElement) {
      accountElement.textContent = `Account: ${session.accounts[0]}`;
    }
  }

  async disconnect(): Promise<void> {
    this.sessions.clear();
    this.pendingRequests.clear();
    
    const connectButton = document.getElementById('connect-button') as HTMLButtonElement;
    const signButton = document.getElementById('sign-button') as HTMLButtonElement;
    const accountElement = document.getElementById('account');

    if (connectButton) {
      connectButton.textContent = 'Connect Wallet';
      connectButton.disabled = false;
    }

    if (signButton) {
      signButton.disabled = true;
    }

    if (accountElement) {
      accountElement.textContent = '';
    }

    this.updateUI('Disconnected');
  }

  async authenticateWithServer(): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Please connect wallet first');
    }

    try {
      this.updateStatus('Requesting server authentication...');
      
      const token = await this.wakuClient.requestServerAuth(this.serverUrl);
      this._authToken = token;
      
      // 存储token到localStorage
      localStorage.setItem('server-auth-token', token);
      
      this.updateStatus('Server authentication successful!');
      this.updateServerAuthUI();

      console.log('Server authentication successful');
    } catch (error: any) {
      this.updateStatus(`Server authentication failed: ${error.message}`);
      console.error('Server authentication failed:', error);
      throw error;
    }
  }

  async callProtectedAPI(endpoint: string, options: RequestInit = {}): Promise<any> {
    if (!this._authToken) {
      throw new Error('Not authenticated with server');
    }

    const response = await fetch(`${this.serverUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${this._authToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired, clear it
        this._authToken = null;
        localStorage.removeItem('server-auth-token');
        this.updateServerAuthUI();
        throw new Error('Authentication expired, please login again');
      }
      throw new Error(`API call failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getUserData(): Promise<any> {
    return this.callProtectedAPI('/api/user/data');
  }

  async updateUserPreferences(preferences: any): Promise<any> {
    return this.callProtectedAPI('/api/user/preferences', {
      method: 'POST',
      body: JSON.stringify(preferences)
    });
  }

  private updateServerAuthUI(): void {
    const authButton = document.getElementById('server-auth-button');
    const authStatus = document.getElementById('server-auth-status');
    const protectedSection = document.getElementById('protected-section');

    if (authButton && authStatus && protectedSection) {
      if (this._authToken) {
        authButton.textContent = 'Logout from Server';
        authStatus.textContent = 'Authenticated with server';
        authStatus.className = 'status success';
        protectedSection.style.display = 'block';
      } else {
        authButton.textContent = 'Login to Server';
        authStatus.textContent = 'Not authenticated with server';
        authStatus.className = 'status';
        protectedSection.style.display = 'none';
      }
    }
  }

  async logoutFromServer(): Promise<void> {
    this._authToken = null;
    localStorage.removeItem('server-auth-token');
    this.updateServerAuthUI();
    this.updateStatus('Logged out from server');
  }

  // 从UI获取钱包地址
  private getWalletAddressFromUI(): string | null {
    const walletInput = document.getElementById('wallet-address') as HTMLInputElement;
    return walletInput?.value?.trim() || null;
  }

  // 获取已连接的钱包地址
  private getConnectedWalletAddress(): string | null {
    const activeSession = Array.from(this.sessions.values())[0];
    if (!activeSession) return null;
    
    // 从会话中获取钱包地址，或者从存储的连接信息中获取
    return activeSession.accounts[0] || null;
  }
}

