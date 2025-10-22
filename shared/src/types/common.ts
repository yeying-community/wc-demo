export interface Reason {
    code: number;
    message: string;
    data?: any;
}

/**
 * Pairing 事件类型
 */
export enum PairingEvent {
  CREATED = 'pairing_created',      // Pairing 创建（DApp 端）
  ACTIVATED = 'pairing_activated',  // Pairing 激活（Wallet 端）
  APPROVED = 'pairing_approved',    // Pairing 批准
  REJECTED = 'pairing_rejected',    // Pairing 拒绝
  DELETED = 'pairing_deleted',      // Pairing 删除
  UPDATED = 'pairing_updated',      // Pairing 更新
  EXPIRED = 'pairing_expired',      // Pairing 过期
  
  PING = 'pairing_ping',            // 收到 ping
  PONG = 'pairing_pong',            // 收到 pong
}

/**
 * Session 事件类型
 */
export enum SessionEvent {
  PROPOSAL = 'session_proposal',      // 收到 session 提议 from dapp
  SETTLED = 'session_settled',        // Session 已建立 from Wallet
  REJECTED = 'session_rejected',      // Session 已拒绝
  UPDATED = 'session_updated',        // Session 已更新
  EXTENDED = 'session_extended',      // Session 已延长
  DELETED = 'session_deleted',        // Session 已删除

  PING = 'session_ping',            // 收到 Ping
  PONG = 'session_pong',            // 收到 Pong

  REQUEST = 'session_request',        // 收到请求
  EVENT_RECEIVED = 'session_event',   // 收到事件
  EXPIRED = 'session_expired'         // Session 已过期
}

