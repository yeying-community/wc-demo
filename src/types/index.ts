export interface SessionRequest {
  id: string;
  topic: string;
  method: string;
  params: {
    requiredNamespaces: Record<string, Namespace>;
    optionalNamespaces?: Record<string, Namespace>;
    sessionProperties?: Record<string, string>;
  };
  metadata: AppMetadata;
}

export interface Namespace {
  chains: string[];
  methods: string[];
  events: string[];
  accounts?: string[];
}

export interface AppMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

export interface Session {
  id: string;
  topic: string;
  accounts: string[];
  namespaces: Record<string, Namespace>;
  metadata: AppMetadata;
  createdAt: number;
  expiresAt: number;
  active: boolean;
}

export interface SignRequest {
  id: string;
  sessionId: string;
  method: string;
  params: any[];
}

export interface WakuMessage {
  type: 'session_request' | 'session_response' | 'sign_request' | 'sign_response';
  sessionId: string;
  data: any;
  timestamp: number;
}

export interface JWTPayload {
  address: string;
  sessionId: string;
  iat: number;
  exp: number;
}
