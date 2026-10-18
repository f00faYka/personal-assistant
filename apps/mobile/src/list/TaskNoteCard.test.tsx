import { act, create } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  class AnimatedValue {
    constructor(private value: number) {}
    setValue(value: number) { this.value = value; }
    interpolate() { return this.value; }
  }
  const Animated = {
    Value: AnimatedValue,
    View: host("AnimatedView"),
    timing: () => ({ start: (callback?: (result: { readonly finished: boolean }) => void) => callback?.({ finished: true }), stop: vi.fn() }),
  };
  const easing = (value: unknown) => value;
  return { Animated, Dimensions: { get: () => ({ width: 1024 }) }, Easing: { cubic: easing, out: easing }, Modal: (props: { readonly visible: boolean; readonly children?: React.ReactNode }) => props.visible ? React.createElement("Modal", props, props.children) : null, PanResponder: { create: (handlers: object) => ({ panHandlers: handlers }) }, Pressable: host("Pressable"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), View: host("View") };
});

import { NoteCard, TaskCard } from "../web/TaskNoteCardPrototype";

const task = { id: "task-1", title: "Book dentist appointment", status: "open" as const, dueAt: "2026-09-15T09:30:00.000Z", space: "Health", tags: ["#errand"] };

describe("TaskNoteCard", () => {
  test("opens the shared Task card and exposes completion actions", () => {
    const onOpen = vi.fn(); const onComplete = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskCard task={task} timeZone="Europe/Warsaw" today="2026-09-15" onPress={onOpen} onSetCompleted={onComplete} />); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Open Task Book dentist appointment" }).props.onPress(); });
    expect(onOpen).toHaveBeenCalledOnce();
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Actions for Task Book dentist appointment" }).props.onPress(); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Mark complete Book dentist appointment" })).toBeDefined();
  });

  test("does not expose completion while a Task save is pending or failed", () => {
    for (const saveState of ["pending", "error"] as const) {
      let renderer!: ReturnType<typeof create>;
      act(() => { renderer = create(<TaskCard task={task} timeZone="Europe/Warsaw" today="2026-09-15" saveState={saveState} onPress={vi.fn()} onSetCompleted={vi.fn()} />); });
      act(() => { renderer.root.findByProps({ accessibilityLabel: "Actions for Task Book dentist appointment" }).props.onPress(); });
      expect(renderer.root.findAll((node) => String(node.props.accessibilityLabel).startsWith("Mark complete"))).toHaveLength(0);
    }
  });

  test("renders a Note without Task completion controls", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<NoteCard note={{ id: "note-1", content: "Call the dentist", reviewState: "needs_review", space: "Health", tags: [] }} onPress={vi.fn()} />); });
    const content = JSON.stringify(renderer.toJSON());
    expect(content).toContain("Needs review");
    expect(content).not.toContain("Mark complete");
  });
});
