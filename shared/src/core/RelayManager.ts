import { IRelay, RelayConfig } from '../types/relay';
import { WakuRelay } from '../relay/waku';

/**
 * Relay 管理器
 * 负责创建和管理 Relay 实例
 */
export class RelayManager {
  private relay: IRelay | null = null;
  private config: RelayConfig;

  constructor(config: Partial<RelayConfig> = {}) {
    this.config = {
      protocol: 'waku',
      connectionTimeout: 5000,
      ...config
    };
  }

  /**
   * 获取或创建 Relay 实例
   */
  async getRelay(): Promise<IRelay> {
    if (!this.relay) {
      this.relay = await this.createRelay();
    }
    return this.relay;
  }

  /**
   * 创建 Relay 实例
   */
  private async createRelay(): Promise<IRelay> {
    console.log('[RelayManager] Creating relay instance...');
    // 目前只支持 Waku
    if (this.config.protocol !== 'waku') {
      throw new Error(`Unsupported relay protocol: ${this.config.protocol}`);
    }

    const relay = new WakuRelay(this.config);
    
    // 初始化并启动
    await relay.init();
    await relay.start();

    console.log('[RelayManager] Relay instance created and started');
    return relay;
  }

  /**
   * 销毁 Relay 实例
   */
  async destroy(): Promise<void> {
    if (this.relay) {
      console.log('[RelayManager] Destroying relay instance...');
      await this.relay.stop();
      this.relay = null;
    }
  }

  /**
   * 检查 Relay 是否已连接
   */
  isConnected(): boolean {
    return this.relay?.isConnected() ?? false;
  }

  /**
   * 获取当前协议信息
   */
  getProtocol() {
    return this.relay?.getProtocol();
  }
}

