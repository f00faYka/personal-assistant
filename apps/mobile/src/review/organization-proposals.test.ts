import { afterEach, describe, expect, test, vi } from "vitest";
import { createOrganizationProposalClient } from "./organization-proposals";

describe("organization proposal client", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("lists proposals for the reviewed item", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ proposals: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await createOrganizationProposalClient("http://api.test/").list("item/1", "note", "member 1");
    expect(fetcher).toHaveBeenCalledWith("http://api.test/items/item%2F1/organization-proposals?memberId=member%201&itemKind=note", {});
  });

  test("accepts selected candidates and reports API errors", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposal: { id: "proposal-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "offline" }), { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const client = createOrganizationProposalClient("http://api.test");
    await client.decide("proposal-1", "accepted", "member-1", ["candidate-1"]);
    expect(fetcher).toHaveBeenNthCalledWith(1, "http://api.test/organization-proposals/proposal-1/accept", expect.objectContaining({ method: "POST", body: JSON.stringify({ memberId: "member-1", candidateIds: ["candidate-1"] }) }));
    await expect(client.decide("proposal-1", "dismissed", "member-1")).rejects.toThrow("offline");
  });
});
