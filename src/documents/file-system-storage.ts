import { Injectable } from '@nestjs/common';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { StoragePort } from './storage-port';

@Injectable()
export class FileSystemStorage extends StoragePort {
  async save(
    input: {
      buffer: Buffer;
      originalname: string;
      mimetype?: string;
    },
    documentId: string,
  ): Promise<{ path: string }> {
    const baseDir = join(process.cwd(), 'storage', 'documents');
    await mkdir(baseDir, { recursive: true });
    const targetPath = join(baseDir, `${documentId}-${input.originalname}`);
    await writeFile(targetPath, input.buffer);
    return { path: targetPath };
  }

  async read(path: string): Promise<Buffer> {
    return readFile(path);
  }
}
