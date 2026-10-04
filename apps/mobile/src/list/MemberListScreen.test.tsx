import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", async () => {
  const React = await import("react");
  type HostProps = { readonly children?: React.ReactNode; readonly refreshControl?: React.ReactNode; readonly ListFooterComponent?: React.ReactNode; readonly [key: string]: unknown };
  const host = (name: string) => function Host(props: HostProps) { return React.createElement(name, props, props.children); };
  const FlatList = (props: HostProps & { readonly data?: readonly unknown[]; readonly renderItem?: (info: { readonly item: unknown; readonly index: number }) => React.ReactNode }) => React.createElement("FlatList", props, props.refreshControl, React.Children.toArray(props.data?.map((item, index) => props.renderItem?.({ item, index }))), props.ListFooterComponent);
  return {
    AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    ActivityIndicator: host("ActivityIndicator"),
    Dimensions: { get: vi.fn(() => ({ width: 390, height: 844 })) },
    FlatList,
    Modal: host("Modal"),
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Pressable: host("Pressable"),
    RefreshControl: host("RefreshControl"),
    ScrollView: host("ScrollView"),
    TextInput: host("TextInput"),
    StyleSheet: { create: <T,>(styles: T): T => styles },
    Text: host("Text"),
    View: host("View"),
  };
});

vi.mock("react-native-safe-area-context", async () => {
  const React = await import("react");
  return { SafeAreaView: (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement("SafeAreaView", props, props.children) };
});

import { Pressable, RefreshControl, TextInput } from "react-native";

import { MemberListScreen } from "./MemberListScreen";
import type { CaptureSubmitter, VoiceRecorder } from "../capture/voice-capture";
import { ConfirmedRequestError } from "../http/request-error";
import type { OfflineDraftStore } from "../offline/offline-drafts";
import type { OfflineDraftSyncClient } from "../offline/synchronize-offline-drafts";
import type { MemberItemsClient } from "./member-items";

const task = { kind: "task" as const, id: "task-1", captureId: "capture-1", title: "Buy milk", state: "open" as const, createdAt: "2026-08-14T08:00:00Z", detailUrl: "/captures/capture-1/review" };
const note = { kind: "note" as const, id: "note-1", captureId: "capture-2", content: "Call the dentist", state: "none" as const, createdAt: "2026-08-14T08:00:00Z", detailUrl: "/captures/capture-2/review" };

describe("MemberListScreen", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("shows loading before the first response", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<MemberListScreen apiBaseUrl="http://api.test" memberId="member-1" />); });

    expect(textContent(renderer)).toContain("Loading your items…");
    renderer.unmount();
  });

  test("refreshes Today’s tasks from every page while Home remains mounted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
    const today = new Date("2026-10-01T12:00:00Z");
    const existingTask = { ...task, dueAt: today.toISOString() };
    const todayTask = { ...task, id: "task-today", captureId: "capture-today", title: "Buy flowers", dueAt: today.toISOString() };
    const list = vi.fn<MemberItemsClient["list"]>()
      .mockResolvedValueOnce({ items: [existingTask], nextCursor: null })
      .mockResolvedValueOnce({ items: [existingTask], nextCursor: null })
      .mockResolvedValueOnce({ items: [existingTask], nextCursor: null })
      .mockResolvedValueOnce({ items: [existingTask], nextCursor: "cursor-today" })
      .mockResolvedValueOnce({ items: [todayTask], nextCursor: null });
    const client: MemberItemsClient = { list, search: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) };
    const renderer = await renderScreen({ client, home: true, timeZone: "UTC" });

    expect(textContent(renderer)).toContain("1 remaining");
    expect(textContent(renderer)).not.toContain("Buy flowers");
    await act(async () => { await renderer.root.findByType(RefreshControl).props.onRefresh(); });

    expect(textContent(renderer)).toContain("Buy flowers");
    expect(textContent(renderer)).toContain("2 remaining");
    expect(list).toHaveBeenCalledTimes(5);
    expect(list).toHaveBeenNthCalledWith(5, "member-1", "cursor-today");
    renderer.unmount();
  });

  test("renders mixed item states and forwards a row detail URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ items: [task, note, { kind: "note", id: "note-2", captureId: "capture-3", content: "Review", state: "needs_review", createdAt: task.createdAt, detailUrl: "/captures/capture-3/review" }, { kind: "capture", id: "capture-4", captureId: "capture-4", state: "pending", createdAt: task.createdAt, detailUrl: "/captures/capture-4/review" }, { kind: "capture", id: "capture-5", captureId: "capture-5", state: "failed", createdAt: task.createdAt, detailUrl: "/captures/capture-5/review" }], nextCursor: null })));
    const onOpenDetail = vi.fn();
    let renderer!: ReactTestRenderer;

    await act(async () => { renderer = create(<MemberListScreen apiBaseUrl="http://api.test" memberId="member-1" onOpenDetail={onOpenDetail} />); });

    expect(textContent(renderer)).toEqual(expect.stringContaining("Buy milk"));
    expect(textContent(renderer)).toEqual(expect.stringContaining("Call the dentist"));
    expect(textContent(renderer)).toEqual(expect.stringContaining("Needs review"));
    expect(textContent(renderer)).toEqual(expect.stringContaining("Processing your Capture"));
    expect(textContent(renderer)).toEqual(expect.stringContaining("Capture processing failed"));
    const firstRow = renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === "Task: Buy milk");
    firstRow?.props.onPress();
    expect(onOpenDetail).toHaveBeenCalledWith("/captures/capture-1/review");
    renderer.unmount();
  });

  test("opens the read-only result review and returns to the same Capture preview", async () => {
    const createdTask = { ...task, captureId: "capture-1", id: "task-new", detailUrl: "/captures/capture-1/review" };
    const client: MemberItemsClient = {
      list: vi.fn().mockResolvedValueOnce({ items: [], nextCursor: null }).mockResolvedValue({ items: [createdTask], nextCursor: null }),
      search: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/captures/capture-1/review")) return jsonResponse({ review: { state: "completed", capture: { id: "capture-1", memberId: "member-1" }, source: { id: "source-1", content: { kind: "audio", contentType: "audio/m4a", byteLength: 1024, sha256: "hash" }, storageState: "stored" }, transcription: { status: "succeeded", text: "Buy milk" }, correction: null, interpretation: { id: "interpretation-1", classification: "clear_supported" }, outcome: { kind: "task", id: "task-new", title: "Buy milk", status: "open", version: 0 }, failure: null } });
      if (url.includes("/metadata")) return jsonResponse({ tags: [], entities: [] });
      if (url.includes("/spaces?")) return jsonResponse({ spaces: [] });
      throw new Error(`Unexpected request ${url}`);
    }));
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn().mockResolvedValue({ uri: "file:///capture.m4a", contentType: "audio/m4a" }), cancel: vi.fn() };
    const renderer = await renderScreen({ client, voiceRecorder: recorder, captureSubmitter: { submit: vi.fn().mockResolvedValue({ captureId: "capture-1" }) } });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Record a voice Capture" }).props.onPress(); });
    await act(async () => { findButton(renderer, "Finish recording").props.onPress(); });
    await act(async () => { findButton(renderer, "Submit Capture").props.onPress(); });

    expect(textContent(renderer)).toContain("Buy milk");
    expect(textContent(renderer)).toContain("AUTO-SAVE");
    expect(textContent(renderer)).toContain("0:15");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Open result details" }).props.onPress(); });
    expect(textContent(renderer)).toContain("TASK");
    expect(textContent(renderer)).not.toContain("Buy milk Buy milk");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Show source and review history" }).props.onPress(); });
    expect(textContent(renderer)).toContain("Original transcription");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Back to Capture result" }).props.onPress(); });
    expect(textContent(renderer)).toContain("RESULT");
    expect(textContent(renderer)).toContain("Buy milk");
    expect(textContent(renderer)).toContain("TIMER STOPPED");
    expect(textContent(renderer)).toContain("countdown stopped while you reviewed");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save result" }).props.onPress(); });
    expect(textContent(renderer)).toContain("Saved to your items");
    renderer.unmount();
  });

  test("keeps review and failure language distinct from Task results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ items: [
      { kind: "note", id: "note-2", captureId: "capture-3", content: "Maybe book a trip", state: "needs_review", createdAt: task.createdAt, detailUrl: "/captures/capture-3/review" },
      { kind: "capture", id: "capture-4", captureId: "capture-4", state: "failed", createdAt: task.createdAt, detailUrl: "/captures/capture-4/review" },
      { kind: "capture", id: "capture-5", captureId: "capture-5", state: "pending", createdAt: task.createdAt, detailUrl: "/captures/capture-5/review" },
    ], nextCursor: null })));
    const renderer = await renderScreen();

    expect(textContent(renderer)).toContain("Needs review");
    expect(textContent(renderer)).toContain("Review this item to confirm what it means.");
    expect(textContent(renderer)).toContain("Capture processing failed");
    expect(textContent(renderer)).toContain("Open review to inspect the failure.");
    expect(textContent(renderer)).toContain("Processing your Capture");
    expect(textContent(renderer)).not.toContain("Task");
    renderer.unmount();
  });

  test("refreshes a Capture from pending to failed and then to Needs review", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ kind: "capture", id: "capture-5", captureId: "capture-5", state: "pending", createdAt: task.createdAt, detailUrl: "/captures/capture-5/review" }], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ kind: "capture", id: "capture-5", captureId: "capture-5", state: "failed", createdAt: task.createdAt, detailUrl: "/captures/capture-5/review" }], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ kind: "note", id: "note-5", captureId: "capture-5", content: "Maybe book a trip", state: "needs_review", createdAt: task.createdAt, detailUrl: "/captures/capture-5/review" }], nextCursor: null }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen();
    const refresh = renderer.root.findByType(RefreshControl);

    expect(textContent(renderer)).toContain("Processing your Capture");
    await act(async () => { await refresh.props.onRefresh(); });
    expect(textContent(renderer)).toContain("Capture processing failed");
    await act(async () => { await refresh.props.onRefresh(); });
    expect(textContent(renderer)).toContain("Needs review");
    expect(textContent(renderer)).not.toContain("Task");
    renderer.unmount();
  });

  test("shows the empty state", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [], nextCursor: null })).mockResolvedValueOnce(jsonResponse({ items: [task], nextCursor: null }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen();

    expect(textContent(renderer)).toContain("Nothing here yet");
    await act(async () => { await renderer.root.findAllByType(Pressable).at(-1)?.props.onPress(); });
    expect(textContent(renderer)).toContain("Buy milk");
    expect(fetcher).toHaveBeenCalledTimes(2);
    renderer.unmount();
  });

  test("shows a request failure without inventing an item", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const renderer = await renderScreen();

    expect(textContent(renderer)).toContain("Couldn’t load your items");
    expect(textContent(renderer)).not.toContain("Task");
    renderer.unmount();
  });

  test("combines search filters and clears them back to the normal timeline", async () => {
    const searchResult = { items: [{ ...task, spaceId: "space-1" }], nextCursor: null };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [task, note], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ spaces: [{ id: "space-1", memberId: "member-1", name: "Home", createdAt: "now" }] }))
      .mockResolvedValueOnce(jsonResponse({ tags: [{ id: "tag-1", memberId: "member-1", name: "urgent", createdAt: "now" }] }))
      .mockResolvedValueOnce(jsonResponse({ entities: [{ id: "entity-1", memberId: "member-1", name: "Office", type: "Place", createdAt: "now" }] }))
      .mockResolvedValue(jsonResponse(searchResult));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen();

    await act(async () => { findButton(renderer, "Open search and filters").props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("milk"); });
    await act(async () => { findButton(renderer, "Apply content search").props.onPress(); });
    await act(async () => { findButton(renderer, "Filter by Space Home").props.onPress(); });
    await act(async () => { findButton(renderer, "Filter by Tag urgent").props.onPress(); });
    await act(async () => { findButton(renderer, "Filter by Entity Office").props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/items/search?memberId=member-1&q=milk&spaceId=space-1&tagId=tag-1&entityId=entity-1");
    expect(textContent(renderer)).toContain("Task");
    expect(textContent(renderer)).not.toContain("Call the dentist");

    await act(async () => { findButton(renderer, "Clear search and filters").props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/items?memberId=member-1");
    renderer.unmount();
  });

  test("ignores a previous search response after filters are cleared", async () => {
    let resolveSearch!: (response: Response) => void;
    const staleSearch = new Promise<Response>((resolve) => { resolveSearch = resolve; });
    const current = { ...note, id: "note-current", captureId: "capture-current", content: "Current timeline" };
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/items/search")) return staleSearch;
      if (url.includes("/spaces")) return Promise.resolve(jsonResponse({ spaces: [] }));
      if (url.includes("/tags")) return Promise.resolve(jsonResponse({ tags: [{ id: "tag-1", memberId: "member-1", name: "urgent", createdAt: "now" }] }));
      if (url.includes("/entities")) return Promise.resolve(jsonResponse({ entities: [] }));
      return Promise.resolve(jsonResponse({ items: [current], nextCursor: null }));
    });
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen();

    await act(async () => { findButton(renderer, "Open search and filters").props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("stale"); });
    act(() => { findButton(renderer, "Apply content search").props.onPress(); });
    await act(async () => { findButton(renderer, "Clear search and filters").props.onPress(); });
    resolveSearch(jsonResponse({ items: [task], nextCursor: null }));
    await act(async () => { await staleSearch; });

    expect(textContent(renderer)).toContain("Current timeline");
    expect(textContent(renderer)).not.toContain("Buy milk");
    renderer.unmount();
  });

  test("does not append a previous pagination response after a filter changes", async () => {
    let resolvePage!: (response: Response) => void;
    const stalePage = new Promise<Response>((resolve) => { resolvePage = resolve; });
    const filtered = { ...note, id: "note-filtered", captureId: "capture-filtered", content: "Filtered note" };
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("cursor=next-page")) return stalePage;
      if (url.includes("/items/search")) return Promise.resolve(jsonResponse({ items: [filtered], nextCursor: null }));
      if (url.includes("/spaces")) return Promise.resolve(jsonResponse({ spaces: [] }));
      if (url.includes("/tags")) return Promise.resolve(jsonResponse({ tags: [{ id: "tag-1", memberId: "member-1", name: "urgent", createdAt: "now" }] }));
      if (url.includes("/entities")) return Promise.resolve(jsonResponse({ entities: [] }));
      return Promise.resolve(jsonResponse({ items: [task], nextCursor: "next-page" }));
    });
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen();

    await act(async () => { await findFlatList(renderer).props.onEndReached(); });
    await act(async () => { findButton(renderer, "Open search and filters").props.onPress(); });
    await act(async () => { findButton(renderer, "Filter by Tag urgent").props.onPress(); });
    resolvePage(jsonResponse({ items: [note], nextCursor: null }));
    await act(async () => { await stalePage; });

    expect(textContent(renderer)).toContain("Filtered note");
    expect(textContent(renderer)).not.toContain("Call the dentist");
    renderer.unmount();
  });

  test("assigns an existing Task to a loaded Space", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [task], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ spaces: [{ id: "space-1", memberId: "member-1", name: "Home", createdAt: "now" }] }))
      .mockResolvedValueOnce(jsonResponse({ assignment: { itemId: "task-1", itemKind: "task", spaceId: "space-1" } }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ ...task, spaceId: "space-1" }], nextCursor: null }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Organize Spaces" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Assign Task to Home" }).props.onPress(); });
    expect(fetcher.mock.calls[2]?.[1]?.method).toBe("PUT");
    expect(fetcher.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ memberId: "member-1", spaceId: "space-1" }));
    expect(textContent(renderer)).toContain("Space: Home");
    renderer.unmount();
  });

  test("retains existing rows and shows a refresh failure", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [task], nextCursor: null })).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen();
    const refresh = renderer.root.findByType(RefreshControl);

    await act(async () => { await refresh.props.onRefresh(); });

    expect(textContent(renderer)).toContain("Buy milk");
    expect(textContent(renderer)).toContain("Refresh failed:");
    expect(textContent(renderer)).toContain("offline");
    renderer.unmount();
  });

  test("keeps loaded rows visible and offers a cursor-specific retry after load-more fails", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [task], nextCursor: "cursor-2" }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen();

    await act(async () => { await findFlatList(renderer).props.onEndReached(); });

    expect(textContent(renderer)).toContain("Buy milk");
    expect(textContent(renderer)).toContain("Couldn’t load more items");
    expect(textContent(renderer)).toContain("offline");
    expect(textContent(renderer)).toContain("Retry loading more items");
    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/items?memberId=member-1&cursor=cursor-2");
    renderer.unmount();
  });

  test("retries the failed cursor and appends each recovered item once", async () => {
    const recovered = { ...note, id: "note-2", captureId: "capture-2" };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [task], nextCursor: "cursor-2" }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse({ items: [task, recovered], nextCursor: null }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen();

    await act(async () => { await findFlatList(renderer).props.onEndReached(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Retry loading more items" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Call the dentist");
    expect(renderer.root.findAllByType(Pressable).filter((node) => node.props.accessibilityLabel === "Task: Buy milk")).toHaveLength(1);
    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/items?memberId=member-1&cursor=cursor-2");
    renderer.unmount();
  });

  test("ignores duplicate retries while the failed cursor is in flight", async () => {
    let resolveRetry!: (response: Response) => void;
    const retry = new Promise<Response>((resolve) => { resolveRetry = resolve; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [task], nextCursor: "cursor-2" }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(retry);
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen();
    await act(async () => { await findFlatList(renderer).props.onEndReached(); });

    act(() => {
      const retryButton = renderer.root.findByProps({ accessibilityLabel: "Retry loading more items" });
      retryButton.props.onPress();
      retryButton.props.onPress();
    });
    resolveRetry(jsonResponse({ items: [note], nextCursor: null }));
    await act(async () => { await retry; });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(renderer.root.findAllByType(Pressable).filter((node) => node.props.accessibilityLabel === "Task: Buy milk")).toHaveLength(1);
    expect(renderer.root.findAllByType(Pressable).filter((node) => node.props.accessibilityLabel === "Note: Call the dentist")).toHaveLength(1);
    renderer.unmount();
  });

  test("keeps recording unavailable when microphone permission is denied", async () => {
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(false), start: vi.fn(), stop: vi.fn(), cancel: vi.fn() };
    const renderer = await renderScreen({ voiceRecorder: recorder });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Record a voice Capture" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Microphone access denied");
    expect(recorder.start).not.toHaveBeenCalled();
    renderer.unmount();
  });

  test("can start and cancel an unsubmitted recording", async () => {
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) };
    const renderer = await renderScreen({ voiceRecorder: recorder });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Record a voice Capture" }).props.onPress(); });
    expect(textContent(renderer)).toContain("Recording Capture");
    expect(textContent(renderer)).toContain("00:00");
    expect(renderer.root.findByProps({ accessibilityLabel: "Recording waveform" })).toBeDefined();
    await act(async () => { findButton(renderer, "Cancel").props.onPress(); });

    expect(recorder.cancel).toHaveBeenCalledOnce();
    expect(textContent(renderer)).not.toContain("Recording Capture");
    renderer.unmount();
  });

  test("explains unavailable metering while keeping the recording controls available", async () => {
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) };
    const renderer = await renderScreen({ voiceRecorder: recorder });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Record a voice Capture" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Microphone level unavailable; recording continues.");
    expect(findButton(renderer, "Finish recording")).toBeDefined();
    renderer.unmount();
  });

  test("explains a recorder interruption without hiding the finish action", async () => {
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) };
    const renderer = await renderScreen({ voiceRecorder: recorder, recordingInterrupted: true, recordingMetering: -18 });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Record a voice Capture" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Microphone input was interrupted. You can still finish this recording.");
    expect(findButton(renderer, "Finish recording")).toBeDefined();
    renderer.unmount();
  });

  test("submits once and retries a failed upload without losing the recording", async () => {
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn().mockResolvedValue({ uri: "file:///capture.m4a", contentType: "audio/m4a" }), cancel: vi.fn() };
    const submit = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ captureId: "capture-1" });
    const captureSubmitter: CaptureSubmitter = { submit };
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen({ voiceRecorder: recorder, captureSubmitter });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Record a voice Capture" }).props.onPress(); });
    await act(async () => { findButton(renderer, "Finish recording").props.onPress(); });
    await act(async () => { findButton(renderer, "Submit Capture").props.onPress(); });

    expect(textContent(renderer)).toContain("Capture submission failed");
    await act(async () => { findButton(renderer, "Retry submission").props.onPress(); });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]?.[0].idempotencyKey).toBe(submit.mock.calls[1]?.[0].idempotencyKey);
    renderer.unmount();
  });

  test("durably saves an unavailable audio submission and presents it as unconfirmed", async () => {
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn().mockResolvedValue({ uri: "file:///capture.m4a", contentType: "audio/m4a" }), cancel: vi.fn().mockResolvedValue(undefined) };
    const captureSubmitter: CaptureSubmitter = { submit: vi.fn().mockRejectedValue(new Error("offline")) };
    const saved = { draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "audio" as const, uri: "file:///documents/draft-1.m4a", contentType: "audio/m4a" } };
    const offlineDraftStore = draftStore({ save: vi.fn().mockResolvedValue(saved) });
    const renderer = await renderScreen({ voiceRecorder: recorder, captureSubmitter, offlineDraftStore });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Record a voice Capture" }).props.onPress(); });
    await act(async () => { findButton(renderer, "Finish recording").props.onPress(); });
    await act(async () => { findButton(renderer, "Submit Capture").props.onPress(); });

    expect(offlineDraftStore.save).toHaveBeenCalledWith(expect.objectContaining({
      memberId: "member-1",
      source: { kind: "audio", uri: "file:///capture.m4a", contentType: "audio/m4a" },
    }));
    expect(textContent(renderer)).toContain("Offline draft");
    expect(textContent(renderer)).toContain("Voice Capture");
    expect(textContent(renderer)).toContain("Not confirmed");
    expect(textContent(renderer)).not.toContain("Capture submission failed");
    renderer.unmount();
  });

  test("does not turn a confirmed client rejection into an Offline draft", async () => {
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn().mockResolvedValue({ uri: "file:///capture.m4a", contentType: "audio/m4a" }), cancel: vi.fn() };
    const captureSubmitter: CaptureSubmitter = { submit: vi.fn().mockRejectedValue(new ConfirmedRequestError("Invalid Capture", 400)) };
    const offlineDraftStore = draftStore();
    const renderer = await renderScreen({ voiceRecorder: recorder, captureSubmitter, offlineDraftStore });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Record a voice Capture" }).props.onPress(); });
    await act(async () => { findButton(renderer, "Finish recording").props.onPress(); });
    await act(async () => { findButton(renderer, "Submit Capture").props.onPress(); });

    expect(offlineDraftStore.save).not.toHaveBeenCalled();
    expect(textContent(renderer)).toContain("Capture submission failed");
    expect(textContent(renderer)).not.toContain("Not confirmed");
    renderer.unmount();
  });

  test("keeps a newly saved draft when startup restoration finishes later", async () => {
    let resolveDrafts!: (drafts: readonly []) => void;
    const startupDrafts = new Promise<readonly []>((resolve) => { resolveDrafts = resolve; });
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn().mockResolvedValue({ uri: "file:///capture.m4a", contentType: "audio/m4a" }), cancel: vi.fn().mockResolvedValue(undefined) };
    const saved = { draftId: "draft-new", memberId: "member-1", capturedAt: "2026-08-15T12:00:00.000Z", source: { kind: "audio" as const, uri: "file:///documents/draft-new.m4a", contentType: "audio/m4a" } };
    const offlineDraftStore = draftStore({ list: vi.fn().mockReturnValue(startupDrafts), save: vi.fn().mockResolvedValue(saved) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ items: [], nextCursor: null })));
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<MemberListScreen apiBaseUrl="http://api.test" memberId="member-1" voiceRecorder={recorder} captureSubmitter={{ submit: vi.fn().mockRejectedValue(new Error("offline")) }} offlineDraftStore={offlineDraftStore} />); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Record a voice Capture" }).props.onPress(); });
    await act(async () => { findButton(renderer, "Finish recording").props.onPress(); });
    await act(async () => { findButton(renderer, "Submit Capture").props.onPress(); });
    expect(textContent(renderer)).toContain("Voice Capture");

    await act(async () => { resolveDrafts([]); await startupDrafts; });

    expect(textContent(renderer)).toContain("Voice Capture");
    renderer.unmount();
  });

  test("does not restore a draft deleted while startup restoration is pending", async () => {
    const draft = { draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T12:00:00.000Z", source: { kind: "audio" as const, uri: "file:///documents/draft-1.m4a", contentType: "audio/m4a" } };
    let resolveDrafts!: (drafts: readonly [typeof draft]) => void;
    const startupDrafts = new Promise<readonly [typeof draft]>((resolve) => { resolveDrafts = resolve; });
    const offlineDraftStore = draftStore({ list: vi.fn().mockReturnValue(startupDrafts), save: vi.fn().mockResolvedValue(draft) });
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn().mockResolvedValue({ uri: "file:///capture.m4a", contentType: "audio/m4a" }), cancel: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ items: [], nextCursor: null })));
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<MemberListScreen apiBaseUrl="http://api.test" memberId="member-1" voiceRecorder={recorder} captureSubmitter={{ submit: vi.fn().mockRejectedValue(new Error("offline")) }} offlineDraftStore={offlineDraftStore} />); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Record a voice Capture" }).props.onPress(); });
    await act(async () => { findButton(renderer, "Finish recording").props.onPress(); });
    await act(async () => { findButton(renderer, "Submit Capture").props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Delete Offline draft Voice Capture" }).props.onPress(); });

    await act(async () => { resolveDrafts([draft]); await startupDrafts; });

    expect(textContent(renderer)).not.toContain("Voice Capture");
    renderer.unmount();
  });

  test("restores multiple Offline drafts while the backend remains unavailable", async () => {
    const offlineDraftStore = draftStore({ list: vi.fn().mockResolvedValue([
      { draftId: "draft-audio", memberId: "member-1", capturedAt: "2026-08-15T11:00:00.000Z", source: { kind: "audio", uri: "file:///documents/draft-audio.m4a", contentType: "audio/m4a" } },
      { draftId: "draft-text", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "text", text: "Call the dentist" } },
    ]) });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const renderer = await renderScreen({ offlineDraftStore });

    expect(textContent(renderer)).toContain("Voice Capture");
    expect(textContent(renderer)).toContain("Call the dentist");
    expect(textContent(renderer).match(/Not confirmed/g)).toHaveLength(2);
    expect(textContent(renderer)).not.toContain("Couldn’t load your items");
    expect(textContent(renderer)).not.toContain("Task");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Delete Offline draft Voice Capture" }).props.onPress(); });
    expect(offlineDraftStore.remove).toHaveBeenCalledWith("member-1", "draft-audio");
    expect(textContent(renderer)).not.toContain("Voice Capture");
    expect(textContent(renderer)).toContain("Call the dentist");
    renderer.unmount();
  });

  test("synchronizes restored drafts, removes only confirmed drafts, and offers retry after failure", async () => {
    const confirmed = { draftId: "draft-confirmed", memberId: "member-1", capturedAt: "2026-08-15T11:00:00.000Z", source: { kind: "text" as const, text: "Confirmed note" } };
    const failed = { draftId: "draft-failed", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "text" as const, text: "Retry me" } };
    const offlineDraftStore = draftStore({ list: vi.fn().mockResolvedValue([confirmed, failed]) });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ items: [note], nextCursor: null }))));
    const synchronize = vi.fn<OfflineDraftSyncClient["synchronize"]>()
      .mockResolvedValueOnce({ draftId: confirmed.draftId, state: "confirmed", retryable: false })
      .mockResolvedValueOnce({ draftId: failed.draftId, state: "failed", retryable: true, message: "offline" })
      .mockResolvedValueOnce({ draftId: failed.draftId, state: "confirmed", retryable: false });
    const offlineDraftSyncClient: OfflineDraftSyncClient = { synchronize };
    const renderer = await renderScreen({ offlineDraftStore, offlineDraftSyncClient });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });

    expect(offlineDraftStore.remove).toHaveBeenCalledWith("member-1", "draft-confirmed");
    expect(textContent(renderer)).toContain("Retry me");
    expect(textContent(renderer)).toContain("offline");
    await act(async () => { findButton(renderer, "Retry synchronization").props.onPress(); });
    expect(offlineDraftStore.remove).toHaveBeenCalledWith("member-1", "draft-failed");
    expect(synchronize).toHaveBeenCalledTimes(3);
    renderer.unmount();
  });

  test("keeps a confirmed draft retryable when local cleanup fails", async () => {
    const draft = { draftId: "draft-confirmed", memberId: "member-1", capturedAt: "2026-08-15T11:00:00.000Z", source: { kind: "text" as const, text: "Confirmed note" } };
    const remove = vi.fn().mockRejectedValueOnce(new Error("file locked")).mockResolvedValue(undefined);
    const offlineDraftStore = draftStore({ list: vi.fn().mockResolvedValue([draft]), remove });
    const synchronize = vi.fn<OfflineDraftSyncClient["synchronize"]>().mockResolvedValue({ draftId: draft.draftId, state: "confirmed", retryable: false });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ items: [note], nextCursor: null }))));
    const renderer = await renderScreen({ offlineDraftStore, offlineDraftSyncClient: { synchronize } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });

    expect(textContent(renderer)).toContain("Local cleanup failed: file locked");
    await act(async () => { findButton(renderer, "Retry synchronization").props.onPress(); });
    expect(remove).toHaveBeenCalledTimes(2);
    renderer.unmount();
  });

  test("surfaces a persistence failure without claiming an Offline draft was saved", async () => {
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn().mockResolvedValue({ uri: "file:///capture.m4a", contentType: "audio/m4a" }), cancel: vi.fn() };
    const captureSubmitter: CaptureSubmitter = { submit: vi.fn().mockRejectedValue(new Error("offline")) };
    const offlineDraftStore = draftStore({ save: vi.fn().mockRejectedValue(new Error("disk full")) });
    const renderer = await renderScreen({ voiceRecorder: recorder, captureSubmitter, offlineDraftStore });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Record a voice Capture" }).props.onPress(); });
    await act(async () => { findButton(renderer, "Finish recording").props.onPress(); });
    await act(async () => { findButton(renderer, "Submit Capture").props.onPress(); });

    expect(textContent(renderer)).toContain("Capture submission failed");
    expect(textContent(renderer)).toContain("Offline draft was not saved: disk full");
    expect(textContent(renderer)).not.toContain("Not confirmed");
    renderer.unmount();
  });

  test("surfaces corrupted Offline draft storage", async () => {
    const offlineDraftStore = draftStore({ list: vi.fn().mockRejectedValue(new Error("Offline draft storage is corrupted")) });
    const renderer = await renderScreen({ offlineDraftStore });

    expect(textContent(renderer)).toContain("Couldn’t restore Offline drafts: Offline draft storage is corrupted");
    renderer.unmount();
  });

  test("identifies an explicit Offline draft deletion failure", async () => {
    const offlineDraftStore = draftStore({
      list: vi.fn().mockResolvedValue([
        { draftId: "draft-audio", memberId: "member-1", capturedAt: "2026-08-15T11:00:00.000Z", source: { kind: "audio", uri: "file:///documents/draft-audio.m4a", contentType: "audio/m4a" } },
      ]),
      remove: vi.fn().mockRejectedValue(new Error("file locked")),
    });
    const renderer = await renderScreen({ offlineDraftStore });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Delete Offline draft Voice Capture" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Couldn’t delete Offline draft: file locked");
    expect(textContent(renderer)).toContain("Voice Capture");
    renderer.unmount();
  });
});

async function renderScreen(props: Partial<React.ComponentProps<typeof MemberListScreen>> = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<MemberListScreen apiBaseUrl="http://api.test" memberId="member-1" {...props} />); });
  return renderer;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function textContent(renderer: ReactTestRenderer): string {
  return renderer.root.findAll((node) => String(node.type) === "Text").flatMap((node) => node.children).filter((child): child is string => typeof child === "string").join(" ");
}

function findFlatList(renderer: ReactTestRenderer): ReactTestInstance { return renderer.root.findAll((node) => String(node.type) === "FlatList")[0]!; }

function findButton(renderer: ReactTestRenderer, label: string) {
  const button = renderer.root.findAllByType(Pressable).find((node) => {
    return node.props.accessibilityLabel === label || reactNodeText(node.props.children).includes(label);
  });
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

function reactNodeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(reactNodeText).join("");
  if (typeof value === "object" && value !== null && "props" in value) {
    return reactNodeText((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function draftStore(overrides: Partial<OfflineDraftStore> = {}): OfflineDraftStore {
  return {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
