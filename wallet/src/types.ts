export interface WalletAccount {
  address: string;
  privateKey: string;
  balance?: string;
}

export interface AuthHistoryEntry {
  timestamp: number;
  dappName: string;
  dappUrl: string;
  action: 'pairing' | 'session' | 'request';
  success: boolean;
  details?: string;
}

export interface ActiveSession {
  topic: string;
  dappName: string;
  dappUrl: string;
  dappIcon?: string;
  chains: string[];
  methods: string[];
  connectedAt: number;
}

export interface PendingRequest {
  id: string;
  type: 'pairing' | 'session_proposal' | 'session_request';
  dappName: string;
  dappUrl: string;
  dappIcon?: string;
  timestamp: number;
  data: any;
}

export interface WalletSettings {
  autoApproveKnownDapps: boolean;
  showNotifications: boolean;
  trustedDapps: string[];
}

