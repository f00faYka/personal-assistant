# Offline draft synchronization

The mobile client keeps an `OfflineDraft` visible as unconfirmed until the backend confirms a durable result. `createOfflineDraftSyncClient` submits the original audio or text with the draft's stable `(memberId, draftId)` identity, then reads `/offline-drafts/<draftId>/status` until the result is confirmed or the bounded polling window ends. The server-side idempotency and status contract is documented in `apps/api/src/features/offline-drafts/README.md`.

Synchronization is attempted when restored drafts load, when the app resumes, and immediately after a new draft is saved. Calls for the same draft share one in-flight request within a client instance; the backend’s stable `(memberId, draftId)` idempotency contract prevents duplicate Captures and results across reconnects and app restarts. A retryable failure leaves the original local draft in place and exposes a retry action; terminal failures remain visible without offering a misleading retry. Local deletion happens only after a `confirmed` status and is itself treated as a recoverable local-storage operation.

`accepted` and `processing` are not result confirmation: the draft remains visible while the server continues processing. Audio is read from the managed local copy only when synchronization begins; the original local draft is never replaced by a server response.
