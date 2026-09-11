export interface BrowserFixtureSpace { readonly id: string; readonly name: string; readonly parentId?: string; }
export interface BrowserFixtureEntity { readonly id: string; readonly name: string; readonly type: "Person" | "Place" | "Organization" | "Object"; }
export interface BrowserFixtureTag { readonly id: string; readonly name: string; }
export interface BrowserFixtureTask { readonly id: string; readonly title: string; readonly dueAt?: string; readonly status: "open" | "completed"; readonly spaceId?: string; readonly tagIds: readonly string[]; readonly entityIds: readonly string[]; }
export interface BrowserFixtureNote { readonly id: string; readonly content: string; readonly reviewState: "none" | "needs_review"; readonly spaceId?: string; readonly tagIds: readonly string[]; readonly entityIds: readonly string[]; }
export interface BrowserFixtureData { readonly memberId: string; readonly spaces: readonly BrowserFixtureSpace[]; readonly entities: readonly BrowserFixtureEntity[]; readonly tags: readonly BrowserFixtureTag[]; readonly tasks: readonly BrowserFixtureTask[]; readonly notes: readonly BrowserFixtureNote[]; }

const seed: BrowserFixtureData = {
  memberId: "fixture-member",
  spaces: [
    { id: "space-home", name: "Home" }, { id: "space-health", name: "Health", parentId: "space-home" }, { id: "space-finance", name: "Finances", parentId: "space-home" },
    { id: "space-work", name: "Work" }, { id: "space-planning", name: "Planning", parentId: "space-work" }, { id: "space-launch", name: "Launch week", parentId: "space-planning" }, { id: "space-travel", name: "Travel" },
  ],
  entities: [{ id: "entity-alex", name: "Alex", type: "Person" }, { id: "entity-dentist", name: "Oak Street Dental", type: "Organization" }, { id: "entity-studio", name: "Home studio", type: "Place" }, { id: "entity-passport", name: "Passport", type: "Object" }],
  tags: [{ id: "tag-urgent", name: "urgent" }, { id: "tag-errand", name: "errand" }, { id: "tag-planning", name: "planning" }, { id: "tag-waiting", name: "waiting" }],
  tasks: [
    { id: "task-01", title: "Book dentist appointment", dueAt: "2026-09-15T09:30:00.000Z", status: "open", spaceId: "space-health", tagIds: ["tag-errand", "tag-urgent"], entityIds: ["entity-dentist"] },
    { id: "task-02", title: "Prepare Q2 planning", dueAt: "2026-09-16T13:00:00.000Z", status: "open", spaceId: "space-planning", tagIds: ["tag-planning"], entityIds: ["entity-alex"] },
    { id: "task-03", title: "Send project update", dueAt: "2026-09-18T16:00:00.000Z", status: "open", spaceId: "space-launch", tagIds: ["tag-waiting", "tag-planning"], entityIds: ["entity-alex"] },
    { id: "task-04", title: "Pack passport and adapters", dueAt: "2026-09-22T18:00:00.000Z", status: "open", spaceId: "space-travel", tagIds: ["tag-errand"], entityIds: ["entity-passport"] },
    { id: "task-05", title: "Buy studio cable", dueAt: "2026-09-26T11:00:00.000Z", status: "open", spaceId: "space-home", tagIds: ["tag-errand"], entityIds: ["entity-studio"] },
    { id: "task-06", title: "Review launch checklist", dueAt: "2026-10-01T10:00:00.000Z", status: "open", spaceId: "space-launch", tagIds: ["tag-planning", "tag-urgent"], entityIds: [] },
    { id: "task-07", title: "Confirm hotel booking", dueAt: "2026-10-04T14:00:00.000Z", status: "completed", spaceId: "space-travel", tagIds: ["tag-waiting"], entityIds: [] },
    { id: "task-08", title: "Clean up receipts", status: "open", spaceId: "space-finance", tagIds: [], entityIds: [] },
    { id: "task-09", title: "Plan October studio session", dueAt: "2026-10-12T15:00:00.000Z", status: "open", spaceId: "space-home", tagIds: ["tag-planning"], entityIds: ["entity-studio"] },
  ],
  notes: [{ id: "note-01", content: "Ask Alex about the launch hand-off", reviewState: "needs_review", spaceId: "space-launch", tagIds: ["tag-waiting"], entityIds: ["entity-alex"] }, { id: "note-02", content: "Ideas for making the studio calmer", reviewState: "none", spaceId: "space-home", tagIds: [], entityIds: ["entity-studio"] }],
};

/** Return a fresh deterministic fixture so preview state can never mutate the seed. */
export function createBrowserFixtureData(): BrowserFixtureData { return structuredClone(seed); }
/** Reset is intentionally the same safe operation as creating a fixture. */
export const resetBrowserFixtureData = createBrowserFixtureData;
