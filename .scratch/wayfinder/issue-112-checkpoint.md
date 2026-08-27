# Issue 112 checkpoint: hierarchical organization for Tasks and Notes

This checkpoint records the agreed resolution of issue 112.

## Current direction

Personal Assistant remains a fast, advanced todo list with a user-defined tree of Spaces. The model should stay small and understandable rather than becoming a general knowledge-base or database builder.

## Agreed model

- `Space` is a user-defined category in a strict tree. Each Space has one parent; top-level Spaces can be multiple. Spaces may contain both Tasks and Notes and may have child Spaces.
- A Space page defaults to an hierarchical view: direct Tasks/Notes plus child Spaces. A flat toggle shows all Tasks/Notes in the subtree with their full paths.
- Each Task/Note has one primary Space or no Space. Objects without a Space are shown at the root as an unassigned section, not as a deletable system Space.
- Renaming or moving a Space changes the displayed path only. Existing Task/Note IDs and their primary Space relationships remain stable.
- Non-empty Spaces are archived as whole subtrees and can be restored. Empty Spaces may be deleted.
- `Entity` is an optional named object linked to Tasks/Notes, not a node in the Space tree. Initial types: `Person`, `Place`, `Organization`, and `Object`.
- Entities do not need a Space of their own. They are found through their own section, search, and linked Tasks/Notes.
- `Tag` is a global, flat, optional marker. Importance is a Task property controlled by the Member, not a Tag. There is no urgency Tag.
- Existing Tags and Entities may be linked automatically at high confidence. The agent may create temporary SuggestedTags/SuggestedEntities for review; it never creates permanent Tags/Entities or Spaces without the user's decision. Suggestions do not block Task creation.
- Suggestions, conflicts, and uncertain classification appear in `Требует решения`. Rejecting a suggestion dismisses that proposal but is not a permanent user preference; the same idea may be suggested again later if the context or request changes. A technical event may prevent an immediate duplicate and support audit/cleanup.
- The agent receives the Space tree, full paths, names, descriptions/examples, existing Tags, and existing Entities/aliases. MVP routing uses ordinary candidate search; semantic/vector search is a later fallback.
- High confidence may apply an existing Space/Tag/Entity; medium confidence produces a suggestion; low confidence leaves the object without a Space and offers candidates. The agent does not silently create Spaces.
- User corrections may improve future routing, but old Tasks/Notes are never automatically reclassified.

## Sharing direction (post-MVP collaboration)

- Personal Space trees, Entities, and Tags are private by default.
- `Общее` is an undeletable system shared Space.
- It can contain independent Shared Tasks/Notes and shortcuts to private Tasks/Notes.
- A shortcut points to the original object rather than duplicating it. The original private Space remains hidden.
- Only the owner controls sharing and removes a shortcut. Other Members can add common information and mark a Shared Task complete, but cannot rewrite the original data.
- Shared Tasks/Notes do not automatically expose private Spaces, Entities, Tags, Capture, audio, transcription, corrections, or AI interpretation.
- Voice editing of Spaces, Entities, and Tags is deferred to separate grilling ticket [#115](https://github.com/f00faYka/personal-assistant/issues/115).

## Deferred

- Detailed semantic/vector retrieval.
- User-defined Entity types and custom Entity fields.
- Space merging and bulk operations.
- Voice editing.
- Collaboration implementation and detailed shared permissions.
- Automatic reclassification of existing objects.

## MVP use-case boundary

- Create, rename, move, archive, restore, and delete empty Spaces; archive non-empty subtrees rather than deleting them.
- Create Tasks/Notes from the root or current Space; organize them manually or through agent proposals.
- Create/link Entities and Tags from Task/Note surfaces; review temporary suggestions separately.
- Search and filter by content, Space subtree, Entity, and Tag.
- Convert Note to Task while inheriting Space, Entities, and Tags, with later editing available.
- Record routing proposals, confidence bands, model/rules version, and Member outcomes for statistics and debugging.

## Handoff constraints

- Implementation should preserve stable IDs, explicit typed operations, append-only provenance, and confirmation boundaries so voice editing can later use the same application operations rather than a separate data model.
- Voice editing, sharing, semantic/vector retrieval, custom Entity schemas, Space merge, and bulk operations remain separate future work.
