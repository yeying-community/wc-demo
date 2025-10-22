import { 
  ISessionStore, 
  SessionData, 
  SessionProposal 
} from '../types/session';

/**
 * Session 存储实现
 * 使用内存存储，可扩展为持久化存储
 */
export class SessionStore implements ISessionStore {
  private sessions: Map<string, SessionData> = new Map();
  private proposals: Map<number, SessionProposal> = new Map();

  /**
   * 设置 Session
   */
  async set(topic: string, session: SessionData): Promise<void> {
    this.sessions.set(topic, session);
  }

  /**
   * 获取 Session
   */
  async get(topic: string): Promise<SessionData | undefined> {
    return this.sessions.get(topic);
  }

  /**
   * 获取所有 Session
   */
  async getAll(): Promise<SessionData[]> {
    return Array.from(this.sessions.values());
  }

  /**
   * 删除 Session
   */
  async delete(topic: string): Promise<void> {
    this.sessions.delete(topic);
  }

  /**
   * 设置提议
   */
  async setProposal(id: number, proposal: SessionProposal): Promise<void> {
    this.proposals.set(id, proposal);
  }

  /**
   * 获取提议
   */
  async getProposal(id: number): Promise<SessionProposal | undefined> {
    return this.proposals.get(id);
  }

  /**
   * 获取所有提议
   */
  async getAllProposals(): Promise<SessionProposal[]> {
    return Array.from(this.proposals.values());
  }

  /**
   * 删除提议
   */
  async deleteProposal(id: number): Promise<void> {
    this.proposals.delete(id);
  }

  /**
   * 清空存储
   */
  async clear(): Promise<void> {
    this.sessions.clear();
    this.proposals.clear();
  }

  /**
   * 获取 Session 数量
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 获取提议数量
   */
  get proposalCount(): number {
    return this.proposals.size;
  }
}
