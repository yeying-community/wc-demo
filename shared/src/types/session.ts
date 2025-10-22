import { Reason } from './common';
import { IRelay, RelayProtocol } from './relay';

/**
 * Session 元数据
 */
export interface SessionMetadata {
  name: string;             // 应用名称
  description: string;      // 应用描述
  url: string;              // 应用 URL
  icons: string[];          // 应用图标
  verifyUrl?: string;       // 验证 URL
  redirect?: {              // 重定向配置
    native?: string;
    universal?: string;
  };
}

/**
 * Session 命名空间
 */
export interface SessionNamespace {
  chains: string[];         // 支持的链 ID，如 ['eip155:1', 'eip155:137']
  methods: string[];        // 支持的方法，如 ['eth_sendTransaction', 'personal_sign']
  events: string[];         // 支持的事件，如 ['chainChanged', 'accountsChanged']
  accounts?: string[];      // 账户列表（可选）
}

/**
 * Session 命名空间集合
 */
export interface SessionNamespaces {
  [namespace: string]: SessionNamespace;
}

/**
 * Session 状态
 */
export enum SessionStatus {
  PROPOSED = 'proposed',    // 已提议
  SETTLED = 'settled',      // 已建立
  DISCONNECTED = 'disconnected', // 已断开
  EXPIRED = 'expired'       // 已过期
}

/**
 * Session 方法（消息类型）
 */
export enum SessionMethod {
  PROPOSE = 'wc_sessionPropose',      // 提议 Session
  SETTLE = 'wc_sessionSettle',        // 建立 Session
  REJECT = 'wc_sessionReject',        // 拒绝 Session
  UPDATE = 'wc_sessionUpdate',        // 更新 Session
  EXTEND = 'wc_sessionExtend',        // 延长 Session
  DELETE = 'wc_sessionDelete',        // 删除 Session
  PING = 'wc_sessionPing',            // Ping
  REQUEST = 'wc_sessionRequest',      // 请求
  RESPONSE = 'wc_sessionResponse',    // 响应
  EVENT = 'wc_sessionEvent'           // 事件
}

/**
 * Session 提议者信息
 */
export interface SessionPeer {
  publicKey: string;         // 节点公钥
  metadata: SessionMetadata; // 回话元数据
}

/**
 * Session 提议
 */
export interface SessionProposal {
  proposalId: number;                     // 提议 ID
  pairingTopic: string;                   // 配对主题
  proposer: SessionPeer;                  // 提议者信息
  requiredNamespaces: SessionNamespaces;  // 必需的命名空间
  optionalNamespaces?: SessionNamespaces; // 可选的命名空间
  relay: RelayProtocol;                   // Relay 协议（单数）
  relays?: RelayProtocol[];               // 备用 Relay 列表（可选）
  expiryTimestamp: number;                // 过期时间戳
}

/**
 * Session Settle 消息参数
 */
export interface SessionSettle {
  proposalId: number;                   // 提议 ID
  pairingTopic: string;                 // 配对主题
  relay: RelayProtocol;                 // Relay 协议（单数）
  namespaces: SessionNamespaces;        // 批准的命名空间
  requiredNamespaces: SessionNamespaces;
  optionalNamespaces?: SessionNamespaces;
  controller: SessionPeer;
  expiry: number;
  accounts?: string[];                  // 账户列表
}

/**
 * Session 拒绝参数
 */
export interface SessionReject {
  proposalId: number;                   // 提议 ID
  reason: Reason
}

/**
 * Session 数据
 */
export interface SessionData {
  topic: string;                        // Session 主题
  pairingTopic: string;                 // 配对主题
  relay: RelayProtocol;                 // Relay 信息
  expiry: number;                       // 过期时间
  acknowledged: boolean;                // 是否已确认
  controller: string;                   // 控制者公钥
  namespaces: SessionNamespaces;        // 已批准的命名空间
  requiredNamespaces: SessionNamespaces; // 必需的命名空间（保留用于验证）
  optionalNamespaces?: SessionNamespaces; // 可选的命名空间（保留用于验证）
  self: {                               // 自身信息
    publicKey: string;
    metadata: SessionMetadata;
  };
  peer: {                               // 对等方信息
    publicKey: string;
    metadata: SessionMetadata;
  };
  status: SessionStatus;                // Session 状态
  createdAt: number;                    // 创建时间
  updatedAt: number;                    // 更新时间
  proposalId?: number;                  // 对应的提议 ID（用于追踪）
}

/**
 * Session 请求
 */
export interface SessionRequest {
  id: number;                           // 请求 ID
  topic: string;                        // Session 主题
  method: string;                       // 方法名
  params: any;                          // 参数
  chainId?: string;                     // 链 ID
}

/**
 * Session 响应
 */
export interface SessionResponse {
  id: number;                           // 请求 ID
  topic: string;                        // Session 主题
  result?: any;                         // 成功结果
  error?: Reason;
}

/**
 * Session 事件数据
 */
export interface SessionEventData {
  topic: string;                        // Session 主题
  event: {
    name: string;                       // 事件名
    data: any;                          // 事件数据
  };
  chainId: string;                      // 链 ID
}

/**
 * Session 更新
 */
export interface SessionUpdate {
  topic: string;                        // Session 主题
  namespaces: SessionNamespaces;        // 新的命名空间
}

/**
 * Session 扩展
 */
export interface SessionExtend {
  topic: string;                        // Session 主题
  expiry: number;                       // 新的过期时间
}

/**
 * Session Ping
 */
export interface SessionPing {
  topic: string;                        // Session 主题
  id: number;                           // Ping ID
}

/**
 * Session 断开
 */
export interface SessionDisconnect {
  topic: string;                        // Session 主题
  reason: {
    code: number;
    message: string;
  };
}

/**
 * Session 消息类型
 */
export interface SessionMessage {
  method: SessionMethod;
  params: any;
}

export interface ApproveSessionParams {
  proposalId: number;                   // 提议 ID
  namespaces: SessionNamespaces;        // 批准的命名空间
  relayProtocol?: string;               // Relay 协议
  accounts?: string[];                  // 账户列表
}

export interface ProposeSessionParams {
  pairingTopic: string;                   // 配对主题
  requiredNamespaces: SessionNamespaces;  // 必需的命名空间
  optionalNamespaces?: SessionNamespaces; // 可选的命名空间
  relays?: RelayProtocol[];               // Relay 协议列表
}

export interface RejectSessionParams {
  proposalId: number;                   // 提议 ID
  reason: Reason;
}

/**
 * Session 存储接口
 */
export interface ISessionStore {
  // Session 数据操作
  set(topic: string, session: SessionData): Promise<void>;
  get(topic: string): Promise<SessionData | undefined>;
  getAll(): Promise<SessionData[]>;
  delete(topic: string): Promise<void>;

  // Session 提议操作
  setProposal(id: number, proposal: SessionProposal): Promise<void>;
  getProposal(id: number): Promise<SessionProposal | undefined>;
  getAllProposals(): Promise<SessionProposal[]>;
  deleteProposal(id: number): Promise<void>;

  // 清理操作
  clear(): Promise<void>;
}

/**
 * Session Manager 接口
 */
export interface ISessionManager {
  // 初始化
  init(relay: IRelay): Promise<void>;

  // Session 提议
  propose(params: ProposeSessionParams): Promise<SessionProposal>;
  reject(params: RejectSessionParams): Promise<void>;
  approve(params: ApproveSessionParams): Promise<SessionData>;

  // Session 操作
  update(params: SessionUpdate): Promise<void>;
  extend(params: SessionExtend): Promise<void>;
  disconnect(params: SessionDisconnect): Promise<void>;
  ping(topic: string): Promise<void>;

  // Session 请求
  request(request: Omit<SessionRequest, 'id'>): Promise<any>;
  respond(response: SessionResponse): Promise<void>;

  // Session 查询
  get(topic: string): SessionData | undefined;
  getAll(): SessionData[];
  find(predicate: (session: SessionData) => boolean): SessionData | undefined;

  // 清理
  cleanup(): Promise<void>;
}

/**
 * Session 错误代码
 */
export enum SessionErrorCode {
  // 提议错误
  INVALID_PROPOSAL = 1000,
  PROPOSAL_EXPIRED = 1001,
  PROPOSAL_NOT_FOUND = 1002,

  // Session 错误
  SESSION_NOT_FOUND = 2000,
  SESSION_EXPIRED = 2001,
  SESSION_SETTLED = 2002,

  // 命名空间错误
  UNSUPPORTED_CHAINS = 3000,
  UNSUPPORTED_METHODS = 3001,
  UNSUPPORTED_EVENTS = 3002,
  UNSUPPORTED_ACCOUNTS = 3003,

  // 请求错误
  INVALID_REQUEST = 4000,
  INVALID_METHOD = 4001,
  INVALID_PARAMS = 4002,

  // 用户错误
  USER_REJECTED = 5000,
  USER_DISCONNECTED = 5001,

  // 其他错误
  UNKNOWN_ERROR = 9999
}

/**
 * Session 错误
 */
export class SessionError extends Error {
  constructor(
    public code: SessionErrorCode,
    message: string,
    public data?: any
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

