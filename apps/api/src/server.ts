import { loadConfiguration, loadLocalEnvironment } from "./configuration.js";
import { CaptureService } from "./features/captures/capture.js";
import { buildApi } from "./http/build-api.js";
import { FileSystemBlobStorage } from "./infrastructure/blob-storage/filesystem-blob-storage.js";
import { prepareRuntime } from "./runtime.js";
import { SqliteCaptureRepository } from "./infrastructure/sqlite/sqlite-capture-repository.js";
import { SqliteInterpretationRepository } from "./infrastructure/sqlite/sqlite-interpretation-repository.js";
import { NoteService, OutcomeService, TaskService } from "./features/outcomes/outcome.js";
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
import { InterpretationService } from "./features/interpretations/interpretation.js";
import { InterpretationWorker } from "./features/interpretations/interpretation-worker.js";
import { LocalOllamaInterpretationProvider } from "./infrastructure/interpretation/local-ollama-interpretation-provider.js";
import { SqliteInterpretationJobRepository } from "./infrastructure/sqlite/sqlite-interpretation-job-repository.js";
import { SpaceService } from "./features/spaces/space.js";
import { SqliteSpaceRepository } from "./infrastructure/sqlite/sqlite-space-repository.js";
import { MetadataService } from "./features/metadata/metadata.js";
import { SqliteMetadataRepository } from "./infrastructure/sqlite/sqlite-metadata-repository.js";

async function start(): Promise<void> {
  loadLocalEnvironment();
  const configuration = loadConfiguration(process.env);
  await prepareRuntime(configuration);

  const repository = new SqliteCaptureRepository(configuration.databasePath);
  const transcriptionRepository = new SqliteTranscriptionRepository(configuration.databasePath);
  const interpretationRepository = new SqliteInterpretationRepository(configuration.databasePath);
  const interpretationJobRepository = new SqliteInterpretationJobRepository(configuration.databasePath);
  const outcomeRepository = new SqliteOutcomeRepository(configuration.databasePath);
  const memberItemsRepository = new SqliteMemberItemsRepository(configuration.databasePath);
  const offlineDraftRepository = new SqliteOfflineDraftRepository(configuration.databasePath);
  const spaceRepository = new SqliteSpaceRepository(configuration.databasePath);
  const metadataRepository = new SqliteMetadataRepository(configuration.databasePath);
  const captureService = new CaptureService(repository, new FileSystemBlobStorage(configuration.blobRoot));
  const interpretationWorker = new InterpretationWorker({
    service: new InterpretationService(interpretationRepository),
    outcomeService: new OutcomeService(outcomeRepository),
    provider: new LocalOllamaInterpretationProvider({
      endpoint: configuration.ollamaEndpoint,
      model: configuration.ollamaModel,
      timeoutMilliseconds: configuration.ollamaTimeoutMilliseconds,
    }),
    repository: interpretationJobRepository,
    transcriptionRepository,
    captureReader: captureService,
    maxAttempts: configuration.interpretationMaxAttempts,
    onError: (error, transcriptionId) => {
      console.error(`Interpretation failed for Transcription ${transcriptionId}`, error);
    },
  });
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
    succeededHandler: interpretationWorker,
    onError: (error, captureId) => {
      console.error(`Transcription failed for Capture ${captureId}`, error);
    },
  });
  const reviewService = new ReviewService({
    captureService,
    transcriptionRepository,
    interpretationRepository,
    interpretationJobRepository,
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
    spaceService: new SpaceService(spaceRepository),
    metadataService: new MetadataService(metadataRepository),
  });
  application.addHook("onClose", async () => {
    await transcriptionWorker.stop();
    await interpretationWorker.stop();
    repository.close();
    transcriptionRepository.close();
    interpretationRepository.close();
    interpretationJobRepository.close();
    outcomeRepository.close();
    memberItemsRepository.close();
    offlineDraftRepository.close();
    spaceRepository.close();
    metadataRepository.close();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void application.close();
    });
  }

  await interpretationWorker.start();
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
