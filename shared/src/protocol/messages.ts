import {
  SessionProposal,
  SessionApproval,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../types';

export enum MessageType {
  PAIRING_PROPOSAL = 'pairing_proposal',
  SESSION_PROPOSAL = 'session_proposal',
  SESSION_APPROVE = 'session_approve',
  SESSION_REJECT = 'session_reject',
  SESSION_UPDATE = 'session_update',
  SESSION_DELETE = 'session_delete',
  SESSION_REQUEST = 'session_request',
  SESSION_RESPONSE = 'session_response',
}

export interface BaseMessage {
  type: MessageType;
  timestamp: number;
}

export interface PairingProposalMessage extends BaseMessage {
  type: MessageType.PAIRING_PROPOSAL;
  proposal: SessionProposal;
}

export interface SessionApproveMessage extends BaseMessage {
  type: MessageType.SESSION_APPROVE;
  approval: SessionApproval;
}

export interface SessionRejectMessage extends BaseMessage {
  type: MessageType.SESSION_REJECT;
  id: string;
  reason: string;
}

export interface SessionDeleteMessage extends BaseMessage {
  type: MessageType.SESSION_DELETE;
  topic: string;
  reason: string;
}

export interface SessionRequestMessage extends BaseMessage {
  type: MessageType.SESSION_REQUEST;
  topic: string;
  request: JsonRpcRequest;
  chainId: string;
}

export interface SessionResponseMessage extends BaseMessage {
  type: MessageType.SESSION_RESPONSE;
  topic: string;
  response: JsonRpcResponse;
}

export type Message =
  | PairingProposalMessage
  | SessionApproveMessage
  | SessionRejectMessage
  | SessionDeleteMessage
  | SessionRequestMessage
  | SessionResponseMessage;

export class MessageBuilder {
  static createPairingProposal(proposal: SessionProposal): PairingProposalMessage {
    return {
      type: MessageType.PAIRING_PROPOSAL,
      timestamp: Date.now(),
      proposal,
    };
  }

  static createSessionApprove(approval: SessionApproval): SessionApproveMessage {
    return {
      type: MessageType.SESSION_APPROVE,
      timestamp: Date.now(),
      approval,
    };
  }

  static createSessionReject(id: string, reason: string): SessionRejectMessage {
    return {
      type: MessageType.SESSION_REJECT,
      timestamp: Date.now(),
      id,
      reason,
    };
  }

  static createSessionDelete(topic: string, reason: string): SessionDeleteMessage {
    return {
      type: MessageType.SESSION_DELETE,
      timestamp: Date.now(),
      topic,
      reason,
    };
  }

  static createSessionRequest(
    topic: string,
    request: JsonRpcRequest,
    chainId: string
  ): SessionRequestMessage {
    return {
      type: MessageType.SESSION_REQUEST,
      timestamp: Date.now(),
      topic,
      request,
      chainId,
    };
  }

  static createSessionResponse(
    topic: string,
    response: JsonRpcResponse
  ): SessionResponseMessage {
    return {
      type: MessageType.SESSION_RESPONSE,
      timestamp: Date.now(),
      topic,
      response,
    };
  }
}

