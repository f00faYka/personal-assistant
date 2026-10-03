import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  return { ActivityIndicator: host("ActivityIndicator"), Pressable: host("Pressable"), RefreshControl: host("RefreshControl"), ScrollView: host("ScrollView"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), TextInput: host("TextInput"), View: host("View") };
});
vi.mock("../web/TaskNoteCardPrototype", async () => {
  const React = await import("react");
  return {
    NoteCard: (props: { readonly note: { readonly content: string }; readonly onPress: () => void }) => React.createElement("NoteCard", { accessibilityLabel: `Open Note ${props.note.content}`, onPress: props.onPress }, props.note.content),
    TaskCard: (props: { readonly task: { readonly title: string }; readonly onPress: () => void }) => React.createElement("TaskCard", { accessibilityLabel: `Open Task ${props.task.title}`, onPress: props.onPress }, props.task.title),
  };
});

import type { MemberItemsClient } from "../list/member-items";
import type { Space } from "../spaces/spaces";
import { Text } from "react-native";
import { MaterialsScreen } from "./MaterialsScreen";

const spaces: readonly Space[] = [
  { id: "home", memberId: "member-1", name: "Home", createdAt: "now" },
  { id: "health", memberId: "member-1", name: "Health", parentId: "home", createdAt: "now" },
];
const task = (id: string, title: string, spaceId?: string) => ({ kind: "task" as const, id, captureId: `capture-${id}`, title, state: "open" as const, createdAt: "now", detailUrl: `/captures/${id}/review`, ...(spaceId ? { spaceId } : {}) });

function textContent(renderer: ReactTestRenderer): string {
  const values: string[] = [];
  renderer.root.findAll((node) => {
    if (typeof node.children[0] === "string") values.push(node.children[0]);
    return false;
  });
  return values.join(" ");
}

function button(renderer: ReactTestRenderer, accessibilityLabel: string) {
  return renderer.root.findByProps({ accessibilityLabel });
}

function renderScreen(client: MemberItemsClient) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<MaterialsScreen apiBaseUrl="http://api.test" memberId="member-1" timeZone="Europe/Warsaw" client={client} spacesClient={{ list: vi.fn().mockResolvedValue(spaces) }} metadataClient={{ listTags: vi.fn().mockResolvedValue([]), listEntities: vi.fn().mockResolvedValue([]) }} onOpenDetail={vi.fn()} />);
  });
  return renderer;
}

describe("MaterialsScreen", () => {
  test("shows the complete flat collection, then browses nested Spaces and direct items", async () => {
    const client: MemberItemsClient = {
      list: vi.fn().mockResolvedValueOnce({ items: [task("unassigned", "Unassigned task"), task("home-task", "Home task", "home")], nextCursor: "next" }).mockResolvedValueOnce({ items: [task("health-task", "Health task", "health")], nextCursor: null }),
      search: vi.fn(),
    };
    const renderer = renderScreen(client);
    await act(async () => { await Promise.resolve(); });

    expect(textContent(renderer)).toContain("Unassigned task");
    expect(textContent(renderer)).toContain("Health task");
    act(() => { button(renderer, "View By Spaces").props.onPress(); });
    expect(textContent(renderer)).toContain("Unassigned");
    act(() => { button(renderer, "Open Space Home").props.onPress(); });
    expect(textContent(renderer)).toContain("Home / Health");
    expect(textContent(renderer)).toContain("Home task");
    act(() => { button(renderer, "Open Space Home / Health").props.onPress(); });
    expect(textContent(renderer)).toContain("Home / Health");
    expect(textContent(renderer)).toContain("Health task");
    expect(textContent(renderer)).not.toContain("Home task");
    renderer.unmount();
  });

  test("keeps the current Materials context while opening and returning from detail", async () => {
    const client: MemberItemsClient = { list: vi.fn().mockResolvedValue({ items: [task("one", "Keep this context", "home")], nextCursor: null }), search: vi.fn() };
    const onOpenDetail = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<MaterialsScreen apiBaseUrl="http://api.test" memberId="member-1" timeZone="Europe/Warsaw" client={client} spacesClient={{ list: vi.fn().mockResolvedValue(spaces) }} metadataClient={{ listTags: vi.fn().mockResolvedValue([]), listEntities: vi.fn().mockResolvedValue([]) }} onOpenDetail={onOpenDetail} />); });
    await act(async () => { await Promise.resolve(); });
    act(() => { button(renderer, "View By Spaces").props.onPress(); });
    act(() => { button(renderer, "Open Space Home").props.onPress(); });
    expect(onOpenDetail).not.toHaveBeenCalled();
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Open Task Keep this context" }).props.onPress(); });
    expect(onOpenDetail).toHaveBeenCalledWith("/captures/one/review");
    act(() => { renderer.update(<MaterialsScreen apiBaseUrl="http://api.test" memberId="member-1" timeZone="Europe/Warsaw" client={client} spacesClient={{ list: vi.fn().mockResolvedValue(spaces) }} metadataClient={{ listTags: vi.fn().mockResolvedValue([]), listEntities: vi.fn().mockResolvedValue([]) }} onOpenDetail={onOpenDetail} detailUrl="/captures/one/review" detail={<Text>Existing detail</Text>} />); });
    expect(textContent(renderer)).toContain("Existing detail");
    act(() => { renderer.update(<MaterialsScreen apiBaseUrl="http://api.test" memberId="member-1" timeZone="Europe/Warsaw" client={client} spacesClient={{ list: vi.fn().mockResolvedValue(spaces) }} metadataClient={{ listTags: vi.fn().mockResolvedValue([]), listEntities: vi.fn().mockResolvedValue([]) }} onOpenDetail={onOpenDetail} />); });
    expect(textContent(renderer)).toContain("Home / Health");
    renderer.unmount();
  });

  test("hosts progressive search and applies the typed search seam", async () => {
    const client: MemberItemsClient = { list: vi.fn().mockResolvedValue({ items: [task("one", "First")], nextCursor: null }), search: vi.fn().mockResolvedValue({ items: [task("two", "Search result")], nextCursor: null }) };
    const renderer = renderScreen(client);
    await act(async () => { await Promise.resolve(); });
    act(() => { button(renderer, "Open Materials search and filters").props.onPress(); });
    await act(async () => { await Promise.resolve(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Search Materials" }).props.onChangeText("search"); });
    await act(async () => { button(renderer, "Apply Materials search").props.onPress(); await Promise.resolve(); });
    expect(client.search).toHaveBeenCalledWith("member-1", { text: "search" }, undefined);
    expect(textContent(renderer)).toContain("Search result");
    expect(textContent(renderer)).not.toContain("First");
    renderer.unmount();
  });

  test("retains the first page and retries the failed cursor", async () => {
    const client: MemberItemsClient = {
      list: vi.fn().mockResolvedValueOnce({ items: [task("first", "First page")], nextCursor: "next" }).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ items: [task("second", "Recovered page")], nextCursor: null }),
      search: vi.fn(),
    };
    const renderer = renderScreen(client);
    await act(async () => { await Promise.resolve(); });

    expect(textContent(renderer)).toContain("First page");
    expect(textContent(renderer)).toContain("Couldn’t load more Materials:");
    expect(button(renderer, "Retry loading more Materials")).toBeDefined();
    await act(async () => { button(renderer, "Retry loading more Materials").props.onPress(); await Promise.resolve(); });
    expect(textContent(renderer)).toContain("Recovered page");
    expect(client.list).toHaveBeenLastCalledWith("member-1", "next");
    renderer.unmount();
  });
});
