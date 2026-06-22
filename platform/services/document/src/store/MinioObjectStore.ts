import * as Minio from 'minio';
import type { ObjectStore } from './ObjectStore.js';

export interface MinioConfig {
  endPoint: string; port: number; useSSL: boolean;
  accessKey: string; secretKey: string; bucket: string;
}

interface MinioLike {
  putObject(bucket: string, key: string, data: Buffer, size: number): Promise<unknown>;
  getObject(bucket: string, key: string): Promise<AsyncIterable<Buffer>>;
  removeObject(bucket: string, key: string): Promise<void>;
}

export class MinioObjectStore implements ObjectStore {
  constructor(private client: MinioLike, private bucket: string) {}

  async put(key: string, data: Buffer): Promise<void> {
    await this.client.putObject(this.bucket, key, data, data.length);
  }
  async get(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }
  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }
}

/** Build the store and ensure its bucket exists (idempotent, tolerates already-exists races). */
export async function createMinioObjectStore(cfg: MinioConfig): Promise<MinioObjectStore> {
  const client = new Minio.Client({
    endPoint: cfg.endPoint, port: cfg.port, useSSL: cfg.useSSL,
    accessKey: cfg.accessKey, secretKey: cfg.secretKey,
  });
  const exists = await client.bucketExists(cfg.bucket).catch(() => false);
  if (!exists) {
    try { await client.makeBucket(cfg.bucket); }
    catch (e) { if (!String((e as Error).message ?? e).toLowerCase().includes('already')) throw e; }
  }
  return new MinioObjectStore(client as unknown as MinioLike, cfg.bucket);
}
