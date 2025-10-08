export interface WalletMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

// 修改为不继承 WakuMessage，而是定义数据结构
export interface ServerAuthRequestData {
  challenge: string;
  serverUrl: string;
  timestamp: number;
}

export interface ServerAuthResponseData {
  success: boolean;
  signature?: string;
  error?: string;
  walletAddress?: string;
}

export interface ServerAuthResponse {
  type: 'server_auth_response';
  id: string;
  from: string;
  to: string;
  sessionId: string;
  timestamp: number;
  data: ServerAuthResponseData;
}
