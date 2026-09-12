import { act, create } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", async () => { const React = await import("react"); const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children); return { ActivityIndicator: host("ActivityIndicator"), Pressable: host("Pressable"), ScrollView: host("ScrollView"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), View: host("View") }; });
vi.mock("react-native-safe-area-context", async () => { const React = await import("react"); return { SafeAreaView: (props: { readonly children?: React.ReactNode }) => React.createElement("SafeAreaView", props, props.children) }; });
vi.mock("../design-system", async () => { const React = await import("react"); const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children); return { Card: host("Card"), Heading: host("Heading"), tokens: { colors: { background: "#fff", surface: "#fff", ink: "#111", muted: "#777", border: "#ddd", green: "#173B2F" }, radius: { control: 14 }, spacing: { lg: 24, xl: 32 } } }; });

import { SelectedDayTaskScreen } from "./SelectedDayTaskScreen";
import { Text } from "react-native";

const item = { kind: "task" as const, id: "task-1", captureId: "capture-1", title: "Book dentist", state: "open" as const, dueAt: "2026-09-15T09:30:00.000Z", createdAt: "2026-09-14T00:00:00Z", detailUrl: "/captures/capture-1/review" };

describe("SelectedDayTaskScreen", () => {
  test("renders only the selected local day and preserves detail navigation", () => {
    const onOpenDetail = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<SelectedDayTaskScreen memberId="member-1" selectedDate="2026-09-15" timeZone="Europe/Warsaw" items={[item, { ...item, id: "other", title: "Tomorrow", dueAt: "2026-09-16T09:30:00.000Z" }]} renderTask={(task) => <Text onPress={() => onOpenDetail(task.detailUrl)}>{task.title}</Text>} />); });
    expect(textContent(renderer)).toContain("Book dentist");
    expect(textContent(renderer)).not.toContain("Tomorrow");
    act(() => { renderer.root.findByProps({ children: "Book dentist" }).props.onPress(); });
    expect(onOpenDetail).toHaveBeenCalledWith(item.detailUrl);
  });

  test("does not show empty until all pages are complete", async () => {
    const client = { list: vi.fn().mockResolvedValueOnce({ items: [], nextCursor: "page-2" }).mockResolvedValueOnce({ items: [item], nextCursor: null }), search: vi.fn() };
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<SelectedDayTaskScreen memberId="member-1" selectedDate="2026-09-15" timeZone="Europe/Warsaw" client={client} renderTask={(task) => <Text>{task.title}</Text>} />); });
    expect(textContent(renderer)).toContain("Book dentist");
    expect(client.list).toHaveBeenNthCalledWith(2, "member-1", "page-2");
  });
});

function textContent(renderer: ReturnType<typeof create>): string { return renderer.root.findAll((node) => String(node.type) === "Text").map((node) => String(node.props.children)).join(" "); }
