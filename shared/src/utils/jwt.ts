import jwt from 'jsonwebtoken';

export class JWTManager {
  private secret: string;

  constructor(secret: string = 'walletconnect-waku-secret') {
    this.secret = secret;
  }

  generateToken(address: string, sessionId: string): string {
    return jwt.sign(
      {
        address,
        sessionId,
        timestamp: Date.now()
      },
      this.secret,
      { expiresIn: '24h' }
    );
  }

  verifyToken(token: string): { address: string; sessionId: string; timestamp: number } | null {
    try {
      return jwt.verify(token, this.secret) as any;
    } catch {
      return null;
    }
  }
}
