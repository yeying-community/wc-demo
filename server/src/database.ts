import { UserProfile } from './types';

// Simple in-memory database for demo purposes
// In production, use a real database like PostgreSQL, MongoDB, etc.
export class Database {
  private users: Map<string, UserProfile> = new Map();

  async getUser(address: string): Promise<UserProfile | null> {
    return this.users.get(address.toLowerCase()) || null;
  }

  async createUser(address: string): Promise<UserProfile> {
    const user: UserProfile = {
      address: address.toLowerCase(),
      loginCount: 1,
      lastLogin: Date.now(),
      createdAt: Date.now()
    };
    
    this.users.set(address.toLowerCase(), user);
    return user;
  }

  async updateUserLogin(address: string): Promise<UserProfile | null> {
    const user = this.users.get(address.toLowerCase());
    if (!user) return null;

    user.loginCount += 1;
    user.lastLogin = Date.now();
    
    this.users.set(address.toLowerCase(), user);
    return user;
  }

  async getAllUsers(): Promise<UserProfile[]> {
    return Array.from(this.users.values());
  }
}
