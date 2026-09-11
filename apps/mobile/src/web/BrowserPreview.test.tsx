import { act, create } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  return { Pressable: host("Pressable"), ScrollView: host("ScrollView"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), View: host("View") };
});
vi.mock("react-native-safe-area-context", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  return { SafeAreaView: host("SafeAreaView") };
});

import { BrowserPreview } from "./BrowserPreview";

describe("BrowserPreview", () => {
  test("exposes fixture navigation without enabling native capture", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<BrowserPreview />); });

    expect(renderer.root.findAllByProps({ accessibilityRole: "alert" }).length).toBeGreaterThan(0);
    expect(renderer.root.findByProps({ accessibilityLabel: "Start a voice Capture" }).props.disabled).toBe(true);
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Open Calendar" }).props.onPress(); });
    expect(renderer.root.findAll((node) => String(node.type) === "Text").some((node) => node.props.children === "Calendar")).toBe(true);
  });
});
