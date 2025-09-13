import { v4 as uuidv4 } from 'uuid';
import { Session, SessionRequest, AppMetadata, Namespace } from '../types';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private pendingRequests: Map<string, SessionRequest> = new Map();

  createSessionRequest(metadata: AppMetadata): SessionRequest {
    const id = uuidv4();
    const topic = this.generateTopic();

    const request: SessionRequest = {
      id,
      topic,
      method: 'wc_sessionPropose',
      params: {
        requiredNamespaces: {
          eip155: {
            chains: ['eip155:1', 'eip155:137'], // Ethereum, Polygon
            methods: ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'],
            events: ['accountsChanged', 'chainChanged']
          }
        }
      },
      metadata
    };
    this.pendingRequests.set(id, request);
    return request;
  }

  approveSession(requestId: string, accounts: string[]): Session {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error('Session request not found');
    }

    const session: Session = {
      id: request.id,
      topic: request.topic,
      accounts,
      namespaces: {
        eip155: {
          chains: ['eip155:1', 'eip155:137'],
          methods: ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'],
          events: ['accountsChanged', 'chainChanged'],
          accounts: accounts.map(addr => `eip155:1:${addr}`)
        }
      },
      metadata: request.metadata,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      active: true
    };

    this.sessions.set(session.id, session);
    this.pendingRequests.delete(requestId);
    
    return session;
  }

  rejectSession(requestId: string): void {
    this.pendingRequests.delete(requestId);
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  private generateTopic(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
