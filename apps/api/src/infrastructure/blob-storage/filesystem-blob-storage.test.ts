import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  FileSystemBlobStorage,
  InvalidBlobIdentifierError,
} from "./filesystem-blob-storage.js";

describe("FileSystemBlobStorage", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  test("round-trips blob content through a safe relative identifier", async () => {
    const rootDirectory = await createRootDirectory();
    const storage = new FileSystemBlobStorage(rootDirectory);
    const content = Uint8Array.from([0, 1, 2, 254, 255]);

    await storage.write("foundation/readiness.bin", content);

    await expect(storage.read("foundation/readiness.bin")).resolves.toEqual(content);
  });

  test.each([
    "../escaped.bin",
    "/absolute.bin",
    "safe/../../escaped.bin",
    "safe\\escaped.bin",
    ".",
    "safe//escaped.bin",
  ])(
    "rejects unsafe blob identifier %s",
    async (identifier) => {
      const rootDirectory = await createRootDirectory();
      const storage = new FileSystemBlobStorage(rootDirectory);

      await expect(storage.write(identifier, Uint8Array.from([1]))).rejects.toThrowError(
        InvalidBlobIdentifierError,
      );
      await expect(storage.read(identifier)).rejects.toThrowError(InvalidBlobIdentifierError);
    },
  );

  async function createRootDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-blobs-"));
    temporaryDirectories.push(directory);
    return join(directory, "blobs");
  }
});
