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

  test("cancels Note edits without saving the draft", () => {
    const onSave = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskNoteDetailScreen item={note} onBack={vi.fn()} onSave={onSave} onConvert={vi.fn()} />); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Edit Note" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Note" }).props.onChangeText("Changed Note"); });
    expect(JSON.stringify(renderer.toJSON())).toContain("Changed Note");
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Cancel Note editing" }).props.onPress(); });
    expect(onSave).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain("Call the dentist");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Changed Note");
  });

  test("cancels Task title and due edits without saving the draft", () => {
    const onSave = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskNoteDetailScreen item={task} onBack={vi.fn()} onSave={onSave} />); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Edit Title" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Title" }).props.onChangeText("Buy oat milk"); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Edit Due information" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ "aria-label": "Due time" }).props.onChange({ currentTarget: { value: "13:00" } }); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });

    act(() => { renderer.root.findByProps({ accessibilityLabel: "Cancel Task editing" }).props.onPress(); });

    expect(onSave).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain("Buy milk");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Buy oat milk");
    expect(JSON.stringify(renderer.toJSON())).toContain(new Date("2026-09-15T09:30:00.000Z").toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    expect(JSON.stringify(renderer.toJSON())).not.toContain("13:00");
    expect(renderer.root.findByProps({ accessibilityLabel: "Save" }).props.disabled).toBe(true);
  });

  test("clearing due information applies immediately", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskNoteDetailScreen item={task} onBack={vi.fn()} onSave={vi.fn()} />); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Edit Due information" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Clear due information" }).props.onPress(); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Save" }).props.disabled).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).toContain("No due date");
  });

  test("edits date and time through the shared due editor", () => {
    const onSave = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskNoteDetailScreen item={task} onBack={vi.fn()} onSave={onSave} />); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Edit Due information" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ "aria-label": "Due time" }).props.onChange({ currentTarget: { value: "13:00" } }); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });
    expect(onSave).toHaveBeenCalledWith({ text: "Buy milk", dueAt: new Date("2026-09-15T13:00:00").toISOString() });
  });
  test("opening and confirming an unchanged due time preserves the stored instant", () => {
    const onSave = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskNoteDetailScreen item={{ ...task, dueAt: "2026-09-15T09:30:45.123Z" }} onBack={vi.fn()} onSave={onSave} />); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Edit Due information" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ "aria-label": "Due date" }).props.onChange({ currentTarget: { value: "2026-09-15" } }); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Choose due date" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });
    expect(onSave).toHaveBeenCalledWith({ text: "Buy milk", dueAt: "2026-09-15T09:30:45.123Z" });
    expect(renderer.root.findByProps({ accessibilityLabel: "Save" }).props.disabled).toBe(true);
  });

  test("invalid time cannot be applied", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<TaskNoteDetailScreen item={task} onBack={vi.fn()} onSave={vi.fn()} />); });
    act(() => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
    act(() => { renderer.root.findByProps({ "aria-label": "Due time" }).props.onChange({ currentTarget: { value: "25:61" } }); });
    expect(JSON.stringify(renderer.toJSON())).toContain("Enter a valid date and time");
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Done due editing" })).toHaveLength(0);
  });

});
