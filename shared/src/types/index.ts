// 基础类型
export type ChainId = string;
export type Address = string;
export type Hex = string;

// 会话相关
export interface SessionProposal {
  id: string;
  proposer: {
    publicKey: string;
    metadata: AppMetadata;
  };
  permissions: {
    chains: ChainId[];
    methods: string[];
    notifications: string[];
  };
  relay: RelayProtocol;
  ttl: number;
}

export interface SessionApproval {
  id: string;
  responder: {
    publicKey: string;
    metadata: AppMetadata;
  };
  accounts: string[];
  expiry: number;
}

export interface SessionRequest {
  id: string;
  topic: string;
  params: {
    request: {
      method: string;
      params: any;
    };
    chainId: string;
  };
}

export interface Session {
  topic: string;
  pairingTopic: string;
  relay: RelayProtocol;
  expiry: number;
  acknowledged: boolean;
  controller: {
    publicKey: string;
    metadata: AppMetadata;
  };
  peer: {
    publicKey: string;
    metadata: AppMetadata;
  };
  permissions: {
    chains: ChainId[];
    methods: string[];
    accounts: string[];
  };
  sharedKey: string;
}

// 应用元数据
export interface AppMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

// 中继协议
export interface RelayProtocol {
  protocol: string;
  data?: string;
}

// 请求/响应
export interface JsonRpcRequest {
  id: number;
  jsonrpc: '2.0';
  method: string;
  params: any;
}

export interface JsonRpcResponse {
  id: number;
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface RequestPayload {
  topic: string;
  chainId: ChainId;
  request: JsonRpcRequest;
}

export interface ResponsePayload {
  topic: string;
  response: JsonRpcResponse;
}

// 签名方法参数
export interface TransactionRequest {
  from: Address;
  to?: Address;
  data?: Hex;
  gas?: Hex;
  gasPrice?: Hex;
  value?: Hex;
  nonce?: Hex;
}

export interface TypedData {
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  domain: {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
  };
  message: Record<string, any>;
}

// 事件类型
export enum ClientEvent {
  SESSION_PROPOSAL = 'session_proposal',
  SESSION_APPROVE = 'session_approve',
  SESSION_REJECT = 'session_reject',
  SESSION_UPDATE = 'session_update',
  SESSION_DELETE = 'session_delete',
  SESSION_REQUEST = 'session_request',
  SESSION_RESPONSE = 'session_response',
  PAIRING_PROPOSAL = 'pairing_proposal',
}

// 错误码
export enum ErrorCode {
  INVALID_REQUEST = 1000,
  UNAUTHORIZED = 1001,
  METHOD_NOT_SUPPORTED = 1002,
  INVALID_PARAMS = 1003,
  USER_REJECTED = 5000,
  SESSION_NOT_FOUND = 6000,
  SESSION_EXPIRED = 6001,
}

// 配置
export interface ClientConfig {
  metadata: AppMetadata;
  storage?: IStorage;
  transport?: ITransport;
  logger?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
}

// 接口定义
export interface IStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ITransport {
  connect(): Promise<void>;
  publish(topic: string, message: string, useQueue: boolean): Promise<void>;
  subscribe(topic: string, callback: (message: string) => void): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  disconnect(): Promise<void>;
}

