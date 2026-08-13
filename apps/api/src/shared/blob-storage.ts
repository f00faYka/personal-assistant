export interface BlobStorage {
  write(identifier: string, content: Uint8Array): Promise<void>;
  read(identifier: string): Promise<Uint8Array>;
}
