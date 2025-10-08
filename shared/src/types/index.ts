/**
 * 基础消息接口
 * 所有消息都基于这个接口，包含基本的路由和标识信息
 */
export interface BaseMessage {
  /** 消息唯一标识符 */
  id: string;
  /** 消息类型 */
  type: string;
  /** 发送方地址/标识 */
  from: string;
  /** 接收方地址/标识 */
  to: string;
  /** 会话ID - 用于关联相关的请求和响应 */
  sessionId: string;
  /** 消息时间戳 */
  timestamp: number;
  /** 消息数据载荷 */
  data: any;
}

/**
 * 会话相关类型定义
 */

/** DApp元数据信息 */
export interface DAppMetadata {
  /** DApp名称 */
  name: string;
  /** DApp描述 */
  description: string;
  /** DApp网站URL */
  url: string;
  /** DApp图标列表 */
  icons: string[];
}

/** 区块链命名空间配置 */
export interface Namespace {
  /** 支持的区块链列表 (如: ["eip155:1", "eip155:137"]) */
  chains: string[];
  /** 支持的方法列表 (如: ["personal_sign", "eth_sendTransaction"]) */
  methods: string[];
  /** 支持的事件列表 (如: ["accountsChanged", "chainChanged"]) */
  events: string[];
  /** 关联的账户列表 (仅在响应中使用) */
  accounts?: string[];
}

/** 会话对象 - 表示DApp和钱包之间的连接状态 */
export interface Session {
  /** 会话唯一标识符 */
  id: string;
  /** 通信主题标识符 */
  topic: string;
  /** 已连接的账户列表 */
  accounts: string[];
  /** 命名空间配置 */
  namespaces: {
    /** EIP-155 以太坊命名空间 */
    eip155: Namespace;
    /** 可扩展其他命名空间 */
    [key: string]: Namespace;
  };
  /** DApp元数据 */
  metadata: DAppMetadata;
  /** 会话创建时间 */
  createdAt: number;
  /** 会话过期时间 */
  expiresAt: number;
  /** 会话是否活跃 */
  active: boolean;
}

/**
 * 连接相关消息类型
 * 用于DApp请求连接钱包的流程
 */

/** 连接请求 - DApp向钱包发起连接请求 */
export interface ConnectionRequest extends BaseMessage {
  type: 'connection_request';
  data: {
    /** DApp元数据信息 */
    metadata: DAppMetadata;
    /** 请求的命名空间配置 */
    requiredNamespaces: {
      eip155?: Namespace;
      [key: string]: Namespace | undefined;
    };
  };
}

/** 连接响应 - 钱包对连接请求的响应 */
export interface ConnectionResponse extends BaseMessage {
  type: 'connection_response';
  data: {
    /** 是否批准连接 */
    approved: boolean;
    /** 如果批准，返回会话信息 */
    session?: Session;
    /** 如果拒绝，返回错误信息 */
    error?: string;
  };
}

/**
 * 签名相关消息类型
 * 用于DApp请求钱包签名的流程
 */

/** 签名方法类型 */
export type SignMethod =
  | 'personal_sign'           // 个人签名
  | 'eth_sign'               // 以太坊签名
  | 'eth_signTypedData'      // 类型化数据签名 (v1)
  | 'eth_signTypedData_v3'   // 类型化数据签名 (v3)
  | 'eth_signTypedData_v4';  // 类型化数据签名 (v4)

/** 签名请求 - DApp向钱包发起签名请求 */
export interface SignRequest extends BaseMessage {
  type: 'sign_request';
  data: {
    /** 签名方法 */
    method: SignMethod;
    /** 签名参数 */
    params: string[];
    /** 可选的显示信息 */
    displayInfo?: {
      /** 人类可读的消息描述 */
      description?: string;
      /** 消息类型 (如: "message", "transaction") */
      messageType?: string;
    };
  };
}

/** 签名响应 - 钱包对签名请求的响应 */
export interface SignResponse extends BaseMessage {
  type: 'sign_response';
  data: {
    /** 如果成功，返回签名结果 */
    signature?: string;
    /** 如果失败，返回错误信息 */
    error?: string;
  };
}

/**
 * 服务器认证相关消息类型
 * 用于DApp通过钱包向后端服务器进行身份认证的流程
 */

/** 服务器认证请求 - DApp向钱包请求对服务器进行身份认证 */
export interface ServerAuthRequest extends BaseMessage {
  type: 'server_auth_request';
  data: {
    /** 服务器URL */
    serverUrl: string;
    /** 服务器提供的挑战字符串 */
    challenge: string;
    /** 需要签名的消息内容 */
    message: string;
    /** 可选的认证描述 */
    description?: string;
  };
}

/** 服务器认证响应 - 钱包对服务器认证请求的响应 */
export interface ServerAuthResponse extends BaseMessage {
  type: 'server_auth_response';
  data: {
    /** 如果成功，返回签名结果 */
    signature?: string;
    /** 如果失败，返回错误信息 */
    error?: string;
  };
}

/**
 * 会话管理相关消息类型
 */

/** 会话断开请求 */
export interface SessionDisconnectRequest extends BaseMessage {
  type: 'session_disconnect';
  data: {
    /** 断开原因 */
    reason: string;
  };
}

/** 会话更新请求 - 用于更新会话配置 */
export interface SessionUpdateRequest extends BaseMessage {
  type: 'session_update';
  data: {
    /** 更新的命名空间配置 */
    namespaces: {
      eip155?: Namespace;
      [key: string]: Namespace | undefined;
    };
  };
}

/** 会话更新响应 */
export interface SessionUpdateResponse extends BaseMessage {
  type: 'session_update_response';
  data: {
    /** 是否批准更新 */
    approved: boolean;
    /** 如果批准，返回更新后的会话信息 */
    session?: Session;
    /** 如果拒绝，返回错误信息 */
    error?: string;
  };
}

/**
 * 服务器API相关类型定义
 */

/** 登录挑战请求 */
export interface LoginChallengeRequest {
  /** 钱包地址 */
  address: string;
}

/** 登录挑战响应 */
export interface LoginChallengeResponse {
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 挑战数据 */
  data?: {
    /** 挑战字符串 */
    challenge: string;
    /** 需要签名的消息 */
    message: string;
  };
}

/** 登录请求 */
export interface LoginRequest {
  /** 钱包地址 */
  address: string;
  /** 签名结果 */
  signature: string;
  /** 挑战字符串 */
  challenge: string;
}

/** 登录响应 */
export interface LoginResponse {
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 登录数据 */
  data?: {
    /** 认证令牌 */
    token: string;
    /** 令牌过期时间 */
    expiresAt?: number;
  };
}

/** 令牌验证响应 */
export interface TokenVerifyResponse {
  /** 是否有效 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 用户信息 */
  data?: {
    /** 用户地址 */
    address: string;
    /** 令牌过期时间 */
    expiresAt: number;
  };
}

/**
 * 钱包内部状态管理类型
 */

/** 认证历史记录 */
export interface AuthHistory {
  /** 认证类型 */
  type: 'connection' | 'server_auth' | 'sign_request';
  /** DApp信息 */
  dapp: string;
  /** 服务器URL (仅服务器认证) */
  server?: string;
  /** 认证时间 */
  timestamp: number;
  /** 认证状态 */
  status: 'approved' | 'rejected';
  /** 请求详情 */
  details?: {
    /** 签名方法 (仅签名请求) */
    method?: SignMethod;
    /** 请求参数 */
    params?: string[];
  };
}

/**
 * 联合类型定义 - 用于类型安全的消息处理
 */

/** 所有请求消息类型 */
export type RequestMessage =
  | ConnectionRequest
  | SignRequest
  | ServerAuthRequest
  | SessionDisconnectRequest
  | SessionUpdateRequest;

/** 所有响应消息类型 */
export type ResponseMessage =
  | ConnectionResponse
  | SignResponse
  | ServerAuthResponse
  | SessionUpdateResponse;

/** 所有消息类型 */
export type WakuMessage = RequestMessage | ResponseMessage;

/**
 * 类型守卫函数 - 用于运行时类型检查
 */

/** 检查是否为连接请求 */
export function isConnectionRequest(message: BaseMessage): message is ConnectionRequest {
  return message.type === 'connection_request';
}

/** 检查是否为签名请求 */
export function isSignRequest(message: BaseMessage): message is SignRequest {
  return message.type === 'sign_request';
}

/** 检查是否为服务器认证请求 */
export function isServerAuthRequest(message: BaseMessage): message is ServerAuthRequest {
  return message.type === 'server_auth_request';
}

/** 检查是否为响应消息 */
export function isResponseMessage(message: BaseMessage): message is ResponseMessage {
  return message.type.endsWith('_response');
}

/**
 * 工具函数
 */

/** 生成唯一ID */
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 生成会话ID */
export function generateSessionId(): string {
  return `session_${generateId()}`;
}

/** 创建基础消息 */
export function createBaseMessage(
  type: string,
  from: string,
  to: string,
  sessionId: string,
  data: any
): BaseMessage {
  return {
    id: generateId(),
    type,
    from,
    to,
    sessionId,
    timestamp: Date.now(),
    data
  };
}

