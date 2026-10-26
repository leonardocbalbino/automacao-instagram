import IORedis from 'ioredis';
import { config } from '../config.js';

// BullMQ exige maxRetriesPerRequest: null nas conexões dos workers
export function createRedis() {
  return new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
}

export const redis = createRedis();
