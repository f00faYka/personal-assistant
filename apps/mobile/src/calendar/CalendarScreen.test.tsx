import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  return { ActivityIndicator: host("ActivityIndicator"), Pressable: host("Pressable"), ScrollView: host("ScrollView"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), View: host("View") };
});
vi.mock("react-native-safe-area-context", async () => {
  const React = await import("react");
  return { SafeAreaView: (props: { readonly children?: React.ReactNode }) => React.createElement("SafeAreaView", props, props.children) };
});
vi.mock("../design-system", async () => {
  const React = await import("react");
  return { Heading: (props: { readonly eyebrow?: string; readonly children?: React.ReactNode }) => React.createElement("Heading", props, props.children), tokens: { colors: { background: "#fff", surface: "#fff", ink: "#111", muted: "#777", border: "#ddd", green: "#173B2F", lime: "#C8F15A" }, radius: { card: 18, control: 14 }, spacing: { lg: 24, md: 16, sm: 8 } } };
});
vi.mock("../day/SelectedDayTaskScreen", async () => {
  const React = await import("react");
  return { SelectedDayTaskScreen: (props: { readonly children?: React.ReactNode }) => React.createElement("SelectedDayTaskScreen", props, props.children) };
});

import { CalendarScreen } from "./CalendarScreen";
import type { LocalDate } from "../day/selected-day";
import type { MemberItemsClient, TaskListItem } from "../list/member-items";

const scheduledTask: TaskListItem = {
  kind: "task", id: "task-1", captureId: "capture-1", title: "Prepare the weekend plan",
  dueAt: "2026-10-04T10:00:00.000Z", state: "open", createdAt: "2026-09-01T10:00:00.000Z", detailUrl: "/tasks/task-1",
};

describe("CalendarScreen", () => {
  afterEach(() => vi.useRealTimers());

  it("marks scheduled dates and opens the selected date without duplicating tasks below the month", async () => {
    const client = paginatedClient();
    const onSelectDate = vi.fn<(date: LocalDate) => void>();
    const onReturnToToday = vi.fn<(date: LocalDate) => void>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(<CalendarScreen client={client} memberId="member-1" selectedDate="2026-10-04" timeZone="UTC" onSelectDate={onSelectDate} onReturnToToday={onReturnToToday} />);
    });

    expect(renderer.root.findByProps({ accessibilityLabel: "Select Sunday, October 4, 2026 · scheduled tasks" })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: "Select Sunday, October 4, 2026 · scheduled tasks" }).props.onPress()).toBeUndefined();
    expect(onSelectDate).toHaveBeenCalledWith("2026-10-04");
    expect(renderer.root.findAllByProps({ children: "Prepare the weekend plan" })).toHaveLength(0);
    expect(client.list).toHaveBeenCalledTimes(2);
  });

  it("moves across the year boundary and returns selection to today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-15T12:00:00.000Z"));
    const onSelectDate = vi.fn<(date: LocalDate) => void>();
    const onReturnToToday = vi.fn<(date: LocalDate) => void>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(<CalendarScreen client={emptyClient()} memberId="member-1" selectedDate="2026-10-18" timeZone="UTC" onSelectDate={onSelectDate} onReturnToToday={onReturnToToday} />);
      await Promise.resolve();
    });

    act(() => { renderer.root.findByProps({ accessibilityLabel: "Next month" }).props.onPress(); });
    expect(renderer.root.findAllByProps({ children: "November 2026" })).not.toHaveLength(0);
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Next month" }).props.onPress(); });
    expect(renderer.root.findAllByProps({ children: "December 2026" })).not.toHaveLength(0);
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Next month" }).props.onPress(); });
    expect(renderer.root.findAllByProps({ children: "January 2027" })).not.toHaveLength(0);
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Return to today" }).props.onPress(); });
    expect(onReturnToToday).toHaveBeenCalledWith("2026-12-15");
  });
});

function paginatedClient(): MemberItemsClient {
  return {
    list: vi.fn(async (_memberId: string, cursor?: string) => {
      return cursor === undefined
        ? { items: [scheduledTask], nextCursor: "next" }
        : { items: [{ ...scheduledTask, id: "task-2", captureId: "capture-2", title: "Water the plants", dueAt: "2026-10-05T11:00:00.000Z" }], nextCursor: null };
    }),
    async search() { return { items: [], nextCursor: null }; },
  };
}

function emptyClient(): MemberItemsClient {
  return { async list() { return { items: [], nextCursor: null }; }, async search() { return { items: [], nextCursor: null }; } };
}
