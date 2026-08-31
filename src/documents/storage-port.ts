export abstract class StoragePort {
  abstract save(input: {
    buffer: Buffer;
    originalname: string;
    mimetype?: string;
  }, documentId: string): Promise<{ path: string }>;

  abstract read(path: string): Promise<Buffer>;
}
