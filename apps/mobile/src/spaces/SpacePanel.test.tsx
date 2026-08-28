import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", async () => { const React = await import("react"); const host = (name: string) => function Host(props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) { return React.createElement(name, props, props.children); }; return { ActivityIndicator: host("ActivityIndicator"), Pressable: host("Pressable"), Text: host("Text"), TextInput: host("TextInput"), View: host("View") }; });

import { Pressable, Text, TextInput } from "react-native";
import { SpacePanel } from "./SpacePanel";
import type { SpaceTreeView, SpacesClient } from "./spaces";

const home = { id: "space-1", memberId: "member-1", name: "Home", createdAt: "now" };
const work = { ...home, id: "space-2", name: "Work" };
const child = { ...home, id: "space-3", name: "Kitchen", parentId: home.id };
const hierarchical: SpaceTreeView = { space: home, path: "Home", children: [{ space: child, path: "Home / Kitchen", children: [], items: [] }], items: [{ itemId: "task-1", itemKind: "task", spaceId: home.id, path: "Home", title: "Buy milk" }] };
const flat: SpaceTreeView = { ...hierarchical, children: [], items: [{ itemId: "note-1", itemKind: "note", spaceId: child.id, path: "Home / Kitchen", content: "Call dentist" }] };

describe("SpacePanel", () => {
  test("loads, creates nested Spaces, and selects the unassigned root", async () => {
    const client = makeClient({ list: vi.fn().mockResolvedValue([home]), create: vi.fn().mockResolvedValue({ ...home, id: "space-4", name: "Office" }) }); const onSelect = vi.fn(); const renderer = render(client, onSelect);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Organize Spaces" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Office"); }); await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Create top-level Space" }).props.onPress(); });
    expect(client.create).toHaveBeenCalledWith("member-1", "Office", undefined); expect(onSelect).toHaveBeenCalledWith("space-4");
    expect(renderer.root.findByProps({ accessibilityLabel: "Select Space Office" })).toBeDefined();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Unassigned root" }).props.onPress(); }); expect(onSelect).toHaveBeenLastCalledWith(null); renderer.unmount();
  });

  test("shows hierarchical and flat content, move destinations, and lifecycle safeguards", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(hierarchical)
      .mockResolvedValueOnce(flat)
      .mockResolvedValueOnce(flat)
      .mockResolvedValueOnce({ ...hierarchical, children: [], items: [] })
      .mockResolvedValueOnce(hierarchical)
      .mockResolvedValue(hierarchical);
    const onSelect = vi.fn();
    const client = makeClient({ list: vi.fn().mockResolvedValue([home, work, child]), read, update: vi.fn().mockResolvedValue({ ...home, parentId: work.id }), archive: vi.fn().mockResolvedValue({ ...home, archivedAt: "later" }), restore: vi.fn().mockResolvedValue(home), remove: vi.fn().mockResolvedValue(undefined) }); const renderer = render(client, onSelect);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Organize Spaces" }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Select Space Home" }).props.onPress(); }); expect(read).toHaveBeenLastCalledWith("member-1", "space-1", "hierarchical"); expect(textContent(renderer)).toContain("Child Space:"); expect(textContent(renderer)).toContain("Kitchen"); expect(textContent(renderer)).toContain("Buy milk");
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Flat Space view" }).props.onPress(); }); expect(read).toHaveBeenLastCalledWith("member-1", "space-1", "flat"); expect(textContent(renderer)).toContain("Home / Kitchen:"); expect(textContent(renderer)).toContain("Call dentist");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Move Space Home" }).props.onPress(); }); await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Move Space Home to Work" }).props.onPress(); }); expect(client.update).toHaveBeenCalledWith("member-1", "space-1", { parentId: "space-2" });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Delete Space Kitchen" }).props.onPress(); }); expect(client.remove).toHaveBeenCalledWith("member-1", "space-3");
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Delete Space Home" }).props.onPress(); }); expect(client.archive).toHaveBeenCalledWith("member-1", "space-1"); expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(renderer.root.findByProps({ accessibilityLabel: "Restore Space Home" })).toBeDefined(); await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Restore Space Home" }).props.onPress(); }); expect(client.restore).toHaveBeenCalledWith("member-1", "space-1"); renderer.unmount();
  });

  test("refreshes selected content after a Space rename", async () => {
    const fresh = { ...hierarchical, space: { ...home, name: "House" }, path: "House", items: [{ ...hierarchical.items[0], title: "Fresh content" }] };
    const client = makeClient({ list: vi.fn().mockResolvedValue([home]), read: vi.fn().mockResolvedValueOnce(hierarchical).mockResolvedValueOnce(fresh), update: vi.fn().mockResolvedValue({ ...home, name: "House" }) });
    const renderer = render(client);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Organize Spaces" }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Select Space Home" }).props.onPress(); });
    expect(textContent(renderer)).toContain("Buy milk");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Rename Space Home" }).props.onPress(); });
    const renameInput = renderer.root.findAllByType(TextInput).find((node) => node.props.accessibilityLabel === "Rename Space Home")!;
    await act(async () => { renameInput.props.onChangeText("House"); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Save Space Home" }).props.onPress(); });
    expect(client.read).toHaveBeenLastCalledWith("member-1", "space-1", "hierarchical");
    expect(textContent(renderer)).toContain("Fresh content");
    expect(textContent(renderer)).not.toContain("Buy milk");
    renderer.unmount();
  });

  test("shows one restore action for an archived subtree root", async () => {
    const client = makeClient({ list: vi.fn().mockResolvedValue([home, child]), archive: vi.fn().mockResolvedValue({ ...home, archivedAt: "later" }) });
    const renderer = render(client);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Organize Spaces" }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Archive Space Home" }).props.onPress(); });
    expect(renderer.root.findAllByType(Pressable).filter((node) => node.props.accessibilityLabel === "Restore Space Home")).toHaveLength(1);
    expect(renderer.root.findAllByType(Pressable).filter((node) => node.props.accessibilityLabel === "Restore Space Kitchen")).toHaveLength(0);
    renderer.unmount();
  });

  test("flat mode excludes an unrelated top-level Space from selected content", async () => {
    const homeFlat = { ...flat, items: [{ ...flat.items[0], path: "Home", content: "Home note" }] };
    const client = makeClient({ list: vi.fn().mockResolvedValue([home, work]), read: vi.fn().mockResolvedValueOnce(hierarchical).mockResolvedValueOnce(homeFlat) });
    const renderer = render(client);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Organize Spaces" }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Select Space Home" }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: "Flat Space view" }).props.onPress(); });
    const contents = renderer.root.findByProps({ accessibilityLabel: "Selected Space contents" });
    expect(textContent(contents)).toContain("Home note");
    expect(textContent(contents)).not.toContain("Work");
    renderer.unmount();
  });
});

function makeClient(overrides: Partial<SpacesClient> = {}): SpacesClient { return { list: vi.fn(), create: vi.fn(), read: vi.fn(), update: vi.fn(), archive: vi.fn(), restore: vi.fn(), remove: vi.fn(), assign: vi.fn(), ...overrides }; }
function render(client: SpacesClient, onSelect = vi.fn()): ReactTestRenderer { let renderer!: ReactTestRenderer; act(() => { renderer = create(<SpacePanel client={client} memberId="member-1" selectedSpaceId={null} onSelect={onSelect} onSpacesChanged={vi.fn()} />); }); return renderer; }
function textContent(renderer: ReactTestRenderer | ReactTestInstance): string {
  const root = "root" in renderer ? renderer.root : renderer;
  return root.findAllByType(Text).map((node) => String(node.props.children ?? "")).join(" ");
}
