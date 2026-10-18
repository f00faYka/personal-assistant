import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", async () => {
  const React = await import("react");
  type HostProps = { readonly children?: React.ReactNode; readonly refreshControl?: React.ReactNode; readonly [key: string]: unknown };
  const host = (name: string) => function Host(props: HostProps) { return React.createElement(name, props, props.children); };
  const FlatList = (props: HostProps & { readonly data?: readonly unknown[]; readonly renderItem?: (info: { readonly item: unknown; readonly index: number }) => React.ReactNode }) => React.createElement("FlatList", props, props.refreshControl, React.Children.toArray(props.data?.map((item, index) => props.renderItem?.({ item, index }))));
  return {
    ActivityIndicator: host("ActivityIndicator"),
    AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    FlatList,
    Pressable: host("Pressable"),
    RefreshControl: host("RefreshControl"),
    ScrollView: host("ScrollView"),
    StyleSheet: { create: <T,>(styles: T): T => styles },
    Text: host("Text"),
    TextInput: host("TextInput"),
    View: host("View"),
  };
});

vi.mock("react-native-safe-area-context", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  return { SafeAreaProvider: host("SafeAreaProvider"), SafeAreaView: host("SafeAreaView"), useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});

vi.mock("expo-audio", () => ({ RecordingPresets: { HIGH_QUALITY: {} }, useAudioRecorder: vi.fn(() => ({})), useAudioRecorderState: vi.fn(() => ({ metering: undefined, mediaServicesDidReset: false })) }));
vi.mock("./src/capture/expo-voice-recorder", () => ({ createExpoVoiceRecorder: vi.fn(() => undefined), readRecordedAudioAsBase64: vi.fn() }));
vi.mock("./src/offline/expo-offline-drafts", () => ({
  createExpoOfflineDraftStore: vi.fn(() => ({ list: vi.fn().mockResolvedValue([]), save: vi.fn(), remove: vi.fn() })),
}));
vi.mock("./src/offline/synchronize-offline-drafts", () => ({ createOfflineDraftSyncClient: vi.fn(() => ({ synchronize: vi.fn() })) }));

import { Pressable } from "react-native";

import App from "./App";

describe("App review navigation", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("refreshes the list after an in-place Note conversion without rendering a duplicate", async () => {
    let listReads = 0;
    let converted = false;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(input);
      if (requestUrl === "http://127.0.0.1:3000/items?memberId=member-1") {
        listReads += 1;
        const item = listReads === 1
          ? { kind: "note", id: "item-1", captureId: "capture-1", content: "Call the dentist", state: "none", createdAt: "2026-08-15T10:00:00.000Z", detailUrl: "/captures/capture-1/review" }
          : { kind: "task", id: "item-1", captureId: "capture-1", title: "Call the dentist", state: "open", createdAt: "2026-08-15T10:00:00.000Z", detailUrl: "/captures/capture-1/review" };
        return jsonResponse({ items: [item], nextCursor: null });
      }
      if (requestUrl === "http://127.0.0.1:3000/captures/capture-1/review") {
        return jsonResponse({ review: reviewWith(converted
          ? { kind: "task", id: "item-1", title: "Call the dentist", status: "open", version: 1 }
          : { kind: "note", id: "item-1", content: "Call the dentist", reviewState: "none", version: 0 }) });
      }
      if (requestUrl === "http://127.0.0.1:3000/notes/item-1/convert-to-task" && init?.method === "POST") {
        converted = true;
        return jsonResponse({ task: { kind: "task", id: "item-1", title: "Call the dentist", status: "open", version: 1 } });
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetcher);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); });

    await act(async () => { findButton(renderer, "Note: Call the dentist").props.onPress(); });
    await act(async () => { findButton(renderer, "Convert saved Note to Task").props.onPress(); });
    await act(async () => { findButton(renderer, "Back to items").props.onPress(); });

    expect(listReads).toBe(2);
    expect(renderer.root.findAllByType(Pressable).filter((node) => node.props.accessibilityLabel === "Task: Call the dentist")).toHaveLength(1);
    expect(renderer.root.findAllByType(Pressable).filter((node) => node.props.accessibilityLabel === "Note: Call the dentist")).toHaveLength(0);
    await act(async () => { findButton(renderer, "Task: Call the dentist").props.onPress(); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Task" })).toBeDefined();
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Edit Note" })).toHaveLength(0);
    renderer.unmount();
  });
});

function reviewWith(outcome: object) {
  return { state: "completed", capture: { id: "capture-1", memberId: "member-1" }, source: { id: "source-1" }, transcription: { status: "succeeded", text: "Call the dentist" }, correction: null, interpretation: { id: "interpretation-1" }, outcome, failure: null };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function findButton(renderer: ReactTestRenderer, accessibilityLabel: string) {
  const button = renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === accessibilityLabel);
  if (!button) throw new Error(`Button not found: ${accessibilityLabel}`);
  return button;
}
