import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class BullMqDocumentQueue {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue('document-processing', {
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    });
  }

  async add(jobName: string, payload: Record<string, unknown>, options?: Record<string, unknown>) {
    return this.queue.add(jobName, payload, {
      attempts: Number(options?.attempts ?? 1),
      delay: Number(options?.delay ?? 0),
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
