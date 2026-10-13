import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createOfflineDraftId, type OfflineDraftStore } from "../offline/offline-drafts";
import { shouldPersistOfflineDraft } from "../http/request-error";
import { TaskNoteDetailScreen, type TaskNoteDetailDraft, type TaskNoteDetailItem, type TaskNoteDetailMetadata } from "../detail/TaskNoteDetailScreen";
import { entityTypes, type Entity, type EntityType, type MetadataClient, type MetadataItemKind, type MetadataLinks, type Tag } from "./metadata";
import { createReviewClient, type ReviewClient, type ReviewContract } from "./review";
import type { OrganizationProposal, OrganizationProposalCandidate, OrganizationProposalClient } from "./organization-proposals";
import { findAssignedSpace, spacePath, type SpacesClient } from "../spaces/spaces";
import { getDeviceTimeZone } from "../time-zone";

interface ReviewScreenProps {
  readonly apiBaseUrl: string;
  readonly memberId: string;
  readonly timeZone?: string;
  readonly detailUrl: string;
  readonly onBack: () => void;
  readonly client?: ReviewClient;
  readonly offlineDraftStore?: OfflineDraftStore;
  readonly metadataClient?: MetadataClient;
  readonly organizationProposalClient?: OrganizationProposalClient;
  readonly spacesClient?: SpacesClient;
  readonly detailMetadata?: TaskNoteDetailMetadata;
}

type ReviewStatus = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly review: ReviewContract };
type PendingMetadataMutation = { readonly label: string; readonly operation: () => Promise<void> };
type DetailMetadataState = { readonly itemId: string; readonly itemKind: MetadataItemKind; readonly selectedSpaceId: string | null; readonly spaces: readonly { readonly id: string; readonly label: string }[]; readonly tags: readonly { readonly id: string; readonly label: string; readonly selected: boolean }[]; readonly error: string | null };

export function ReviewScreen({ apiBaseUrl, memberId, timeZone, detailUrl, onBack, client: providedClient, offlineDraftStore, metadataClient: providedMetadataClient, organizationProposalClient: providedOrganizationProposalClient, spacesClient: providedSpacesClient, detailMetadata }: ReviewScreenProps) {
  const effectiveTimeZone = timeZone ?? getDeviceTimeZone();
  const client = useMemo(() => providedClient ?? createReviewClient(apiBaseUrl), [apiBaseUrl, providedClient]);
  const metadataClient = useMemo(() => providedMetadataClient ?? null, [providedMetadataClient]);
  const organizationProposalClient = useMemo(() => providedOrganizationProposalClient ?? null, [providedOrganizationProposalClient]);
  const spacesClient = useMemo(() => providedSpacesClient ?? null, [providedSpacesClient]);
  const [state, setState] = useState<ReviewStatus>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [conversionNotice, setConversionNotice] = useState<string | null>(null);
  const [loadedDetailMetadata, setLoadedDetailMetadata] = useState<DetailMetadataState | null>(null);
  const savingInFlight = useRef(false);
  const completionInFlight = useRef(false);
  const conversionInFlight = useRef(false);
  const textDraftIdentity = useRef<{ readonly draftId: string; readonly capturedAt: string; readonly text: string } | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const review = await client.get(detailUrl);
      setState({ status: "ready", review });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Unable to load review" });
    }
  }, [client, detailUrl]);

  const refreshReviewVersion = useCallback(async () => {
    try {
      const review = await client.get(detailUrl);
      setState({ status: "ready", review });
      return review;
    } catch {
      // Keep the current review visible when the recovery read also fails.
      return undefined;
    }
  }, [client, detailUrl]);

  useEffect(() => { void load(); }, [load]);

  const loadDetailMetadata = useCallback(async (itemId: string, itemKind: MetadataItemKind) => {
    if (!spacesClient) return;
    try {
      const [nextLinks, nextTags, nextSpaces] = await Promise.all([
        metadataClient ? metadataClient.listLinks(itemId, itemKind, memberId) : Promise.resolve({ tags: [], entities: [] }),
        metadataClient ? metadataClient.listTags(memberId) : Promise.resolve([]),
        spacesClient.list(memberId),
      ]);
      const activeSpaces = nextSpaces.filter((space) => !space.archivedAt);
      const assigned = await findAssignedSpace(spacesClient, activeSpaces, memberId, itemId, itemKind);
      setLoadedDetailMetadata({ itemId, itemKind, selectedSpaceId: assigned?.id ?? null, spaces: activeSpaces.map((space) => ({ id: space.id, label: spacePath(nextSpaces, space.id) })), tags: nextTags.map((tag) => ({ id: tag.id, label: tag.name, selected: nextLinks.tags.some((linked) => linked.id === tag.id) })), error: null });
    } catch (cause) {
      setLoadedDetailMetadata({ itemId, itemKind, selectedSpaceId: null, spaces: [], tags: [], error: cause instanceof Error ? cause.message : "Unable to load item properties" });
    }
  }, [memberId, metadataClient, spacesClient]);

  useEffect(() => {
    const outcome = state.status === "ready" ? state.review.outcome : null;
    if (!detailMetadata && outcome && spacesClient) void loadDetailMetadata(outcome.id, outcome.kind);
    else if (!outcome) setLoadedDetailMetadata(null);
  }, [detailMetadata, loadDetailMetadata, metadataClient, spacesClient, state.status, state.status === "ready" ? state.review.outcome?.id : null, state.status === "ready" ? state.review.outcome?.kind : null]);

  const liveMetadata = loadedDetailMetadata && state.status === "ready" && state.review.outcome?.id === loadedDetailMetadata.itemId && state.review.outcome.kind === loadedDetailMetadata.itemKind ? loadedDetailMetadata : null;
  const resolvedDetailMetadata = detailMetadata ?? (liveMetadata ? {
    selectedSpaceId: liveMetadata.selectedSpaceId,
    spaces: liveMetadata.spaces,
    tags: liveMetadata.tags,
    error: liveMetadata.error,
    onSpaceChange: async (spaceId: string | null) => {
      if (!spacesClient) return;
      try { await spacesClient.assign(liveMetadata.itemId, liveMetadata.itemKind, memberId, spaceId); setLoadedDetailMetadata({ ...liveMetadata, selectedSpaceId: spaceId, error: null }); }
      catch (cause) { setLoadedDetailMetadata({ ...liveMetadata, error: cause instanceof Error ? cause.message : "Unable to update Space" }); }
    },
    onTagToggle: async (tagId: string) => {
      if (!metadataClient) return;
      const tag = liveMetadata.tags.find((candidate) => candidate.id === tagId);
      if (!tag) return;
      try {
        const links = tag.selected ? await metadataClient.unlinkTag(liveMetadata.itemId, liveMetadata.itemKind, tagId, memberId) : await metadataClient.linkTag(liveMetadata.itemId, liveMetadata.itemKind, tagId, memberId);
        setLoadedDetailMetadata({ ...liveMetadata, tags: liveMetadata.tags.map((candidate) => ({ ...candidate, selected: links.tags.some((linked) => linked.id === candidate.id) })), error: null });
      } catch (cause) { setLoadedDetailMetadata({ ...liveMetadata, error: cause instanceof Error ? cause.message : "Unable to update Tags" }); }
    },
  } satisfies TaskNoteDetailMetadata : undefined);

  const save = useCallback(async (nextDraft: TaskNoteDetailDraft) => {
    if (state.status !== "ready" || !state.review.outcome || savingInFlight.current) return;
    if (state.review.outcome.kind === "task" && nextDraft.dueAt !== null && !isValidIsoDate(nextDraft.dueAt)) {
      setSaveError("Due information must be a valid date and time");
      return;
    }
    savingInFlight.current = true;
    setSaving(true);
    setSaveError(null);
    const outcome = state.review.outcome;
    try {
      if (outcome.kind === "task") {
        const changes: { title?: string; dueAt?: string | null } = {};
        if (nextDraft.text !== outcome.title) changes.title = nextDraft.text;
        if (nextDraft.dueAt !== (outcome.dueAt ?? null)) changes.dueAt = nextDraft.dueAt;
        if (Object.keys(changes).length > 0) await client.updateTask(outcome.id, memberId, outcome.version, changes);
      } else if (nextDraft.text !== outcome.content) {
        await client.updateNote(outcome.id, memberId, outcome.version, nextDraft.text);
      }
      onBack();
    } catch (error) {
      const saveMessage = error instanceof Error ? error.message : "Unable to save review";
      const text = nextDraft.text;
      if (outcome.kind === "note" && text !== outcome.content && offlineDraftStore && shouldPersistOfflineDraft(error)) {
        if (textDraftIdentity.current?.text !== text) {
          textDraftIdentity.current = { draftId: createOfflineDraftId(), capturedAt: new Date().toISOString(), text };
        }
        try {
          const identity = textDraftIdentity.current;
          await offlineDraftStore.save({ draftId: identity.draftId, memberId, capturedAt: identity.capturedAt, timeZone: effectiveTimeZone, source: { kind: "text", text } });
          setSaveError(`${saveMessage}. Saved as an Offline draft · Not confirmed`);
        } catch (persistenceError) {
          const persistenceMessage = persistenceError instanceof Error ? persistenceError.message : "local storage failed";
          setSaveError(`${saveMessage}. Offline draft was not saved: ${persistenceMessage}`);
        }
      } else {
        setSaveError(saveMessage);
      }
      const refreshed = await refreshReviewVersion();
      if (outcome.kind === "note" && refreshed?.outcome?.kind === "task" && refreshed.outcome.id === outcome.id) {
        setSaveError("This Note was converted to a Task elsewhere. The review was refreshed.");
      }
    } finally {
      savingInFlight.current = false;
      setSaving(false);
    }
  }, [client, memberId, offlineDraftStore, onBack, refreshReviewVersion, state]);

  const complete = useCallback(async () => {
    if (state.status !== "ready" || state.review.outcome?.kind !== "task" || state.review.outcome.status !== "open" || completionInFlight.current) return;
    completionInFlight.current = true;
    setCompleting(true);
    setCompletionError(null);
    try {
      await client.completeTask(state.review.outcome.id, memberId, state.review.outcome.version);
      onBack();
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : "Unable to complete Task");
      await refreshReviewVersion();
    } finally {
      completionInFlight.current = false;
      setCompleting(false);
    }
  }, [client, memberId, onBack, refreshReviewVersion, state]);

  const changeStatus = useCallback(async () => {
    if (state.status !== "ready" || state.review.outcome?.kind !== "task" || completionInFlight.current) return;
    if (state.review.outcome.status === "completed") {
      if (!client.reopenTask) {
        setCompletionError("Reopening is not available until the backend reopening contract is implemented.");
        return;
      }
      completionInFlight.current = true;
      setCompleting(true);
      setCompletionError(null);
      try {
        const task = await client.reopenTask(state.review.outcome.id, memberId, state.review.outcome.version);
        setState({ status: "ready", review: { ...state.review, outcome: task } });
      } catch (error) {
        setCompletionError(error instanceof Error ? error.message : "Unable to reopen Task");
        await refreshReviewVersion();
      } finally {
        completionInFlight.current = false;
        setCompleting(false);
      }
      return;
    }
    await complete();
  }, [client, complete, memberId, refreshReviewVersion, state]);

  const convertNoteToTask = useCallback(async () => {
    if (state.status !== "ready" || state.review.outcome?.kind !== "note" || conversionInFlight.current) return;
    conversionInFlight.current = true;
    setConverting(true);
    setConversionError(null);
    setConversionNotice(null);
    const note = state.review.outcome;
    try {
      const task = await client.convertNoteToTask(note.id, memberId, note.version);
      if (task.id !== note.id) throw new Error("Conversion response did not preserve item identity");
      setState({ status: "ready", review: { ...state.review, state: "completed", outcome: task } });
      setConversionNotice("Converted to Task. Identity and provenance were kept.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "conversion failed";
      const refreshed = await refreshReviewVersion();
      if (refreshed?.outcome?.kind === "task" && refreshed.outcome.id === note.id) {
        setConversionNotice("Conversion confirmed after refreshing.");
      } else {
        setConversionError(`Unable to convert Note: ${message}`);
      }
    } finally {
      conversionInFlight.current = false;
      setConverting(false);
    }
  }, [client, memberId, refreshReviewVersion, state]);

  if (state.status === "loading") return <ReviewShell onBack={onBack}><ActivityIndicator accessibilityLabel="Loading review" /><Text style={styles.stateText}>Loading review…</Text></ReviewShell>;
  if (state.status === "error") return <ReviewShell onBack={onBack}><Text style={styles.title}>Couldn’t load review</Text><Text style={styles.stateText}>{state.message}</Text><Button label="Try again" onPress={() => void load()} /></ReviewShell>;
  return <ReviewShell onBack={onBack} showBack={false}>
    <ReviewStateBanner review={state.review} />
    {state.review.state === "failed" ? <Button label="Refresh processing status" onPress={() => void load()} /> : null}
    {state.review.outcome ? <TaskNoteDetailScreen item={detailItem(state.review, resolvedDetailMetadata)} {...(resolvedDetailMetadata ? { metadata: resolvedDetailMetadata } : {})} {...(metadataClient ? { metadataContent: <MetadataControls client={metadataClient} memberId={memberId} itemId={state.review.outcome.id} itemKind={state.review.outcome.kind} /> } : {})} onBack={onBack} onSave={(nextDraft) => void save(nextDraft)} onChangeStatus={() => void changeStatus()} onConvert={state.review.outcome.kind === "note" ? () => void convertNoteToTask() : undefined} saving={saving} statusBusy={completing} converting={converting} error={saveError ?? completionError ?? conversionError} notice={conversionNotice} /> : <Text style={styles.stateText}>This Capture has no editable result yet.</Text>}
    {state.review.outcome && organizationProposalClient ? <OrganizationProposalControls client={organizationProposalClient} memberId={memberId} itemId={state.review.outcome.id} itemKind={state.review.outcome.kind} /> : null}
    {!state.review.outcome ? <><Text style={styles.sectionTitle}>Source and provenance</Text><Text style={styles.provenance}>Capture {state.review.capture.id} · source {state.review.source.id}</Text>{state.review.transcription ? <><Text style={styles.fieldLabel}>Original transcription{state.review.transcription.language ? ` · ${state.review.transcription.language}` : ""}</Text><Text style={styles.originalText}>{state.review.transcription.text ?? `Status: ${state.review.transcription.status}`}</Text></> : <Text style={styles.provenance}>Original transcription · pending</Text>}</> : null}
  </ReviewShell>;
}

function OrganizationProposalControls({ client, memberId, itemId, itemKind }: { readonly client: OrganizationProposalClient; readonly memberId: string; readonly itemId: string; readonly itemKind: "task" | "note" }) {
  const [proposals, setProposals] = useState<readonly OrganizationProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, readonly string[]>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setProposals(await client.list(itemId, itemKind, memberId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load AI suggestions"); }
    finally { setLoading(false); }
  }, [client, itemId, itemKind, memberId]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (proposal: OrganizationProposal, state: "accepted" | "dismissed") => {
    if (inFlight) return;
    setInFlight(proposal.id); setMutationError(null);
    try {
      const candidateIds = state === "accepted" ? selected[proposal.id] ?? proposal.candidates.filter((candidate) => candidate.state === "pending" && candidate.confidenceBand !== "low").map((candidate) => candidate.id) : undefined;
      const updated = await client.decide(proposal.id, state, memberId, candidateIds);
      setProposals((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) { setMutationError(cause instanceof Error ? cause.message : "Unable to update organization proposal"); }
    finally { setInFlight(null); }
  };

  if (loading) return <View style={styles.organization}><Text style={styles.sectionTitle}>AI suggestions</Text><Text style={styles.stateText}>Loading suggestions…</Text></View>;
  return <View style={styles.organization}>
    <Text style={styles.sectionTitle}>AI suggestions</Text>
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Button label="Retry AI suggestions" onPress={() => void load()} /></> : null}
    {!error && proposals.filter((proposal) => proposal.state === "pending" && proposal.candidates.some((candidate) => candidate.state === "pending")).length === 0 ? <Text style={styles.stateText}>No AI suggestions need review.</Text> : null}
    {!error ? proposals.filter((proposal) => proposal.state === "pending" && proposal.candidates.some((candidate) => candidate.state === "pending")).map((proposal) => <View key={proposal.id} style={styles.proposalCard}>
      <Text style={styles.proposalMeta}>Suggested by {proposal.modelVersion} · rules {proposal.rulesVersion}</Text>
      {proposal.candidates.filter((candidate) => candidate.state === "pending").map((candidate) => <ProposalCandidateRow key={candidate.id} candidate={candidate} selected={(selected[proposal.id] ?? proposal.candidates.filter((item) => item.state === "pending" && item.confidenceBand !== "low").map((item) => item.id)).includes(candidate.id)} disabled={inFlight !== null} onToggle={() => setSelected((current) => ({ ...current, [proposal.id]: (current[proposal.id] ?? proposal.candidates.filter((item) => item.state === "pending" && item.confidenceBand !== "low").map((item) => item.id)).includes(candidate.id) ? (current[proposal.id] ?? []).filter((id) => id !== candidate.id) : [...(current[proposal.id] ?? proposal.candidates.filter((item) => item.state === "pending" && item.confidenceBand !== "low").map((item) => item.id)), candidate.id] }))} />)}
      <View style={styles.proposalActions}><Button label={inFlight === proposal.id ? "Accepting…" : "Accept selected suggestions"} onPress={() => void decide(proposal, "accepted")} disabled={inFlight !== null || hasNoSelectedCandidates(selected[proposal.id])} /><Button label={inFlight === proposal.id ? "Dismissing…" : "Dismiss suggestions"} onPress={() => void decide(proposal, "dismissed")} disabled={inFlight !== null} /></View>
    </View>) : null}
    {mutationError ? <Text accessibilityRole="alert" style={styles.error}>{mutationError}</Text> : null}
  </View>;
}

function hasNoSelectedCandidates(candidateIds: readonly string[] | undefined): boolean {
  return candidateIds !== undefined && candidateIds.length === 0;
}

function ProposalCandidateRow({ candidate, selected, disabled, onToggle }: { readonly candidate: OrganizationProposalCandidate; readonly selected: boolean; readonly disabled: boolean; readonly onToggle: () => void }) {
  const name = candidate.suggestedName ?? `${candidate.kind} ${candidate.targetId ?? ""}`.trim();
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled }} accessibilityLabel={`${selected ? "Remove" : "Select"} ${candidate.kind} suggestion ${name}`} onPress={onToggle} disabled={disabled || candidate.confidenceBand === "low"} style={styles.proposalCandidate}>
    <Text style={styles.metadataValue}>{selected ? "✓ " : "○ "}{candidate.kind} · {name}</Text><Text style={styles.proposalConfidence}>{candidate.confidenceBand} confidence ({Math.round(candidate.confidence * 100)}%)</Text><Text style={styles.provenance}>Source: {candidate.provenance.join(" · ")}</Text>{candidate.confidenceBand === "low" ? <Text style={styles.error}>Low-confidence suggestions cannot be accepted.</Text> : null}
  </Pressable>;
}

function MetadataControls({ client, memberId, itemId, itemKind }: { readonly client: MetadataClient; readonly memberId: string; readonly itemId: string; readonly itemKind: MetadataItemKind }) {
  const [links, setLinks] = useState<MetadataLinks>({ tags: [], entities: [] });
  const [tags, setTags] = useState<readonly Tag[]>([]);
  const [entities, setEntities] = useState<readonly Entity[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [entityDraft, setEntityDraft] = useState("");
  const [entityType, setEntityType] = useState<EntityType>(entityTypes[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
  const [tagEditDraft, setTagEditDraft] = useState("");
  const [entityEditDraft, setEntityEditDraft] = useState("");
  const [entityEditType, setEntityEditType] = useState<EntityType>(entityTypes[0]);
  const [pendingMutation, setPendingMutation] = useState<PendingMetadataMutation | null>(null);
  const [mutationInFlight, setMutationInFlight] = useState(false);
  const mutationInFlightRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextLinks, nextTags, nextEntities] = await Promise.all([
        client.listLinks(itemId, itemKind, memberId),
        client.listTags(memberId),
        client.listEntities(memberId),
      ]);
      setLinks(nextLinks);
      setTags(nextTags);
      setEntities(nextEntities);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Tags and Entities");
    } finally {
      setLoading(false);
    }
  }, [client, itemId, itemKind, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runMutation = async (label: string, operation: () => Promise<void>) => {
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setMutationInFlight(true);
    setMutationError(null);
    try {
      await operation();
      setPendingMutation(null);
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Unable to update metadata");
      setPendingMutation({ label, operation });
    } finally {
      mutationInFlightRef.current = false;
      setMutationInFlight(false);
    }
  };

  const addTag = () => {
    const name = tagDraft.trim();
    if (!name) {
      setMutationError("Tag name must not be empty");
      return;
    }
    let createdTag: Tag | null = null;
    void runMutation(`creating and adding Tag ${name}`, async () => {
      createdTag ??= await client.createTag(memberId, name);
      const tag = createdTag;
      setTags((current) => current.some((item) => item.id === tag.id) ? current : [...current, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setTagDraft("");
      setLinks(await client.linkTag(itemId, itemKind, tag.id, memberId));
    });
  };

  const addEntity = () => {
    const name = entityDraft.trim();
    if (!name) {
      setMutationError("Entity name must not be empty");
      return;
    }
    const type = entityType;
    let createdEntity: Entity | null = null;
    void runMutation(`creating and adding Entity ${name}`, async () => {
      createdEntity ??= await client.createEntity(memberId, name, type);
      const entity = createdEntity;
      setEntities((current) => current.some((item) => item.id === entity.id) ? current : [...current, entity].sort((a, b) => a.name.localeCompare(b.name)));
      setEntityDraft("");
      setLinks(await client.linkEntity(itemId, itemKind, entity.id, memberId));
    });
  };

  const editTag = (tag: Tag) => {
    const name = tagEditDraft.trim();
    if (!name) {
      setMutationError("Tag name must not be empty");
      return;
    }
    void runMutation(`editing Tag ${tag.name}`, async () => {
      const updated = await client.updateTag(tag.id, memberId, name);
      setTags((current) => current.map((item) => item.id === updated.id ? updated : item));
      setLinks((current) => ({ ...current, tags: current.tags.map((item) => item.id === updated.id ? updated : item) }));
      setEditingTagId(null);
    });
  };

  const editEntity = (entity: Entity) => {
    const name = entityEditDraft.trim();
    if (!name) {
      setMutationError("Entity name must not be empty");
      return;
    }
    const type = entityEditType;
    void runMutation(`editing Entity ${entity.name}`, async () => {
      const updated = await client.updateEntity(entity.id, memberId, name, type);
      setEntities((current) => current.map((item) => item.id === updated.id ? updated : item));
      setLinks((current) => ({ ...current, entities: current.entities.map((item) => item.id === updated.id ? updated : item) }));
      setEditingEntityId(null);
    });
  };

  if (loading) {
    return <View style={styles.metadataInline}>
      <Text style={styles.fieldLabel}>TAGS & ENTITIES</Text>
      <Text style={styles.stateText}>Loading metadata…</Text>
    </View>;
  }

  return <View style={styles.metadataInline}>
    <Text style={styles.fieldLabel}>TAGS & ENTITIES</Text>
    {error ? <>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Button label="Retry metadata" onPress={() => void load()} disabled={mutationInFlight} />
    </> : <Button label="Refresh metadata" onPress={() => void load()} disabled={mutationInFlight} />}
    <Text style={styles.stateText}>Tags are flat markers. Entities are named {entityTypes.join(", ")}.</Text>
    <Text style={styles.fieldLabel}>Tags</Text>
    {links.tags.map((tag) => <MetadataTagRow
      key={tag.id}
      tag={tag}
      linked
      editing={editingTagId === tag.id}
      editDraft={tagEditDraft}
      disabled={mutationInFlight}
      onEdit={() => { setEditingTagId(tag.id); setTagEditDraft(tag.name); }}
      onEditChange={setTagEditDraft}
      onSave={() => editTag(tag)}
      onRemove={() => void runMutation(`removing Tag ${tag.name}`, async () => setLinks(await client.unlinkTag(itemId, itemKind, tag.id, memberId)))}
    />)}
    <TextInput accessibilityLabel="New Tag name" placeholder="New Tag" value={tagDraft} onChangeText={setTagDraft} editable={!mutationInFlight} style={styles.input} />
    <Button label="Create and add Tag" onPress={addTag} disabled={mutationInFlight} />
    {tags.filter((tag) => !links.tags.some((linked) => linked.id === tag.id)).map((tag) => <MetadataTagRow
      key={tag.id}
      tag={tag}
      linked={false}
      editing={editingTagId === tag.id}
      editDraft={tagEditDraft}
      disabled={mutationInFlight}
      onEdit={() => { setEditingTagId(tag.id); setTagEditDraft(tag.name); }}
      onEditChange={setTagEditDraft}
      onSave={() => editTag(tag)}
      onAdd={() => void runMutation(`adding Tag ${tag.name}`, async () => setLinks(await client.linkTag(itemId, itemKind, tag.id, memberId)))}
    />)}
    <Text style={styles.fieldLabel}>Entities</Text>
    {links.entities.map((entity) => <MetadataEntityRow
      key={entity.id}
      entity={entity}
      linked
      editing={editingEntityId === entity.id}
      editDraft={entityEditDraft}
      editType={entityEditType}
      disabled={mutationInFlight}
      onEdit={() => { setEditingEntityId(entity.id); setEntityEditDraft(entity.name); setEntityEditType(entity.type); }}
      onEditChange={setEntityEditDraft}
      onTypeChange={setEntityEditType}
      onSave={() => editEntity(entity)}
      onRemove={() => void runMutation(`removing Entity ${entity.name}`, async () => setLinks(await client.unlinkEntity(itemId, itemKind, entity.id, memberId)))}
    />)}
    <TextInput accessibilityLabel="New Entity name" placeholder="New Entity" value={entityDraft} onChangeText={setEntityDraft} editable={!mutationInFlight} style={styles.input} />
    <EntityTypePicker value={entityType} onChange={setEntityType} disabled={mutationInFlight} />
    <Button label="Create and add Entity" onPress={addEntity} disabled={mutationInFlight} />
    {entities.filter((entity) => !links.entities.some((linked) => linked.id === entity.id)).map((entity) => <MetadataEntityRow
      key={entity.id}
      entity={entity}
      linked={false}
      editing={editingEntityId === entity.id}
      editDraft={entityEditDraft}
      editType={entityEditType}
      disabled={mutationInFlight}
      onEdit={() => { setEditingEntityId(entity.id); setEntityEditDraft(entity.name); setEntityEditType(entity.type); }}
      onEditChange={setEntityEditDraft}
      onTypeChange={setEntityEditType}
      onSave={() => editEntity(entity)}
      onAdd={() => void runMutation(`adding Entity ${entity.name}`, async () => setLinks(await client.linkEntity(itemId, itemKind, entity.id, memberId)))}
    />)}
    {mutationError ? <>
      <Text accessibilityRole="alert" style={styles.error}>{mutationError}</Text>
      {pendingMutation ? <Button label={`Retry ${pendingMutation.label}`} onPress={() => void runMutation(pendingMutation.label, pendingMutation.operation)} disabled={mutationInFlight} /> : null}
    </> : null}
  </View>;
}

function MetadataTagRow({ tag, linked, editing, editDraft, disabled, onEdit, onEditChange, onSave, onAdd, onRemove }: { readonly tag: Tag; readonly linked: boolean; readonly editing: boolean; readonly editDraft: string; readonly disabled: boolean; readonly onEdit: () => void; readonly onEditChange: (value: string) => void; readonly onSave: () => void; readonly onAdd?: () => void; readonly onRemove?: () => void }) {
  if (editing) return <View style={styles.metadataRow}>
    {!linked && onAdd ? <Button label={`Add existing Tag ${tag.name}`} onPress={onAdd} disabled={disabled} /> : null}
    <TextInput accessibilityLabel={`Edit Tag ${tag.name}`} value={editDraft} onChangeText={onEditChange} editable={!disabled} style={styles.editInput} />
    <Button label={`Save Tag ${tag.name}`} onPress={onSave} disabled={disabled} />
  </View>;
  return <View style={styles.metadataRow}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit Tag ${tag.name}`} onPress={onEdit} disabled={disabled} style={styles.inlineEdit}><Text style={styles.metadataValue}>Tag · {tag.name}</Text></Pressable>
    {linked && onRemove ? <Button label={`Remove Tag ${tag.name}`} onPress={onRemove} disabled={disabled} /> : null}
    {!linked && onAdd ? <Button label={`Add existing Tag ${tag.name}`} onPress={onAdd} disabled={disabled} /> : null}
  </View>;
}

function MetadataEntityRow({ entity, linked, editing, editDraft, editType, disabled, onEdit, onEditChange, onTypeChange, onSave, onAdd, onRemove }: { readonly entity: Entity; readonly linked: boolean; readonly editing: boolean; readonly editDraft: string; readonly editType: EntityType; readonly disabled: boolean; readonly onEdit: () => void; readonly onEditChange: (value: string) => void; readonly onTypeChange: (value: EntityType) => void; readonly onSave: () => void; readonly onAdd?: () => void; readonly onRemove?: () => void }) {
  if (editing) return <View style={styles.metadataRow}>
    {!linked && onAdd ? <Button label={`Add existing Entity ${entity.name}`} onPress={onAdd} disabled={disabled} /> : null}
    <TextInput accessibilityLabel={`Edit Entity ${entity.name}`} value={editDraft} onChangeText={onEditChange} editable={!disabled} style={styles.editInput} />
    <EntityTypePicker value={editType} onChange={onTypeChange} disabled={disabled} edit />
    <Button label={`Save Entity ${entity.name}`} onPress={onSave} disabled={disabled} />
  </View>;
  return <View style={styles.metadataRow}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit Entity ${entity.name}`} onPress={onEdit} disabled={disabled} style={styles.inlineEdit}><Text style={styles.metadataValue}>{entity.type} · {entity.name}</Text></Pressable>
    {linked && onRemove ? <Button label={`Remove Entity ${entity.name}`} onPress={onRemove} disabled={disabled} /> : null}
    {!linked && onAdd ? <Button label={`Add existing Entity ${entity.name}`} onPress={onAdd} disabled={disabled} /> : null}
  </View>;
}

function EntityTypePicker({ value, onChange, disabled, edit = false }: { readonly value: EntityType; readonly onChange: (value: EntityType) => void; readonly disabled: boolean; readonly edit?: boolean }) {
  return <View style={styles.typeRow}>
    {entityTypes.map((type) => <Pressable key={type} accessibilityRole="button" accessibilityLabel={`${edit ? "Edit " : ""}Entity type ${type}`} onPress={() => onChange(type)} disabled={disabled} style={type === value ? styles.typeSelected : styles.typeOption}>
      <Text>{type}</Text>
    </Pressable>)}
  </View>;
}

function ReviewStateBanner({ review }: { readonly review: ReviewContract }) {
  if (review.state === "completed") return null;
  if (review.state === "needs_review") {
    if (review.interpretation?.classification === "ambiguous") return <Text accessibilityRole="alert" style={styles.reviewState}>Needs review · The Capture was ambiguous. Confirm or edit the Note before saving.</Text>;
    if (review.interpretation?.classification === "unsupported") return <Text accessibilityRole="alert" style={styles.reviewState}>Needs review · This instruction is unsupported. Confirm or edit the Note before saving.</Text>;
    return <Text accessibilityRole="alert" style={styles.reviewState}>Needs review · Confirm or edit this result before saving.</Text>;
  }
  if (review.state === "failed") return <View accessibilityRole="alert"><Text style={styles.error}>Processing failed</Text><Text style={styles.stateText}>{review.failure?.message ?? "The Capture could not be processed."}</Text><Text style={styles.stateText}>Review the original Capture and try again when processing is available.</Text></View>;
  return <Text accessibilityRole="alert" style={styles.reviewState}>Processing · No result is available yet.</Text>;
}

function detailItem(review: ReviewContract, metadata?: TaskNoteDetailMetadata): TaskNoteDetailItem {
  const outcome = review.outcome;
  if (!outcome) throw new Error("Cannot render detail without an outcome");
  const space = metadata?.selectedSpaceId === null ? "No Space" : metadata?.spaces.find((candidate) => candidate.id === metadata.selectedSpaceId)?.label ?? "No Space";
  const tags = metadata?.tags.filter((tag) => tag.selected).map((tag) => `#${tag.label}`) ?? [];
  const interpretation = review.interpretation?.classification?.replaceAll("_", " ") ?? "Saved result";
  const transcription = review.transcription?.text ? { text: review.transcription.text, ...(review.transcription.language ? { language: review.transcription.language } : {}) } : undefined;
  if (outcome.kind === "task") return { kind: "task", id: outcome.id, title: outcome.title, status: outcome.status, dueAt: outcome.dueAt ?? null, space, tags, source: `Capture ${review.capture.id} · source ${review.source.id}`, interpretation, ...(transcription ? { transcription } : {}) };
  return { kind: "note", id: outcome.id, content: outcome.content, reviewState: outcome.reviewState === "needs_review" ? "needs_review" : "saved", space, tags, source: `Capture ${review.capture.id} · source ${review.source.id}`, interpretation, ...(transcription ? { transcription } : {}) };
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/.exec(value);
  if (!match) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]) && date.getUTCHours() === Number(match[4]) && date.getUTCMinutes() === Number(match[5]);
}

function ReviewShell({ children, onBack, showBack = true }: { readonly children: ReactNode; readonly onBack: () => void; readonly showBack?: boolean }) { return <SafeAreaView style={styles.safeArea}>{showBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back to items" onPress={onBack}><Text style={styles.back}>‹ Items</Text></Pressable> : null}<ScrollView contentContainerStyle={styles.content}>{children}</ScrollView></SafeAreaView>; }
function Button({ label, onPress, disabled = false }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({ safeArea: { flex: 1, backgroundColor: "#F7F5F0" }, content: { padding: 24 }, back: { color: "#7A5C36", fontSize: 16, paddingHorizontal: 24, paddingTop: 16 }, eyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, title: { color: "#24221F", fontSize: 32, fontWeight: "700", marginTop: 6 }, stateText: { color: "#716B64", fontSize: 15, lineHeight: 22, marginTop: 8 }, reviewState: { color: "#8C3D25", fontSize: 15, fontWeight: "600", lineHeight: 22, marginTop: 18 }, field: { marginTop: 24 }, fieldLabel: { color: "#8B7355", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, value: { color: "#24221F", fontSize: 19, lineHeight: 27, marginTop: 5 }, originalText: { color: "#716B64", fontSize: 16, lineHeight: 24, marginTop: 5 }, input: { borderBottomColor: "#B9A895", borderBottomWidth: 1, color: "#24221F", fontSize: 19, lineHeight: 27, paddingVertical: 5 }, editInput: { borderBottomColor: "#B9A895", borderBottomWidth: 1, color: "#24221F", flex: 1, fontSize: 16, paddingVertical: 5 }, sectionTitle: { color: "#24221F", fontSize: 17, fontWeight: "700", marginTop: 32 }, provenance: { color: "#716B64", fontSize: 14, lineHeight: 21, marginTop: 6 }, metadataInline: { marginTop: 14 }, organization: { borderTopColor: "#D8CFC2", borderTopWidth: 1, marginTop: 30, paddingTop: 4 }, proposalCard: { backgroundColor: "#FFF8E8", borderColor: "#D5B98D", borderRadius: 14, borderWidth: 1, marginTop: 14, padding: 14 }, proposalCandidate: { borderBottomColor: "#E5D8C3", borderBottomWidth: 1, paddingBottom: 10, paddingTop: 8 }, proposalMeta: { color: "#716B64", fontSize: 13 }, proposalConfidence: { color: "#7A5C36", fontSize: 13, marginTop: 4 }, proposalActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, metadataRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }, inlineEdit: { flex: 1 }, metadataValue: { color: "#24221F", flex: 1, fontSize: 16, marginTop: 18 }, typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }, typeOption: { borderColor: "#B9A895", borderRadius: 10, borderWidth: 1, padding: 8 }, typeSelected: { backgroundColor: "#D5B98D", borderColor: "#8B7355", borderRadius: 10, borderWidth: 1, padding: 8 }, button: { alignSelf: "flex-start", backgroundColor: "#24221F", borderRadius: 12, marginTop: 24, paddingHorizontal: 20, paddingVertical: 12 }, buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" }, error: { color: "#A33B31", fontSize: 14, marginTop: 12 }, success: { color: "#356445", fontSize: 14, marginTop: 12 }, dueBubbles: { flexDirection: "row", gap: 8, marginTop: 10 }, dueBubble: { borderColor: "#B9A895", borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 }, dueBubbleText: { color: "#24221F", fontSize: 16 }, clearDue: { color: "#8C3D25", fontSize: 14, marginTop: 12 }, pickerPanel: { backgroundColor: "#EFEAE2", borderRadius: 16, marginTop: 14, padding: 16 }, pickerHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, pickerTitle: { color: "#24221F", fontSize: 17, fontWeight: "700" }, pickerHint: { color: "#716B64", fontSize: 13, marginTop: 8 }, monthRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginVertical: 18 }, calendarGrid: { flexDirection: "row", flexWrap: "wrap" }, calendarDay: { alignItems: "center", justifyContent: "center", minHeight: 38, width: "14.285%" }, calendarDaySelected: { backgroundColor: "#D5B98D", borderRadius: 19 } });
