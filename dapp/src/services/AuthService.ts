interface AuthResponse {
  success: boolean;
  data?: any;
  error?: string;
}

interface UserSession {
  address: string;
  token: string;
  expiresAt: number;
  user: {
    address: string;
    loginCount: number;
    lastLogin: number;
    createdAt: number;
  };
}

export class AuthService {
  private readonly API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3002';
  private session: UserSession | null = null;

  constructor() {
    this.restoreSession();
  }

  /**
   * 步骤 1: 从服务器获取挑战
   */
  async getChallenge(address: string): Promise<{ challenge: string; message: string }> {
    const response = await fetch(`${this.API_BASE_URL}/auth/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ address }),
    });

    const result: AuthResponse = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to get challenge');
    }

    return result.data;
  }

  /**
   * 步骤 2: 验证签名并登录
   */
  async verifyAndLogin(
    address: string, 
    signature: string, 
    challenge: string
  ): Promise<UserSession> {
    const response = await fetch(`${this.API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address,
        signature,
        challenge,
      }),
    });

    const result: AuthResponse = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Login verification failed');
    }

    const session: UserSession = {
      address: address.toLowerCase(),
      token: result.data.token,
      expiresAt: result.data.expiresAt,
      user: result.data.user,
    };

    this.saveSession(session);
    return session;
  }

  /**
   * 保存会话到 localStorage
   */
  private saveSession(session: UserSession): void {
    this.session = session;
    localStorage.setItem('auth_session', JSON.stringify(session));
  }

  /**
   * 从 localStorage 恢复会话
   */
  private restoreSession(): void {
    try {
      const stored = localStorage.getItem('auth_session');
      if (stored) {
        const session: UserSession = JSON.parse(stored);
        
        if (session.expiresAt > Date.now()) {
          this.session = session;
          console.log('[Auth] Session restored for', session.address);
        } else {
          console.log('[Auth] Session expired');
          this.logout();
        }
      }
    } catch (error) {
      console.error('[Auth] Failed to restore session:', error);
      this.logout();
    }
  }

  /**
   * 登出
   */
  logout(): void {
    this.session = null;
    localStorage.removeItem('auth_session');
    console.log('[Auth] Logged out');
  }

  /**
   * 获取当前会话
   */
  getSession(): UserSession | null {
    return this.session;
  }

  /**
   * 检查是否已登录
   */
  isAuthenticated(): boolean {
    return this.session !== null && this.session.expiresAt > Date.now();
  }

  /**
   * 获取认证 token
   */
  getAuthToken(): string | null {
    return this.session?.token || null;
  }

  /**
   * 验证当前 token 是否有效
   */
  async verifyToken(): Promise<boolean> {
    if (!this.session) return false;

    try {
      const response = await fetch(`${this.API_BASE_URL}/auth/verify`, {
        headers: {
          'Authorization': `Bearer ${this.session.token}`,
        },
      });

      const result: AuthResponse = await response.json();
      return result.success;
    } catch (error) {
      console.error('[Auth] Token verification failed:', error);
      return false;
    }
  }

  /**
   * 获取用户资料
   */
  async getUserProfile(): Promise<any> {
    if (!this.session) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${this.API_BASE_URL}/auth/profile`, {
      headers: {
        'Authorization': `Bearer ${this.session.token}`,
      },
    });

    const result: AuthResponse = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to get profile');
    }

    return result.data;
  }

  /**
   * 调用受保护的 API
   */
  async callProtectedAPI(endpoint: string, options: RequestInit = {}): Promise<any> {
    if (!this.session) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${this.API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${this.session.token}`,
        'Content-Type': 'application/json',
      },
    });

    const result: AuthResponse = await response.json();
    
    if (!result.success) {
      if (response.status === 401) {
        this.logout();
        throw new Error('Session expired, please login again');
      }
      throw new Error(result.error || 'API call failed');
    }

    return result.data;
  }
}
