import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

export class RedisService {
  private client: RedisClientType;
  private isConnected: boolean = false;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    this.client.on('error', (err) => {
      logger.error('Redis Client Error:', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      logger.info('Connected to Redis');
      this.isConnected = true;
    });

    this.client.on('disconnect', () => {
      logger.info('Disconnected from Redis');
      this.isConnected = false;
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
    } catch (error) {
      logger.error('Failed to disconnect from Redis:', error);
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isConnected) {
      logger.warn('Redis is not connected, returning null for key:', key);
      return null;
    }

    try {
      const result = await this.client.get(key);
      return result || null;
    } catch (error) {
      logger.error(`Failed to get key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn('Redis is not connected, skipping set for key:', key);
      return false;
    }

    try {
      if (ttl) {
        await this.client.setEx(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (error) {
      logger.error(`Failed to set key ${key}:`, error);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn('Redis is not connected, skipping delete for key:', key);
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error(`Failed to delete key ${key}:`, error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Failed to check existence of key ${key}:`, error);
      return false;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.isConnected) {
      return [];
    }

    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error(`Failed to get keys with pattern ${pattern}:`, error);
      return [];
    }
  }

  async hGet(key: string, field: string): Promise<string | null> {
    if (!this.isConnected) {
      return null;
    }

    try {
      const result = await this.client.hGet(key, field);
      return result || null;
    } catch (error) {
      logger.error(`Failed to hGet ${key}.${field}:`, error);
      return null;
    }
  }

  async hSet(key: string, field: string, value: string): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      await this.client.hSet(key, field, value);
      return true;
    } catch (error) {
      logger.error(`Failed to hSet ${key}.${field}:`, error);
      return false;
    }
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    if (!this.isConnected) {
      return {};
    }

    try {
      return await this.client.hGetAll(key);
    } catch (error) {
      logger.error(`Failed to hGetAll ${key}:`, error);
      return {};
    }
  }

  isReady(): boolean {
    return this.isConnected;
  }
}

export const redisService = new RedisService();
