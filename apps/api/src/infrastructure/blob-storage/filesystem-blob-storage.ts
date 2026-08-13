import { constants } from "node:fs";
import { lstat, link, mkdir, open, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { relative, resolve, sep } from "node:path";

import type { BlobStorage } from "../../shared/blob-storage.js";

export class FileSystemBlobStorage implements BlobStorage {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory);
  }

  async write(identifier: string, content: Uint8Array): Promise<void> {
    const filePath = this.resolveIdentifier(identifier);
    await this.prepareParentDirectories(filePath, identifier);
    await this.rejectSymbolicLink(filePath, identifier, true);

    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const file = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await file.writeFile(content);
    } finally {
      await file.close();
    }
    try {
      await link(temporaryPath, filePath);
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") {
        throw new BlobAlreadyExistsError(identifier);
      }
      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async read(identifier: string): Promise<Uint8Array> {
    const filePath = this.resolveIdentifier(identifier);
    await this.rejectPathSymbolicLinks(filePath, identifier);

    const file = await this.openWithoutFollowingSymbolicLinks(
      filePath,
      constants.O_RDONLY,
      identifier,
    );
    try {
      return new Uint8Array(await file.readFile());
    } finally {
      await file.close();
    }
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

  private async prepareParentDirectories(filePath: string, identifier: string): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    const segments = relative(this.rootDirectory, filePath).split(sep);
    let currentPath = this.rootDirectory;

    for (const segment of segments.slice(0, -1)) {
      currentPath = resolve(currentPath, segment);
      try {
        await mkdir(currentPath);
      } catch (error) {
        if (!isErrnoException(error) || error.code !== "EEXIST") {
          throw error;
        }
      }

      const statistics = await lstat(currentPath);
      if (statistics.isSymbolicLink() || !statistics.isDirectory()) {
        throw new InvalidBlobIdentifierError(identifier);
      }
    }
  }

  private async rejectPathSymbolicLinks(filePath: string, identifier: string): Promise<void> {
    const segments = relative(this.rootDirectory, filePath).split(sep);
    let currentPath = this.rootDirectory;

    for (const segment of segments) {
      currentPath = resolve(currentPath, segment);
      await this.rejectSymbolicLink(currentPath, identifier, false);
    }
  }

  private async rejectSymbolicLink(
    filePath: string,
    identifier: string,
    allowMissing: boolean,
  ): Promise<void> {
    try {
      if ((await lstat(filePath)).isSymbolicLink()) {
        throw new InvalidBlobIdentifierError(identifier);
      }
    } catch (error) {
      if (allowMissing && isErrnoException(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  private async openWithoutFollowingSymbolicLinks(
    filePath: string,
    flags: number,
    identifier: string,
  ): Promise<Awaited<ReturnType<typeof open>>> {
    try {
      return await open(filePath, flags | constants.O_NOFOLLOW, 0o600);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ELOOP") {
        throw new InvalidBlobIdentifierError(identifier);
      }
      if (isErrnoException(error) && error.code === "EEXIST") {
        throw new BlobAlreadyExistsError(identifier);
      }
      throw error;
    }
  }
}

export class InvalidBlobIdentifierError extends Error {
  constructor(identifier: string) {
    super(`Unsafe blob identifier: ${identifier}`);
    this.name = "InvalidBlobIdentifierError";
  }
}

export class BlobAlreadyExistsError extends Error {
  constructor(identifier: string) {
    super(`Blob already exists: ${identifier}`);
    this.name = "BlobAlreadyExistsError";
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
