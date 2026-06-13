import fs from 'node:fs/promises';
import path from 'node:path';
import type { ObjectStore } from './ObjectStore.js';

export class FileObjectStore implements ObjectStore {
  constructor(private readonly baseDir: string) {}

  async put(key: string, data: Buffer): Promise<void> {
    const full = path.join(this.baseDir, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(path.join(this.baseDir, key));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(path.join(this.baseDir, key));
  }
}
