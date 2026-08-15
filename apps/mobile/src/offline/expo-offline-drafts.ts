import { Directory, File, Paths } from "expo-file-system";

import { createOfflineDraftStore, type OfflineDraftPersistence, type OfflineDraftStore } from "./offline-drafts";

export function createExpoOfflineDraftStore(): OfflineDraftStore {
  return createOfflineDraftStore(createExpoOfflineDraftPersistence());
}

function createExpoOfflineDraftPersistence(): OfflineDraftPersistence {
  const directory = new Directory(Paths.document, "offline-drafts");
  const manifestFile = () => new File(directory, "manifest.json");
  const manifestBackupFile = () => new File(directory, "manifest.backup.json");
  const manifestNextFile = () => new File(directory, "manifest.next.json");

  const ensureDirectory = () => {
    directory.create({ idempotent: true, intermediates: true });
  };

  return {
    async readManifest() {
      const manifest = manifestFile();
      if (manifest.exists) {
        const contents = await manifest.text();
        recoverStagedAudioDeletions(directory, contents);
        return contents;
      }
      const manifestBackup = manifestBackupFile();
      if (manifestBackup.exists) {
        const contents = await manifestBackup.text();
        recoverStagedAudioDeletions(directory, contents);
        return contents;
      }
      recoverStagedAudioDeletions(directory, null);
      return null;
    },
    async writeManifest(contents) {
      ensureDirectory();
      let manifest = manifestFile();
      let manifestBackup = manifestBackupFile();
      const manifestNext = manifestNextFile();
      if (!manifest.exists && manifestBackup.exists) manifestBackup.move(manifest);
      manifest = manifestFile();
      manifestBackup = manifestBackupFile();
      if (manifestNext.exists) manifestNext.delete();
      manifestNext.write(contents);
      if (manifestBackup.exists) manifestBackup.delete();
      if (manifest.exists) manifest.move(manifestBackup);
      try {
        manifestNext.move(manifestFile());
      } catch (error) {
        const currentManifest = manifestFile();
        const currentBackup = manifestBackupFile();
        if (!currentManifest.exists && currentBackup.exists) {
          try { currentBackup.move(currentManifest); } catch { /* readManifest can still recover the backup. */ }
        }
        throw error;
      }
    },
    async copyAudio(sourceUri, draftId) {
      ensureDirectory();
      const destination = audioFile(directory, draftId);
      if (destination.exists) destination.delete();
      new File(sourceUri).copy(destination);
      return destination.uri;
    },
    async deleteAudio(draftId) {
      const file = audioFile(directory, draftId);
      if (file.exists) file.delete();
    },
    async stageAudioDeletion(draftId) {
      const file = audioFile(directory, draftId);
      const staged = stagedAudioFile(directory, draftId);
      if (!file.exists) return;
      if (staged.exists) staged.delete();
      file.move(staged);
    },
    async restoreAudioDeletion(draftId) {
      restoreStagedAudio(directory, draftId);
    },
    async commitAudioDeletion(draftId) {
      const staged = stagedAudioFile(directory, draftId);
      if (staged.exists) staged.delete();
    },
  };
}

function audioFile(directory: Directory, draftId: string): File {
  return new File(directory, `${encodeURIComponent(draftId)}.m4a`);
}

function stagedAudioFile(directory: Directory, draftId: string): File {
  return new File(directory, `${encodeURIComponent(draftId)}.m4a.deleting`);
}

function restoreStagedAudio(directory: Directory, draftId: string): void {
  const staged = stagedAudioFile(directory, draftId);
  if (!staged.exists) return;
  const original = audioFile(directory, draftId);
  if (original.exists) staged.delete();
  else staged.move(original);
}

function recoverStagedAudioDeletions(directory: Directory, contents: string | null): void {
  if (!directory.exists) return;
  const retainedAudioUris = retainedAudioDraftUris(directory, contents);
  if (retainedAudioUris === null) return;
  for (const entry of directory.list()) {
    if (!(entry instanceof File) || !entry.uri.endsWith(".m4a.deleting")) continue;
    const original = new File(entry.uri.slice(0, -".deleting".length));
    if (retainedAudioUris.has(original.uri)) {
      if (original.exists) entry.delete();
      else entry.move(original);
    } else {
      entry.delete();
    }
  }
}

function retainedAudioDraftUris(directory: Directory, contents: string | null): Set<string> | null {
  if (contents === null) return new Set();
  try {
    const value: unknown = JSON.parse(contents);
    if (typeof value !== "object" || value === null || !("drafts" in value) || !Array.isArray(value.drafts)) return null;
    const uris = new Set<string>();
    for (const draft of value.drafts) {
      if (typeof draft !== "object" || draft === null || !("draftId" in draft) || typeof draft.draftId !== "string" || !("source" in draft) || typeof draft.source !== "object" || draft.source === null || !("kind" in draft.source)) return null;
      if (draft.source.kind === "audio") uris.add(audioFile(directory, draft.draftId).uri);
    }
    return uris;
  } catch {
    return null;
  }
}
