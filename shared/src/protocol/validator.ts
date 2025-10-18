import {
  SessionProposal,
  SessionApproval,
  JsonRpcRequest,
  TransactionRequest,
  TypedData,
} from '../types';
import { ErrorCode } from '../types';

export class Validator {
  static validateSessionProposal(proposal: SessionProposal): void {
    if (!proposal.id) {
      throw new Error('Invalid proposal: missing id');
    }
    if (!proposal.proposer?.publicKey) {
      throw new Error('Invalid proposal: missing proposer public key');
    }
    if (!proposal.proposer?.metadata) {
      throw new Error('Invalid proposal: missing proposer metadata');
    }
    if (!proposal.permissions?.chains?.length) {
      throw new Error('Invalid proposal: missing chains');
    }
    if (!proposal.permissions?.methods?.length) {
      throw new Error('Invalid proposal: missing methods');
    }
  }

  static validateSessionApproval(approval: SessionApproval): void {
    if (!approval.id) {
      throw new Error('Invalid approval: missing id');
    }
    if (!approval.responder?.publicKey) {
      throw new Error('Invalid approval: missing responder public key');
    }
    if (!approval.accounts?.length) {
      throw new Error('Invalid approval: missing accounts');
    }
  }

  static validateJsonRpcRequest(request: JsonRpcRequest): void {
    if (!request.id) {
      throw new Error('Invalid request: missing id');
    }
    if (request.jsonrpc !== '2.0') {
      throw new Error('Invalid request: invalid jsonrpc version');
    }
    if (!request.method) {
      throw new Error('Invalid request: missing method');
    }
  }

  static validateTransactionRequest(tx: TransactionRequest): void {
    if (!tx.from) {
      throw new Error('Invalid transaction: missing from address');
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(tx.from)) {
      throw new Error('Invalid transaction: invalid from address');
    }
    if (tx.to && !/^0x[a-fA-F0-9]{40}$/.test(tx.to)) {
      throw new Error('Invalid transaction: invalid to address');
    }
  }

  static validateTypedData(data: TypedData): void {
    if (!data.types) {
      throw new Error('Invalid typed data: missing types');
    }
    if (!data.primaryType) {
      throw new Error('Invalid typed data: missing primaryType');
    }
    if (!data.domain) {
      throw new Error('Invalid typed data: missing domain');
    }
    if (!data.message) {
      throw new Error('Invalid typed data: missing message');
    }
  }

  static validateChainId(chainId: string): void {
    if (!/^eip155:\d+$/.test(chainId)) {
      throw new Error(`Invalid chainId format: ${chainId}`);
    }
  }

  static validateAccount(account: string): void {
    // Format: eip155:1:0x1234...
    const parts = account.split(':');
    if (parts.length !== 3) {
      throw new Error(`Invalid account format: ${account}`);
    }
    if (parts[0] !== 'eip155') {
      throw new Error(`Unsupported namespace: ${parts[0]}`);
    }
    if (!/^\d+$/.test(parts[1])) {
      throw new Error(`Invalid chain ID in account: ${parts[1]}`);
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(parts[2])) {
      throw new Error(`Invalid address in account: ${parts[2]}`);
    }
  }

  static validateTopic(topic: string): void {
    if (!topic || topic.length < 32) {
      throw new Error('Invalid topic: too short');
    }
    if (!/^[a-zA-Z0-9]+$/.test(topic)) {
      throw new Error('Invalid topic: invalid characters');
    }
  }

  static validateUri(uri: string): void {
    if (!uri.startsWith('wc:')) {
      throw new Error('Invalid URI: must start with wc:');
    }
    
    try {
      const url = new URL(uri.replace('wc:', 'http:'));
      const params = url.searchParams;
      
      if (!params.get('symKey')) {
        throw new Error('Invalid URI: missing symKey');
      }
      if (!params.get('relay-protocol')) {
        throw new Error('Invalid URI: missing relay-protocol');
      }
    } catch (error) {
      throw new Error(`Invalid URI format: ${error}`);
    }
  }

  static validateErrorCode(code: number): boolean {
    return Object.values(ErrorCode).includes(code);
  }

  static validateMetadata(metadata: any): void {
    if (!metadata.name) {
      throw new Error('Invalid metadata: missing name');
    }
    if (!metadata.description) {
      throw new Error('Invalid metadata: missing description');
    }
    if (!metadata.url) {
      throw new Error('Invalid metadata: missing url');
    }
    if (!metadata.icons || !Array.isArray(metadata.icons) || metadata.icons.length === 0) {
      throw new Error('Invalid metadata: missing or invalid icons');
    }
  }
}


