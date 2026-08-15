import { loadConfiguration, loadLocalEnvironment } from "./configuration.js";
import { CaptureService } from "./features/captures/capture.js";
import { buildApi } from "./http/build-api.js";
import { FileSystemBlobStorage } from "./infrastructure/blob-storage/filesystem-blob-storage.js";
import { prepareRuntime } from "./runtime.js";
import { SqliteCaptureRepository } from "./infrastructure/sqlite/sqlite-capture-repository.js";
import { SqliteInterpretationRepository } from "./infrastructure/sqlite/sqlite-interpretation-repository.js";
import { NoteService, TaskService } from "./features/outcomes/outcome.js";
import { SqliteOutcomeRepository } from "./infrastructure/sqlite/sqlite-outcome-repository.js";
import { SqliteTranscriptionRepository } from "./infrastructure/sqlite/sqlite-transcription-repository.js";
import { ReviewService } from "./features/reviews/review.js";
import { MemberItemsService } from "./features/items/items.js";
import { SqliteMemberItemsRepository } from "./infrastructure/sqlite/sqlite-member-items-repository.js";
import { OfflineDraftService } from "./features/offline-drafts/offline-draft.js";
import { SqliteOfflineDraftRepository } from "./infrastructure/sqlite/sqlite-offline-draft-repository.js";
import { TranscriptionService } from "./features/transcriptions/transcription.js";
import { TranscriptionWorker } from "./features/transcriptions/transcription-worker.js";
import { LocalWhisperProvider } from "./infrastructure/transcription/local-whisper-provider.js";

async function start(): Promise<void> {
  loadLocalEnvironment();
  const configuration = loadConfiguration(process.env);
  await prepareRuntime(configuration);

  const repository = new SqliteCaptureRepository(configuration.databasePath);
  const transcriptionRepository = new SqliteTranscriptionRepository(configuration.databasePath);
  const interpretationRepository = new SqliteInterpretationRepository(configuration.databasePath);
  const outcomeRepository = new SqliteOutcomeRepository(configuration.databasePath);
  const memberItemsRepository = new SqliteMemberItemsRepository(configuration.databasePath);
  const offlineDraftRepository = new SqliteOfflineDraftRepository(configuration.databasePath);
  const captureService = new CaptureService(repository, new FileSystemBlobStorage(configuration.blobRoot));
  const transcriptionWorker = new TranscriptionWorker({
    service: new TranscriptionService(
      transcriptionRepository,
      captureService,
      new LocalWhisperProvider({
        endpoint: configuration.whisperEndpoint,
        model: configuration.whisperModel,
        timeoutMilliseconds: configuration.whisperTimeoutMilliseconds,
      }),
    ),
    repository: transcriptionRepository,
    maxAttempts: configuration.transcriptionMaxAttempts,
    onError: (error, captureId) => {
      console.error(`Transcription failed for Capture ${captureId}`, error);
    },
  });
  const reviewService = new ReviewService({
    captureService,
    transcriptionRepository,
    interpretationRepository,
    outcomeRepository,
  });
  const application = buildApi({
    logger: true,
    captureService,
    captureStoredHandler: transcriptionWorker,
    reviewService,
    noteService: new NoteService(outcomeRepository),
    taskService: new TaskService(outcomeRepository),
    memberItemsService: new MemberItemsService(memberItemsRepository),
    offlineDraftService: new OfflineDraftService(
      offlineDraftRepository,
      captureService,
      reviewService,
      transcriptionWorker,
    ),
  });
  application.addHook("onClose", async () => {
    await transcriptionWorker.stop();
    repository.close();
    transcriptionRepository.close();
    interpretationRepository.close();
    outcomeRepository.close();
    memberItemsRepository.close();
    offlineDraftRepository.close();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void application.close();
    });
  }

  await transcriptionWorker.start();
  await application.listen({
    host: configuration.host,
    port: configuration.port,
  });
}

try {
  await start();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
