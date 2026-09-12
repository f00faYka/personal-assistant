import { act, create } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  return { Dimensions: { get: () => ({ width: 1024 }) }, Modal: (props: { visible: boolean; children?: React.ReactNode }) => props.visible ? React.createElement("Modal", props, props.children) : null, PanResponder: { create: (handlers: object) => ({ panHandlers: handlers }) }, Pressable: host("Pressable"), ScrollView: host("ScrollView"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), View: host("View") };
});
vi.mock("react-native-safe-area-context", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  return { SafeAreaView: host("SafeAreaView"), useSafeAreaInsets: () => ({ bottom: 0 }) };
});

import { TaskCard, NoteCard } from "./TaskNoteCardPrototype";
import { createBrowserFixtureData } from "./fixture-data";

import { BrowserPreview } from "./BrowserPreview";

describe("BrowserPreview", () => {
  test("exposes fixture navigation without enabling native capture", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<BrowserPreview />); });

    expect(renderer.root.findAllByProps({ accessibilityRole: "alert" }).length).toBeGreaterThan(0);
    expect(renderer.root.findByProps({ accessibilityLabel: "Start a voice Capture" }).props.disabled).toBeUndefined();
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Open Calendar" }).props.onPress(); });
    expect(renderer.root.findAll((node) => String(node.type) === "Text").some((node) => node.props.children === "Calendar")).toBe(true);
  });

  test("uses the shared shell destinations", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<BrowserPreview />); });

    for (const label of ["Home", "Find", "Calendar", "Me"]) {
      expect(renderer.root.findByProps({ accessibilityLabel: `Open ${label}` })).toBeDefined();
    }
  });
});


describe("approved card interactions", () => {
  const fixture = createBrowserFixtureData();
  test("menu completion never opens the body and holding only opens actions", () => {
    const onOpen = vi.fn(); const onComplete = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskCard task={fixture.tasks[0]!} fixture={fixture} timeZone="Europe/Warsaw" today="2026-09-15" onPress={onOpen} onSetCompleted={(completed) => onComplete(completed)} />); });
    const body = renderer.root.findByProps({ accessibilityLabel: "Open Task Book dentist appointment" });
    act(() => { body.props.onLongPress(); body.props.onPress(); });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Mark complete Book dentist appointment" }).props.onPress(); });
    expect(onComplete).toHaveBeenCalledOnce(); expect(onOpen).not.toHaveBeenCalled();
  });
  test("dots and long press both expose the complete action", () => {
    const onComplete = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskCard task={fixture.tasks[0]!} fixture={fixture} timeZone="Europe/Warsaw" today="2026-09-15" onPress={vi.fn()} onSetCompleted={(completed) => onComplete(completed)} />); });
    const actions = renderer.root.findByProps({ accessibilityLabel: "Actions for Task Book dentist appointment" });
    act(() => { actions.props.onPress(); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Mark complete Book dentist appointment" })).toBeDefined();
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Dismiss card actions" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Open Task Book dentist appointment" }).props.onLongPress(); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Mark complete Book dentist appointment" })).toBeDefined();
  });
  test("a full left swipe moves the card off-screen and completes it", () => {
    const onOpen = vi.fn(); const onComplete = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskCard task={fixture.tasks[0]!} fixture={fixture} timeZone="Europe/Warsaw" today="2026-09-15" onPress={onOpen} onSetCompleted={(completed) => onComplete(completed)} />); });
    const swipe = renderer.root.findAll((node) => typeof node.props.onMoveShouldSetPanResponder === "function")[0]!;
    expect(swipe.props.onMoveShouldSetPanResponder({}, { dx: 3, dy: 60 })).toBe(false);
    expect(swipe.props.onMoveShouldSetPanResponder({}, { dx: -70, dy: 3 })).toBe(true);
    expect(swipe.props.onMoveShouldSetPanResponderCapture({}, { dx: -70, dy: 3 })).toBe(true);
    expect(swipe.props.onPanResponderTerminationRequest()).toBe(false);
    act(() => { swipe.props.onPanResponderGrant(); swipe.props.onPanResponderMove({}, { dx: -260, dy: 0 }); });
    expect(JSON.stringify(renderer.toJSON())).toContain("translateX");
    act(() => { swipe.props.onPanResponderRelease({}, { dx: -260 }); });
    expect(onComplete).toHaveBeenCalledOnce(); expect(onOpen).not.toHaveBeenCalled();
  });
  test("pending and failed tasks expose no completion capability", () => {
    for (const saveState of ["pending", "error"] as const) {
      let renderer!: ReturnType<typeof create>;
      act(() => { renderer = create(<TaskCard task={fixture.tasks[0]!} fixture={fixture} timeZone="Europe/Warsaw" today="2026-09-15" saveState={saveState} onPress={vi.fn()} onSetCompleted={vi.fn()} />); });
      act(() => { renderer.root.findByProps({ accessibilityLabel: "Actions for Task Book dentist appointment" }).props.onPress(); });
      expect(renderer.root.findAll((node) => String(node.props.accessibilityLabel).startsWith("Mark complete"))).toHaveLength(0);
    }
  });
  test("completed tasks offer mark incomplete in the actions menu", () => {
    const onSetCompleted = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskCard task={fixture.tasks[6]!} fixture={fixture} timeZone="Europe/Warsaw" today="2026-09-15" onPress={vi.fn()} onSetCompleted={onSetCompleted} />); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Actions for Task Confirm hotel booking" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Mark incomplete Confirm hotel booking" }).props.onPress(); });
    expect(onSetCompleted).toHaveBeenCalledWith(false);
  });
  test("Note has review status and no date or completion; full tags open in details", () => {
    let renderer!: ReturnType<typeof create>; const onOpen = vi.fn();
    act(() => { renderer = create(<NoteCard note={fixture.notes[0]!} fixture={fixture} onPress={onOpen} />); });
    const content = JSON.stringify(renderer.toJSON());
    expect(content).toContain("Needs review"); expect(content).not.toContain("No due date"); expect(content).not.toContain("Mark complete");
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Open Note Ask Alex about the launch hand-off" }).props.onPress(); });
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
