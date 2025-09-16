import { createLightNode, LightNode, createDecoder, createEncoder, waitForRemotePeer, Protocols } from '@waku/sdk';
import { WakuMessage } from '../types';

export class WakuClient {
  private node: LightNode | null = null;
  private clusterId = 5432;
  private pubsubTopic = `/waku/2/rs/${this.clusterId}/0`;
  private topic = '/walletconnect/1/session/proto';
  private messageHandlers: Map<string, (message: WakuMessage) => void> = new Map();

  async start(wakuNodes?: string[]): Promise<void> {
    console.log('Starting Waku client...');

    const customNodes = wakuNodes || [];

    console.log('Connecting to nodes:', customNodes)

    this.node = await createLightNode({
      networkConfig: { clusterId: this.clusterId },
      bootstrapPeers: customNodes,
      numPeersToUse: 1,
      libp2p: {
        filterMultiaddrs: false,
        hideWebSocketInfo: true,
      },
    });

    this.node.events.addEventListener("waku:connection", (event) => {
      console.log('connnect event');
      console.log(event.detail); // true if connected, false if disconnected
    });

    this.node.events.addEventListener("waku:health", (event) => {
      console.log('health event');
      console.log(event.detail); // 'Unhealthy', 'MinimallyHealthy', or 'SufficientlyHealthy'
    });

    console.log(this.node.peerId);
    // const promises = customNodes.map((multiaddr) => (this.node as LightNode).dial(multiaddr));
    // await Promise.all(promises);

    await this.node.start();
    console.log(`Node connected=${this.node.isConnected()}`)

    console.log(`Node started=${this.node.isStarted()}, waiting for peers...`);
    await this.node.waitForPeers([Protocols.LightPush, Protocols.Filter], 1000);

    console.log(`Node connected=${this.node.isConnected()}`)
    // 使用正确的 decoder
    const decoder = createDecoder(this.topic, {
      clusterId: this.clusterId,
      shardId: 0,
      pubsubTopic: this.pubsubTopic
    });

    await this.node.filter.subscribe(
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

    console.log('Waku client started successfully');
  }

  async publishMessage(message: WakuMessage): Promise<void> {
    if (!this.node) {
      throw new Error('Waku node not initialized');
    }

    const payload = new TextEncoder().encode(JSON.stringify(message));
    const encoder = createEncoder({
      contentTopic: this.topic, routingInfo: {
        clusterId: this.clusterId,
        shardId: 0,
        pubsubTopic: this.pubsubTopic
      }
    });

    const result = await this.node.lightPush.send(encoder, {
      payload,
      timestamp: new Date()
    });
    console.log('Message published:', message.type, 'Success:', result.successes.length > 0);
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
