export type OfflineDraftSource =
  | { readonly kind: "audio"; readonly uri: string; readonly contentType: string }
  | { readonly kind: "text"; readonly text: string };

export interface OfflineDraft {
  readonly draftId: string;
  readonly memberId: string;
  readonly capturedAt: string;
  readonly timeZone?: string;
  readonly source: OfflineDraftSource;
}

export type NewOfflineDraft = OfflineDraft;

export interface OfflineDraftStore {
  list(memberId: string): Promise<readonly OfflineDraft[]>;
  save(draft: NewOfflineDraft): Promise<OfflineDraft>;
  remove(memberId: string, draftId: string): Promise<void>;
}

/** In-memory adapter for the same UI when the app is started with fixture data. */
export function createMemoryOfflineDraftStore(): OfflineDraftStore {
  let drafts: OfflineDraft[] = [];
  return {
    async list(memberId) { return drafts.filter((draft) => draft.memberId === memberId); },
    async save(draft) { drafts = [...drafts.filter((current) => current.draftId !== draft.draftId), draft]; return draft; },
    async remove(memberId, draftId) { drafts = drafts.filter((draft) => draft.memberId !== memberId || draft.draftId !== draftId); },
  };
}

export interface OfflineDraftPersistence {
  readManifest(): Promise<string | null>;
  writeManifest(contents: string): Promise<void>;
  copyAudio(sourceUri: string, draftId: string): Promise<string>;
  deleteAudio(draftId: string): Promise<void>;
  stageAudioDeletion(draftId: string): Promise<void>;
  restoreAudioDeletion(draftId: string): Promise<void>;
  commitAudioDeletion(draftId: string): Promise<void>;
}

interface OfflineDraftManifest {
  readonly version: 1;
  readonly drafts: readonly OfflineDraft[];
}

export function createOfflineDraftStore(persistence: OfflineDraftPersistence): OfflineDraftStore {
  let mutationQueue: Promise<void> = Promise.resolve();

  const mutate = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    async list(memberId) {
      await mutationQueue;
      const drafts = await readDrafts(persistence);
      return drafts
        .filter((draft) => draft.memberId === memberId)
        .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
    },

    save(input) {
      return mutate(async () => {
        validateDraft(input);
        const drafts = await readDrafts(persistence);
        const existing = drafts.find((draft) => draft.memberId === input.memberId && draft.draftId === input.draftId);
        if (existing) {
          if (!sameSource(existing.source, input.source)) throw new Error(`Offline draft conflicts with existing source: ${input.draftId}`);
          return existing;
        }

        if (input.source.kind === "text") {
          const draft: OfflineDraft = { ...input, source: { ...input.source } };
          await writeDrafts(persistence, [...drafts, draft]);
          return draft;
        }

        const uri = await persistence.copyAudio(input.source.uri, input.draftId);
        const draft: OfflineDraft = {
          draftId: input.draftId,
          memberId: input.memberId,
          capturedAt: input.capturedAt,
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
          source: { kind: "audio", uri, contentType: input.source.contentType },
        };
        try {
          await writeDrafts(persistence, [...drafts, draft]);
          return draft;
        } catch (error) {
          try { await persistence.deleteAudio(input.draftId); } catch { /* Preserve the original persistence error. */ }
          throw error;
        }
      });
    },

    remove(memberId, draftId) {
      return mutate(async () => {
        const drafts = await readDrafts(persistence);
        const draft = drafts.find((candidate) => candidate.memberId === memberId && candidate.draftId === draftId);
        if (!draft) return;
        const remaining = drafts.filter((candidate) => candidate !== draft);
        if (draft.source.kind === "audio") {
          await persistence.stageAudioDeletion(draft.draftId);
          try {
            await writeDrafts(persistence, remaining);
          } catch (error) {
            try { await persistence.restoreAudioDeletion(draft.draftId); } catch { /* Startup recovery sees the staged file and durable manifest. */ }
            throw error;
          }
          try { await persistence.commitAudioDeletion(draft.draftId); } catch { /* The manifest is committed; startup reconciliation finishes managed cleanup. */ }
          return;
        }
        await writeDrafts(persistence, remaining);
      });
    },
  };
}

export function createOfflineDraftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function readDrafts(persistence: OfflineDraftPersistence): Promise<OfflineDraft[]> {
  const contents = await persistence.readManifest();
  if (contents === null) return [];
  try {
    const value: unknown = JSON.parse(contents);
    if (!isManifest(value)) throw new Error("invalid manifest");
    return value.drafts.map((draft) => ({ ...draft, source: { ...draft.source } }));
  } catch {
    throw new Error("Offline draft storage is corrupted");
  }
}

function writeDrafts(persistence: OfflineDraftPersistence, drafts: readonly OfflineDraft[]): Promise<void> {
  const manifest: OfflineDraftManifest = { version: 1, drafts };
  return persistence.writeManifest(JSON.stringify(manifest));
}

function isManifest(value: unknown): value is OfflineDraftManifest {
  return isRecord(value)
    && value.version === 1
    && Array.isArray(value.drafts)
    && value.drafts.every(isOfflineDraft);
}

function isOfflineDraft(value: unknown): value is OfflineDraft {
  if (!isRecord(value)
    || typeof value.draftId !== "string"
    || typeof value.memberId !== "string"
    || typeof value.capturedAt !== "string"
    || !isRecord(value.source)) return false;
  return value.source.kind === "audio"
    ? typeof value.source.uri === "string" && typeof value.source.contentType === "string"
    : value.source.kind === "text" && typeof value.source.text === "string";
}

function validateDraft(draft: NewOfflineDraft): void {
  if (!draft.draftId.trim()) throw new Error("Offline draft ID is required");
  if (!draft.memberId.trim()) throw new Error("Offline draft Member is required");
  if (Number.isNaN(new Date(draft.capturedAt).getTime())) throw new Error("Offline draft capture time is invalid");
  if (draft.source.kind === "audio") {
    if (!draft.source.uri.trim()) throw new Error("Offline draft audio is required");
    if (!/^audio\/[A-Za-z0-9.+-]+$/.test(draft.source.contentType)) throw new Error("Offline draft audio type is invalid");
  } else if (!draft.source.text.trim()) {
    throw new Error("Offline draft text is required");
  }
}

function sameSource(left: OfflineDraftSource, right: OfflineDraftSource): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "audio" && right.kind === "audio"
    ? left.uri === right.uri && left.contentType === right.contentType
    : left.kind === "text" && right.kind === "text" && left.text === right.text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
