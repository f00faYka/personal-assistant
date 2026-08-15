import { describe, expect, test } from "vitest";

import { responseError, shouldPersistOfflineDraft } from "./request-error";

describe("Offline-draft request classification", () => {
  test.each([400, 403, 409])("treats confirmed HTTP %s rejections as normal request failures", (status) => {
    expect(shouldPersistOfflineDraft(responseError("rejected", status))).toBe(false);
  });

  test.each([408, 429, 500, 503])("keeps HTTP %s eligible for durable Offline-draft recovery", (status) => {
    expect(shouldPersistOfflineDraft(responseError("unconfirmed", status))).toBe(true);
  });
});
