export enum SignMethod {
  ETH_SIGN = 'eth_sign',
  PERSONAL_SIGN = 'personal_sign',
  ETH_SIGN_TYPED_DATA = 'eth_signTypedData',
  ETH_SIGN_TYPED_DATA_V3 = 'eth_signTypedData_v3',
  ETH_SIGN_TYPED_DATA_V4 = 'eth_signTypedData_v4',
  ETH_SEND_TRANSACTION = 'eth_sendTransaction',
  ETH_SIGN_TRANSACTION = 'eth_signTransaction',
}

export enum SessionMethod {
  SESSION_REQUEST = 'wc_sessionRequest',
  SESSION_APPROVE = 'wc_sessionApprove',
  SESSION_REJECT = 'wc_sessionReject',
  SESSION_UPDATE = 'wc_sessionUpdate',
  SESSION_DELETE = 'wc_sessionDelete',
}

export const DEFAULT_METHODS = [
  SignMethod.ETH_SIGN,
  SignMethod.PERSONAL_SIGN,
  SignMethod.ETH_SIGN_TYPED_DATA_V4,
  SignMethod.ETH_SEND_TRANSACTION,
];

export const DEFAULT_NOTIFICATIONS = ['accountsChanged', 'chainChanged'];

export function isSignMethod(method: string): boolean {
  return Object.values(SignMethod).includes(method as SignMethod);
}

export function isSessionMethod(method: string): boolean {
  return Object.values(SessionMethod).includes(method as SessionMethod);
}

