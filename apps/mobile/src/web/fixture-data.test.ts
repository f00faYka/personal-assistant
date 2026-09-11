import { describe, expect, test } from "vitest";

import { createBrowserFixtureData, resetBrowserFixtureData } from "./fixture-data";

describe("browser UI fixture", () => {
  test("creates the same structured dataset every time", () => {
    const first = createBrowserFixtureData();
    const second = createBrowserFixtureData();

    expect(first).toEqual(second);
    expect(first.spaces.filter((space) => !space.parentId)).toHaveLength(3);
    expect(first.spaces.some((space) => space.parentId === "space-planning")).toBe(true);
    expect(first.tasks.filter((task) => task.dueAt)).toHaveLength(8);
    expect(first.tasks.filter((task) => task.dueAt?.startsWith("2026-09-15"))).toHaveLength(2);
    expect(first.tasks.some((task) => task.status === "completed")).toBe(true);
    expect(first.tasks.some((task) => !task.dueAt)).toBe(true);
    expect(first.tasks.some((task) => task.tagIds.length > 0 && task.entityIds.length > 0)).toBe(true);
    expect(first.entities.map((entity) => entity.type)).toEqual(expect.arrayContaining(["Person", "Place", "Project", "Organization", "Object"]));
  });

  test("reset recreates fresh data without sharing mutable rows", () => {
    const fixture = createBrowserFixtureData();
    (fixture.tasks[0]!.tagIds as string[]).push("unexpected");

    const reset = resetBrowserFixtureData();
    expect(reset.tasks[0]!.tagIds).not.toContain("unexpected");
    expect(reset).toEqual(createBrowserFixtureData());
  });
});
