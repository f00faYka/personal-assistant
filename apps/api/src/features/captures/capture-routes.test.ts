import { afterEach, describe, expect, test } from "vitest";

import { CaptureService, type Capture } from "./capture.js";
import { registerCaptureRoutes } from "./capture-routes.js";
import { buildApi } from "../../http/build-api.js";

describe("Capture routes", () => {
  const applications: Array<ReturnType<typeof buildApi>> = [];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.close()));
  });

  test("submits audio and retrieves immutable source metadata", async () => {
    const repository = new MemoryRepository();
    const application = buildApi({ logger: false });
    registerCaptureRoutes(application, new CaptureService(repository, new MemoryBlobStorage()));
    applications.push(application);

    const submission = {
      memberId: "member-1",
      idempotencyKey: "capture-1",
      audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
      contentType: "audio/m4a",
      capturedAt: "2026-08-14T10:00:00.000Z",
    };
    const response = await application.inject({
      method: "POST",
      url: "/captures",
      payload: submission,
    });
    const capture = response.json<{ capture: Capture }>().capture;

    expect(response.statusCode).toBe(201);
    expect(capture).toMatchObject({ memberId: "member-1", byteLength: 3 });
    expect(capture.contentSha256).toHaveLength(64);

    const retrieval = await application.inject({ method: "GET", url: `/captures/${capture.id}` });
    expect(retrieval.statusCode).toBe(200);
    expect(retrieval.json()).toEqual({ capture });
  });

  test("rejects incomplete submissions without creating a Capture", async () => {
    const repository = new MemoryRepository();
    const application = buildApi({ logger: false });
    registerCaptureRoutes(application, new CaptureService(repository, new MemoryBlobStorage()));
    applications.push(application);

    const response = await application.inject({
      method: "POST",
      url: "/captures",
      payload: { memberId: "member-1", audioBase64: "%%%" },
    });

    expect(response.statusCode).toBe(400);
    expect(repository.values).toHaveLength(0);
  });
});

class MemoryRepository {
  readonly values: Capture[] = [];

  findByIdempotencyKey(memberId: string, idempotencyKey: string): Capture | undefined {
    return this.values.find(
      (capture) => capture.memberId === memberId && capture.idempotencyKey === idempotencyKey,
    );
  }

  findById(id: string): Capture | undefined {
    return this.values.find((capture) => capture.id === id);
  }

  create(capture: Capture): Capture {
    this.values.push(capture);
    return capture;
  }

  markStored(id: string): void {
    const index = this.values.findIndex((value) => value.id === id);
    const capture = this.values[index];
    if (capture) this.values[index] = { ...capture, storageState: "stored" };
  }
}

class MemoryBlobStorage {
  async write(_identifier: string, _content: Uint8Array): Promise<void> {}

  async read(_identifier: string): Promise<Uint8Array> {
    return Uint8Array.from([]);
  }
}
