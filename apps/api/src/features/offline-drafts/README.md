# Offline draft synchronization

`POST /offline-drafts/sync` accepts a client-owned `draftId` together with a Member identity and the original audio or text. The `(memberId, draftId)` pair is the idempotency identity. Retrying the same original returns the same durable draft; retrying it with different source content returns `409`.

An `accepted` draft means that the server has durably retained the original and, for audio, linked it to one Capture. It does not mean that transcription, interpretation, or a Task/Note has been confirmed. A failed audio handoff remains durable with `retryable: true`, and a later retry can complete the handoff. Downstream processing and its confirmed-result state remain separate from this synchronization boundary.
