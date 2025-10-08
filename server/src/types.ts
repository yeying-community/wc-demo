export interface LoginChallenge {
  challenge: string;
  message: string;
  expiresAt: number;
}

export interface LoginRequest {
  address: string;
  signature: string;
  challenge: string;
}

export interface AuthToken {
  token: string;
  expiresAt: number;
}

export interface UserProfile {
  address: string;
  loginCount: number;
  lastLogin: number;
  createdAt: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
