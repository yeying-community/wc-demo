import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { LoginChallenge, LoginRequest, AuthToken } from './types';

export class AuthService {
  private challenges: Map<string, LoginChallenge> = new Map();
  private readonly JWT_SECRET: string;
  private readonly CHALLENGE_EXPIRY = 5 * 60 * 1000; // 5 minutes
  private readonly TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
  }

  generateChallenge(address: string): LoginChallenge {
    const challenge = ethers.hexlify(ethers.randomBytes(32));
    const message = `Please sign this message to authenticate with the DApp.\n\nChallenge: ${challenge}\nAddress: ${address}\nTimestamp: ${Date.now()}`;
    
    const challengeData: LoginChallenge = {
      challenge,
      message,
      expiresAt: Date.now() + this.CHALLENGE_EXPIRY
    };

    this.challenges.set(address, challengeData);
    
    // Clean up expired challenges
    this.cleanupExpiredChallenges();
    
    return challengeData;
  }

  async verifyLogin(loginRequest: LoginRequest): Promise<AuthToken | null> {
    const { address, signature, challenge } = loginRequest;

    // Get stored challenge
    const storedChallenge = this.challenges.get(address);
    if (!storedChallenge) {
      throw new Error('Challenge not found or expired');
    }

    // Check if challenge is expired
    if (Date.now() > storedChallenge.expiresAt) {
      this.challenges.delete(address);
      throw new Error('Challenge expired');
    }

    // Verify challenge matches
    if (storedChallenge.challenge !== challenge) {
      throw new Error('Invalid challenge');
    }

    try {
      // Verify signature
      const recoveredAddress = ethers.verifyMessage(storedChallenge.message, signature);
      
      if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Invalid signature');
      }

      // Clean up used challenge
      this.challenges.delete(address);

      // Generate JWT token
      const token = jwt.sign(
        { 
          address: address.toLowerCase(),
          loginTime: Date.now()
        },
        this.JWT_SECRET,
        { expiresIn: '24h' }
      );

      return {
        token,
        expiresAt: Date.now() + this.TOKEN_EXPIRY
      };

    } catch (error) {
      throw new Error('Signature verification failed');
    }
  }

  verifyToken(token: string): { address: string; loginTime: number } | null {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET) as any;
      return {
        address: decoded.address,
        loginTime: decoded.loginTime
      };
    } catch (error) {
      return null;
    }
  }

  private cleanupExpiredChallenges(): void {
    const now = Date.now();
    for (const [address, challenge] of this.challenges.entries()) {
      if (now > challenge.expiresAt) {
        this.challenges.delete(address);
      }
    }
 } 
}
