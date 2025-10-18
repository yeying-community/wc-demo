import { IStorage } from '../types/index';

export class LocalStorage implements IStorage {
  private prefix: string;

  constructor(prefix: string = 'yeying_') {
    this.prefix = prefix;
  }

  async getItem(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(this.prefix + key);
    } catch (error) {
      console.error('LocalStorage getItem error:', error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(this.prefix + key, value);
    } catch (error) {
      console.error('LocalStorage setItem error:', error);
      throw error;
    }
  }
    
  async removeItem(key: string): Promise<void> {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch (error) {
      console.error('LocalStorage removeItem error:', error);
      throw error;
    }
  }
}
