# Personal Assistant

This context describes the people and private group boundary served by the personal assistant.

## Language

**Private Group**:
The single private group whose members use the product. It typically has two to six members rather than a hard-coded two-person limit.
_Avoid_: Family, household, tenant

**Member**:
An independently authenticated person who belongs to the private group, has the same product capabilities as every other member, and has their own private data.
_Avoid_: User, account, family member

**Capture**:
The immutable member-originated input event. A Capture may contain entered text or audio and preserves any associated transcription as a separate source artifact.

**Source content**:
The preserved payload of a Capture, including entered text or audio and its associated transcription. Source content is retained as product data until explicit deletion and is never overwritten by a correction or AI interpretation.

**Correction**:
A separate member-authored revision to a transcription or other input representation. A Correction leaves the source content intact and becomes part of the provenance lineage.

**AI interpretation**:
A structured, versioned proposal produced from a Capture, Source content, or Correction. It references the exact input it used, never silently replaces it, and may be rejected without changing durable content. For ordinary Notes, AI interpretation is limited to helpful metadata such as tags and a caption; it does not create a Task, Reminder, or other action. A Direct instruction is the separate path for supported actions.

**Direct instruction**:
A clear Member command that authorizes one supported action, such as “Add task with schedule: buy milk tomorrow” or “Mark task buy milk as completed”. The assistant parses the instruction but does not infer a broader intent. An unclear instruction causes no action and remains available for Member review. Direct instructions are distinct from AI interpretations.

**Provenance**:
The explicit record of source, correction, interpretation, and derivation links that explains how a durable item came to exist.

**Note**:
A durable human-readable item derived from a Capture or its provenance lineage. A Note preserves its source relationships rather than replacing them.

AI may add editable tags and a caption to a Note, but ordinary Note content does not become a Task or Reminder without a Direct instruction or explicit Member action.

In later collaboration phases, a Note may be explicitly shared or exposed through a shared shortcut. Sharing the Note does not automatically expose its Capture, audio, transcription, Correction, or AI interpretation.

**Task**:
An actionable commitment created by a Direct instruction or explicit Member action from a Capture or Note. A Task may have an owner, due information, and private or explicitly shared visibility. Its core information includes its title, details, status, source connection, Plan connection, and optional Reminder. In the first MVP, similar Task-creating Direct instructions or explicit Member actions create separate Tasks; AI does not detect, suggest, merge, or deduplicate them. A Member may explicitly combine Tasks. Later phases may add AI duplicate assistance. A later change to a completed Task creates new follow-up work rather than reopening the completed Task automatically.
_Avoid_: Todo

For the current product scope, Tasks and Notes are private unless explicitly shared in a later collaboration phase. A Task's creator is immutable provenance; its owner is the Member responsible for it and may be explicitly reassigned. A newly created Task is owned by its creator by default. The owner may share the Task with the Private Group or withdraw that sharing. Other Active Members may view a Shared Task and mark it complete or add common information, but they may not rewrite its original data; only the current owner may change its owner or sharing state. Sharing a Task does not expose its private Capture, Source content, Correction, AI interpretation, or other provenance unless those items are shared separately.

**Space**:
A user-defined category in a strict tree that provides the primary organizational place for a Task or Note. A Space may contain direct Tasks and Notes and child Spaces; it is a user-facing context, not a real-world entity or physical storage container.
_Avoid_: Folder, Group, Project when referring to the category tree

**Entity**:
An optional named object that a Member links to Tasks or Notes for later search and alternate views; it is not a node in the Space tree. Initial semantic hints are Person, Place, Organization, and Object, without user-defined schemas in the MVP.
_Avoid_: Project when the intended meaning is a category in the Space tree

**Tag**:
A global, flat, optional marker on a Task or Note used for lightweight cross-cutting classification. A Tag is not a Space or Entity, and Task importance is a separate user-controlled property.

**SuggestedTag / SuggestedEntity**:
A temporary AI proposal that is not a permanent Tag or Entity until the Member accepts it. It appears in `Требует решения`, never blocks creation, and rejection dismisses that proposal without becoming a permanent negative preference.

**Importance**:
A user-controlled Task property describing significance independently of its due time. Importance is not urgency and is not represented as a Tag.

**Shared shortcut**:
An explicit shared reference to a private Task or Note in the system shared Space `Общее`. It points to the original object without exposing its private Space or private organizational metadata.

**Unassigned object**:
A Task or Note whose primary Space is absent. It is shown in a root-level unassigned section, not stored in a deletable system Space.

**Reminder**:
A scheduled notification or trigger attached to a Task or Note. A Reminder is scheduling metadata, not a separate source-content item; it requires a Direct instruction or explicit Member action, and an actionable reminder request produces a Task with a Reminder attached. A Reminder can be fired while its Task remains open.

**Plan**:
An explicit grouping of Tasks and Notes around a goal or time horizon. A Plan organizes related work without becoming the source of that work, and remains active until a Member explicitly completes or archives it. A Member may explicitly make a Note a Plan in the app while the Note remains stored as the Plan's description and source; a so-called subtask is an ordinary Task inside the Plan.

**Related item**:
An explicit, typed relationship between durable items. A Member creates a relationship with a clear action such as “Add this Note to the renovation Plan”; relatedness must not be inferred or added automatically only because content appears similar.

**Needs review**:
A state for captured content, an unclear Direct instruction, or an AI interpretation that needs Member attention. It must remain visible to the Member for correction or acknowledgment. It is not a path for the assistant to guess a Task or Reminder from an ordinary Note.

**Transcription confirmation**:
The point at which a voice recording's transcription is accepted for downstream use. A normal transcription is confirmed automatically after a bounded review window if the Member does not respond; an unusable transcription remains in the failed Review state with its Capture and original audio retained.

**Unusable transcription**:
A result identified as a non-transcription marker rather than a reliable representation of spoken content. It is not used to create a Task or Note; the Capture and original audio remain available to the Member.

**Digest**:
A Member-facing summary of due Tasks, scheduled reminders, and items needing review. New items may appear when they are soon due or in an expandable additional section; an item leaves the digest after the Member actions on or acknowledges it.

**Shared Task**:
A Task whose visibility was explicitly extended to the Private Group. It appears in each Member's digest, particularly when soon due, and any Member may complete it. If its owner leaves, the original owner attribution remains and another Member may complete it; reassignment is explicit.

**Invitation**:
A private, single-use request for a person to authenticate their own identity and join the Private Group. An Invitation expires if it is not accepted within its validity period. All Active Members can see and revoke pending Invitations, and any Active Member can create one.

**Active Member**:
A person whose authenticated identity currently belongs to the Private Group. Active Members have equal product capabilities; the person who created the group does not retain a permanent administrative role.

**Removed Member**:
A person whose membership in the Private Group has ended. Their private content remains theirs and is no longer accessible to the group; content they explicitly shared remains shared. Removing another Member requires unanimous confirmation from every unaffected Active Member, while self-removal is always available.

**Identity recovery**:
The deliberate process by which a Member regains access to their existing identity after losing a device or authentication access. The identity remains stable across devices and recovery. Recovery must not grant support or developers access to private content, silently transfer the identity to another person, or automatically merge it with another identity.

**Device session**:
The revocable authenticated access granted to one device for an existing Member identity. A Member may have multiple device sessions; revoking one does not transfer or merge the Member identity.

**Offline draft**:
Original Member content captured while the client cannot confirm synchronization with the backend. It remains durable and visibly pending or failed until synchronized or explicitly resolved; it is not treated as completed server work.

**Synchronized cache**:
A bounded local copy of previously synchronized data available to the authenticated Member while offline. It may include the Member's private items and explicitly shared Tasks, but must not expose another Member's private data.

**Pending synchronization**:
The explicit client state for an Offline draft or permitted local change that has not yet received server confirmation. Synchronization may retry automatically, but failure must remain visible and must not silently discard the original.

**Archived Private Group**:
A Private Group with no Active Members. It accepts no new Invitations and retains its data until an explicit deletion action; leaving and deleting data are separate actions.
