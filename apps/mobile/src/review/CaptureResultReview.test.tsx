import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", async () => {
  const React = await import("react");
  type Props = { readonly children?: React.ReactNode; readonly [key: string]: unknown };
  const host = (name: string) => (props: Props) => React.createElement(name, props, props.children);
  return { ActivityIndicator: host("ActivityIndicator"), Pressable: host("Pressable"), ScrollView: host("ScrollView"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), View: host("View") };
});
vi.mock("react-native-safe-area-context", async () => {
  const React = await import("react");
  return { SafeAreaView: (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement("SafeAreaView", props, props.children) };
});

import { CaptureResultReview } from "./CaptureResultReview";

describe("CaptureResultReview", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("shows result facts first and keeps source history collapsed until requested", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/review")) return jsonResponse({ review: reviewContract() });
      if (url.includes("/metadata")) return jsonResponse({ tags: [], entities: [{ id: "entity-1", memberId: "member-1", name: "Office", type: "Place", createdAt: "now" }] });
      if (url.includes("/spaces?")) return jsonResponse({ spaces: [{ id: "space-1", memberId: "member-1", name: "Work", createdAt: "now" }] });
      if (url.includes("/spaces/space-1")) return jsonResponse({ space: { id: "space-1", memberId: "member-1", name: "Work", createdAt: "now" }, path: "Work", children: [], items: [{ itemId: "task-1", itemKind: "task", spaceId: "space-1", path: "Work" }] });
      throw new Error(`Unexpected request ${url}`);
    }));
    let renderer!: ReactTestRenderer;
    const onBack = vi.fn();
    await act(async () => { renderer = create(<CaptureResultReview apiBaseUrl="http://api.test" memberId="member-1" detailUrl="/captures/capture-1/review" timeZone="UTC" onBack={onBack} />); });
    expect(textContent(renderer)).toContain("Buy milk");
    expect(textContent(renderer)).toContain("Due date");
    expect(textContent(renderer)).toContain("Due time");
    expect(textContent(renderer)).not.toContain("Call dentist tomorrow");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Show source and review history" }).props.onPress(); });
    expect(textContent(renderer)).toContain("Call dentist tomorrow");
    expect(textContent(renderer)).toContain("AI interpretation");
    expect(textContent(renderer)).toContain("Audio playback is not available");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Back to Capture result" }).props.onPress(); });
    expect(onBack).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  test("shows a Needs review Note without Task fields and preserves missing audio state", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/review")) return jsonResponse({ review: { ...reviewContract(), state: "needs_review", source: { id: "source-1", storageState: "pending", content: { kind: "audio", contentType: "audio/m4a", byteLength: 12, sha256: "hash" } }, outcome: { kind: "note", id: "note-1", content: "Maybe book a trip", reviewState: "needs_review", version: 0 } } });
      if (url.includes("/metadata")) return jsonResponse({ tags: [], entities: [] });
      if (url.includes("/spaces?")) return jsonResponse({ spaces: [] });
      throw new Error(`Unexpected request ${url}`);
    }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<CaptureResultReview apiBaseUrl="http://api.test" memberId="member-1" detailUrl="/captures/capture-1/review" timeZone="UTC" onBack={vi.fn()} />); });
    expect(textContent(renderer)).toContain("Maybe book a trip");
    expect(textContent(renderer)).toContain("Needs review");
    expect(textContent(renderer)).toContain("Type Note");
    expect(textContent(renderer)).not.toContain("Due date");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Show source and review history" }).props.onPress(); });
    expect(textContent(renderer)).toContain("Storage pending · audio/m4a · 12 bytes");
    renderer.unmount();
  });
});

function reviewContract() {
  return { state: "completed", capture: { id: "capture-1", memberId: "member-1" }, source: { id: "source-1", storageState: "stored", content: { kind: "audio", contentType: "audio/m4a", byteLength: 2048, sha256: "hash" } }, transcription: { status: "succeeded", text: "Call dentist tomorrow" }, correction: null, interpretation: { id: "interpretation-1", classification: "clear_supported" }, outcome: { kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-10-05T09:30:00.000Z", status: "open", version: 0 }, failure: null };
}
function jsonResponse(body: unknown): Response { return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }
function textContent(renderer: ReactTestRenderer): string { return renderer.root.findAll((node) => String(node.type) === "Text").flatMap((node) => node.children).filter((child): child is string => typeof child === "string").join(" "); }
