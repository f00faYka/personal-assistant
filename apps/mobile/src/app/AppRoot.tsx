import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from "expo-audio";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppShell, MeSurface, type ShellTab } from "../AppShell";
import { createCaptureSubmitter } from "../capture/voice-capture";
import { createExpoVoiceRecorder, readRecordedAudioAsBase64 } from "../capture/expo-voice-recorder";
import { SelectedDayTaskScreen } from "../day/SelectedDayTaskScreen";
import { MemberListScreen } from "../list/MemberListScreen";
import { createMemberItemsClient, createStaticMemberItemsClient, type MemberListItem } from "../list/member-items";
import { createExpoOfflineDraftStore } from "../offline/expo-offline-drafts";
import { createMemoryOfflineDraftStore } from "../offline/offline-drafts";
import { createOfflineDraftSyncClient } from "../offline/synchronize-offline-drafts";
import { createMetadataClient, type MetadataClient, type MetadataLinks } from "../review/metadata";
import { createOrganizationProposalClient } from "../review/organization-proposals";
import { ReviewScreen } from "../review/ReviewScreen";
import { createReviewClient, createReviewFixtureClient, setTaskCompletion, type ReviewClient } from "../review/review";
import { createSpacesClient } from "../spaces/spaces";
import type { TaskNoteDetailMetadata } from "../detail/TaskNoteDetailScreen";
import { TaskCard } from "../web/TaskNoteCardPrototype";
import { createBrowserFixtureData, type BrowserFixtureData } from "../web/fixture-data";
import { localDateKey } from "../day/selected-day";
import { getDeviceTimeZone } from "../time-zone";
import { MaterialsPrototype } from "../materials/MaterialsPrototype";
import { MaterialsScreen } from "../materials/MaterialsScreen";
import { TaskActionsPrototype } from "../list/TaskActionsPrototype";
import { CalendarScreen, CalendarSelectedDayScreen } from "../calendar/CalendarScreen";
import { CaptureResultProvider, useCaptureResultController } from "../preview/CaptureResultController";
import { CaptureResultReview } from "../review/CaptureResultReview";
import type { LocalDate } from "../day/selected-day";
import type { Entity, Tag } from "../review/metadata";

export default function AppRoot() {
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
  const memberId = process.env.EXPO_PUBLIC_MEMBER_ID ?? "member-1";
  const timeZone = getDeviceTimeZone();
  return <SafeAreaProvider><CaptureResultProvider apiBaseUrl={apiBaseUrl} memberId={memberId} timeZone={timeZone}><AppRootContent apiBaseUrl={apiBaseUrl} memberId={memberId} /></CaptureResultProvider></SafeAreaProvider>;
}

function AppRootContent({ apiBaseUrl, memberId }: { readonly apiBaseUrl: string; readonly memberId: string }) {
  const captureResult = useCaptureResultController();
  const uiFixture = process.env.EXPO_PUBLIC_UI_FIXTURE === "true";
  const materialsPrototype = uiFixture && process.env.EXPO_PUBLIC_MATERIALS_PROTOTYPE === "true";
  const taskActionsPrototype = uiFixture && process.env.EXPO_PUBLIC_TASK_ACTIONS_PROTOTYPE === "true";
  const [detailUrl, setDetailUrl] = useState<string | null>(null);
  const [detailInitialEditing, setDetailInitialEditing] = useState(false);
  const [fixtureMode, setFixtureMode] = useState(process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "task" || process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "note");
  const [tab, setTab] = useState<ShellTab>("home");
  const [captureRequest, setCaptureRequest] = useState(0);
  const [showToday, setShowToday] = useState(false);
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<LocalDate>(() => localDateKey(new Date(), getDeviceTimeZone()));
  const [calendarDayOpen, setCalendarDayOpen] = useState(false);
  const [calendarDayClosing, setCalendarDayClosing] = useState(false);
  const [showMaterialsPrototype, setShowMaterialsPrototype] = useState(false);
  const [materialsDetailUrl, setMaterialsDetailUrl] = useState<string | null>(null);
  const [materialsInitialEditing, setMaterialsInitialEditing] = useState(false);
  const timeZone = getDeviceTimeZone();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 150);
  const voiceRecorder = useMemo(() => createExpoVoiceRecorder(recorder), [recorder]);
  const captureSubmitter = useMemo(() => createCaptureSubmitter(apiBaseUrl, readRecordedAudioAsBase64), [apiBaseUrl]);
  const offlineDraftStore = useMemo(() => uiFixture || typeof window !== "undefined" ? createMemoryOfflineDraftStore() : createExpoOfflineDraftStore(), [uiFixture]);
  const offlineDraftSyncClient = useMemo(() => createOfflineDraftSyncClient(apiBaseUrl, { readBase64: readRecordedAudioAsBase64 }), [apiBaseUrl]);
  const reviewClient = useMemo(() => createReviewClient(apiBaseUrl), [apiBaseUrl]);
  const fixtureData = useMemo(() => uiFixture ? createBrowserFixtureData() : undefined, [uiFixture]);
  const [fixtureSpaceIds, setFixtureSpaceIds] = useState<Record<string, string | null>>({});
  const [fixtureTagIds, setFixtureTagIds] = useState<Record<string, readonly string[]>>({});
  const fixtureItems = useMemo(() => fixtureData ? createStaticMemberItemsClient([...fixtureData.tasks.map((task, index) => fixtureTaskItem(task, index)), ...fixtureData.notes.map((note, index) => fixtureNoteItem(note, index))]) : undefined, [fixtureData]);
  const calendarItemsClient = useMemo(() => fixtureItems ?? createMemberItemsClient(apiBaseUrl), [apiBaseUrl, fixtureItems]);
  const fixtureSpacesClient = useMemo(() => fixtureData ? createFixtureSpacesClient(fixtureData.spaces, memberId) : undefined, [fixtureData, memberId]);
  const fixtureMetadataClient = useMemo(() => fixtureData ? createFixtureMetadataClient(fixtureData, memberId) : undefined, [fixtureData, memberId]);
  const fixtureKind = process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "task" ? "task" : "note";
  const reviewUrl = detailUrl ?? materialsDetailUrl;
  const activeFixtureMode = fixtureMode || (uiFixture && reviewUrl !== null);
  const fixtureOutcome = useMemo(() => fixtureData && reviewUrl ? fixtureOutcomeForUrl(fixtureData, reviewUrl) : undefined, [fixtureData, reviewUrl]);
  const fixtureClient = useMemo(() => uiFixture && activeFixtureMode ? createReviewFixtureClient(fixtureOutcome?.kind ?? fixtureKind, fixtureOutcome) : undefined, [activeFixtureMode, fixtureKind, fixtureOutcome, uiFixture]);
  const fixtureMetadata = uiFixture && fixtureData && reviewUrl ? fixtureDetailMetadata(fixtureData, reviewUrl, fixtureSpaceIds, fixtureTagIds, setFixtureSpaceIds, setFixtureTagIds) : undefined;
  const materialsDetail = materialsDetailUrl ? <ReviewScreen apiBaseUrl={apiBaseUrl} memberId={memberId} timeZone={timeZone} detailUrl={materialsDetailUrl} initialEditing={materialsInitialEditing} {...(fixtureMetadata ? { detailMetadata: fixtureMetadata } : {})} {...(!activeFixtureMode ? { metadataClient: createMetadataClient(apiBaseUrl), organizationProposalClient: createOrganizationProposalClient(apiBaseUrl), spacesClient: createSpacesClient(apiBaseUrl) } : {})} {...(activeFixtureMode && fixtureMetadataClient ? { metadataClient: fixtureMetadataClient } : {})} {...(activeFixtureMode ? { client: fixtureClient ?? createReviewFixtureClient(fixtureKind) } : {})} offlineDraftStore={offlineDraftStore} onBack={() => { setMaterialsDetailUrl(null); setMaterialsInitialEditing(false); }} /> : undefined;
  const materialsScreen = <MaterialsScreen apiBaseUrl={apiBaseUrl} memberId={memberId} timeZone={timeZone} {...(fixtureItems ? { client: fixtureItems } : {})} {...(fixtureSpacesClient ? { spacesClient: fixtureSpacesClient } : {})} {...(fixtureMetadataClient ? { metadataClient: fixtureMetadataClient } : {})} onOpenDetail={(url) => { setMaterialsInitialEditing(false); setMaterialsDetailUrl(url); }} onEditDetail={(url) => { setMaterialsInitialEditing(true); setMaterialsDetailUrl(url); }} detailUrl={materialsDetailUrl} detail={materialsDetail} />;
  const openCapture = () => setCaptureRequest((request) => request + 1);
  const memberListScreen = <MemberListScreen apiBaseUrl={apiBaseUrl} {...(fixtureItems ? { client: fixtureItems } : {})} memberId={memberId} timeZone={timeZone} home={tab === "home" && process.env.NODE_ENV !== "test"} onOpenToday={() => setShowToday(true)} onOpenDetail={(url) => { setDetailInitialEditing(false); setDetailUrl(url); }} onEditDetail={(url) => { setDetailInitialEditing(true); setDetailUrl(url); }} voiceRecorder={voiceRecorder} recordingMetering={recorderState.metering} recordingInterrupted={recorderState.mediaServicesDidReset} captureSubmitter={captureSubmitter} offlineDraftStore={offlineDraftStore} offlineDraftSyncClient={offlineDraftSyncClient} captureRequest={captureRequest} captureReviewInRoot />;
  const detailScreen = <ReviewScreen apiBaseUrl={apiBaseUrl} memberId={memberId} timeZone={timeZone} detailUrl={detailUrl ?? "/captures/demo-capture-1/review"} initialEditing={detailInitialEditing} {...(fixtureMetadata ? { detailMetadata: fixtureMetadata } : {})} {...(!activeFixtureMode ? { metadataClient: createMetadataClient(apiBaseUrl), organizationProposalClient: createOrganizationProposalClient(apiBaseUrl), spacesClient: createSpacesClient(apiBaseUrl) } : {})} {...(activeFixtureMode && fixtureMetadataClient ? { metadataClient: fixtureMetadataClient } : {})} {...(activeFixtureMode ? { client: fixtureClient ?? createReviewFixtureClient(fixtureKind) } : {})} offlineDraftStore={offlineDraftStore} onBack={() => { setDetailUrl(null); setDetailInitialEditing(false); setFixtureMode(false); captureResult.closeReview(); }} />;
  const calendarDayFlow = tab === "calendar" && calendarDayOpen;
  const closeCalendarScreen = () => setCalendarDayClosing(true);
  const calendarDayScreen = detailUrl || fixtureMode
    ? detailScreen
    : <CalendarSelectedDayScreen apiBaseUrl={apiBaseUrl} memberId={memberId} selectedDate={calendarSelectedDate} timeZone={timeZone} client={calendarItemsClient} onBack={closeCalendarScreen} renderTask={(task) => <PressableTaskRow task={task} memberId={memberId} client={reviewClient} timeZone={timeZone} onOpenDetail={(url) => { setDetailInitialEditing(false); setDetailUrl(url); }} onEditDetail={(url) => { setDetailInitialEditing(true); setDetailUrl(url); }} />} />;
  const calendarScreen = <CalendarScreen apiBaseUrl={apiBaseUrl} memberId={memberId} selectedDate={calendarSelectedDate} timeZone={timeZone} client={calendarItemsClient} onSelectDate={(date) => { setCalendarSelectedDate(date); setCalendarDayClosing(false); setCalendarDayOpen(true); }} onReturnToToday={setCalendarSelectedDate} />;
  const isHomeListVisible = tab === "home" && !taskActionsPrototype && !calendarDayFlow && !detailUrl && !fixtureMode && !showToday && !captureResult.reviewUrl;
  const content = captureResult.reviewUrl ? <CaptureResultReview apiBaseUrl={apiBaseUrl} memberId={memberId} timeZone={timeZone} detailUrl={captureResult.reviewUrl} onBack={captureResult.closeReview} />
    : taskActionsPrototype ? <TaskActionsPrototype />
    : calendarDayFlow ? calendarScreen
    : detailUrl || fixtureMode
    ? detailScreen
    : showToday ? <SelectedDayTaskScreen apiBaseUrl={apiBaseUrl} memberId={memberId} selectedDate={localDateKey(new Date(), timeZone)} timeZone={timeZone} renderTask={(task) => <PressableTaskRow task={task} memberId={memberId} client={reviewClient} timeZone={timeZone} onOpenDetail={(url) => { setDetailInitialEditing(false); setDetailUrl(url); }} onEditDetail={(url) => { setDetailInitialEditing(true); setDetailUrl(url); }} />} />
    : tab === "find" ? materialsScreen
    : tab === "calendar" ? calendarScreen
    : tab === "me" ? (materialsPrototype && showMaterialsPrototype ? <MaterialsPrototype timeZone={timeZone} /> : <MeSurface onOpenMaterials={() => materialsPrototype ? setShowMaterialsPrototype(true) : setTab("find")} />)
    : memberListScreen;
  return <>
    <AppShell tab={tab} onTabChange={(nextTab) => { setTab(nextTab); setShowToday(false); setCalendarDayOpen(false); setCalendarDayClosing(false); }} onCapture={openCapture}>
      <View style={{ flex: 1 }}>
        <View style={isHomeListVisible ? { flex: 1 } : { display: "none" }}>{memberListScreen}</View>
        {!isHomeListVisible ? content : null}
      </View>
    </AppShell>
    {calendarDayFlow ? <CalendarScreenTransition closing={calendarDayClosing} onClosed={() => { setCalendarDayOpen(false); setCalendarDayClosing(false); }}>{calendarDayScreen}</CalendarScreenTransition> : null}
  </>;
}

function CalendarScreenTransition({ children, closing, onClosed }: { readonly children: ReactNode; readonly closing: boolean; readonly onClosed: () => void }) {
  const { width } = useWindowDimensions();
  const [translateX] = useState(() => new Animated.Value(width));
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  useEffect(() => {
    const animation = Animated.timing(translateX, { toValue: closing ? width : 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start(({ finished }) => { if (finished && closing) onClosedRef.current(); });
    return () => animation.stop();
  }, [closing, translateX, width]);
  return <Animated.View style={[calendarTransitionStyles.overlay, { transform: [{ translateX }] }]}>{children}</Animated.View>;
}

const calendarTransitionStyles = StyleSheet.create({ overlay: { backgroundColor: "#F8F6F1", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 } });

function createFixtureSpacesClient(spaces: BrowserFixtureData["spaces"], memberId: string) {
  return { list: async () => spaces.map((space) => ({ id: space.id, memberId, name: space.name, ...(space.parentId ? { parentId: space.parentId } : {}), createdAt: "fixture" })) };
}

function createFixtureMetadataClient(fixture: BrowserFixtureData, memberId: string): MetadataClient {
  let tags: Tag[] = fixture.tags.map((tag) => ({ ...tag, memberId, createdAt: "fixture" }));
  let entities: Entity[] = fixture.entities.map((entity) => ({ ...entity, memberId, createdAt: "fixture", type: entity.type === "Person" || entity.type === "Place" || entity.type === "Organization" || entity.type === "Object" ? entity.type : "Object" }));
  const itemLinks = new Map<string, MetadataLinks>();
  for (const task of fixture.tasks) itemLinks.set(`task:${task.id}`, { tags: tags.filter((tag) => task.tagIds.includes(tag.id)), entities: entities.filter((entity) => task.entityIds.includes(entity.id)) });
  for (const note of fixture.notes) itemLinks.set(`note:${note.id}`, { tags: tags.filter((tag) => note.tagIds.includes(tag.id)), entities: entities.filter((entity) => note.entityIds.includes(entity.id)) });
  const linksFor = (itemId: string, itemKind: "task" | "note") => itemLinks.get(`${itemKind}:${itemId}`) ?? { tags: [], entities: [] };
  return {
    listTags: async () => tags,
    createTag: async (_memberId, name) => { const tag = { id: `fixture-tag-${tags.length + 1}`, memberId, name, createdAt: "fixture" }; tags = [...tags, tag]; return tag; },
    updateTag: async (id, _memberId, name) => { const updated = { ...tags.find((tag) => tag.id === id)!, name }; tags = tags.map((tag) => tag.id === id ? updated : tag); for (const [key, links] of itemLinks) itemLinks.set(key, { ...links, tags: links.tags.map((tag) => tag.id === id ? updated : tag) }); return updated; },
    listEntities: async () => entities,
    createEntity: async (_memberId, name, type) => { const entity = { id: `fixture-entity-${entities.length + 1}`, memberId, name, type, createdAt: "fixture" }; entities = [...entities, entity]; return entity; },
    updateEntity: async (id, _memberId, name, type) => { const updated = { ...entities.find((entity) => entity.id === id)!, name, type }; entities = entities.map((entity) => entity.id === id ? updated : entity); for (const [key, links] of itemLinks) itemLinks.set(key, { ...links, entities: links.entities.map((entity) => entity.id === id ? updated : entity) }); return updated; },
    listLinks: async (itemId, itemKind) => linksFor(itemId, itemKind),
    linkTag: async (itemId, itemKind, tagId) => { const links = linksFor(itemId, itemKind); const tag = tags.find((entry) => entry.id === tagId); const updated = tag && !links.tags.some((entry) => entry.id === tag.id) ? { ...links, tags: [...links.tags, tag] } : links; itemLinks.set(`${itemKind}:${itemId}`, updated); return updated; },
    unlinkTag: async (itemId, itemKind, tagId) => { const links = linksFor(itemId, itemKind); const updated = { ...links, tags: links.tags.filter((tag) => tag.id !== tagId) }; itemLinks.set(`${itemKind}:${itemId}`, updated); return updated; },
    linkEntity: async (itemId, itemKind, entityId) => { const links = linksFor(itemId, itemKind); const entity = entities.find((entry) => entry.id === entityId); const updated = entity && !links.entities.some((entry) => entry.id === entity.id) ? { ...links, entities: [...links.entities, entity] } : links; itemLinks.set(`${itemKind}:${itemId}`, updated); return updated; },
    unlinkEntity: async (itemId, itemKind, entityId) => { const links = linksFor(itemId, itemKind); const updated = { ...links, entities: links.entities.filter((entity) => entity.id !== entityId) }; itemLinks.set(`${itemKind}:${itemId}`, updated); return updated; },
  };
}

function PressableTaskRow({ task, memberId, client, timeZone, onOpenDetail, onEditDetail }: { readonly task: import("../list/member-items").TaskListItem; readonly memberId: string; readonly client: ReviewClient; readonly timeZone: string; readonly onOpenDetail: (url: string) => void; readonly onEditDetail: (url: string) => void }) {
  const [status, setStatus] = useState(task.state);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "error">("saved");
  const updateStatus = async (completed: boolean): Promise<boolean> => {
    setSaveState("pending");
    try {
      const result = await setTaskCompletion(client, task.detailUrl, memberId, completed);
      setStatus(result.status); setSaveState("saved"); return true;
    } catch {
      setSaveState("error"); return false;
    }
  };
  return <TaskCard task={{ id: task.id, title: task.title, ...(task.dueAt ? { dueAt: task.dueAt } : {}), status }} timeZone={timeZone} today={localDateKey(new Date(), timeZone)} saveState={saveState} onRetry={() => void updateStatus(status !== "completed")} onSetCompleted={updateStatus} onPress={() => onOpenDetail(task.detailUrl)} onEdit={() => onEditDetail(task.detailUrl)} />;
}

function fixtureDueAt(value: string | undefined, index: number): string | undefined {
  if (!value || index > 1) return value;
  const today = new Date();
  const source = new Date(value);
  today.setHours(source.getUTCHours(), source.getUTCMinutes(), 0, 0);
  return today.toISOString();
}

function fixtureTaskItem(task: BrowserFixtureData["tasks"][number], index: number): MemberListItem {
  const dueAt = fixtureDueAt(task.dueAt, index);
  return { kind: "task", id: task.id, captureId: `fixture-${task.id}`, title: task.title, ...(dueAt === undefined ? {} : { dueAt }), state: task.status, createdAt: task.dueAt ?? new Date().toISOString(), detailUrl: `/tasks/${task.id}`, ...(task.spaceId === undefined ? {} : { spaceId: task.spaceId }) };
}

function fixtureNoteItem(note: BrowserFixtureData["notes"][number], index: number): MemberListItem {
  return { kind: "note", id: note.id, captureId: `fixture-${note.id}`, content: note.content, state: note.reviewState, createdAt: new Date(Date.now() - index * 60_000).toISOString(), detailUrl: `/notes/${note.id}`, ...(note.spaceId === undefined ? {} : { spaceId: note.spaceId }) };
}

function fixtureOutcomeForUrl(fixture: BrowserFixtureData, detailUrl: string) {
  const task = fixture.tasks.find((candidate) => detailUrl.includes(candidate.id));
  if (task) return { kind: "task" as const, id: task.id, title: task.title, status: task.status, ...(task.dueAt === undefined ? {} : { dueAt: task.dueAt }), version: 0 };
  const note = fixture.notes.find((candidate) => detailUrl.includes(candidate.id));
  if (note) return { kind: "note" as const, id: note.id, content: note.content, reviewState: note.reviewState, version: 0 };
  return undefined;
}

function fixtureDetailMetadata(fixture: BrowserFixtureData, detailUrl: string, spaceIds: Record<string, string | null>, tagIds: Record<string, readonly string[]>, setSpaceIds: (value: (current: Record<string, string | null>) => Record<string, string | null>) => void, setTagIds: (value: (current: Record<string, readonly string[]>) => Record<string, readonly string[]>) => void): TaskNoteDetailMetadata | undefined {
  const item = fixture.tasks.find((candidate) => detailUrl.includes(candidate.id)) ?? fixture.notes.find((candidate) => detailUrl.includes(candidate.id));
  if (!item) return undefined;
  const itemId = item.id;
  const initialSpaceId = "spaceId" in item ? item.spaceId ?? null : null;
  const selectedSpaceId = Object.prototype.hasOwnProperty.call(spaceIds, itemId) ? spaceIds[itemId] ?? null : initialSpaceId;
  const initialTagIds = item.tagIds;
  const selectedTagIds = Object.prototype.hasOwnProperty.call(tagIds, itemId) ? tagIds[itemId] ?? initialTagIds : initialTagIds;
  return {
    selectedSpaceId,
    spaces: fixture.spaces.map((space) => ({ id: space.id, label: spacePath(fixture.spaces, space.id) })),
    tags: fixture.tags.map((tag) => ({ id: tag.id, label: tag.name, selected: selectedTagIds.includes(tag.id) })),
    onSpaceChange: (nextSpaceId) => setSpaceIds((current) => ({ ...current, [itemId]: nextSpaceId })),
    onTagToggle: (tagId) => setTagIds((current) => {
      const next = selectedTagIds.includes(tagId) ? selectedTagIds.filter((id) => id !== tagId) : [...selectedTagIds, tagId];
      return { ...current, [itemId]: next };
    }),
  };
}

function spacePath(spaces: BrowserFixtureData["spaces"], spaceId: string): string {
  const space = spaces.find((candidate) => candidate.id === spaceId);
  if (!space) return "No Space";
  return space.parentId ? `${spacePath(spaces, space.parentId)} > ${space.name}` : space.name;
}
