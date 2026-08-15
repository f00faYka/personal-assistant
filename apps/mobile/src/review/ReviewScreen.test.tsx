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

  test("keeps the review visible and exposes a retry after save failure", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "needs_review", version: 0 }) })).mockResolvedValueOnce(new Response(JSON.stringify({ error: "offline" }), { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const onBack = vi.fn();
    const renderer = await renderScreen(onBack);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Note" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Call the dentist tomorrow"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(textContent(renderer)).toContain("offline");
    expect(renderer.root.findByType(TextInput).props.value).toBe("Call the dentist tomorrow");
    expect(onBack).not.toHaveBeenCalled();
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
    expect(textContent(renderer)).not.toContain("Task");
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

async function renderScreen(onBack: () => void): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<ReviewScreen apiBaseUrl="http://api.test" memberId="member-1" detailUrl="/captures/capture-1/review" onBack={onBack} />); });
  return renderer;
}

function reviewWith(outcome: object | null, overrides: object = {}) {
  return { state: "completed", capture: { id: "capture-1", memberId: "member-1" }, source: { id: "source-1" }, transcription: { status: "succeeded" }, correction: null, interpretation: { id: "interpretation-1" }, outcome, failure: null, ...overrides };
}

function jsonResponse(body: unknown): Response { return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }
function textContent(renderer: ReactTestRenderer): string { return renderer.root.findAll((node) => String(node.type) === "Text").flatMap((node) => node.children).filter((child): child is string => typeof child === "string").join(" "); }
