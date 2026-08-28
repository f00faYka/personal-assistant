import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => function Host(props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) { return React.createElement(name, props, props.children); };
  return { ActivityIndicator: host("ActivityIndicator"), Pressable: host("Pressable"), Text: host("Text"), TextInput: host("TextInput"), View: host("View") };
});

import { Pressable, Text, TextInput } from "react-native";
import { SpacePanel } from "./SpacePanel";
import type { SpacesClient } from "./spaces";

const home = { id: "space-1", memberId: "member-1", name: "Home", createdAt: "now" };

describe("SpacePanel", () => {
  test("loads Spaces, creates a top-level Space, and selects the unassigned root", async () => {
    const client: SpacesClient = { list: vi.fn().mockResolvedValue([home]), create: vi.fn().mockResolvedValue({ ...home, id: "space-2", name: "Work" }), read: vi.fn(), update: vi.fn(), archive: vi.fn(), restore: vi.fn(), remove: vi.fn(), assign: vi.fn() };
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
    const client: SpacesClient = { list: vi.fn().mockResolvedValue([home]), create: vi.fn().mockResolvedValue({ ...home, id: "space-2", name: "Kitchen", parentId: home.id }), read: vi.fn(), update: vi.fn(), archive: vi.fn(), restore: vi.fn(), remove: vi.fn(), assign: vi.fn() };
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<SpacePanel client={client} memberId="member-1" selectedSpaceId={null} onSelect={vi.fn()} onSpacesChanged={vi.fn()} />); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Organize Spaces" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Create child Space under Home" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Kitchen"); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Create child Space" }).props.onPress(); });
    expect(client.create).toHaveBeenCalledWith("member-1", "Kitchen", "space-1");
    renderer.unmount();
  });

  test("renders nested paths in flat mode and can rename, archive, restore, and delete", async () => {
    const child = { ...home, id: "space-2", name: "Kitchen", parentId: home.id };
    const client: SpacesClient = { list: vi.fn().mockResolvedValue([home, child]), create: vi.fn(), read: vi.fn(), update: vi.fn().mockResolvedValue({ ...home, name: "House" }), archive: vi.fn().mockResolvedValue({ ...home, archivedAt: "later" }), restore: vi.fn().mockResolvedValue(home), remove: vi.fn().mockResolvedValue(undefined), assign: vi.fn() };
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<SpacePanel client={client} memberId="member-1" selectedSpaceId={null} onSelect={vi.fn()} onSpacesChanged={vi.fn()} />); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Organize Spaces" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Flat Space view" }).props.onPress(); });
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
    expect(textContent(renderer)).toContain("Home / Kitchen");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Rename Space Home" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Rename Space Home" }).findByType(TextInput).props.onChangeText("House"); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Save Space Home" }).props.onPress(); });
    expect(client.update).toHaveBeenCalledWith("member-1", "space-1", { name: "House" });
    const archiveButton = renderer.root.findAllByType(Pressable).find((node) => String(node.props.accessibilityLabel).startsWith("Archive Space"));
    await act(async () => { await archiveButton?.props.onPress(); });
    expect(client.archive).toHaveBeenCalledWith("member-1", "space-1");
    renderer.unmount();
  });
});

function textContent(renderer: ReactTestRenderer): string { return renderer.root.findAllByType(Text).map((node) => String(node.props.children ?? "")).join(" "); }
