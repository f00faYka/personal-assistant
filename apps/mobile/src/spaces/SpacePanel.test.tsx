import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => function Host(props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) { return React.createElement(name, props, props.children); };
  return { ActivityIndicator: host("ActivityIndicator"), Pressable: host("Pressable"), Text: host("Text"), TextInput: host("TextInput"), View: host("View") };
});

import { TextInput } from "react-native";
import { SpacePanel } from "./SpacePanel";
import type { SpacesClient } from "./spaces";

const home = { id: "space-1", memberId: "member-1", name: "Home", createdAt: "now" };

describe("SpacePanel", () => {
  test("loads Spaces, creates a top-level Space, and selects the unassigned root", async () => {
    const client: SpacesClient = { list: vi.fn().mockResolvedValue([home]), create: vi.fn().mockResolvedValue({ ...home, id: "space-2", name: "Work" }), assign: vi.fn() };
    const onSelect = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<SpacePanel client={client} memberId="member-1" selectedSpaceId={null} onSelect={onSelect} onSpacesChanged={vi.fn()} />); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Organize Spaces" }).props.onPress(); });
    expect(client.list).toHaveBeenCalledWith("member-1");
    expect(renderer.root.findByProps({ accessibilityLabel: "Select Space Home" })).toBeDefined();
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Work"); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Create top-level Space" }).props.onPress(); });
    expect(client.create).toHaveBeenCalledWith("member-1", "Work", undefined);
    expect(onSelect).toHaveBeenCalledWith("space-2");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Unassigned root" }).props.onPress(); });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    renderer.unmount();
  });

  test("selects a parent before creating a child Space", async () => {
    const client: SpacesClient = { list: vi.fn().mockResolvedValue([home]), create: vi.fn().mockResolvedValue({ ...home, id: "space-2", name: "Kitchen", parentId: home.id }), assign: vi.fn() };
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<SpacePanel client={client} memberId="member-1" selectedSpaceId={null} onSelect={vi.fn()} onSpacesChanged={vi.fn()} />); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Organize Spaces" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Create child Space under Home" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Kitchen"); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Create child Space" }).props.onPress(); });
    expect(client.create).toHaveBeenCalledWith("member-1", "Kitchen", "space-1");
    renderer.unmount();
  });
});
