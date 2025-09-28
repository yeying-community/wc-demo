import { createLightNode, LightNode, createDecoder, createEncoder, Protocols } from '@waku/sdk';
import { WakuMessage } from '../types';
import { yamux } from '@chainsafe/libp2p-yamux';

export class WakuClient {
  private node: LightNode | null = null;
  private clusterId: number;
  private pubsubTopic: string;
  private contentTopic = '/walletconnect/1/session/proto';
  private messageHandlers: Map<string, (message: WakuMessage) => void> = new Map();

  constructor(clusterId: number = 5432) {
    this.clusterId = clusterId
    this.pubsubTopic = `/waku/2/rs/${this.clusterId}/0`;
  }

  async start(wakuNodes: string[]): Promise<void> {
    console.log('Starting Waku client...');

    console.log('Connecting to nodes:', wakuNodes)
    this.node = await createLightNode({
      networkConfig: {
        clusterId: this.clusterId,
      },
      defaultBootstrap: false,
      autoStart: true,
      bootstrapPeers: wakuNodes,
      numPeersToUse: 1,
      libp2p: {
        // 明确指定流多路复用器
        streamMuxers: [yamux()],
        filterMultiaddrs: false,
        hideWebSocketInfo: true,
        connectionManager: {
          dialTimeout: 5000, // 增加拨号超时
          maxConnections: 10,
        }
      },
    });

    console.log(`Node=${this.node.peerId} started=${this.node.isStarted()}, waiting for peers...`);
    await this.node.waitForPeers([Protocols.LightPush, Protocols.Filter], 5000);

    console.log(`Node connected=${this.node.isConnected()}`)

    const decoder = createDecoder(this.contentTopic, {
      clusterId: this.clusterId,
      shardId: 0,
      pubsubTopic: this.pubsubTopic
    });

    const success = await this.node.filter.subscribe(
      [decoder],
      (wakuMessage) => {
        try {
          const payload = new TextDecoder().decode(wakuMessage.payload);
          const message: WakuMessage = JSON.parse(payload);
          console.log('Received message:', message);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse Waku message:', error);
        }
      }
    );

    console.log(`Subscribe content topic=${this.contentTopic}, clusterId=${this.clusterId}, pubsubTopic=${this.pubsubTopic}, success=${success} `)
    if (!success) {
      console.error("Failed to subscribe");
    }
    console.log('Waku client started successfully');
  }

  async publishMessage(message: WakuMessage): Promise<void> {
    if (!this.node) {
      throw new Error('Waku node not initialized');
    }

    const payload = new TextEncoder().encode(JSON.stringify(message));
    const encoder = createEncoder({
      contentTopic: this.contentTopic, routingInfo: {
        clusterId: this.clusterId,
        shardId: 0,
        pubsubTopic: this.pubsubTopic
      }
    });

    const result = await this.node.lightPush.send(encoder, {
      payload,
      timestamp: new Date(),
    },{
      useLegacy: true,
    });
    console.log('Message published:', message.type, 'Success:', result.successes.length > 0, "error:", result.failures);
  }

  onMessage(type: string, handler: (message: WakuMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  private handleMessage(message: WakuMessage): void {
    console.log('Received message:', message.type);
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(message);
    }
  }

  async stop(): Promise<void> {
    if (this.node) {
      await this.node.stop();
      this.node = null;
    }
  }
}
