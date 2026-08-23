import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", async () => {
  const React = await import("react");
  type Props = { readonly children?: React.ReactNode; readonly [key: string]: unknown };
  const host = (name: string) => function Host(props: Props) { return React.createElement(name, props, props.children); };
  return { ActivityIndicator: host("ActivityIndicator"), Pressable: host("Pressable"), SafeAreaView: host("SafeAreaView"), ScrollView: host("ScrollView"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), TextInput: host("TextInput"), View: host("View") };
});

import { TextInput } from "react-native";
import { ReviewScreen } from "./ReviewScreen";
import type { OfflineDraftStore } from "../offline/offline-drafts";

describe("ReviewScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("loads readable Task fields, focuses an edit field, and saves once", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy bread", status: "open", version: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const onBack = vi.fn();
    const renderer = await renderScreen(onBack);

    expect(textContent(renderer)).toContain("Buy milk");
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Title" }).props.onPress(); });
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Buy bread"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/tasks/task-1", expect.objectContaining({ method: "PATCH" }));
    expect(onBack).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  test("shows editable due date and time controls and can clear due information", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-08-15T09:00:00.000Z", status: "open", version: 0 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());

    expect(textContent(renderer)).toContain("Remind At:");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Due information" }).props.onPress(); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Choose due date" })).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: "Choose due time" })).toBeTruthy();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Clear due information" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/tasks/task-1", expect.objectContaining({ body: JSON.stringify({ memberId: "member-1", expectedVersion: 0, dueAt: null }) }));
    renderer.unmount();
  });

  test("rejects an invalid due value without invoking notification behavior or saving", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-02-30T09:00:00.000Z", status: "open", version: 0 }) }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Due information must be a valid date and time");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(textContent(renderer)).not.toContain("notification");
    renderer.unmount();
  });

  test("sets due information from an absent value", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-08-20T09:00:00.000Z", status: "open", version: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Due information" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Set due information" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Due date 2026-08-20" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Due time" }).props.onChangeText("09:00"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Done due time" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/tasks/task-1", expect.objectContaining({ body: JSON.stringify({ memberId: "member-1", expectedVersion: 0, dueAt: "2026-08-20T09:00:00.000Z" }) }));
    renderer.unmount();
  });

  test("saves changed date and time as one non-notifying due value", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-08-15T09:00:00.000Z", status: "open", version: 0 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-08-20T10:30:00.000Z", status: "open", version: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Due information" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Choose due date" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Due date 2026-08-20" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Due time" }).props.onChangeText("10:30"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Done due time" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/tasks/task-1", expect.objectContaining({ body: JSON.stringify({ memberId: "member-1", expectedVersion: 0, dueAt: "2026-08-20T10:30:00.000Z" }) }));
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["http://api.test/captures/capture-1/review", "http://api.test/tasks/task-1"]);
    renderer.unmount();
  });

  test("keeps the review visible and exposes a retry after save failure", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "needs_review", version: 0 }) }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "offline" }), { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "needs_review", version: 0 }) }))
      .mockResolvedValueOnce(jsonResponse({ note: { kind: "note", id: "note-1", content: "Call the dentist tomorrow", reviewState: "none", version: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const onBack = vi.fn();
    const renderer = await renderScreen(onBack);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Note" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Call the dentist tomorrow"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(textContent(renderer)).toContain("offline");
    expect(renderer.root.findByType(TextInput).props.value).toBe("Call the dentist tomorrow");
    expect(onBack).not.toHaveBeenCalled();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });
    expect(onBack).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  test("preserves explicitly entered review text as an unconfirmed Offline draft", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "needs_review", version: 0 }) }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "offline" }), { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "needs_review", version: 0 }) }));
    vi.stubGlobal("fetch", fetcher);
    const offlineDraftStore = draftStore({
      save: vi.fn(async (draft) => ({ ...draft, source: { ...draft.source } })),
    });
    const onBack = vi.fn();
    const renderer = await renderScreen(onBack, { offlineDraftStore });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Note" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Call the dentist tomorrow"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(offlineDraftStore.save).toHaveBeenCalledWith(expect.objectContaining({
      memberId: "member-1",
      source: { kind: "text", text: "Call the dentist tomorrow" },
    }));
    expect(textContent(renderer)).toContain("Saved as an Offline draft · Not confirmed");
    expect(onBack).not.toHaveBeenCalled();
    renderer.unmount();
  });

  test("does not turn a confirmed Note conflict into an Offline draft", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "none", version: 2 }) }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Note changed elsewhere" }), { status: 409 }))
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "none", version: 3 }) }));
    vi.stubGlobal("fetch", fetcher);
    const offlineDraftStore = draftStore();
    const renderer = await renderScreen(vi.fn(), { offlineDraftStore });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Note" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Call the dentist tomorrow"); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(offlineDraftStore.save).not.toHaveBeenCalled();
    expect(textContent(renderer)).toContain("Note changed elsewhere");
    expect(textContent(renderer)).not.toContain("Saved as an Offline draft");
    renderer.unmount();
  });

  test("keeps original transcription distinct from editable Note content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "none", version: 2 }, { transcription: { status: "succeeded", text: "Call the dentist tomorrow" } }) })));
    const renderer = await renderScreen(vi.fn());

    expect(textContent(renderer)).toContain("Original transcription");
    expect(textContent(renderer)).toContain("Call the dentist tomorrow");
    expect(textContent(renderer)).toContain("Call the dentist");
    renderer.unmount();
  });

  test("shows original non-English transcription text and language without translating it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Позвони врачу", reviewState: "none", version: 2 }, { transcription: { status: "succeeded", text: "Позвони врачу завтра", language: "ru" } }) })));
    const renderer = await renderScreen(vi.fn());

    expect(textContent(renderer)).toContain("Original transcription");
    expect(textContent(renderer)).toContain("ru");
    expect(textContent(renderer)).toContain("Позвони врачу завтра");
    expect(textContent(renderer)).not.toContain("Call the doctor tomorrow");
    renderer.unmount();
  });

  test("shows original transcription before an editable outcome exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith(null, { state: "pending", transcription: { status: "succeeded", text: "Привет", language: "ru" } }) })));
    const renderer = await renderScreen(vi.fn());

    expect(textContent(renderer)).toContain("Привет");
    expect(textContent(renderer)).toContain("ru");
    renderer.unmount();
  });

  test("prevents duplicate Note saves while one request is in flight", async () => {
    let resolveSave!: (response: Response) => void;
    const save = new Promise<Response>((resolve) => { resolveSave = resolve; });
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "none", version: 0 }) })).mockReturnValueOnce(save);
    vi.stubGlobal("fetch", fetcher);
    const onBack = vi.fn();
    const renderer = await renderScreen(onBack);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Note" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Call the dentist tomorrow"); });

    act(() => {
      const button = renderer.root.findByProps({ accessibilityLabel: "Save" });
      button.props.onPress();
      button.props.onPress();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    resolveSave(jsonResponse({ note: { kind: "note", id: "note-1", content: "Call the dentist tomorrow", reviewState: "none", version: 1 } }));
    await act(async () => { await save; });
    expect(onBack).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  test("explicitly converts a saved Note in place and renders the same item as a Task", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "none", version: 1 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "note-1", title: "Call the dentist", status: "open", version: 2 } }));
    vi.stubGlobal("fetch", fetcher);
    const onBack = vi.fn();
    const renderer = await renderScreen(onBack);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Convert saved Note to Task" }).props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/notes/note-1/convert-to-task", expect.objectContaining({ method: "POST", body: JSON.stringify({ memberId: "member-1", expectedVersion: 1 }) }));
    expect(textContent(renderer)).toContain("Converted to Task. Identity and provenance were kept.");
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Edit Note" })).toHaveLength(0);
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Title" })).toBeDefined();
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Convert saved Note to Task" })).toHaveLength(0);
    expect(onBack).not.toHaveBeenCalled();
    renderer.unmount();
  });

  test("prevents duplicate Note conversion requests while one is in flight", async () => {
    let resolveConversion!: (response: Response) => void;
    const conversion = new Promise<Response>((resolve) => { resolveConversion = resolve; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "none", version: 1 }) }))
      .mockReturnValueOnce(conversion);
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());
    const button = renderer.root.findByProps({ accessibilityLabel: "Convert saved Note to Task" });

    act(() => { button.props.onPress(); button.props.onPress(); });

    expect(fetcher).toHaveBeenCalledTimes(2);
    resolveConversion(jsonResponse({ task: { kind: "task", id: "note-1", title: "Call the dentist", status: "open", version: 2 } }));
    await act(async () => { await conversion; });
    renderer.unmount();
  });

  test("keeps a Needs review Note intact and retries conversion with the refreshed version", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Maybe book a trip", reviewState: "needs_review", version: 0 }, { state: "needs_review" }) }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "offline" }), { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Maybe book a trip", reviewState: "needs_review", version: 1 }, { state: "needs_review" }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "note-1", title: "Maybe book a trip", status: "open", version: 2 } }));
    vi.stubGlobal("fetch", fetcher);
    const offlineDraftStore = draftStore();
    const onBack = vi.fn();
    const renderer = await renderScreen(onBack, { offlineDraftStore });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Convert saved Note to Task" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Needs review");
    expect(textContent(renderer)).toContain("capture-1");
    expect(textContent(renderer)).toContain("source-1");
    expect(textContent(renderer)).toContain("Unable to convert Note: offline");
    expect(offlineDraftStore.save).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Convert saved Note to Task" }).props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/notes/note-1/convert-to-task", expect.objectContaining({ body: JSON.stringify({ memberId: "member-1", expectedVersion: 1 }) }));
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Title" })).toBeDefined();
    renderer.unmount();
  });

  test("recognizes a converted Task when the mutation response is lost and detail refresh succeeds", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "none", version: 0 }) }))
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "note-1", title: "Call the dentist", status: "open", version: 1 }) }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Convert saved Note to Task" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Conversion confirmed after refreshing.");
    expect(textContent(renderer)).toContain("Call the dentist");
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Title" })).toBeDefined();
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Convert saved Note to Task" })).toHaveLength(0);
    expect(textContent(renderer)).not.toContain("Unable to convert Note");
    renderer.unmount();
  });

  test("completes an open Task once after server confirmation", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 3 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy milk", status: "completed", version: 4 } }));
    vi.stubGlobal("fetch", fetcher);
    const onBack = vi.fn();
    const renderer = await renderScreen(onBack);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Complete task" }).props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/tasks/task-1/complete", expect.objectContaining({ method: "POST" }));
    expect(onBack).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  test("prevents duplicate completion requests while one is in flight", async () => {
    let resolveCompletion!: (response: Response) => void;
    const completion = new Promise<Response>((resolve) => { resolveCompletion = resolve; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 3 }) }))
      .mockReturnValueOnce(completion);
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());
    const button = renderer.root.findByProps({ accessibilityLabel: "Complete task" });

    act(() => { button.props.onPress(); button.props.onPress(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolveCompletion(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy milk", status: "completed", version: 4 } }));
    await act(async () => { await completion; });
    renderer.unmount();
  });

  test("keeps the Task visible and retries after completion failure", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 3 }) }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Task changed elsewhere" }), { status: 409 }))
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy oat milk", status: "open", version: 4 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy oat milk", status: "completed", version: 5 } }));
    vi.stubGlobal("fetch", fetcher);
    const onBack = vi.fn();
    const renderer = await renderScreen(onBack);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Complete task" }).props.onPress(); });
    expect(textContent(renderer)).toContain("Task changed elsewhere");
    expect(onBack).not.toHaveBeenCalled();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Complete task" }).props.onPress(); });

    expect(onBack).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/tasks/task-1/complete", expect.objectContaining({ body: JSON.stringify({ memberId: "member-1", expectedVersion: 4 }) }));
    renderer.unmount();
  });

  test("distinguishes failed processing and Needs review without presenting a Task", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith(null, { state: "failed", failure: { stage: "transcription", message: "provider offline" } }) }));
    vi.stubGlobal("fetch", fetcher);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ReviewScreen apiBaseUrl="http://api.test" memberId="member-1" detailUrl="/captures/capture-1/review" onBack={vi.fn()} />);
    });

    expect(textContent(renderer)).toContain("Processing failed");
    expect(textContent(renderer)).toContain("provider offline");
    expect(textContent(renderer)).toContain("Review the original Capture and try again when processing is available.");
    expect(textContent(renderer)).not.toContain("Task");
    renderer.unmount();
  });

  test("labels an ambiguous Note as Needs review", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Maybe book a trip", reviewState: "needs_review", version: 0 }, { state: "needs_review", interpretation: { id: "interpretation-1", classification: "ambiguous" } }) })));
    const renderer = await renderScreen(vi.fn());

    expect(textContent(renderer)).toContain("The Capture was ambiguous");
    expect(textContent(renderer)).toContain("Maybe book a trip");
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Edit Title" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Complete task" })).toHaveLength(0);
    renderer.unmount();
  });

  test("distinguishes an unsupported instruction from an ambiguous Note", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Set a timer", reviewState: "needs_review", version: 0 }, { state: "needs_review", interpretation: { id: "interpretation-1", classification: "unsupported" } }) })));
    const renderer = await renderScreen(vi.fn());

    expect(textContent(renderer)).toContain("This instruction is unsupported");
    expect(textContent(renderer)).not.toContain("The Capture was ambiguous");
    renderer.unmount();
  });
});

async function renderScreen(onBack: () => void, props: Partial<React.ComponentProps<typeof ReviewScreen>> = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<ReviewScreen apiBaseUrl="http://api.test" memberId="member-1" detailUrl="/captures/capture-1/review" onBack={onBack} {...props} />); });
  return renderer;
}

function reviewWith(outcome: object | null, overrides: object = {}) {
  return { state: "completed", capture: { id: "capture-1", memberId: "member-1" }, source: { id: "source-1" }, transcription: { status: "succeeded", text: "Call the dentist" }, correction: null, interpretation: { id: "interpretation-1" }, outcome, failure: null, ...overrides };
}

function jsonResponse(body: unknown): Response { return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }
function textContent(renderer: ReactTestRenderer): string { return renderer.root.findAll((node) => String(node.type) === "Text").flatMap((node) => node.children).filter((child): child is string => typeof child === "string").join(" "); }

function draftStore(overrides: Partial<OfflineDraftStore> = {}): OfflineDraftStore {
  return { list: vi.fn().mockResolvedValue([]), save: vi.fn(), remove: vi.fn().mockResolvedValue(undefined), ...overrides };
}
