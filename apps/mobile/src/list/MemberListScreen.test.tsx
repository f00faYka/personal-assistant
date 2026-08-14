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
    FlatList,
    Pressable: host("Pressable"),
    RefreshControl: host("RefreshControl"),
    SafeAreaView: host("SafeAreaView"),
    StyleSheet: { create: <T,>(styles: T): T => styles },
    Text: host("Text"),
    View: host("View"),
  };
});

import { Pressable, RefreshControl } from "react-native";

import { MemberListScreen } from "./MemberListScreen";
import type { CaptureSubmitter, VoiceRecorder } from "../capture/voice-capture";

const task = { kind: "task" as const, id: "task-1", captureId: "capture-1", title: "Buy milk", state: "open" as const, createdAt: "2026-08-14T08:00:00Z", detailUrl: "/captures/capture-1/review" };
const note = { kind: "note" as const, id: "note-1", captureId: "capture-2", content: "Call the dentist", state: "none" as const, createdAt: "2026-08-14T08:00:00Z", detailUrl: "/captures/capture-2/review" };

describe("MemberListScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("shows loading before the first response", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<MemberListScreen apiBaseUrl="http://api.test" memberId="member-1" />); });

    expect(textContent(renderer)).toContain("Loading your items…");
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
    expect(textContent(renderer)).toEqual(expect.stringContaining("This Capture could not be processed"));
    const firstRow = renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === "Task: Buy milk");
    firstRow?.props.onPress();
    expect(onOpenDetail).toHaveBeenCalledWith("/captures/capture-1/review");
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
    await act(async () => { findButton(renderer, "Cancel").props.onPress(); });

    expect(recorder.cancel).toHaveBeenCalledOnce();
    expect(textContent(renderer)).not.toContain("Recording Capture");
    renderer.unmount();
  });

  test("submits once and retries a failed upload without losing the recording", async () => {
    const recorder: VoiceRecorder = { requestPermission: vi.fn().mockResolvedValue(true), start: vi.fn(), stop: vi.fn().mockResolvedValue({ uri: "file:///capture.m4a", contentType: "audio/m4a" }), cancel: vi.fn() };
    const submit = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
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

function findButton(renderer: ReactTestRenderer, label: string) {
  const button = renderer.root.findAllByType(Pressable).find((node) => {
    const child = node.props.children as { props?: { children?: unknown } } | undefined;
    return child?.props?.children === label;
  });
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}
