import { RelayProtocol } from '../types/relay';
import { PairingURI } from '../types/pairing';

/**
 * Pairing URI 工具类
 * 
 * 职责：
 * - 生成 WalletConnect URI
 * - 解析 WalletConnect URI
 * - 验证 URI 格式
 */
export class PairingURIUtil {
  private static readonly PROTOCOL = 'wc';
  private static readonly VERSION = 2;

  /**
   * 生成 Pairing URI
   * 
   * 格式: wc:{topic}@{version}?relay-protocol={protocol}&symKey={key}
   * 
   * @param topic - Pairing topic
   * @param symKey - 对称密钥（hex 格式）
   * @param relay - 中继协议配置
   * @returns URI 字符串
   */
  static encode(
    topic: string,
    symKey: string,
    relay: RelayProtocol
  ): string {
    // 验证参数
    if (!topic || !symKey || !relay) {
      throw new Error('Missing required parameters for URI encoding');
    }

    // 构建查询参数
    const params = new URLSearchParams({
      'relay-protocol': relay.protocol,
      'symKey': symKey
    });

    // 添加可选的 relay data
    if (relay.data) {
      params.append('relay-data', relay.data);
    }

    // 构建完整 URI
    const uri = `${this.PROTOCOL}:${topic}@${this.VERSION}?${params.toString()}`;
    
    return uri;
  }

  /**
   * 解析 Pairing URI
   * 
   * @param uri - URI 字符串
   * @returns 解析后的 PairingURI 对象
   * @throws 如果 URI 格式无效
   */
  static decode(uri: string): PairingURI {
    try {
      // 验证协议前缀
      if (!uri.startsWith(`${this.PROTOCOL}:`)) {
        throw new Error(`Invalid protocol. Expected "${this.PROTOCOL}:"`);
      }

      // 移除协议前缀
      const content = uri.substring(this.PROTOCOL.length + 1);

      // 分离 topic@version 和查询参数
      const [topicVersion, queryString] = content.split('?');
      
      if (!topicVersion || !queryString) {
        throw new Error('Invalid URI format');
      }

      // 解析 topic 和 version
      const [topic, versionStr] = topicVersion.split('@');
      
      if (!topic || !versionStr) {
        throw new Error('Missing topic or version');
      }

      const version = parseInt(versionStr, 10);
      
      if (version !== this.VERSION) {
        throw new Error(`Unsupported version: ${version}`);
      }

      // 解析查询参数
      const params = new URLSearchParams(queryString);
      const relayProtocol = params.get('relay-protocol');
      const symKey = params.get('symKey');
      const relayData = params.get('relay-data');

      if (!relayProtocol || !symKey) {
        throw new Error('Missing required query parameters');
      }

      // 构建返回对象
      const result: PairingURI = {
        topic,
        version,
        symKey,
        relay: {
          protocol: relayProtocol,
          data: relayData || undefined
        }
      };

      return result;
    } catch (error) {
      throw new Error(`Failed to parse URI: ${error}`);
    }
  }

  /**
   * 验证 URI 格式
   * 
   * @param uri - URI 字符串
   * @returns 是否有效
   */
  static validate(uri: string): boolean {
    try {
      this.decode(uri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 从 URI 提取 topic
   * 
   * @param uri - URI 字符串
   * @returns topic 字符串
   */
  static extractTopic(uri: string): string {
    const parsed = this.decode(uri);
    return parsed.topic;
  }

  /**
   * 从 URI 提取 symKey
   * 
   * @param uri - URI 字符串
   * @returns symKey 字符串
   */
  static extractSymKey(uri: string): string {
    const parsed = this.decode(uri);
    return parsed.symKey;
  }
}
