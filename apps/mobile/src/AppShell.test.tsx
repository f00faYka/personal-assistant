import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  return { Pressable: host("Pressable"), ScrollView: host("ScrollView"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), View: host("View") };
});
vi.mock("react-native-safe-area-context", async () => {
  const React = await import("react");
  return { SafeAreaView: (props: { readonly children?: React.ReactNode }) => React.createElement("SafeAreaView", props, props.children), useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});

import { AppShell, MeSurface } from "./AppShell";
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
    act(() => { find("Open Calendar")?.props.onPress(); find("Start a voice Capture")?.props.onPress(); });
    expect(onTabChange).toHaveBeenCalledWith("calendar");
    expect(onCapture).toHaveBeenCalledOnce();
  });

  test("exposes one discoverable Materials entry from the library host", () => {
    const onOpenMaterials = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<MeSurface onOpenMaterials={onOpenMaterials} />); });

    const entry = renderer.root.findByProps({ accessibilityLabel: "Open Materials" });
    act(() => { entry.props.onPress(); });

    expect(onOpenMaterials).toHaveBeenCalledOnce();
  });
});
