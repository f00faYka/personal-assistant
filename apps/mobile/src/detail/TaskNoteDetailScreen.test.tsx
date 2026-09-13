import { act, create } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement(name, props, props.children);
  return { Pressable: host("Pressable"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), TextInput: host("TextInput"), View: host("View") };
});

import { TaskNoteDetailScreen, type TaskNoteDetailItem } from "./TaskNoteDetailScreen";

const task: TaskNoteDetailItem = { kind: "task", id: "task-1", title: "Buy milk", status: "open", dueAt: "2026-09-15T09:30:00.000Z", space: "Home", tags: ["#errand"], source: "Capture capture-1" };
const note: TaskNoteDetailItem = { kind: "note", id: "note-1", content: "Call the dentist", reviewState: "needs_review", space: "Health", tags: [], source: "Capture capture-2" };

describe("TaskNoteDetailScreen", () => {
  test("uses one editor for Task and Note data", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskNoteDetailScreen item={task} onBack={vi.fn()} onSave={vi.fn()} onChangeStatus={vi.fn()} />); });
    expect(JSON.stringify(renderer.toJSON())).toContain("Buy milk");
    act(() => { renderer.update(<TaskNoteDetailScreen item={note} onBack={vi.fn()} onSave={vi.fn()} onConvert={vi.fn()} />); });
    expect(JSON.stringify(renderer.toJSON())).toContain("Call the dentist");
    expect(renderer.root.findByProps({ accessibilityLabel: "Convert saved Note to Task" })).toBeDefined();
  });

  test("keeps status action explicit for completed Tasks", () => {
    const onStatus = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskNoteDetailScreen item={{ ...task, status: "completed" }} onBack={vi.fn()} onSave={vi.fn()} onChangeStatus={onStatus} />); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Reopen task" })).toBeDefined();
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Reopen task" }).props.onPress(); });
    expect(onStatus).toHaveBeenCalledOnce();
  });

  test("edits date and time through the shared due editor", () => {
    const onSave = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskNoteDetailScreen item={task} onBack={vi.fn()} onSave={onSave} />); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Edit Due information" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Due time" }).props.onChangeText("13:00"); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Done due time" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Done due editing" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });
    expect(onSave).toHaveBeenCalledWith({ text: "Buy milk", dueAt: "2026-09-15T13:00:00.000Z" });
  });
});
