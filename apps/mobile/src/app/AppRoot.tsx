import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from "expo-audio";
import { useMemo, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppShell, CalendarSurface, FindSurface, MeSurface, type ShellTab } from "../AppShell";
import { createCaptureSubmitter } from "../capture/voice-capture";
import { createExpoVoiceRecorder, readRecordedAudioAsBase64 } from "../capture/expo-voice-recorder";
import { SelectedDayTaskScreen } from "../day/SelectedDayTaskScreen";
import { MemberListScreen } from "../list/MemberListScreen";
import { createStaticMemberItemsClient, type MemberListItem } from "../list/member-items";
import { createExpoOfflineDraftStore } from "../offline/expo-offline-drafts";
import { createMemoryOfflineDraftStore } from "../offline/offline-drafts";
import { createOfflineDraftSyncClient } from "../offline/synchronize-offline-drafts";
import { createMetadataClient } from "../review/metadata";
import { createOrganizationProposalClient } from "../review/organization-proposals";
import { ReviewScreen } from "../review/ReviewScreen";
import { createReviewFixtureClient } from "../review/review";
import { createSpacesClient } from "../spaces/spaces";
import type { TaskNoteDetailMetadata } from "../detail/TaskNoteDetailScreen";
import { TaskCard } from "../web/TaskNoteCardPrototype";
import { createBrowserFixtureData, type BrowserFixtureData, type BrowserFixtureTask } from "../web/fixture-data";

export default function AppRoot() {
  const uiFixture = process.env.EXPO_PUBLIC_UI_FIXTURE === "true";
  const [detailUrl, setDetailUrl] = useState<string | null>(null);
  const [fixtureMode, setFixtureMode] = useState(process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "task" || process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "note");
  const [tab, setTab] = useState<ShellTab>("home");
  const [captureRequest, setCaptureRequest] = useState(0);
  const [showToday, setShowToday] = useState(false);
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 150);
  const offlineDraftStore = useMemo(() => uiFixture || typeof window !== "undefined" ? createMemoryOfflineDraftStore() : createExpoOfflineDraftStore(), [uiFixture]);
  const offlineDraftSyncClient = useMemo(() => createOfflineDraftSyncClient(apiBaseUrl, { readBase64: readRecordedAudioAsBase64 }), [apiBaseUrl]);
  const memberId = process.env.EXPO_PUBLIC_MEMBER_ID ?? "member-1";
  const fixtureData = useMemo(() => uiFixture ? createBrowserFixtureData() : undefined, [uiFixture]);
  const [fixtureSpaceIds, setFixtureSpaceIds] = useState<Record<string, string | null>>({});
  const [fixtureTagIds, setFixtureTagIds] = useState<Record<string, readonly string[]>>({});
  const fixtureItems = fixtureData ? createStaticMemberItemsClient([...fixtureData.tasks.map((task, index) => fixtureTaskItem(task, index)), ...fixtureData.notes.map((note, index) => fixtureNoteItem(note, index))]) : undefined;
  const fixtureKind = process.env.EXPO_PUBLIC_REVIEW_FIXTURE === "task" ? "task" : "note";
  const activeFixtureMode = fixtureMode || (uiFixture && detailUrl !== null);
  const fixtureOutcome = useMemo(() => fixtureData && detailUrl ? fixtureOutcomeForUrl(fixtureData, detailUrl) : undefined, [detailUrl, fixtureData]);
  const fixtureClient = useMemo(() => uiFixture && activeFixtureMode ? createReviewFixtureClient(fixtureOutcome?.kind ?? fixtureKind, fixtureOutcome) : undefined, [activeFixtureMode, fixtureKind, fixtureOutcome, uiFixture]);
  const fixtureMetadata = uiFixture && fixtureData && detailUrl ? fixtureDetailMetadata(fixtureData, detailUrl, fixtureSpaceIds, fixtureTagIds, setFixtureSpaceIds, setFixtureTagIds) : undefined;
  const openCapture = () => { setTab("home"); setCaptureRequest((request) => request + 1); };
  const content = detailUrl || fixtureMode
    ? <ReviewScreen apiBaseUrl={apiBaseUrl} memberId={memberId} detailUrl={detailUrl ?? "/captures/demo-capture-1/review"} {...(fixtureMetadata ? { detailMetadata: fixtureMetadata } : {})} {...(!activeFixtureMode ? { metadataClient: createMetadataClient(apiBaseUrl), organizationProposalClient: createOrganizationProposalClient(apiBaseUrl), spacesClient: createSpacesClient(apiBaseUrl) } : {})} {...(activeFixtureMode ? { client: fixtureClient ?? createReviewFixtureClient(fixtureKind) } : {})} offlineDraftStore={offlineDraftStore} onBack={() => { setDetailUrl(null); setFixtureMode(false); }} />
    : showToday ? <SelectedDayTaskScreen apiBaseUrl={apiBaseUrl} memberId={memberId} selectedDate={new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date()) as `${number}-${number}-${number}`} timeZone="Europe/Warsaw" renderTask={(task) => <PressableTaskRow title={task.title} detailUrl={task.detailUrl} onOpenDetail={setDetailUrl} />} />
    : tab === "find" ? <FindSurface />
    : tab === "calendar" ? <CalendarSurface />
    : tab === "me" ? <MeSurface />
    : <MemberListScreen apiBaseUrl={apiBaseUrl} {...(fixtureItems ? { client: fixtureItems } : {})} memberId={memberId} home={tab === "home" && process.env.NODE_ENV !== "test"} onOpenToday={() => setShowToday(true)} onOpenDetail={setDetailUrl} voiceRecorder={createExpoVoiceRecorder(recorder)} recordingMetering={recorderState.metering} recordingInterrupted={recorderState.mediaServicesDidReset} captureSubmitter={createCaptureSubmitter(apiBaseUrl, readRecordedAudioAsBase64)} offlineDraftStore={offlineDraftStore} offlineDraftSyncClient={offlineDraftSyncClient} captureRequest={captureRequest} />;
  return <SafeAreaProvider><AppShell tab={tab} onTabChange={(nextTab) => { setTab(nextTab); setShowToday(false); }} onCapture={openCapture}>{content}</AppShell></SafeAreaProvider>;
}

function PressableTaskRow({ title, detailUrl, onOpenDetail }: { readonly title: string; readonly detailUrl: string; readonly onOpenDetail: (url: string) => void }) {
  const task: BrowserFixtureTask = { id: detailUrl, title, status: "open", tagIds: [], entityIds: [] };
  return <TaskCard task={task} timeZone="Europe/Warsaw" today={new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date())} onPress={() => onOpenDetail(detailUrl)} />;
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
