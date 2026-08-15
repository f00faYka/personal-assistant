import { Directory, File, Paths } from "expo-file-system";

import { createOfflineDraftStore, type OfflineDraftPersistence, type OfflineDraftStore } from "./offline-drafts";

export function createExpoOfflineDraftStore(): OfflineDraftStore {
  return createOfflineDraftStore(createExpoOfflineDraftPersistence());
}

function createExpoOfflineDraftPersistence(): OfflineDraftPersistence {
  const directory = new Directory(Paths.document, "offline-drafts");
  const manifest = new File(directory, "manifest.json");

  const ensureDirectory = () => {
    directory.create({ idempotent: true, intermediates: true });
  };

  return {
    async readManifest() {
      if (!manifest.exists) return null;
      return manifest.text();
    },
    async writeManifest(contents) {
      ensureDirectory();
      manifest.write(contents);
    },
    async copyAudio(sourceUri, draftId) {
      ensureDirectory();
      const destination = new File(directory, `${encodeURIComponent(draftId)}.m4a`);
      if (destination.exists) destination.delete();
      new File(sourceUri).copy(destination);
      return destination.uri;
    },
    async deleteAudio(uri) {
      ensureOwnedAudioUri(directory, uri);
      const file = new File(uri);
      if (file.exists) file.delete();
    },
  };
}

function ensureOwnedAudioUri(directory: Directory, uri: string): void {
  const prefix = directory.uri.endsWith("/") ? directory.uri : `${directory.uri}/`;
  if (!uri.startsWith(prefix)) throw new Error("Offline draft audio path is outside managed storage");
}
