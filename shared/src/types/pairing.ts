/**
 * Pairing 相关类型定义
 * 职责：定义配对的数据结构和状态
 */

import { PairingEvent, Reason, SessionEvent } from "./common";
import { RelayProtocol } from "./relay";


/**
 * Pairing 状态
 */
export enum PairingStatus {
  PENDING = 'pending',    // 等待对方批准
  ACTIVE = 'active',      // 已激活，可以使用
  DELETED = 'deleted'     // 已删除
}

/**
 * 参与方信息
 */
export interface Participant {
  publicKey: string;      // 公钥（用于 ECDH）
  appMetadata?: AppMetadata; // 元数据（名称、图标等）
}

/**
 * 应用元数据
 */
export interface AppMetadata {
  name: string;           // 应用名称
  description: string;    // 应用描述
  url: string;            // 应用 URL
  icons: string[];        // 应用图标
}

/**
 * Pairing 数据结构
 * 
 * 职责：
 * - 存储加密通信所需的信息
 * - 不包含任何业务逻辑相关的信息
 */
export interface Pairing {
  // 基本信息
  topic: string;                    // 通信频道 ID（唯一标识）
  relay: RelayProtocol;             // 中继服务器配置

  // 参与方信息
  self: Participant;                // 本地参与方
  peer: Participant;                // 远程参与方

  // 状态信息
  status: PairingStatus;            // 当前状态
  expiry: number;                   // 过期时间（Unix 时间戳，秒）

  // 元数据
  createdAt: number;                // 创建时间
  updatedAt: number;                // 更新时间

  // 方向标识
  initiator: boolean;               // 是否是发起方（DApp 为 true，Wallet 为 false）
}

/**
 * Pairing URI 结构
 * 
 * 格式: wc:{topic}@{version}?relay-protocol={protocol}&symKey={key}
 * 例如: wc:abc123@2?relay-protocol=irn&symKey=def456
 */
export interface PairingURI {
  topic: string;                    // 通信频道
  version: number;                  // 协议版本（通常是 2）
  relay: RelayProtocol;             // 中继协议
  symKey: string;                   // 对称密钥（用于初始加密）
}

/**
 * 创建 Pairing 的参数
 */
export interface CreatePairingParams {
  relay?: RelayProtocol;            // 可选的中继配置
  appMetadata?: AppMetadata;           // 可选的元数据
  expiry?: number;                  // 可选的过期时间（秒数，默认 30 天）
}

/**
 * 创建 Pairing 的返回值
 */
export interface CreatePairingResult {
  topic: string;                    // Pairing topic
  uri: string;                      // Pairing URI（用于二维码）
  pairing: Pairing;
  approval: () => Promise<Pairing>; // 等待批准的 Promise
}

/**
 * 激活 Pairing 的参数（Wallet 端使用）
 */
export interface ActivatePairingParams {
  uri: string;                      // 从二维码解析的 URI
  appMetadata: AppMetadata;         // Wallet 的元数据
}

/**
 * Pairing 协议消息类型
 */
export enum PairingMethod {
  APPROVE = 'wc_pairingApprove',    // 钱包批准配对，单向
  REJECT = 'wc_pairingReject',      // 钱包拒绝配对，单向
  DELETE = 'wc_pairingDelete',      // 钱包或应用删除配对，
  PING = 'wc_pairingPing',          // 钱包或应用心跳检测
  UPDATE = 'wc_pairingUpdate',      // 钱包或应用更新元数据
}

/**
 * wc_pairingApprove 消息参数
 */
export interface PairingApproveParams {
  relay: RelayProtocol;
  responder: Participant;           // Wallet 的参与方信息
  expiry: number;
  state?: {
    appMetadata?: AppMetadata;
  };
}

/**
 * wc_pairingReject 消息参数
 */
export interface PairingRejectParams {
  reason: Reason
}

/**
 * wc_pairingDelete 消息参数
 */
export interface PairingDeleteParams {
  reason: Reason
}

/**
 * wc_pairingUpdate 消息参数
 */
export interface PairingUpdateParams {
  appMetadata: AppMetadata;
}

/**
 * Pairing 存储接口
 */
export interface IPairingStore {
  // 基本操作
  set(topic: string, pairing: Pairing): Promise<void>;
  get(topic: string): Promise<Pairing | undefined>;
  delete(topic: string): Promise<void>;
  getAll(): Promise<Pairing[]>;

  // 查询操作
  getActive(): Promise<Pairing[]>;
  getPending(): Promise<Pairing[]>;

  // 清理操作
  deleteExpired(): Promise<void>;
}

/**
 * Pairing 管理器接口
 */
export interface IPairingManager {
  // 创建和激活
  create(params?: CreatePairingParams): Promise<CreatePairingResult>;
  activate(params: ActivatePairingParams): Promise<Pairing>;

  // 查询
  get(topic: string): Promise<Pairing | undefined>;
  getAll(): Promise<Pairing[]>;
  getActive(): Promise<Pairing[]>;

  // 操作
  approve(topic: string, params: PairingApproveParams): Promise<void>;
  reject(topic: string, reason: string): Promise<void>;
  delete(topic: string, reason: string): Promise<void>;
  update(topic: string, metadata: AppMetadata): Promise<void>;
  ping(topic: string): Promise<void>;

  // Session 消息转发
  forward(topic: string, method: string, message: any): Promise<void>;

  // 事件
  on(event: PairingEvent | SessionEvent, callback: (data: any) => void): void;
  off(event: PairingEvent | SessionEvent, callback: (data: any) => void): void;
}

