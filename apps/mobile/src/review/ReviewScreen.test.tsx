import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", async () => {
  const React = await import("react");
  type Props = { readonly children?: React.ReactNode; readonly [key: string]: unknown };
  const host = (name: string) => function Host(props: Props) { return React.createElement(name, props, props.children); };
  class Value { setValue() {} }
  const animation = { start: (callback?: () => void) => callback?.() };
  return { ActivityIndicator: host("ActivityIndicator"), Animated: { Value, timing: () => animation, spring: () => animation, View: host("AnimatedView") }, PanResponder: { create: () => ({ panHandlers: {} }) }, Pressable: host("Pressable"), ScrollView: host("ScrollView"), StyleSheet: { create: <T,>(styles: T): T => styles }, Text: host("Text"), TextInput: host("TextInput"), View: host("View") };
});

vi.mock("react-native-safe-area-context", async () => {
  const React = await import("react");
  return { SafeAreaView: (props: { readonly children?: React.ReactNode; readonly [key: string]: unknown }) => React.createElement("SafeAreaView", props, props.children) };
});

import { TextInput } from "react-native";
import { ReviewScreen } from "./ReviewScreen";
import type { OfflineDraftStore } from "../offline/offline-drafts";
import type { Entity, MetadataClient, MetadataLinks, Tag } from "./metadata";
import type { OrganizationProposal, OrganizationProposalClient } from "./organization-proposals";
import type { Space, SpacesClient } from "../spaces/spaces";

describe("ReviewScreen", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  test("keeps the saved Task visible and polls until proposals are ready", async () => {
    vi.useFakeTimers();
    const list = vi.fn()
      .mockResolvedValueOnce({ generation: { state: "running" }, proposals: [] })
      .mockResolvedValueOnce({ generation: { state: "ready" }, proposals: [organizationProposal()] });
    const organizationProposalClient = organizationProposalFixture({ list });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { organizationProposalClient });

    expect(textContent(renderer)).toContain("Buy milk");
    expect(textContent(renderer)).toContain("preparing suggestions");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(textContent(renderer)).toContain("Office");
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(list).toHaveBeenCalledTimes(2);
    renderer.unmount();
  });

  test("stops polling after the item detail closes", async () => {
    vi.useFakeTimers();
    const list = vi.fn().mockResolvedValue({ generation: { state: "running" }, proposals: [] });
    const organizationProposalClient = organizationProposalFixture({ list });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { organizationProposalClient });

    await act(async () => { renderer.unmount(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(list).toHaveBeenCalledTimes(1);
  });

  test("retries retryable generation failures and resumes polling", async () => {
    vi.useFakeTimers();
    const list = vi.fn()
      .mockResolvedValueOnce({ generation: { state: "failed", retryable: true, error: "Generation failed" }, proposals: [] })
      .mockResolvedValueOnce({ generation: { state: "running" }, proposals: [] })
      .mockResolvedValueOnce({ generation: { state: "ready" }, proposals: [organizationProposal()] });
    const retry = vi.fn().mockResolvedValue({ generation: { state: "pending" }, proposals: [] });
    const organizationProposalClient = organizationProposalFixture({ list, retry });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Dinner Friday", reviewState: "none", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { organizationProposalClient });

    expect(textContent(renderer)).toContain("Dinner Friday");
    expect(textContent(renderer)).toContain("Generation failed");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Retry suggestions" }).props.onPress(); await Promise.resolve(); });
    expect(retry).toHaveBeenCalledWith("note-1", "note", "member-1");
    expect(textContent(renderer)).toContain("preparing suggestions");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(textContent(renderer)).toContain("Office");
    renderer.unmount();
  });

  test("loads readable Task fields, focuses an edit field, and saves once", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy bread", status: "open", version: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const onBack = vi.fn();
    const renderer = await renderScreen(onBack);

    expect(textContent(renderer)).toContain("Buy milk");
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Task" }).props.onPress(); });
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Buy bread"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/tasks/task-1", expect.objectContaining({ method: "PATCH" }));
    expect(onBack).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    expect(textContent(renderer)).toContain("Task changes saved.");
    renderer.unmount();
  });

  test("batches a card decision into one accept and keeps the result visible", async () => {
    const proposal = organizationProposal();
    const list = vi.fn().mockResolvedValueOnce({ generation: { state: "ready" }, proposals: [proposal] }).mockResolvedValueOnce({ generation: { state: "ready" }, proposals: [{ ...proposal, state: "accepted", candidates: proposal.candidates.map((candidate) => ({ ...candidate, state: "accepted" })) }] });
    const organizationProposalClient = organizationProposalFixture({ list, decide: vi.fn().mockResolvedValue({ ...proposal, state: "accepted", candidates: proposal.candidates.map((candidate) => ({ ...candidate, state: "accepted" })) }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { organizationProposalClient });

    expect(textContent(renderer)).toContain("Office");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add space suggestion Office" }).props.onPress(); });

    expect(organizationProposalClient.decide).toHaveBeenCalledWith("proposal-1", "accepted", "member-1", ["candidate-space"]);
    expect(textContent(renderer)).toContain("No AI suggestions need review.");
    renderer.unmount();
  });

  test("shows Готово while a proposal still has undecided cards", async () => {
    const proposal = organizationProposal({ candidates: [
      { id: "candidate-space", kind: "space", confidence: 0.94, confidenceBand: "high", targetId: "space-1", suggestedName: "Office", provenance: ["model"], state: "pending" },
      { id: "candidate-tag", kind: "tag", confidence: 0.78, confidenceBand: "medium", suggestedName: "urgent", provenance: ["model"], state: "pending" },
    ] });
    const organizationProposalClient = organizationProposalFixture({ list: vi.fn().mockResolvedValue({ generation: { state: "ready" }, proposals: [proposal] }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { organizationProposalClient });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add space suggestion Office" }).props.onPress(); });

    expect(renderer.root.findByProps({ accessibilityLabel: "Готово" }).props.disabled).toBe(false);
    expect(organizationProposalClient.decide).not.toHaveBeenCalled();
    renderer.unmount();
  });

  test("dismisses undecided cards on Готово without changing the underlying result", async () => {
    const proposal = organizationProposal();
    const dismissed = { ...proposal, state: "dismissed" as const, candidates: proposal.candidates.map((candidate) => ({ ...candidate, state: "dismissed" as const })) };
    const organizationProposalClient = organizationProposalFixture({ list: vi.fn().mockResolvedValueOnce({ generation: { state: "ready" }, proposals: [proposal] }).mockResolvedValueOnce({ generation: { state: "ready" }, proposals: [dismissed] }), decide: vi.fn().mockResolvedValue(dismissed) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call", reviewState: "needs_review", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { organizationProposalClient });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Готово" }).props.onPress(); });

    expect(organizationProposalClient.decide).toHaveBeenCalledWith("proposal-1", "dismissed", "member-1", undefined);
    expect(textContent(renderer)).toContain("Call");
    expect(textContent(renderer)).toContain("No AI suggestions need review.");
    renderer.unmount();
  });

  test("preserves local decisions after a failed submission and prevents repeated taps", async () => {
    const proposal = organizationProposal();
    const list = vi.fn().mockResolvedValue({ generation: { state: "ready" }, proposals: [proposal] });
    let rejectDecision: ((error: Error) => void) | undefined;
    const decide = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => { rejectDecision = reject; }));
    const organizationProposalClient = organizationProposalFixture({ list, decide });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { organizationProposalClient });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add space suggestion Office" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Отправка…" }).props.onPress(); });
    expect(decide).toHaveBeenCalledTimes(1);
    rejectDecision?.(new Error("conflict"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(textContent(renderer)).toContain("conflict");
    expect(renderer.root.findByProps({ accessibilityLabel: "Повторить отправку" })).toBeTruthy();
    renderer.unmount();
  });

  test("reports a failed proposal load and retries it", async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error("proposals unavailable")).mockResolvedValueOnce({ generation: { state: "ready" }, proposals: [] });
    const organizationProposalClient = organizationProposalFixture({ list });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { organizationProposalClient });

    expect(textContent(renderer)).toContain("proposals unavailable");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Retry AI suggestions" }).props.onPress(); });

    expect(textContent(renderer)).toContain("No AI suggestions need review.");
    expect(list).toHaveBeenCalledTimes(2);
    renderer.unmount();
  });

  test("links and unlinks an existing Tag without changing the Task", async () => {
    const tag = metadataTag("tag-1", "urgent");
    const links: MetadataLinks = { tags: [], entities: [] };
    const metadataClient = metadataFixture({ listTags: vi.fn().mockResolvedValue([tag]), listLinks: vi.fn().mockResolvedValue(links), linkTag: vi.fn().mockResolvedValue({ tags: [tag], entities: [] }), unlinkTag: vi.fn().mockResolvedValue(links) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient });
    await act(async () => { await Promise.resolve(); });
    await enterEditMode(renderer);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add Tag" }).props.onPress(); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add existing Tag urgent" }).props.onPress(); });
    expect(metadataClient.linkTag).toHaveBeenCalledWith("task-1", "task", "tag-1", "member-1");
    expect(textContent(renderer)).toContain("urgent");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Remove Tag urgent" }).props.onPress(); });
    expect(metadataClient.unlinkTag).toHaveBeenCalledWith("task-1", "task", "tag-1", "member-1");
    renderer.unmount();
  });

  test("shows a compact metadata summary and reveals Tag choices without entering Task edit mode", async () => {
    const tag = metadataTag("tag-1", "urgent");
    const unlinkedTag = metadataTag("tag-2", "weekly");
    const entity = metadataEntity("entity-1", "Alex", "Person");
    const metadataClient = metadataFixture({ listTags: vi.fn().mockResolvedValue([tag, unlinkedTag]), listEntities: vi.fn().mockResolvedValue([entity]), listLinks: vi.fn().mockResolvedValue({ tags: [tag], entities: [entity] }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient });

    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Tag urgent" })).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Entity Alex" })).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: "Add Tag" })).toBeTruthy();
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Add existing Tag urgent" })).toHaveLength(0);
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Task" })).toBeTruthy();

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add Tag" }).props.onPress(); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Add existing Tag weekly" })).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: "Close Tag choices" }).props.accessibilityState.expanded).toBe(true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Close Tag choices" }).props.onPress(); });
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Add existing Tag weekly" })).toHaveLength(0);
    expect(renderer.root.findByProps({ accessibilityLabel: "Add Tag" })).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Task" })).toBeTruthy();
    renderer.unmount();
  });

  test("keeps Space, Tags, and Entities in the Task detail metadata area", async () => {
    const office: Space = { id: "space-1", memberId: "member-1", name: "Office", createdAt: "now" };
    const metadataClient = metadataFixture({ listTags: vi.fn().mockResolvedValue([metadataTag("tag-1", "urgent")]), listLinks: vi.fn().mockResolvedValue({ tags: [], entities: [] }) });
    const spacesClient = spacesFixture({
      list: vi.fn().mockResolvedValue([office]),
      read: vi.fn().mockResolvedValue({ space: office, path: "Office", children: [], items: [{ itemId: "task-1", itemKind: "task", spaceId: office.id, path: "Office", title: "Buy milk" }] }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient, spacesClient });
    await enterEditMode(renderer);

    expect(renderer.root.findByProps({ accessibilityLabel: "Choose Space" })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: "Add Tag" })).toBeDefined();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add Tag" }).props.onPress(); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Add existing Tag urgent" })).toBeDefined();
    expect(textContent(renderer)).toContain("Tags");
    expect(textContent(renderer)).toContain("Entities");
    expect(textContent(renderer)).not.toContain("Tags and Entities");
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Assign Space Office" })).toHaveLength(0);
    renderer.unmount();
  });

  test("keeps Space, Tags, and Entities in the Note detail metadata area", async () => {
    const office: Space = { id: "space-1", memberId: "member-1", name: "Office", createdAt: "now" };
    const metadataClient = metadataFixture({ listTags: vi.fn().mockResolvedValue([metadataTag("tag-1", "urgent")]), listEntities: vi.fn().mockResolvedValue([metadataEntity("entity-1", "Alex", "Person")]), listLinks: vi.fn().mockResolvedValue({ tags: [], entities: [] }) });
    const spacesClient = spacesFixture({ list: vi.fn().mockResolvedValue([office]), read: vi.fn().mockResolvedValue({ space: office, path: "Office", children: [], items: [{ itemId: "note-1", itemKind: "note", spaceId: office.id, path: "Office", content: "Call" }] }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call", reviewState: "none", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient, spacesClient });
    await enterEditMode(renderer, "note");

    expect(renderer.root.findByProps({ accessibilityLabel: "Choose Space" })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: "Add Tag" })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: "Add Entity" })).toBeDefined();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add Tag" }).props.onPress(); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Add existing Tag urgent" })).toBeDefined();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add Entity" }).props.onPress(); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Add existing Entity Alex" })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: "Close Tag choices" })).toBeDefined();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Close Tag choices" }).props.onPress(); });
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Add existing Tag urgent" })).toHaveLength(0);
    expect(renderer.root.findByProps({ accessibilityLabel: "Add existing Entity Alex" })).toBeDefined();
    expect(textContent(renderer)).toContain("Tags");
    expect(textContent(renderer)).toContain("Entities");
    expect(textContent(renderer)).not.toContain("Tags and Entities");
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Assign Space Office" })).toHaveLength(0);
    renderer.unmount();
  });

  test("validates Entity name without exposing its internal type classifier", async () => {
    const metadataClient = metadataFixture();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call", reviewState: "none", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient });
    await enterEditMode(renderer, "note");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add Entity" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "New Entity" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add" }).props.onPress(); });
    expect(textContent(renderer)).toContain("Entity name must not be empty");
    expect(metadataClient.createEntity).not.toHaveBeenCalled();
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel?.startsWith("Entity type "))).toHaveLength(0);
    renderer.unmount();
  });

  test("keeps links visible and reports a recoverable mutation failure", async () => {
    const tag = metadataTag("tag-1", "urgent");
    const metadataClient = metadataFixture({ listTags: vi.fn().mockResolvedValue([tag]), listLinks: vi.fn().mockResolvedValue({ tags: [tag], entities: [] }), unlinkTag: vi.fn().mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValueOnce({ tags: [], entities: [] }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient });
    await enterEditMode(renderer);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Remove Tag urgent" }).props.onPress(); });
    expect(textContent(renderer)).toContain("network unavailable");
    expect(textContent(renderer)).toContain("urgent");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Retry removing Tag urgent" }).props.onPress(); });
    expect(metadataClient.unlinkTag).toHaveBeenCalledTimes(2);
    expect(textContent(renderer)).not.toContain("network unavailable");
    renderer.unmount();
  });

  test("retries a failed create-and-link operation without recreating the Tag", async () => {
    const tag = metadataTag("tag-new", "urgent");
    const metadataClient = metadataFixture({ createTag: vi.fn().mockResolvedValue(tag), linkTag: vi.fn().mockRejectedValueOnce(new Error("link unavailable")).mockResolvedValueOnce({ tags: [tag], entities: [] }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient });
    await enterEditMode(renderer);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add Tag" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "New Tag" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "New Tag name" }).props.onChangeText("urgent"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add" }).props.onPress(); });
    expect(textContent(renderer)).toContain("link unavailable");
    expect(renderer.root.findByProps({ accessibilityLabel: "New Tag name" }).props.value).toBe("urgent");
    expect(renderer.root.findByProps({ accessibilityLabel: "Retry creating and adding Tag urgent" })).toBeTruthy();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Retry creating and adding Tag urgent" }).props.onPress(); });
    expect(metadataClient.createTag).toHaveBeenCalledOnce();
    expect(metadataClient.linkTag).toHaveBeenCalledTimes(2);
    expect(textContent(renderer)).toContain("urgent");
    renderer.unmount();
  });

  test("keeps the Entity name and current links after a failed create-and-link", async () => {
    const linkedTag = metadataTag("tag-1", "family");
    const entity = metadataEntity("entity-new", "Alex", "Object");
    const metadataClient = metadataFixture({
      listTags: vi.fn().mockResolvedValue([linkedTag]),
      listLinks: vi.fn().mockResolvedValue({ tags: [linkedTag], entities: [] }),
      createEntity: vi.fn().mockResolvedValue(entity),
      linkEntity: vi.fn().mockRejectedValueOnce(new Error("link unavailable")).mockResolvedValueOnce({ tags: [linkedTag], entities: [entity] }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call", reviewState: "none", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add Entity" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "New Entity" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "New Entity name" }).props.onChangeText("Alex"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add" }).props.onPress(); });

    expect(textContent(renderer)).toContain("link unavailable");
    expect(renderer.root.findByProps({ accessibilityLabel: "New Entity name" }).props.value).toBe("Alex");
    expect(textContent(renderer)).toContain("family");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Retry creating and adding Entity Alex" }).props.onPress(); });

    expect(metadataClient.createEntity).toHaveBeenCalledOnce();
    expect(metadataClient.createEntity).toHaveBeenCalledWith("member-1", "Alex", "Object");
    expect(metadataClient.linkEntity).toHaveBeenCalledTimes(2);
    expect(metadataClient.linkEntity).toHaveBeenLastCalledWith("note-1", "note", "entity-new", "member-1");
    expect(textContent(renderer)).toContain("Alex");
    renderer.unmount();
  });

  test("ignores duplicate taps while a metadata link is in flight", async () => {
    const tag = metadataTag("tag-1", "urgent");
    let releaseLink!: (links: MetadataLinks) => void;
    const linkTag = vi.fn().mockReturnValue(new Promise<MetadataLinks>((resolve) => { releaseLink = resolve; }));
    const metadataClient = metadataFixture({ listTags: vi.fn().mockResolvedValue([tag]), linkTag });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient });
    await enterEditMode(renderer);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add Tag" }).props.onPress(); });
    const addButton = renderer.root.findByProps({ accessibilityLabel: "Add existing Tag urgent" });

    act(() => { addButton.props.onPress(); addButton.props.onPress(); });
    expect(linkTag).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ accessibilityLabel: "Add existing Tag urgent" }).props.disabled).toBe(true);
    await act(async () => { releaseLink({ tags: [tag], entities: [] }); });
    expect(textContent(renderer)).not.toContain("Unable to update metadata");
    renderer.unmount();
  });

  test("links and unlinks an Entity", async () => {
    const entity = metadataEntity("entity-1", "Office", "Place");
    const metadataClient = metadataFixture({ listEntities: vi.fn().mockResolvedValue([entity]), linkEntity: vi.fn().mockResolvedValue({ tags: [], entities: [entity] }), unlinkEntity: vi.fn().mockResolvedValue({ tags: [], entities: [] }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call", reviewState: "none", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient });
    await enterEditMode(renderer, "note");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add Entity" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Add existing Entity Office" }).props.onPress(); });
    expect(metadataClient.linkEntity).toHaveBeenCalledWith("note-1", "note", "entity-1", "member-1");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Remove Entity Office" }).props.onPress(); });
    expect(metadataClient.unlinkEntity).toHaveBeenCalledWith("note-1", "note", "entity-1", "member-1");
    renderer.unmount();
  });

  test("preserves links and offers retry after metadata loading fails", async () => {
    const tag = metadataTag("tag-1", "urgent");
    const listTags = vi.fn().mockRejectedValueOnce(new Error("metadata unavailable")).mockResolvedValueOnce([tag]);
    const metadataClient = metadataFixture({ listTags, listLinks: vi.fn().mockResolvedValue({ tags: [tag], entities: [] }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient });
    await enterEditMode(renderer);
    expect(textContent(renderer)).toContain("metadata unavailable");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Retry metadata" }).props.onPress(); });
    expect(textContent(renderer)).not.toContain("metadata unavailable");
    expect(textContent(renderer)).toContain("urgent");
    renderer.unmount();
  });

  test("edits existing Tag and Entity records", async () => {
    const tag = metadataTag("tag-1", "urgent");
    const entity = metadataEntity("entity-1", "Office", "Place");
    const metadataClient = metadataFixture({ listTags: vi.fn().mockResolvedValue([tag]), listEntities: vi.fn().mockResolvedValue([entity]), listLinks: vi.fn().mockResolvedValue({ tags: [tag], entities: [entity] }), updateTag: vi.fn().mockResolvedValue({ ...tag, name: "later" }), updateEntity: vi.fn().mockResolvedValue({ ...entity, name: "HQ", type: "Organization" }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) })));
    const renderer = await renderScreen(vi.fn(), { metadataClient });
    await enterEditMode(renderer);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Tag urgent" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Tag urgent" }).props.onChangeText("later"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save Tag urgent" }).props.onPress(); });
    expect(metadataClient.updateTag).toHaveBeenCalledWith("tag-1", "member-1", "later");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Entity Office" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Entity Office" }).props.onChangeText("HQ"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save Entity Office" }).props.onPress(); });
    expect(metadataClient.updateEntity).toHaveBeenCalledWith("entity-1", "member-1", "HQ", "Place");
    renderer.unmount();
  });

  test("shows editable due date and time controls and can clear due information", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-08-15T09:00:00.000Z", status: "open", version: 0 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());

    expect(textContent(renderer)).toContain("Due");
    await enterEditMode(renderer);
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

    await enterEditMode(renderer);
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Buy bread"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Due information must be a valid date and time");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(textContent(renderer)).not.toContain("notification");
    renderer.unmount();
  });

  test("sets due information from an absent value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T09:00:00.000Z"));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy milk", dueAt: new Date("2026-08-20T09:00:00").toISOString(), status: "open", version: 1 } }));
    try {
      vi.stubGlobal("fetch", fetcher);
      const renderer = await renderScreen(vi.fn());
      await enterEditMode(renderer);
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Due information" }).props.onPress(); });
      await act(async () => { renderer.root.findByProps({ "aria-label": "Due date" }).props.onChange({ currentTarget: { value: "2026-08-20" } }); });
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
      await act(async () => { renderer.root.findByProps({ "aria-label": "Due time" }).props.onChange({ currentTarget: { value: "09:00" } }); });
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

      expect(fetcher).toHaveBeenLastCalledWith("http://api.test/tasks/task-1", expect.objectContaining({ body: JSON.stringify({ memberId: "member-1", expectedVersion: 0, dueAt: new Date("2026-08-20T09:00:00").toISOString() }) }));
      renderer.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  test("saves changed date and time as one non-notifying due value", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-08-15T09:00:00.000Z", status: "open", version: 0 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy milk", dueAt: new Date("2026-08-20T10:30:00").toISOString(), status: "open", version: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());
    await enterEditMode(renderer);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Due information" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ "aria-label": "Due date" }).props.onChange({ currentTarget: { value: "2026-08-20" } }); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ "aria-label": "Due time" }).props.onChange({ currentTarget: { value: "10:30" } }); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/tasks/task-1", expect.objectContaining({ body: JSON.stringify({ memberId: "member-1", expectedVersion: 0, dueAt: new Date("2026-08-20T10:30:00").toISOString() }) }));
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["http://api.test/captures/capture-1/review", "http://api.test/tasks/task-1"]);
    renderer.unmount();
  });

  test("keeps the edited due time after a failed mutation and retries it", async () => {
    const original = reviewWith({ kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-08-15T09:00:00.000Z", status: "open", version: 0 });
    const dueAt = new Date("2026-08-20T10:30:00").toISOString();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: original }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "offline" }), { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ review: original }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy milk", dueAt, status: "open", version: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());
    await enterEditMode(renderer);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Due information" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ "aria-label": "Due date" }).props.onChange({ currentTarget: { value: "2026-08-20" } }); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ "aria-label": "Due time" }).props.onChange({ currentTarget: { value: "10:30" } }); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Choose due time" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });
    expect(textContent(renderer)).toContain("offline");
    expect(textContent(renderer)).toContain("10:30");
    expect(textContent(renderer)).not.toContain("Task changes saved.");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });
    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/tasks/task-1", expect.objectContaining({ body: JSON.stringify({ memberId: "member-1", expectedVersion: 0, dueAt }) }));
    expect(textContent(renderer)).toContain("Task changes saved.");
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
      timeZone: expect.any(String),
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "none", version: 2 }, {
      source: { id: "source-1", content: { kind: "audio", contentType: "audio/m4a", byteLength: 1024, sha256: "abc123" } },
      transcription: { status: "succeeded", text: "Call the dentist tomorrow", language: "en" },
      correction: { text: "Call the dentist on Friday" },
      interpretation: { id: "interpretation-1", classification: "clear_supported" },
    }) })));
    const renderer = await renderScreen(vi.fn());

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Toggle source and review history" }).props.onPress(); });
    expect(textContent(renderer)).toContain("Audio source · audio/m4a · 1,024 bytes · SHA-256 abc123");
    expect(textContent(renderer)).toContain("Original transcription");
    expect(textContent(renderer)).toContain("· en");
    expect(textContent(renderer)).toContain("Call the dentist tomorrow");
    expect(textContent(renderer)).toContain("Call the dentist on Friday");
    expect(textContent(renderer)).toContain("clear supported");
    expect(textContent(renderer)).toContain("Saved outcome");
    expect(textContent(renderer)).toContain("Call the dentist");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Note" }).props.onPress(); });
    expect(renderer.root.findByType(TextInput).props.value).toBe("Call the dentist");
    expect(textContent(renderer)).toContain("Call the dentist tomorrow");
    renderer.unmount();
  });

  test("shows original non-English transcription text and language without translating it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Позвони врачу", reviewState: "none", version: 2 }, { transcription: { status: "succeeded", text: "Позвони врачу завтра", language: "ru" } }) })));
    const renderer = await renderScreen(vi.fn());

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Toggle source and review history" }).props.onPress(); });
    expect(textContent(renderer)).toContain("Original transcription");
    expect(textContent(renderer)).toContain("ru");
    expect(textContent(renderer)).toContain("Позвони врачу завтра");
    expect(textContent(renderer)).not.toContain("Call the doctor tomorrow");
    renderer.unmount();
  });

  test("shows Task source and interpretation history separately from the Task fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", status: "open", version: 0 }, {
      source: { id: "source-1", content: { kind: "audio", contentType: "audio/m4a", byteLength: 512, sha256: "task-hash" } },
      transcription: { status: "succeeded", text: "Купи молоко", language: "ru" },
      interpretation: { id: "interpretation-1", classification: "clear_supported" },
    }) })));
    const renderer = await renderScreen(vi.fn());

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Toggle source and review history" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Audio source · audio/m4a · 512 bytes · SHA-256 task-hash");
    expect(textContent(renderer)).toContain("Original transcription");
    expect(textContent(renderer)).toContain("· ru");
    expect(textContent(renderer)).toContain("Купи молоко");
    expect(textContent(renderer)).toContain("clear supported");
    expect(textContent(renderer)).toContain("Buy milk");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Task" }).props.onPress(); });
    expect(renderer.root.findByProps({ accessibilityLabel: "Title" }).props.value).toBe("Buy milk");
    expect(textContent(renderer)).toContain("Купи молоко");
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

  test("cancels the Task draft without sending a mutation", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-08-15T09:00:00.000Z", status: "open", version: 0 }) }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Task" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Buy oat milk"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Cancel editing" }).props.onPress(); });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(textContent(renderer)).toContain("Buy milk");
    expect(textContent(renderer)).not.toContain("Buy oat milk");
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Task" })).toBeDefined();
    renderer.unmount();
  });

  test("saves a Task draft once and leaves the detail clean", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-08-15T09:00:00.000Z", status: "open", version: 0 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy oat milk (saved)", dueAt: "2026-08-15T09:00:00.000Z", status: "open", version: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const onBack = vi.fn();
    const renderer = await renderScreen(onBack);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Task" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Buy oat milk"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onBack).not.toHaveBeenCalled();
    expect(textContent(renderer)).toContain("Buy oat milk (saved)");
    expect(textContent(renderer)).toContain("Task changes saved.");
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Task" })).toBeDefined();
    renderer.unmount();
  });

  test("preserves a failed Task draft for retry and ignores duplicate Save taps", async () => {
    let resolveSave!: (response: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => { resolveSave = resolve; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-08-15T09:00:00.000Z", status: "open", version: 0 }) }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "offline" }), { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "task-1", title: "Buy milk", dueAt: "2026-08-15T09:00:00.000Z", status: "open", version: 0 }) }))
      .mockReturnValueOnce(pendingSave);
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Task" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Buy oat milk"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });
    expect(textContent(renderer)).toContain("offline");
    expect(renderer.root.findByType(TextInput).props.value).toBe("Buy oat milk");

    act(() => {
      const button = renderer.root.findByProps({ accessibilityLabel: "Save" });
      button.props.onPress();
      button.props.onPress();
    });
    act(() => {
      const cancel = renderer.root.findByProps({ accessibilityLabel: "Cancel editing" });
      cancel.props.onPress();
      cancel.props.onPress();
    });
    expect(renderer.root.findByType(TextInput).props.value).toBe("Buy oat milk");
    expect(fetcher).toHaveBeenCalledTimes(4);
    resolveSave(jsonResponse({ task: { kind: "task", id: "task-1", title: "Buy oat milk", dueAt: "2026-08-15T09:00:00.000Z", status: "open", version: 1 } }));
    await act(async () => { await pendingSave; });

    expect(textContent(renderer)).toContain("Task changes saved.");
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Task" })).toBeDefined();
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
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Task" })).toBeDefined();
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Convert saved Note to Task" })).toHaveLength(0);
    expect(onBack).not.toHaveBeenCalled();
    renderer.unmount();
  });

  test("keeps inherited Space visible and editable after Note conversion", async () => {
    const office: Space = { id: "space-1", memberId: "member-1", name: "Office", createdAt: "now" };
    const spacesClient = spacesFixture({
      list: vi.fn().mockResolvedValue([office]),
      read: vi.fn()
        .mockResolvedValueOnce({ space: office, path: "Office", children: [], items: [{ itemId: "note-1", itemKind: "note", spaceId: office.id, path: "Office", content: "Call" }] })
        .mockResolvedValueOnce({ space: office, path: "Office", children: [], items: [{ itemId: "note-1", itemKind: "task", spaceId: office.id, path: "Office", title: "Call" }] }),
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call", reviewState: "none", version: 1 }) }))
      .mockResolvedValueOnce(jsonResponse({ task: { kind: "task", id: "note-1", title: "Call", status: "open", version: 2 } }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn(), { spacesClient });

    expect(textContent(renderer)).toContain("Office");
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Convert saved Note to Task" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Converted to Task. Identity and provenance were kept.");
    expect(textContent(renderer)).toContain("Office");
    await enterEditMode(renderer);
    expect(renderer.root.findByProps({ accessibilityLabel: "Choose Space" })).toBeDefined();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Choose Space" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Choose Space Unassigned" }).props.onPress(); });
    expect(spacesClient.assign).toHaveBeenCalledWith("note-1", "task", "member-1", null);
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

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Toggle source and review history" }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Convert saved Note to Task" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Needs review");
    expect(textContent(renderer)).toContain("capture-1");
    expect(textContent(renderer)).toContain("source-1");
    expect(textContent(renderer)).toContain("Unable to convert Note: offline");
    expect(offlineDraftStore.save).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Convert saved Note to Task" }).props.onPress(); });

    expect(fetcher).toHaveBeenLastCalledWith("http://api.test/notes/note-1/convert-to-task", expect.objectContaining({ body: JSON.stringify({ memberId: "member-1", expectedVersion: 1 }) }));
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Task" })).toBeDefined();
    renderer.unmount();
  });

  test("resolves a stale Note review when the Note was converted before saving", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "none", version: 0 }) }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Note changed elsewhere" }), { status: 409 }))
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "task", id: "note-1", title: "Call the dentist", status: "open", version: 1 }) }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Edit Note" }).props.onPress(); });
    await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("Call the dentist tomorrow"); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Save" }).props.onPress(); });

    expect(textContent(renderer)).toContain("This Note was converted to a Task elsewhere. The review was refreshed.");
    expect(renderer.root.findByProps({ accessibilityRole: "alert" })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Task" })).toBeDefined();
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Edit Note" })).toHaveLength(0);
    expect(textContent(renderer)).not.toContain("Call the dentist tomorrow");
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
    expect(renderer.root.findByProps({ accessibilityLabel: "Edit Task" })).toBeDefined();
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

  test("offers a refresh action for failed processing", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith(null, { state: "failed", failure: { stage: "transcription", message: "provider offline" } }) }))
      .mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Call the dentist", reviewState: "none", version: 0 }) }));
    vi.stubGlobal("fetch", fetcher);
    const renderer = await renderScreen(vi.fn());

    expect(renderer.root.findByProps({ accessibilityLabel: "Refresh processing status" })).toBeDefined();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Refresh processing status" }).props.onPress(); });

    expect(textContent(renderer)).toContain("Note");
    expect(textContent(renderer)).not.toContain("Processing failed");
    renderer.unmount();
  });

  test("shows a safe unusable transcription failure without promising retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith(null, {
      state: "failed",
      transcription: { status: "failed", text: "[speaking russian]", provider: "whisper-local", model: "large-v3" },
      failure: { stage: "transcription", classification: "unusable_transcription", message: "Transcription could not be used. The Capture and original audio are saved." },
    }) })));
    const renderer = await renderScreen(vi.fn());
    const content = textContent(renderer);

    expect(content).toContain("Transcription could not be used. The Capture and original audio are saved.");
    expect(content.replace(/\s+/g, " ")).toContain("Transcription source · whisper-local · large-v3");
    expect(content).not.toContain("[speaking russian]");
    expect(content).not.toContain("try again when processing is available");
    expect(renderer.root.findByProps({ accessibilityLabel: "Refresh processing status" })).toBeDefined();
    renderer.unmount();
  });

  test("labels an ambiguous Note as Needs review", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ review: reviewWith({ kind: "note", id: "note-1", content: "Maybe book a trip", reviewState: "needs_review", version: 0 }, { state: "needs_review", interpretation: { id: "interpretation-1", classification: "ambiguous" } }) })));
    const renderer = await renderScreen(vi.fn());

    expect(textContent(renderer)).toContain("The Capture was ambiguous");
    expect(textContent(renderer)).toContain("Maybe book a trip");
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Edit Task" })).toHaveLength(0);
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

async function enterEditMode(renderer: ReactTestRenderer, kind: "task" | "note" = "task"): Promise<void> {
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: `Edit ${kind === "task" ? "Task" : "Note"}` }).props.onPress(); });
}

function reviewWith(outcome: object | null, overrides: object = {}) {
  return { state: "completed", capture: { id: "capture-1", memberId: "member-1" }, source: { id: "source-1" }, transcription: { status: "succeeded", text: "Call the dentist" }, correction: null, interpretation: { id: "interpretation-1" }, outcome, failure: null, ...overrides };
}

function jsonResponse(body: unknown): Response { return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }
function textContent(renderer: ReactTestRenderer): string { return renderer.root.findAll((node) => String(node.type) === "Text").flatMap((node) => node.children).filter((child): child is string => typeof child === "string").join(" "); }

function draftStore(overrides: Partial<OfflineDraftStore> = {}): OfflineDraftStore {
  return { list: vi.fn().mockResolvedValue([]), save: vi.fn(), remove: vi.fn().mockResolvedValue(undefined), ...overrides };
}

function metadataTag(id: string, name: string): Tag { return { id, name, memberId: "member-1", createdAt: "2026-01-01T00:00:00.000Z" }; }
function metadataEntity(id: string, name: string, type: Entity["type"]): Entity { return { id, name, type, memberId: "member-1", createdAt: "2026-01-01T00:00:00.000Z" }; }

function metadataFixture(overrides: Partial<MetadataClient> = {}): MetadataClient {
  const entity = metadataEntity("entity-1", "Office", "Place");
  return {
    listTags: vi.fn().mockResolvedValue([]), createTag: vi.fn().mockResolvedValue(metadataTag("tag-new", "new")),
    updateTag: vi.fn().mockResolvedValue(metadataTag("tag-1", "updated")),
    listEntities: vi.fn().mockResolvedValue([entity]), createEntity: vi.fn().mockResolvedValue(entity),
    updateEntity: vi.fn().mockResolvedValue(entity),
    listLinks: vi.fn().mockResolvedValue({ tags: [], entities: [] }),
    linkTag: vi.fn().mockResolvedValue({ tags: [], entities: [] }), unlinkTag: vi.fn().mockResolvedValue({ tags: [], entities: [] }),
    linkEntity: vi.fn().mockResolvedValue({ tags: [], entities: [] }), unlinkEntity: vi.fn().mockResolvedValue({ tags: [], entities: [] }),
    ...overrides,
  };
}

function spacesFixture(overrides: Partial<SpacesClient> = {}): SpacesClient {
  const space: Space = { id: "space-1", memberId: "member-1", name: "Office", createdAt: "now" };
  return {
    list: vi.fn().mockResolvedValue([space]), create: vi.fn(), read: vi.fn().mockResolvedValue({ space, path: "Office", children: [], items: [] }),
    update: vi.fn(), archive: vi.fn(), restore: vi.fn(), remove: vi.fn(), assign: vi.fn().mockResolvedValue(undefined), ...overrides,
  };
}

function organizationProposal(overrides: Partial<OrganizationProposal> = {}): OrganizationProposal {
  return {
    id: "proposal-1", itemId: "task-1", itemKind: "task", modelVersion: "qwen3.5:4b", rulesVersion: "organization.v1", state: "pending",
    candidates: [{ id: "candidate-space", kind: "space", confidence: 0.94, confidenceBand: "high", targetId: "space-1", suggestedName: "Office", provenance: ["model"], state: "pending" }],
    ...overrides,
  };
}

function organizationProposalFixture(overrides: Partial<OrganizationProposalClient> = {}): OrganizationProposalClient {
  return { list: vi.fn().mockResolvedValue({ generation: { state: "ready" }, proposals: [organizationProposal()] }), retry: vi.fn().mockResolvedValue({ generation: { state: "pending" }, proposals: [] }), decide: vi.fn().mockResolvedValue(organizationProposal()), ...overrides };
}
