import { ITransport } from '../types';
import { Logger } from '../utils/logger';

interface QueuedMessage {
  id: string;
  topic: string;
  message: string;
  timestamp: number;
  retries: number;
  maxRetries: number;
}

export class MessageQueue {
  private logger: Logger;
  private queue: QueuedMessage[] = [];
  private processing: boolean = false;
  private maxRetries: number = 3;
  private retryDelay: number = 1000;
  private transport: ITransport;

  constructor(transport: ITransport) {
    this.logger = new Logger('MessageQueue');
    this.transport = transport
  }

  /**
   * 添加消息到队列
   */
  public enqueue(topic: string, message: string, maxRetries?: number): string {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const queuedMessage: QueuedMessage = {
      id,
      topic,
      message,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: maxRetries ?? this.maxRetries,
    };

    this.queue.push(queuedMessage);
    this.logger.debug(`Message queued: ${id}`);

    // 开始处理队列
    this.processQueue();

    return id;
  }

  /**
   * 处理队列中的消息
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const message = this.queue[0];

      try {
        await this.transport.publish(message.topic, message.message, false);

        // 发送成功，移除消息
        this.queue.shift();
        this.logger.debug(`Message sent successfully: ${message.id}`);

      } catch (error) {
        this.logger.error(`Failed to send message ${message.id}:`, error);

        message.retries++;

        if (message.retries >= message.maxRetries) {
          // 达到最大重试次数，移除消息
          this.queue.shift();
          this.logger.error(`Message ${message.id} failed after ${message.retries} retries`);
        } else {
          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * message.retries));
        }
      }
    }

    this.processing = false;
  }

  /**
   * 获取队列大小
   */
  public size(): number {
    return this.queue.length;
  }

  /**
   * 清空队列
   */
  public clear(): void {
    this.queue = [];
    this.logger.info('Queue cleared');
  }

  /**
   * 获取队列中的所有消息
   */
  public getMessages(): QueuedMessage[] {
    return [...this.queue];
  }
}

