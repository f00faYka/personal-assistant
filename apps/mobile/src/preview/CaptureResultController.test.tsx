import { act, create, type ReactTestRenderer } from "react-test-renderer";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  return { ActivityIndicator: host("ActivityIndicator"), Pressable: host("Pressable"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), View: host("View") };
});
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));

import { Pressable, Text } from "react-native";
import { CaptureResultProvider, useCaptureResultController } from "./CaptureResultController";
import type { MemberItemsClient } from "../list/member-items";

describe("CaptureResultProvider", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  test("keeps the result drawer mounted over the app when the active screen changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 })));
    const item = { kind: "task" as const, id: "task-1", captureId: "capture-1", title: "Buy milk", state: "open" as const, createdAt: "now", detailUrl: "/captures/capture-1/review" };
    const client: MemberItemsClient = {
      list: vi.fn().mockResolvedValueOnce({ items: [], nextCursor: null }).mockResolvedValue({ items: [item], nextCursor: null }),
      search: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(<CaptureResultProvider apiBaseUrl="http://api.test" memberId="member-1" timeZone="UTC" client={client}><ScreenSwitcher /></CaptureResultProvider>);
    });

    await act(async () => { findButton(renderer, "Start Capture").props.onPress(); });
    expect(textContent(renderer)).toContain("Processing your Capture");
    expect(renderer.root.findByProps({ accessibilityLabel: "Capture result drawer" })).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(textContent(renderer)).toContain("Buy milk");
    expect(textContent(renderer)).toContain("AUTO-SAVE");

    act(() => { findButton(renderer, "Open Find").props.onPress(); });

    expect(textContent(renderer)).toContain("Find");
    expect(textContent(renderer)).toContain("screen");
    expect(textContent(renderer)).toContain("Buy milk");
    expect(textContent(renderer)).toContain("AUTO-SAVE");
    renderer.unmount();
  });
});

function ScreenSwitcher() {
  const [screen, setScreen] = React.useState("Home");
  const { begin } = useCaptureResultController();
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Start Capture" onPress={() => begin("capture-1", null)}><Text>Start Capture</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Open Find" onPress={() => setScreen("Find")}><Text>Open Find</Text></Pressable>
    <Text>{screen} screen</Text>
  </>;
}

function findButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === label)!;
}

function textContent(renderer: ReactTestRenderer): string {
  return renderer.root.findAll((node) => String(node.type) === "Text").flatMap((node) => node.children).filter((child): child is string => typeof child === "string").join(" ");
}
