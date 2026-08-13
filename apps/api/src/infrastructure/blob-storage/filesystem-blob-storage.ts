import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type { BlobStorage } from "../../shared/blob-storage.js";

export class FileSystemBlobStorage implements BlobStorage {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory);
  }

  async write(identifier: string, content: Uint8Array): Promise<void> {
    const filePath = this.resolveIdentifier(identifier);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  async read(identifier: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolveIdentifier(identifier)));
  }

  private resolveIdentifier(identifier: string): string {
    const segments = identifier.split("/");
    const usesSafeSegments =
      segments.length > 0 &&
      segments.every(
        (segment) =>
          segment !== "." &&
          segment !== ".." &&
          /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment),
      );
    const filePath = resolve(this.rootDirectory, identifier);
    const relativePath = relative(this.rootDirectory, filePath);
    const remainsInsideRoot = relativePath !== ".." && !relativePath.startsWith(`..${sep}`);

    if (!usesSafeSegments || identifier.includes("\\") || !remainsInsideRoot) {
      throw new InvalidBlobIdentifierError(identifier);
    }

    return filePath;
  }
}

export class InvalidBlobIdentifierError extends Error {
  constructor(identifier: string) {
    super(`Unsafe blob identifier: ${identifier}`);
    this.name = "InvalidBlobIdentifierError";
  }
}
