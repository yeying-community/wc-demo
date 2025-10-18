import { DappClient, DappConfig, SessionData, Logger } from 'walletconnect-waku-sdk';
import QRCode from 'qrcode';
export interface DAppMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

export class DApp {
  private client: DappClient;
  private logger: Logger;
  private currentSession?: SessionData;
  private qrCodeData?: string;

  constructor(config?: DappConfig) {
    this.logger = new Logger('DApp');

    // 初始化 DApp 客户端
    this.client = new DappClient({
      ...config,
      name: 'WalletConnect Waku DApp',
      description: 'A sample DApp using WalletConnect over Waku',
      url: 'https://walletconnect-waku.example.com',
      icons: ['https://walletconnect-waku.example.com/icon.png'],
      requiredChains: ['eip155:1', 'eip155:137'], // Ethereum 和 Polygon
      optionalChains: ['eip155:56'], // BSC
      requiredMethods: [
        'eth_sendTransaction',
        'personal_sign',
        'eth_signTypedData_v4'
      ],
      optionalMethods: [
        'eth_signTransaction',
        'wallet_switchEthereumChain'
      ]
    });

    this.setupEventListeners();
  }

  /**
   * 初始化 DApp
   */
  async initialize(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.info('DApp initialized successfully');
      this.updateStatus('DApp initialized. Ready to connect.');
    } catch (error) {
      this.logger.error('Failed to initialize DApp:', error);
      this.updateStatus('Failed to initialize DApp');
      throw error;
    }
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 配对批准
    this.client.on('pairing_approved', (data) => {
      this.logger.info('Pairing approved:', data);
      this.updateStatus('Pairing approved. Waiting for session approval...');
    });

    // 配对拒绝
    this.client.on('pairing_rejected', (data) => {
      this.logger.error('Pairing rejected:', data);
      this.updateStatus('Pairing rejected by wallet');
      this.hideQRCode();
    });

    // 会话批准
    this.client.on('session_approved', (session: SessionData) => {
      this.logger.info('Session approved:', session);
      this.currentSession = session;
      this.updateStatus('Connected to wallet');
      this.showConnectedState();
      this.hideQRCode();
    });

    // 会话拒绝
    this.client.on('session_rejected', (data) => {
      this.logger.error('Session rejected:', data);
      this.updateStatus('Session rejected by wallet');
      this.hideQRCode();
    });

    // 会话更新
    this.client.on('session_updated', (session: SessionData) => {
      this.logger.info('Session updated:', session);
      this.currentSession = session;
      this.updateStatus('Session updated');
    });

    // 会话删除
    this.client.on('session_deleted', () => {
      this.logger.info('Session deleted');
      this.currentSession = undefined;
      this.updateStatus('Disconnected from wallet');
      this.showDisconnectedState();
    });

    // 会话提案
    this.client.on('session_proposed', (data) => {
      this.logger.info('Session proposed:', data);
      this.updateStatus('Session proposal sent. Please approve in your wallet.');
    });
  }

  /**
   * 创建连接（生成 QR 码）
   */
  async createConnection(): Promise<string> {
    try {
      this.updateStatus('Creating connection...');

      // 创建连接 URI
      const connectionURI = await this.client.createConnectionURI();
      this.qrCodeData = connectionURI.uri;

      // 显示 QR 码
      this.showQRCode(this.qrCodeData);

      // 发起配对
      await this.client.pair();

      this.updateStatus('Scan QR code with your wallet to connect');
      return connectionURI.uri;
    } catch (error) {
      this.logger.error('Failed to create connection:', error);
      this.updateStatus('Failed to create connection');
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
  }): Promise<string> {
    try {
      if (!this.currentSession) {
        throw new Error('No active session. Please connect first.');
      }

      this.updateStatus('Sending transaction request...');

      const chainId = this.client.getChainId() || 'eip155:1';
      const accounts = this.client.getAccounts();

      if (accounts.length === 0) {
        throw new Error('No accounts available');
      }

      const from = accounts[0].split(':')[2]; // 从 "eip155:1:0x..." 中提取地址

      const result = await this.client.request({
        chainId,
        method: 'eth_sendTransaction',
        params: [{
          from,
          to: params.to,
          value: params.value,
          data: params.data || '0x',
          gas: params.gas
        }]
      });

      this.updateStatus('Transaction sent successfully');
      this.logger.info('Transaction hash:', result);
      return result;
    } catch (error: any) {
      this.logger.error('Failed to send transaction:', error);
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

      const chainId = this.client.getChainId() || 'eip155:1';
      const accounts = this.client.getAccounts();

      if (accounts.length === 0) {
        throw new Error('No accounts available');
      }

      const address = accounts[0].split(':')[2];

      const result = await this.client.request({
        chainId,
        method: 'personal_sign',
        params: [message, address]
      });

      this.updateStatus('Message signed successfully');
      this.logger.info('Signature:', result);
      return result;
    } catch (error: any) {
      this.logger.error('Failed to sign message:', error);
      this.updateStatus(`Sign failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 签名类型化数据
   */
  async signTypedData(typedData: any): Promise<string> {
    try {
      if (!this.currentSession) {
        throw new Error('No active session. Please connect first.');
      }

      this.updateStatus('Sending typed data sign request...');

      const chainId = this.client.getChainId() || 'eip155:1';
      const accounts = this.client.getAccounts();

      if (accounts.length === 0) {
        throw new Error('No accounts available');
      }

      const address = accounts[0].split(':')[2];

      const result = await this.client.request({
        chainId,
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify(typedData)]
      });

      this.updateStatus('Typed data signed successfully');
      this.logger.info('Signature:', result);
      return result;
    } catch (error: any) {
      this.logger.error('Failed to sign typed data:', error);
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

      await this.client.request({
        chainId: this.client.getChainId() || 'eip155:1',
        method: 'wallet_switchEthereumChain',
        params: [{ chainId }]
      });

      this.updateStatus(`Switched to chain ${chainId}`);
    } catch (error: any) {
      this.logger.error('Failed to switch chain:', error);
      this.updateStatus(`Switch chain failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    try {
      if (!this.currentSession) {
        this.updateStatus('No active session');
        return;
      }

      this.updateStatus('Disconnecting...');
      await this.client.disconnectSession();
      this.currentSession = undefined;
      this.showDisconnectedState();
    } catch (error) {
      this.logger.error('Failed to disconnect:', error);
      this.updateStatus('Failed to disconnect');
      throw error;
    }
  }

  /**
   * 发送 ping
   */
  async ping(): Promise<void> {
    try {
      await this.client.ping();
      this.updateStatus('Ping sent');
    } catch (error) {
      this.logger.error('Failed to send ping:', error);
      this.updateStatus('Ping failed');
      throw error;
    }
  }

  /**
   * 获取当前账户
   */
  getAccounts(): string[] {
    return this.client.getAccounts();
  }

  /**
   * 获取当前链 ID
   */
  getChainId(): string | undefined {
    return this.client.getChainId();
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.client.isSessionActive();
  }

  /**
   * 获取会话信息
   */
  getSession(): SessionData | undefined {
    return this.client.getSession();
  }

  // UI 辅助方法

  private updateStatus(message: string): void {
    const statusElement = document.getElementById('status');
    if (statusElement) {
      statusElement.textContent = message;
    }
    this.logger.info('Status:', message);
  }

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
      });

      // 同时显示 URI 文本
      const uriText = document.getElementById('uri-text');
      if (uriText) {
        uriText.textContent = uri;
      }
    }
  }

  private hideQRCode(): void {
    const qrContainer = document.getElementById('qr-container');
    if (qrContainer) {
      qrContainer.style.display = 'none';
    }
  }

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
      const chainId = this.getChainId();
      accountInfo.innerHTML = `
        <p><strong>Account:</strong> ${accounts[0] || 'N/A'}</p>
        <p><strong>Chain:</strong> ${chainId || 'N/A'}</p>
      `;
      accountInfo.style.display = 'block';
    }
  }

  private showDisconnectedState(): void {
    const connectButton = document.getElementById('connect-button') as HTMLButtonElement;
    const disconnectButton = document.getElementById('disconnect-button') as HTMLButtonElement;
    const actionsSection = document.getElementById('actions-section');
    const accountInfo = document.getElementById('account-info');

    if (connectButton) {
      connectButton.disabled = false;
      connectButton.textContent = 'Connect Wallet';
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
}
