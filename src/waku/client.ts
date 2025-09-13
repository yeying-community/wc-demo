import { createLightNode, LightNode, Protocols, createDecoder, createEncoder } from '@waku/sdk';
import { WakuMessage } from '../types';

export class WakuClient {
  private node: LightNode | null = null;
  private pubsubTopic = '/waku/2/rs/5432/0';
  private topic = '/walletconnect/1/session/proto';
  private messageHandlers: Map<string, (message: WakuMessage) => void> = new Map();

  async start(wakuNodes?: string[]): Promise<void> {
    console.log('Starting Waku client...');

    const customNodes = wakuNodes || [
      `/ip4/159.138.36.164/tcp/60001/ws/p2p/16Uiu2HAkyt6wQkYk2EZPWsrot8aktLwya1UixWTstjGFrW4B63b5`
    ];

    console.log('Connecting to nodes:', customNodes)

    this.node = await createLightNode({
      defaultBootstrap: false, // 禁用默认节点
      networkConfig: { clusterId: 5432, numShardsInCluster: 0 },
      numPeersToUse: 1,
      bootstrapPeers: customNodes // 使用自定义节点
    });

    await this.node.start();

    console.log('Node started, waiting for peers...');
    // await waitForRemotePeer(this.node, [Protocols.Filter, Protocols.LightPush], 5000);

    // 使用正确的 decoder
    const decoder = createDecoder(this.topic, {
      clusterId: 5432,
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
        clusterId: 5432,
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
