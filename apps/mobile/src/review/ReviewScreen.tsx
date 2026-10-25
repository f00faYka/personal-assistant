import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createOfflineDraftId, type OfflineDraftStore } from "../offline/offline-drafts";
import { shouldPersistOfflineDraft } from "../http/request-error";
import { TaskNoteDetailScreen, type TaskNoteDetailDraft, type TaskNoteDetailItem, type TaskNoteDetailMetadata } from "../detail/TaskNoteDetailScreen";
import type { Entity, EntityType, MetadataClient, MetadataItemKind, MetadataLinks, Tag } from "./metadata";
import { createReviewClient, type ReviewClient, type ReviewContract } from "./review";
import type { OrganizationProposal, OrganizationProposalCandidate, OrganizationProposalClient, OrganizationProposalGeneration } from "./organization-proposals";
import { findAssignedSpace, spacePath, type SpacesClient } from "../spaces/spaces";
import { getDeviceTimeZone } from "../time-zone";

interface ReviewScreenProps {
  readonly apiBaseUrl: string;
  readonly memberId: string;
  readonly timeZone?: string;
  readonly detailUrl: string;
  readonly initialEditing?: boolean;
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

export function ReviewScreen({ apiBaseUrl, memberId, timeZone, detailUrl, initialEditing = false, onBack, client: providedClient, offlineDraftStore, metadataClient: providedMetadataClient, organizationProposalClient: providedOrganizationProposalClient, spacesClient: providedSpacesClient, detailMetadata }: ReviewScreenProps) {
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

  const save = useCallback(async (nextDraft: TaskNoteDetailDraft): Promise<TaskNoteDetailDraft | undefined> => {
    if (state.status !== "ready" || !state.review.outcome || savingInFlight.current) return undefined;
    if (state.review.outcome.kind === "task" && nextDraft.dueAt !== null && !isValidIsoDate(nextDraft.dueAt)) {
      setSaveError("Due information must be a valid date and time");
      return undefined;
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
        if (Object.keys(changes).length > 0) {
          const updated = await client.updateTask(outcome.id, memberId, outcome.version, changes);
          if (updated.kind !== "task") throw new Error("Task update response did not include a Task");
          setState({ status: "ready", review: { ...state.review, outcome: updated } });
          return { text: updated.title, dueAt: updated.dueAt ?? null };
        }
        return { text: outcome.title, dueAt: outcome.dueAt ?? null };
      } else if (nextDraft.text !== outcome.content) {
        await client.updateNote(outcome.id, memberId, outcome.version, nextDraft.text);
      }
      onBack();
      return undefined;
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
      return undefined;
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
    {state.review.outcome ? <TaskNoteDetailScreen item={detailItem(state.review, resolvedDetailMetadata)} initialEditing={initialEditing} {...(resolvedDetailMetadata ? { metadata: resolvedDetailMetadata } : {})} {...(metadataClient ? { tagEntityControls: () => <MetadataControls client={metadataClient} memberId={memberId} itemId={state.review.outcome!.id} itemKind={state.review.outcome!.kind} /> } : {})} onBack={onBack} onSave={save} onChangeStatus={() => void changeStatus()} onConvert={state.review.outcome.kind === "note" ? () => void convertNoteToTask() : undefined} saving={saving} statusBusy={completing} converting={converting} error={saveError ?? completionError ?? conversionError} notice={conversionNotice} /> : <Text style={styles.stateText}>This Capture has no editable result yet.</Text>}
    {state.review.outcome && organizationProposalClient ? <OrganizationProposalControls client={organizationProposalClient} memberId={memberId} itemId={state.review.outcome.id} itemKind={state.review.outcome.kind} /> : null}
    {!state.review.outcome ? <><Text style={styles.sectionTitle}>Source and provenance</Text><Text style={styles.provenance}>Capture {state.review.capture.id} · source {state.review.source.id}</Text>{state.review.failure?.classification === "unusable_transcription" ? <><Text style={styles.provenance}>Original transcription · unavailable</Text>{state.review.transcription?.provider ? <Text style={styles.provenance}>Transcription source · {state.review.transcription.provider}{state.review.transcription.model ? ` · ${state.review.transcription.model}` : ""}</Text> : null}</> : state.review.transcription ? <><Text style={styles.fieldLabel}>Original transcription{state.review.transcription.language ? ` · ${state.review.transcription.language}` : ""}</Text><Text style={styles.originalText}>{state.review.transcription.text ?? `Status: ${state.review.transcription.status}`}</Text></> : <Text style={styles.provenance}>Original transcription · pending</Text>}</> : null}
  </ReviewShell>;
}

function OrganizationProposalControls({ client, memberId, itemId, itemKind }: { readonly client: OrganizationProposalClient; readonly memberId: string; readonly itemId: string; readonly itemKind: "task" | "note" }) {
  const pollIntervalMilliseconds = 2_000;
  const [proposals, setProposals] = useState<readonly OrganizationProposal[]>([]);
  const [generation, setGeneration] = useState<OrganizationProposalGeneration>({ state: "pending" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [pollCycle, setPollCycle] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, Record<string, "accepted" | "dismissed">>>({});
  const generationRef = useRef<OrganizationProposalGeneration>({ state: "pending" });
  const submissionInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    generationRef.current = { state: "pending" };
    setGeneration(generationRef.current);
    setProposals([]);
    setLoading(true);
    const scheduleNext = () => { timer = setTimeout(() => { void poll(false); }, pollIntervalMilliseconds); };
    const poll = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      setError(null);
      try {
        const snapshot = await client.list(itemId, itemKind, memberId);
        if (!active) return;
        setProposals(snapshot.proposals);
        generationRef.current = snapshot.generation;
        setGeneration(snapshot.generation);
        setLoading(false);
        if (snapshot.generation.state === "pending" || snapshot.generation.state === "running") scheduleNext();
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Unable to load AI suggestions");
        setLoading(false);
        const lastState = generationRef.current.state;
        if (lastState === "pending" || lastState === "running") scheduleNext();
      }
    };
    void poll(true);
    return () => { active = false; if (timer !== undefined) clearTimeout(timer); };
  }, [client, itemId, itemKind, memberId, pollCycle]);

  const retryGeneration = async () => {
    setRetrying(true); setError(null);
    try {
      const snapshot = await client.retry(itemId, itemKind, memberId);
      setProposals(snapshot.proposals);
      generationRef.current = snapshot.generation;
      setGeneration(snapshot.generation);
      setPollCycle((current) => current + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to retry AI suggestions"); }
    finally { setRetrying(false); }
  };

  const retryLoading = () => setPollCycle((current) => current + 1);

  const refreshProposals = async (proposalId?: string) => {
    try {
      const snapshot = await client.list(itemId, itemKind, memberId);
      setProposals(snapshot.proposals);
      generationRef.current = snapshot.generation;
      setGeneration(snapshot.generation);
      if (proposalId && !snapshot.proposals.some((proposal) => proposal.id === proposalId && proposal.state === "pending")) {
        setDecisions((current) => { const next = { ...current }; delete next[proposalId]; return next; });
      }
    } catch {
      // Keep the server response or local decisions visible when reconciliation is unavailable.
    }
  };

  const submitProposal = async (proposal: OrganizationProposal, nextDecisions: Record<string, "accepted" | "dismissed">) => {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setInFlight(proposal.id); setMutationError(null);
    try {
      const candidateIds = proposal.candidates.filter((candidate) => nextDecisions[candidate.id] === "accepted").map((candidate) => candidate.id);
      const updated = await client.decide(proposal.id, candidateIds.length > 0 ? "accepted" : "dismissed", memberId, candidateIds.length > 0 ? candidateIds : undefined);
      setProposals((current) => current.map((item) => item.id === updated.id ? updated : item));
      await refreshProposals(proposal.id);
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Unable to update organization proposal");
      await refreshProposals(proposal.id);
    } finally {
      submissionInFlight.current = false;
      setInFlight(null);
    }
  };

  const decideLocally = (proposal: OrganizationProposal, candidateId: string, decision: "accepted" | "dismissed") => {
    if (submissionInFlight.current) return;
    const pendingCandidates = proposal.candidates.filter((candidate) => candidate.state === "pending");
    const nextDecisions = { ...(decisions[proposal.id] ?? {}), [candidateId]: decision };
    setDecisions((current) => ({ ...current, [proposal.id]: nextDecisions }));
    if (pendingCandidates.every((candidate) => nextDecisions[candidate.id])) void submitProposal(proposal, nextDecisions);
  };

  const finishProposal = (proposal: OrganizationProposal) => {
    if (submissionInFlight.current) return;
    void submitProposal(proposal, decisions[proposal.id] ?? {});
  };

  if (loading) return <View style={styles.organization}><Text style={styles.sectionTitle}>AI suggestions</Text><Text style={styles.stateText}>Loading suggestions…</Text></View>;
  return <View style={styles.organization}>
    <Text style={styles.sectionTitle}>AI suggestions</Text>
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Button label="Retry AI suggestions" onPress={retryLoading} /></> : null}
    {!error && (generation.state === "pending" || generation.state === "running") ? <Text style={styles.stateText}>Your {itemKind === "task" ? "Task" : "Note"} is saved. We’re preparing suggestions…</Text> : null}
    {generation.state === "failed" ? <><Text accessibilityRole="alert" style={styles.error}>{generation.error}</Text>{generation.retryable ? <Button label={retrying ? "Retrying suggestions…" : "Retry suggestions"} onPress={() => void retryGeneration()} disabled={retrying} /> : null}</> : null}
    {!error && generation.state === "completed_empty" ? <Text style={styles.stateText}>No suggestions were found. Your {itemKind === "task" ? "Task" : "Note"} remains saved.</Text> : null}
    {!error && generation.state === "ready" && proposals.filter((proposal) => proposal.state === "pending" && proposal.candidates.some((candidate) => candidate.state === "pending")).length === 0 ? <Text style={styles.stateText}>No AI suggestions need review.</Text> : null}
    {!error ? proposals.filter((proposal) => proposal.state === "pending" && proposal.candidates.some((candidate) => candidate.state === "pending")).map((proposal) => <View key={proposal.id} style={styles.proposalCard}>
      <Text style={styles.proposalMeta}>Suggested by {proposal.modelVersion} · rules {proposal.rulesVersion}</Text>
      <Text style={styles.stateText}>Swipe each card to decide. The {itemKind === "task" ? "Task" : "Note"} is already saved.</Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingHorizontal: 4 }}><Text style={{ color: "#8C3D25", fontSize: 13, fontWeight: "800" }}>← Ignore</Text><Text style={{ color: "#356445", fontSize: 13, fontWeight: "800" }}>Add →</Text></View>
      {proposal.candidates.filter((candidate) => candidate.state === "pending").map((candidate) => <ProposalCandidateRow key={candidate.id} candidate={candidate} decision={decisions[proposal.id]?.[candidate.id]} disabled={inFlight !== null} onDecision={(decision) => decideLocally(proposal, candidate.id, decision)} />)}
      <Button label={inFlight === proposal.id ? "Отправка…" : mutationError && Object.keys(decisions[proposal.id] ?? {}).length === proposal.candidates.filter((candidate) => candidate.state === "pending").length ? "Повторить отправку" : "Готово"} onPress={() => finishProposal(proposal)} disabled={inFlight !== null} />
    </View>) : null}
    {mutationError ? <Text accessibilityRole="alert" style={styles.error}>{mutationError}</Text> : null}
  </View>;
}

function ProposalCandidateRow({ candidate, decision, disabled, onDecision }: { readonly candidate: OrganizationProposalCandidate; readonly decision: "accepted" | "dismissed" | undefined; readonly disabled: boolean; readonly onDecision: (decision: "accepted" | "dismissed") => void }) {
  const name = candidate.suggestedName ?? `${candidate.kind} ${candidate.targetId ?? ""}`.trim();
  const translateX = useRef(new Animated.Value(0)).current;
  const current = useRef(onDecision);
  current.current = onDecision;
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: (_event, gesture) => translateX.setValue(gesture.dx),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx > 72 || gesture.dx < -72) {
        const decision = gesture.dx > 0 ? "accepted" : "dismissed";
        Animated.timing(translateX, { toValue: gesture.dx > 0 ? 500 : -500, duration: 150, useNativeDriver: false }).start(() => current.current(decision));
      } else Animated.spring(translateX, { toValue: 0, useNativeDriver: false }).start();
    },
    onPanResponderTerminate: () => Animated.spring(translateX, { toValue: 0, useNativeDriver: false }).start(),
  })).current;
  return <Animated.View {...responder.panHandlers} accessibilityLabel={`${candidate.kind} suggestion ${name}. Swipe right to add, left to ignore.`} style={[styles.proposalCandidate, decision === "accepted" ? { borderColor: "#356445", borderWidth: 2 } : decision === "dismissed" ? { borderColor: "#8C3D25", borderWidth: 2 } : null, { transform: [{ translateX }] }]}>
    <Text style={styles.metadataValue}>{candidate.kind} · {name}</Text><Text style={styles.proposalConfidence}>{candidate.confidenceBand} confidence ({Math.round(candidate.confidence * 100)}%)</Text><Text style={styles.provenance}>Source: {candidate.provenance.join(" · ")}</Text>{decision ? <Text style={styles.stateText}>{decision === "accepted" ? "Marked to Add" : "Marked to Ignore"}</Text> : null}
    <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}><Pressable accessibilityRole="button" accessibilityState={{ selected: decision === "dismissed", disabled }} accessibilityLabel={`Ignore ${candidate.kind} suggestion ${name}`} onPress={() => current.current("dismissed")} disabled={disabled} style={[styles.button, decision === "dismissed" ? { backgroundColor: "#8C3D25" } : null]}><Text style={styles.buttonText}>← Ignore</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ selected: decision === "accepted", disabled }} accessibilityLabel={`Add ${candidate.kind} suggestion ${name}`} onPress={() => current.current("accepted")} disabled={disabled} style={[styles.button, decision === "accepted" ? { backgroundColor: "#356445" } : null]}><Text style={styles.buttonText}>Add →</Text></Pressable></View>
  </Animated.View>;
}

function MetadataControls({ client, memberId, itemId, itemKind }: { readonly client: MetadataClient; readonly memberId: string; readonly itemId: string; readonly itemKind: MetadataItemKind }) {
  const [links, setLinks] = useState<MetadataLinks>({ tags: [], entities: [] });
  const [tags, setTags] = useState<readonly Tag[]>([]);
  const [entities, setEntities] = useState<readonly Entity[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [entityDraft, setEntityDraft] = useState("");
  const [openPickers, setOpenPickers] = useState({ tags: false, entities: false });
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newEntityOpen, setNewEntityOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
  const [tagEditDraft, setTagEditDraft] = useState("");
  const [entityEditDraft, setEntityEditDraft] = useState("");
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
      setLinks(await client.linkTag(itemId, itemKind, tag.id, memberId));
      setTagDraft("");
      setNewTagOpen(false);
      setOpenPickers((current) => ({ ...current, tags: false }));
    });
  };

  const addEntity = () => {
    const name = entityDraft.trim();
    if (!name) {
      setMutationError("Entity name must not be empty");
      return;
    }
    // Entity type remains an internal classifier; until users can classify Entities,
    // store new ones with the existing default and keep it out of the interaction.
    const type: EntityType = "Object";
    let createdEntity: Entity | null = null;
    void runMutation(`creating and adding Entity ${name}`, async () => {
      createdEntity ??= await client.createEntity(memberId, name, type);
      const entity = createdEntity;
      setEntities((current) => current.some((item) => item.id === entity.id) ? current : [...current, entity].sort((a, b) => a.name.localeCompare(b.name)));
      setLinks(await client.linkEntity(itemId, itemKind, entity.id, memberId));
      setEntityDraft("");
      setNewEntityOpen(false);
      setOpenPickers((current) => ({ ...current, entities: false }));
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
    const type = entity.type;
    void runMutation(`editing Entity ${entity.name}`, async () => {
      const updated = await client.updateEntity(entity.id, memberId, name, type);
      setEntities((current) => current.map((item) => item.id === updated.id ? updated : item));
      setLinks((current) => ({ ...current, entities: current.entities.map((item) => item.id === updated.id ? updated : item) }));
      setEditingEntityId(null);
    });
  };

  return <View style={styles.metadataInline}>
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Button label="Retry metadata" onPress={() => void load()} disabled={mutationInFlight} /></> : null}
    {loading ? <Text style={styles.metadataHint}>Loading Tags and Entities…</Text> : <>
    <View style={styles.metadataSection}>
      <Text style={styles.metadataHeading}>Tags</Text>
      <View style={styles.metadataCategoryLine}>
        {links.tags.map((tag) => <MetadataTagChip key={tag.id} tag={tag} editing={editingTagId === tag.id} editDraft={tagEditDraft} disabled={mutationInFlight} onEdit={() => { setEditingTagId(tag.id); setTagEditDraft(tag.name); }} onEditChange={setTagEditDraft} onSave={() => editTag(tag)} onCancel={() => setEditingTagId(null)} onRemove={() => void runMutation(`removing Tag ${tag.name}`, async () => setLinks(await client.unlinkTag(itemId, itemKind, tag.id, memberId)))} />)}
        <MetadataAction label={openPickers.tags ? "Close Tag choices" : "Add Tag"} expanded={openPickers.tags} onPress={() => setOpenPickers((current) => ({ ...current, tags: false }))} onOpen={() => setOpenPickers((current) => ({ ...current, tags: true }))} disabled={mutationInFlight} />
      </View>
      {openPickers.tags ? <View style={[styles.metadataOptions, styles.metadataTagOptions]}>
        {tags.filter((tag) => !links.tags.some((linked) => linked.id === tag.id)).map((tag) => <MetadataChoiceRow key={tag.id} label={`Add existing Tag ${tag.name}`} name={`#${tag.name}`} entity={false} disabled={mutationInFlight} onSelect={() => void runMutation(`adding Tag ${tag.name}`, async () => { setLinks(await client.linkTag(itemId, itemKind, tag.id, memberId)); })} />)}
        {newTagOpen ? <MetadataCreateChip inputLabel="New Tag name" value={tagDraft} placeholder="Tag name" disabled={mutationInFlight} onChange={setTagDraft} onAdd={addTag} /> : <MetadataNewChoice label="New Tag" onPress={() => setNewTagOpen(true)} />}
      </View> : null}
    </View>
    <View style={styles.metadataSection}>
      <Text style={styles.metadataHeading}>Entities</Text>
      <View style={styles.metadataCategoryLine}>
        {links.entities.map((entity) => <MetadataEntityChip key={entity.id} entity={entity} editing={editingEntityId === entity.id} editDraft={entityEditDraft} disabled={mutationInFlight} onEdit={() => { setEditingEntityId(entity.id); setEntityEditDraft(entity.name); }} onEditChange={setEntityEditDraft} onSave={() => editEntity(entity)} onCancel={() => setEditingEntityId(null)} onRemove={() => void runMutation(`removing Entity ${entity.name}`, async () => setLinks(await client.unlinkEntity(itemId, itemKind, entity.id, memberId)))} />)}
        <MetadataAction label={openPickers.entities ? "Close Entity choices" : "Add Entity"} entity expanded={openPickers.entities} onPress={() => setOpenPickers((current) => ({ ...current, entities: false }))} onOpen={() => setOpenPickers((current) => ({ ...current, entities: true }))} disabled={mutationInFlight} />
      </View>
      {openPickers.entities ? <View style={[styles.metadataOptions, styles.metadataEntityOptions]}>
        {entities.filter((entity) => !links.entities.some((linked) => linked.id === entity.id)).map((entity) => <MetadataChoiceRow key={entity.id} label={`Add existing Entity ${entity.name}`} name={entity.name} entity disabled={mutationInFlight} onSelect={() => void runMutation(`adding Entity ${entity.name}`, async () => { setLinks(await client.linkEntity(itemId, itemKind, entity.id, memberId)); })} />)}
        {newEntityOpen ? <MetadataCreateChip inputLabel="New Entity name" value={entityDraft} placeholder="Entity name" entity disabled={mutationInFlight} onChange={setEntityDraft} onAdd={addEntity} /> : <MetadataNewChoice label="New Entity" entity onPress={() => setNewEntityOpen(true)} />}
      </View> : null}
    </View>
    </>}
    {mutationError ? <><Text accessibilityRole="alert" style={styles.error}>{mutationError}</Text>{pendingMutation ? <Button label={`Retry ${pendingMutation.label}`} onPress={() => void runMutation(pendingMutation.label, pendingMutation.operation)} disabled={mutationInFlight} /> : null}</> : null}
  </View>;
}

function MetadataAction({ label, entity = false, expanded = false, onPress, onOpen, disabled }: { readonly label: string; readonly entity?: boolean; readonly expanded?: boolean; readonly onPress: () => void; readonly onOpen: () => void; readonly disabled: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded }} onPress={expanded ? onPress : onOpen} disabled={disabled} style={[styles.metadataAction, entity && styles.metadataEntityAction]}>
    <Text style={[styles.metadataActionText, entity && styles.metadataEntityActionText]}>{expanded ? "×" : "＋"}</Text>
  </Pressable>;
}

function MetadataNewChoice({ label, entity = false, onPress }: { readonly label: string; readonly entity?: boolean; readonly onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.metadataNewChoice, entity && styles.metadataEntityNewChoice]}>
    <Text style={[styles.metadataNewChoiceText, entity && styles.metadataEntityNewChoiceText]}>{label}</Text>
  </Pressable>;
}

function MetadataTagChip({ tag, editing, editDraft, disabled, onEdit, onEditChange, onSave, onCancel, onRemove }: { readonly tag: Tag; readonly editing: boolean; readonly editDraft: string; readonly disabled: boolean; readonly onEdit: () => void; readonly onEditChange: (value: string) => void; readonly onSave: () => void; readonly onCancel: () => void; readonly onRemove: () => void }) {
  if (editing) return <View style={[styles.metadataChip, styles.metadataChipEditing]}>
    <TextInput accessibilityLabel={`Edit Tag ${tag.name}`} value={editDraft} onChangeText={onEditChange} editable={!disabled} style={styles.metadataChipInput} />
    <Pressable accessibilityRole="button" accessibilityLabel={`Save Tag ${tag.name}`} onPress={onSave} disabled={disabled} style={styles.metadataChipAction}><Text style={styles.metadataChipActionText}>✓</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Cancel editing Tag ${tag.name}`} onPress={onCancel} disabled={disabled} style={styles.metadataChipAction}><Text style={styles.metadataChipActionText}>×</Text></Pressable>
  </View>;
  return <View style={styles.metadataChip}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit Tag ${tag.name}`} onPress={onEdit} disabled={disabled} style={styles.metadataChipLabel}><Text style={styles.metadataChipText}>#{tag.name}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Remove Tag ${tag.name}`} onPress={onRemove} disabled={disabled} style={styles.metadataChipAction}><Text style={styles.metadataChipActionText}>×</Text></Pressable>
  </View>;
}

function MetadataEntityChip({ entity, editing, editDraft, disabled, onEdit, onEditChange, onSave, onCancel, onRemove }: { readonly entity: Entity; readonly editing: boolean; readonly editDraft: string; readonly disabled: boolean; readonly onEdit: () => void; readonly onEditChange: (value: string) => void; readonly onSave: () => void; readonly onCancel: () => void; readonly onRemove: () => void }) {
  if (editing) return <View style={[styles.metadataChip, styles.metadataEntityChip, styles.metadataChipEditing]}>
    <TextInput accessibilityLabel={`Edit Entity ${entity.name}`} value={editDraft} onChangeText={onEditChange} editable={!disabled} style={styles.metadataChipInput} />
    <Pressable accessibilityRole="button" accessibilityLabel={`Save Entity ${entity.name}`} onPress={onSave} disabled={disabled} style={styles.metadataChipAction}><Text style={styles.metadataChipActionText}>✓</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Cancel editing Entity ${entity.name}`} onPress={onCancel} disabled={disabled} style={styles.metadataChipAction}><Text style={styles.metadataChipActionText}>×</Text></Pressable>
  </View>;
  return <View style={[styles.metadataChip, styles.metadataEntityChip]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit Entity ${entity.name}`} onPress={onEdit} disabled={disabled} style={styles.metadataChipLabel}><Text style={styles.metadataChipText}>{entity.name}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Remove Entity ${entity.name}`} onPress={onRemove} disabled={disabled} style={styles.metadataChipAction}><Text style={styles.metadataChipActionText}>×</Text></Pressable>
  </View>;
}

function MetadataChoiceRow({ label, name, entity = false, disabled, onSelect }: { readonly label: string; readonly name: string; readonly entity?: boolean; readonly disabled: boolean; readonly onSelect: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onSelect} disabled={disabled} style={[styles.metadataChip, entity && styles.metadataEntityChip, styles.metadataChoiceChip]}>
    <Text style={[styles.metadataChipText, entity && styles.metadataEntityChipText]}>{name}</Text>
  </Pressable>;
}

function MetadataCreateChip({ inputLabel, value, placeholder, entity = false, disabled, onChange, onAdd }: { readonly inputLabel: string; readonly value: string; readonly placeholder: string; readonly entity?: boolean; readonly disabled: boolean; readonly onChange: (value: string) => void; readonly onAdd: () => void }) {
  return <View style={[styles.metadataChip, entity && styles.metadataEntityChip, styles.metadataChipEditing]}>
    <TextInput accessibilityLabel={inputLabel} placeholder={placeholder} value={value} onChangeText={onChange} editable={!disabled} style={[styles.metadataChipInput, entity && styles.metadataEntityChipText]} />
    <Pressable accessibilityRole="button" accessibilityLabel="Add" onPress={onAdd} disabled={disabled} style={styles.metadataChipAction}><Text style={[styles.metadataChipActionText, entity && styles.metadataEntityChipText]}>✓</Text></Pressable>
  </View>;
}

function ReviewStateBanner({ review }: { readonly review: ReviewContract }) {
  if (review.state === "completed") return null;
  if (review.state === "needs_review") {
    if (review.interpretation?.classification === "ambiguous") return <Text accessibilityRole="alert" style={styles.reviewState}>Needs review · The Capture was ambiguous. Confirm or edit the Note before saving.</Text>;
    if (review.interpretation?.classification === "unsupported") return <Text accessibilityRole="alert" style={styles.reviewState}>Needs review · This instruction is unsupported. Confirm or edit the Note before saving.</Text>;
    return <Text accessibilityRole="alert" style={styles.reviewState}>Needs review · Confirm or edit this result before saving.</Text>;
  }
  if (review.state === "failed") return <View accessibilityRole="alert"><Text style={styles.error}>Processing failed</Text><Text style={styles.stateText}>{review.failure?.message ?? "The Capture could not be processed."}</Text>{review.failure?.classification === "unusable_transcription" ? null : <Text style={styles.stateText}>Review the original Capture and try again when processing is available.</Text>}</View>;
  return <Text accessibilityRole="alert" style={styles.reviewState}>Processing · No result is available yet.</Text>;
}

function detailItem(review: ReviewContract, metadata?: TaskNoteDetailMetadata): TaskNoteDetailItem {
  const outcome = review.outcome;
  if (!outcome) throw new Error("Cannot render detail without an outcome");
  const space = metadata?.selectedSpaceId === null ? "No Space" : metadata?.spaces.find((candidate) => candidate.id === metadata.selectedSpaceId)?.label ?? "No Space";
  const tags = metadata?.tags.filter((tag) => tag.selected).map((tag) => `#${tag.label}`) ?? [];
  const interpretation = review.interpretation?.classification?.replaceAll("_", " ") ?? "Saved result";
  const sourceDetails = review.source.content?.kind === "audio"
    ? `Audio source · ${review.source.content.contentType} · ${review.source.content.byteLength.toLocaleString()} bytes · SHA-256 ${review.source.content.sha256}`
    : undefined;
  const transcription = review.transcription?.text ? { text: review.transcription.text, ...(review.transcription.language ? { language: review.transcription.language } : {}) } : undefined;
  const provenance = { source: `Capture ${review.capture.id} · source ${review.source.id}`, ...(sourceDetails ? { sourceDetails } : {}), ...(review.correction ? { correction: review.correction.text } : {}), interpretation, ...(transcription ? { transcription } : {}) };
  if (outcome.kind === "task") return { kind: "task", id: outcome.id, title: outcome.title, status: outcome.status, dueAt: outcome.dueAt ?? null, space, tags, ...provenance };
  return { kind: "note", id: outcome.id, content: outcome.content, reviewState: outcome.reviewState === "needs_review" ? "needs_review" : "saved", space, tags, ...provenance };
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/.exec(value);
  if (!match) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]) && date.getUTCHours() === Number(match[4]) && date.getUTCMinutes() === Number(match[5]);
}

function ReviewShell({ children, onBack, showBack = true }: { readonly children: ReactNode; readonly onBack: () => void; readonly showBack?: boolean }) { return <SafeAreaView style={styles.safeArea}>{showBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back to items" onPress={onBack}><Text style={styles.back}>‹ Items</Text></Pressable> : null}<ScrollView contentContainerStyle={styles.content}>{children}</ScrollView></SafeAreaView>; }
function Button({ label, onPress, disabled = false }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({ safeArea: { flex: 1, backgroundColor: "#F7F5F0" }, content: { padding: 24 }, back: { color: "#7A5C36", fontSize: 16, paddingHorizontal: 24, paddingTop: 16 }, eyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, title: { color: "#24221F", fontSize: 32, fontWeight: "700", marginTop: 6 }, stateText: { color: "#716B64", fontSize: 15, lineHeight: 22, marginTop: 8 }, reviewState: { color: "#8C3D25", fontSize: 15, fontWeight: "600", lineHeight: 22, marginTop: 18 }, field: { marginTop: 24 }, fieldLabel: { color: "#8B7355", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, value: { color: "#24221F", fontSize: 19, lineHeight: 27, marginTop: 5 }, originalText: { color: "#716B64", fontSize: 16, lineHeight: 24, marginTop: 5 }, input: { borderBottomColor: "#B9A895", borderBottomWidth: 1, color: "#24221F", fontSize: 19, lineHeight: 27, paddingVertical: 5 }, editInput: { borderBottomColor: "#B9A895", borderBottomWidth: 1, color: "#24221F", flex: 1, fontSize: 16, paddingVertical: 5 }, sectionTitle: { color: "#24221F", fontSize: 17, fontWeight: "700", marginTop: 32 }, provenance: { color: "#716B64", fontSize: 14, lineHeight: 21, marginTop: 6 }, metadataInline: { marginTop: 12, gap: 15 }, metadataSection: { gap: 6 }, metadataHeading: { color: "#64616A", fontSize: 17, fontWeight: "600" }, metadataCategoryLine: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 }, metadataOptions: { alignItems: "center", borderRadius: 16, flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2, padding: 10 }, metadataTagOptions: { backgroundColor: "#F0F5EB" }, metadataEntityOptions: { backgroundColor: "#F5EFFA" }, metadataSummary: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 9 }, metadataHint: { color: "#716B64", fontSize: 12, lineHeight: 18, marginTop: 5 }, metadataActions: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 6 }, metadataAction: { alignItems: "center", backgroundColor: "#7FAF73", borderColor: "#7FAF73", borderRadius: 20, borderWidth: 1, height: 36, justifyContent: "center", width: 36 }, metadataActionText: { color: "#FFFFFF", fontSize: 24, fontWeight: "500", lineHeight: 28, marginTop: -2 }, metadataEntityAction: { backgroundColor: "#A882D6", borderColor: "#A882D6" }, metadataEntityActionText: { color: "#FFFFFF" }, metadataNewChoice: { backgroundColor: "rgba(255,255,255,0.4)", borderColor: "#87A87B", borderRadius: 22, borderStyle: "dashed", borderWidth: 1, minHeight: 38, justifyContent: "center", paddingHorizontal: 14 }, metadataNewChoiceText: { color: "#5F7F58", fontSize: 14, fontWeight: "600" }, metadataEntityNewChoice: { borderColor: "#AA8AD3" }, metadataEntityNewChoiceText: { color: "#73569A" }, metadataChip: { alignItems: "center", backgroundColor: "#E8F0E8", borderColor: "#C9D9CB", borderRadius: 18, borderWidth: 1, flexDirection: "row", maxWidth: "100%", minHeight: 38 }, metadataEntityChip: { backgroundColor: "#ECEAF5", borderColor: "#D4CFE7" }, metadataChipEditing: { alignItems: "center", flexDirection: "row", paddingLeft: 8 }, metadataChipLabel: { flexShrink: 1, paddingLeft: 12, paddingVertical: 8 }, metadataChipText: { color: "#173B2F", flexShrink: 1, fontSize: 14, fontWeight: "600" }, metadataChipAction: { alignItems: "center", justifyContent: "center", minHeight: 34, minWidth: 34, paddingHorizontal: 8 }, metadataChipActionText: { color: "#173B2F", fontSize: 14, fontWeight: "800" }, metadataChipInput: { color: "#24221F", flexShrink: 1, fontSize: 13, fontWeight: "600", minHeight: 32, minWidth: 48, paddingVertical: 0, width: 120 }, separatedField: { borderBottomColor: "#D8CFC2", borderBottomWidth: 1, borderTopColor: "#D8CFC2", borderTopWidth: 1, marginTop: 8, paddingVertical: 10 }, organization: { borderTopColor: "#D8CFC2", borderTopWidth: 1, marginTop: 30, paddingTop: 4 }, proposalCard: { backgroundColor: "#FFF8E8", borderColor: "#D5B98D", borderRadius: 14, borderWidth: 1, marginTop: 14, padding: 14 }, proposalCandidate: { borderBottomColor: "#E5D8C3", borderBottomWidth: 1, paddingBottom: 10, paddingTop: 8 }, proposalMeta: { color: "#716B64", fontSize: 13 }, proposalConfidence: { color: "#7A5C36", fontSize: 13, marginTop: 4 }, proposalActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, metadataRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }, inlineEdit: { flex: 1 }, metadataValue: { color: "#24221F", flex: 1, fontSize: 16, marginTop: 8 }, typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }, typeOption: { borderColor: "#B9A895", borderRadius: 10, borderWidth: 1, padding: 8 }, typeSelected: { backgroundColor: "#D5B98D", borderColor: "#8B7355", borderRadius: 10, borderWidth: 1, padding: 8 }, button: { alignSelf: "flex-start", backgroundColor: "#24221F", borderRadius: 12, marginTop: 12, paddingHorizontal: 20, paddingVertical: 12 }, buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" }, error: { color: "#A33B31", fontSize: 14, marginTop: 12 }, success: { color: "#356445", fontSize: 14, marginTop: 12 }, dueBubbles: { flexDirection: "row", gap: 8, marginTop: 10 }, dueBubble: { borderColor: "#B9A895", borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 }, dueBubbleText: { color: "#24221F", fontSize: 16 }, clearDue: { color: "#8C3D25", fontSize: 14, marginTop: 12 }, metadataChoiceChip: { borderColor: "transparent", paddingHorizontal: 12, paddingVertical: 8 }, metadataEntityChipText: { color: "#39344C" }, pickerPanel: { backgroundColor: "#EFEAE2", borderRadius: 16, marginTop: 14, padding: 16 }, pickerHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, pickerTitle: { color: "#24221F", fontSize: 17, fontWeight: "700" }, cancelPicker: { color: "#173B2F", fontSize: 14, fontWeight: "700", padding: 8 }, pickerHint: { color: "#716B64", fontSize: 13, marginTop: 8 }, monthRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginVertical: 18 }, calendarGrid: { flexDirection: "row", flexWrap: "wrap" }, calendarDay: { alignItems: "center", justifyContent: "center", minHeight: 38, width: "14.285%" }, calendarDaySelected: { backgroundColor: "#D5B98D", borderRadius: 19 } });
