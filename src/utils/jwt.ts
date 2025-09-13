import jwt from 'jsonwebtoken';
import { JWTPayload } from '../types';

export class JWTManager {
  private secret: string;

  constructor(secret: string = 'your-secret-key') {
    this.secret = secret;
  }

  generateToken(address: string, sessionId: string): string {
    const payload: JWTPayload = {
      address,
      sessionId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    return jwt.sign(payload, this.secret);
  }

  verifyToken(token: string): JWTPayload | null {
    try {
      return jwt.verify(token, this.secret) as JWTPayload;
    } catch {
      return null;
    }
  }
}
