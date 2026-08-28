import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createOfflineDraftId, type OfflineDraftStore } from "../offline/offline-drafts";
import { shouldPersistOfflineDraft } from "../http/request-error";
import { entityTypes, type Entity, type EntityType, type MetadataClient, type MetadataItemKind, type MetadataLinks, type Tag } from "./metadata";
import { createReviewClient, type ReviewClient, type ReviewContract, type ReviewOutcome } from "./review";

interface ReviewScreenProps {
  readonly apiBaseUrl: string;
  readonly memberId: string;
  readonly detailUrl: string;
  readonly onBack: () => void;
  readonly client?: ReviewClient;
  readonly offlineDraftStore?: OfflineDraftStore;
  readonly metadataClient?: MetadataClient;
}

type ReviewStatus = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly review: ReviewContract };
type Draft = { readonly title?: string; readonly dueAt?: string | null; readonly content?: string };
type PendingMetadataMutation = { readonly label: string; readonly operation: () => Promise<void> };

export function ReviewScreen({ apiBaseUrl, memberId, detailUrl, onBack, client: providedClient, offlineDraftStore, metadataClient: providedMetadataClient }: ReviewScreenProps) {
  const client = useMemo(() => providedClient ?? createReviewClient(apiBaseUrl), [apiBaseUrl, providedClient]);
  const metadataClient = useMemo(() => providedMetadataClient ?? null, [providedMetadataClient]);
  const [state, setState] = useState<ReviewStatus>({ status: "loading" });
  const [draft, setDraft] = useState<Draft>({});
  const [editing, setEditing] = useState<"title" | "dueAt" | "content" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [conversionNotice, setConversionNotice] = useState<string | null>(null);
  const savingInFlight = useRef(false);
  const completionInFlight = useRef(false);
  const conversionInFlight = useRef(false);
  const textDraftIdentity = useRef<{ readonly draftId: string; readonly capturedAt: string; readonly text: string } | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const review = await client.get(detailUrl);
      setState({ status: "ready", review });
      setDraft(review.outcome?.kind === "task" ? { title: review.outcome.title, dueAt: review.outcome.dueAt ?? null } : review.outcome ? { content: review.outcome.content } : {});
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

  const save = useCallback(async () => {
    if (state.status !== "ready" || !state.review.outcome || savingInFlight.current) return;
    if (state.review.outcome.kind === "task" && draft.dueAt !== null && draft.dueAt !== undefined && !isValidIsoDate(draft.dueAt)) {
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
        if (draft.title !== outcome.title && draft.title !== undefined) changes.title = draft.title;
        if (draft.dueAt !== outcome.dueAt) changes.dueAt = draft.dueAt ?? null;
        if (Object.keys(changes).length > 0) await client.updateTask(outcome.id, memberId, outcome.version, changes);
      } else if (draft.content !== outcome.content) {
        await client.updateNote(outcome.id, memberId, outcome.version, draft.content ?? "");
      }
      onBack();
    } catch (error) {
      const saveMessage = error instanceof Error ? error.message : "Unable to save review";
      const text = draft.content ?? "";
      if (outcome.kind === "note" && text !== outcome.content && offlineDraftStore && shouldPersistOfflineDraft(error)) {
        if (textDraftIdentity.current?.text !== text) {
          textDraftIdentity.current = { draftId: createOfflineDraftId(), capturedAt: new Date().toISOString(), text };
        }
        try {
          const identity = textDraftIdentity.current;
          await offlineDraftStore.save({ draftId: identity.draftId, memberId, capturedAt: identity.capturedAt, source: { kind: "text", text } });
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
        setDraft({ title: refreshed.outcome.title, dueAt: refreshed.outcome.dueAt ?? null });
        setEditing(null);
        setSaveError("This Note was converted to a Task elsewhere. The review was refreshed.");
      }
    } finally {
      savingInFlight.current = false;
      setSaving(false);
    }
  }, [client, draft, memberId, offlineDraftStore, onBack, refreshReviewVersion, state]);

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
      setDraft({ title: task.title, dueAt: task.dueAt ?? null });
      setEditing(null);
      setConversionNotice("Converted to Task. Identity and provenance were kept.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "conversion failed";
      const refreshed = await refreshReviewVersion();
      if (refreshed?.outcome?.kind === "task" && refreshed.outcome.id === note.id) {
        setDraft({ title: refreshed.outcome.title, dueAt: refreshed.outcome.dueAt ?? null });
        setEditing(null);
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
  return <ReviewShell onBack={onBack}>
    <Text style={styles.eyebrow}>DETAILED REVIEW</Text>
    <ReviewStateBanner review={state.review} />
    {state.review.state === "failed" ? <Button label="Refresh processing status" onPress={() => void load()} /> : null}
    <Text style={styles.title}>{state.review.outcome?.kind === "task" ? "Task" : state.review.outcome?.kind === "note" ? "Note" : state.review.state === "failed" ? "Processing failed" : "Processing"}</Text>
    <Text style={styles.stateText}>Original source and processing history remain separate from editable result fields.</Text>
    {state.review.outcome ? <ReviewFields outcome={state.review.outcome} draft={draft} editing={editing} onEdit={setEditing} onChange={setDraft} /> : <Text style={styles.stateText}>This Capture has no editable result yet.</Text>}
    {state.review.outcome && metadataClient ? <MetadataControls client={metadataClient} memberId={memberId} itemId={state.review.outcome.id} itemKind={state.review.outcome.kind} /> : null}
    <Text style={styles.sectionTitle}>Source and provenance</Text>
    <Text style={styles.provenance}>Capture {state.review.capture.id} · source {state.review.source.id}</Text>
    {state.review.transcription ? <><Text style={styles.fieldLabel}>Original transcription{state.review.transcription.language ? ` · ${state.review.transcription.language}` : ""}</Text><Text style={styles.originalText}>{state.review.transcription.text ?? `Status: ${state.review.transcription.status}`}</Text></> : <Text style={styles.provenance}>Original transcription · pending</Text>}
    {state.review.outcome ? <>
      {state.review.outcome.kind === "task" && state.review.outcome.status === "open" ? <Button label={completing ? "Completing…" : "Complete task"} onPress={() => void complete()} disabled={completing || saving || converting} /> : null}
      {state.review.outcome.kind === "note" || state.review.outcome.status === "open" ? <Button label={saving ? "Saving…" : "Save"} onPress={() => void save()} disabled={saving || completing || converting} /> : null}
      {state.review.outcome.kind === "note" ? <>
        <Text style={styles.stateText}>Conversion requires a connection. The saved Note becomes a Task while keeping its identity and provenance.</Text>
        <Button label={converting ? "Converting…" : "Convert saved Note to Task"} onPress={() => void convertNoteToTask()} disabled={saving || completing || converting} />
      </> : null}
    </> : null}
    {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}
    {completionError ? <Text accessibilityRole="alert" style={styles.error}>{completionError}</Text> : null}
    {conversionError ? <Text accessibilityRole="alert" style={styles.error}>{conversionError}</Text> : null}
    {conversionNotice ? <Text accessibilityRole="alert" style={styles.success}>{conversionNotice}</Text> : null}
  </ReviewShell>;
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
    return <View style={styles.metadata}>
      <Text style={styles.sectionTitle}>Tags and Entities</Text>
      <Text style={styles.stateText}>Loading metadata…</Text>
    </View>;
  }

  return <View style={styles.metadata}>
    <Text style={styles.sectionTitle}>Tags and Entities</Text>
    {error ? <>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Button label="Retry Tags and Entities" onPress={() => void load()} disabled={mutationInFlight} />
    </> : <Button label="Refresh Tags and Entities" onPress={() => void load()} disabled={mutationInFlight} />}
    <Text style={styles.stateText}>Tags are flat markers. Entities are named {entityTypes.join(", ")}. Spaces and Task importance are separate controls.</Text>
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
    <Text style={styles.metadataValue}>Tag · {tag.name}</Text>
    <Button label={`Edit Tag ${tag.name}`} onPress={onEdit} disabled={disabled} />
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
    <Text style={styles.metadataValue}>{entity.type} · {entity.name}</Text>
    <Button label={`Edit Entity ${entity.name}`} onPress={onEdit} disabled={disabled} />
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

function ReviewFields({ outcome, draft, editing, onEdit, onChange }: { readonly outcome: ReviewOutcome; readonly draft: Draft; readonly editing: "title" | "dueAt" | "content" | null; readonly onEdit: (field: "title" | "dueAt" | "content") => void; readonly onChange: (draft: Draft) => void }) {
  if (outcome.kind === "note") return <EditableField field="content" label="Note" value={draft.content ?? ""} editing={editing} onEdit={onEdit} onChange={(value) => onChange({ content: value })} multiline />;
  const editable = outcome.status === "open";
  return <><EditableField field="title" label="Title" value={draft.title ?? ""} editing={editing} onEdit={onEdit} onChange={(value) => onChange({ ...draft, title: value })} editable={editable} /><DueInformation value={draft.dueAt ?? null} editing={editing === "dueAt"} editable={editable} onEdit={() => onEdit("dueAt")} onChange={(dueAt) => onChange({ ...draft, dueAt })} /></>;
}

function DueInformation({ value, editing, editable, onEdit, onChange }: { readonly value: string | null; readonly editing: boolean; readonly editable: boolean; readonly onEdit: () => void; readonly onChange: (value: string | null) => void }) {
  const initial = parseDue(value) ?? new Date();
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [hasDue, setHasDue] = useState(() => value !== null);
  const [draftDate, setDraftDate] = useState(() => initial);
  const [draftTime, setDraftTime] = useState(() => formatTime(initial));
  const display = value && isValidIsoDate(value) ? formatDue(value) : value ?? "Not set";

  if (!editing) return editable ? <Pressable style={styles.field} accessibilityRole="button" accessibilityLabel="Edit Due information" onPress={onEdit}><Text style={styles.fieldLabel}>Remind At:</Text><Text style={styles.value}>{display}</Text></Pressable> : <View style={styles.field}><Text style={styles.fieldLabel}>Remind At:</Text><Text style={styles.value}>{display}</Text></View>;

  const commitDate = (date: Date) => {
    const [hour, minute] = draftTime.split(":").map(Number);
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute));
    setDraftDate(next);
    setHasDue(true);
    onChange(next.toISOString());
    setPicker(null);
  };
  const commitTime = (time: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setTimeError("Enter a valid time between 00:00 and 23:59");
      return;
    }
    setTimeError(null);
    const [hour, minute] = time.split(":").map(Number);
    const next = new Date(Date.UTC(draftDate.getUTCFullYear(), draftDate.getUTCMonth(), draftDate.getUTCDate(), hour, minute));
    setDraftTime(time);
    setDraftDate(next);
    setHasDue(true);
    onChange(next.toISOString());
    setPicker(null);
  };
  return <View style={styles.field}><Text style={styles.fieldLabel}>Remind At:</Text>{hasDue ? <View style={styles.dueBubbles}><Pressable accessibilityRole="button" accessibilityLabel="Choose due date" onPress={() => setPicker("date")} style={styles.dueBubble}><Text style={styles.dueBubbleText}>{formatDateBubble(draftDate)}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Choose due time" onPress={() => setPicker("time")} style={styles.dueBubble}><Text style={styles.dueBubbleText}>{draftTime}</Text></Pressable></View> : <Text style={styles.value}>Not set</Text>}<Pressable accessibilityRole="button" accessibilityLabel={hasDue ? "Change due information" : "Set due information"} onPress={() => setPicker("date")}><Text style={styles.clearDue}>{hasDue ? "Change due information" : "Set due information"}</Text></Pressable>{hasDue ? <Pressable accessibilityRole="button" accessibilityLabel="Clear due information" onPress={() => { onChange(null); setHasDue(false); setPicker(null); }}><Text style={styles.clearDue}>Clear due information</Text></Pressable> : null}{timeError ? <Text accessibilityRole="alert" style={styles.error}>{timeError}</Text> : null}{picker === "date" ? <DatePicker value={draftDate} onCancel={() => setPicker(null)} onDone={commitDate} /> : null}{picker === "time" ? <TimePicker value={draftTime} onCancel={() => setPicker(null)} onDone={commitTime} /> : null}</View>;
}

function DatePicker({ value, onCancel, onDone }: { readonly value: Date; readonly onCancel: () => void; readonly onDone: (value: Date) => void }) {
  const [month, setMonth] = useState(() => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)));
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const firstDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)).getUTCDay();
  return <View style={styles.pickerPanel}><View style={styles.pickerHeader}><Pressable accessibilityRole="button" accessibilityLabel="Cancel due date" onPress={onCancel}><Text>Cancel</Text></Pressable><Text style={styles.pickerTitle}>Date</Text><Pressable accessibilityRole="button" accessibilityLabel="Done due date" onPress={() => onDone(value)}><Text>Done</Text></Pressable></View><View style={styles.monthRow}><Pressable accessibilityRole="button" accessibilityLabel="Previous due month" onPress={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}><Text>‹</Text></Pressable><Text>{month.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</Text><Pressable accessibilityRole="button" accessibilityLabel="Next due month" onPress={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}><Text>›</Text></Pressable></View><View style={styles.calendarGrid}>{Array.from({ length: firstDay }, (_, index) => <View key={`empty-${index}`} style={styles.calendarDay} />)}{Array.from({ length: days }, (_, index) => { const day = index + 1; const selected = value.getUTCFullYear() === month.getUTCFullYear() && value.getUTCMonth() === month.getUTCMonth() && value.getUTCDate() === day; return <Pressable key={day} accessibilityRole="button" accessibilityLabel={`Due date ${month.getUTCFullYear()}-${pad(month.getUTCMonth() + 1)}-${pad(day)}`} onPress={() => onDone(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, value.getUTCHours(), value.getUTCMinutes())))} style={[styles.calendarDay, selected && styles.calendarDaySelected]}><Text>{day}</Text></Pressable>; })}</View></View>;
}

function TimePicker({ value, onCancel, onDone }: { readonly value: string; readonly onCancel: () => void; readonly onDone: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  return <View style={styles.pickerPanel}><View style={styles.pickerHeader}><Pressable accessibilityRole="button" accessibilityLabel="Cancel due time" onPress={onCancel}><Text>Cancel</Text></Pressable><Text style={styles.pickerTitle}>Time</Text><Pressable accessibilityRole="button" accessibilityLabel="Done due time" onPress={() => onDone(draft)}><Text>Done</Text></Pressable></View><TextInput accessibilityLabel="Due time" value={draft} onChangeText={setDraft} keyboardType="numbers-and-punctuation" style={styles.input} /><Text style={styles.pickerHint}>Use 24-hour time, for example 09:00.</Text></View>;
}

function EditableField({ field, label, value, editing, onEdit, onChange, multiline = false, editable = true }: { readonly field: "title" | "dueAt" | "content"; readonly label: string; readonly value: string; readonly editing: string | null; readonly onEdit: (field: "title" | "dueAt" | "content") => void; readonly onChange: (value: string) => void; readonly multiline?: boolean; readonly editable?: boolean }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{editing === field && editable ? <TextInput accessibilityLabel={label} autoFocus value={value} multiline={multiline} onChangeText={onChange} style={styles.input} /> : editable ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} onPress={() => onEdit(field)}><Text style={styles.value}>{value}</Text></Pressable> : <Text style={styles.value}>{value}</Text>}</View>;
}

function parseDue(value: string | null): Date | null {
  return value && isValidIsoDate(value) ? new Date(value) : null;
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/.exec(value);
  if (!match) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3])
    && date.getUTCHours() === Number(match[4])
    && date.getUTCMinutes() === Number(match[5])
    && (match[6] === undefined || date.getUTCSeconds() === Number(match[6]));
}

function formatDue(value: string): string {
  const date = new Date(value);
  return `${formatDateBubble(date)} · ${formatTime(date)}`;
}

function formatDateBubble(value: Date): string { return `${value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`; }
function formatTime(value: Date): string { return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`; }
function pad(value: number): string { return String(value).padStart(2, "0"); }

function ReviewShell({ children, onBack }: { readonly children: ReactNode; readonly onBack: () => void }) { return <SafeAreaView style={styles.safeArea}><Pressable accessibilityRole="button" accessibilityLabel="Back to items" onPress={onBack}><Text style={styles.back}>‹ Items</Text></Pressable><ScrollView contentContainerStyle={styles.content}>{children}</ScrollView></SafeAreaView>; }
function Button({ label, onPress, disabled = false }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({ safeArea: { flex: 1, backgroundColor: "#F7F5F0" }, content: { padding: 24 }, back: { color: "#7A5C36", fontSize: 16, paddingHorizontal: 24, paddingTop: 16 }, eyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, title: { color: "#24221F", fontSize: 32, fontWeight: "700", marginTop: 6 }, stateText: { color: "#716B64", fontSize: 15, lineHeight: 22, marginTop: 8 }, reviewState: { color: "#8C3D25", fontSize: 15, fontWeight: "600", lineHeight: 22, marginTop: 18 }, field: { marginTop: 24 }, fieldLabel: { color: "#8B7355", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, value: { color: "#24221F", fontSize: 19, lineHeight: 27, marginTop: 5 }, originalText: { color: "#716B64", fontSize: 16, lineHeight: 24, marginTop: 5 }, input: { borderBottomColor: "#B9A895", borderBottomWidth: 1, color: "#24221F", fontSize: 19, lineHeight: 27, paddingVertical: 5 }, editInput: { borderBottomColor: "#B9A895", borderBottomWidth: 1, color: "#24221F", flex: 1, fontSize: 16, paddingVertical: 5 }, sectionTitle: { color: "#24221F", fontSize: 17, fontWeight: "700", marginTop: 32 }, provenance: { color: "#716B64", fontSize: 14, lineHeight: 21, marginTop: 6 }, metadata: { borderTopColor: "#D8CFC2", borderTopWidth: 1, marginTop: 30, paddingTop: 4 }, metadataRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }, metadataValue: { color: "#24221F", flex: 1, fontSize: 16, marginTop: 18 }, typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }, typeOption: { borderColor: "#B9A895", borderRadius: 10, borderWidth: 1, padding: 8 }, typeSelected: { backgroundColor: "#D5B98D", borderColor: "#8B7355", borderRadius: 10, borderWidth: 1, padding: 8 }, button: { alignSelf: "flex-start", backgroundColor: "#24221F", borderRadius: 12, marginTop: 24, paddingHorizontal: 20, paddingVertical: 12 }, buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" }, error: { color: "#A33B31", fontSize: 14, marginTop: 12 }, success: { color: "#356445", fontSize: 14, marginTop: 12 }, dueBubbles: { flexDirection: "row", gap: 8, marginTop: 10 }, dueBubble: { borderColor: "#B9A895", borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 }, dueBubbleText: { color: "#24221F", fontSize: 16 }, clearDue: { color: "#8C3D25", fontSize: 14, marginTop: 12 }, pickerPanel: { backgroundColor: "#EFEAE2", borderRadius: 16, marginTop: 14, padding: 16 }, pickerHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, pickerTitle: { color: "#24221F", fontSize: 17, fontWeight: "700" }, pickerHint: { color: "#716B64", fontSize: 13, marginTop: 8 }, monthRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginVertical: 18 }, calendarGrid: { flexDirection: "row", flexWrap: "wrap" }, calendarDay: { alignItems: "center", justifyContent: "center", minHeight: 38, width: "14.285%" }, calendarDaySelected: { backgroundColor: "#D5B98D", borderRadius: 19 } });
