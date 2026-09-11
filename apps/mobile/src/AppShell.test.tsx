import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  return { Pressable: host("Pressable"), ScrollView: host("ScrollView"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), View: host("View") };
});
vi.mock("react-native-safe-area-context", async () => {
  const React = await import("react");
  return { SafeAreaView: (props: { readonly children?: React.ReactNode }) => React.createElement("SafeAreaView", props, props.children) };
});

import { AppShell } from "./AppShell";
import { Text, Pressable } from "react-native";

describe("AppShell", () => {
  test("provides accessible navigation and capture affordance", () => {
    const onTabChange = vi.fn();
    const onCapture = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<AppShell tab="home" onTabChange={onTabChange} onCapture={onCapture}> <Text>Home content</Text> </AppShell>); });
    const find = (label: string) => renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === label);
    expect(find("Open Home")?.props.accessibilityState).toEqual({ selected: true });
    expect(find("Start a voice Capture")).toBeDefined();
    act(() => { find("Open Digest")?.props.onPress(); find("Start a voice Capture")?.props.onPress(); });
    expect(onTabChange).toHaveBeenCalledWith("digest");
    expect(onCapture).toHaveBeenCalledOnce();
  });
});
