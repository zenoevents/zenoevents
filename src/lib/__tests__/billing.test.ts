import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccess } from "../billing";

test("resolveAccess marks past paid-until dates as locked", () => {
  const access = resolveAccess("2026-08-01", "2026-08-02");
  assert.equal(access.status, "locked");
});

test("resolveAccess treats a paid-until date equal to today as still active", () => {
  const access = resolveAccess("2026-08-02", "2026-08-02");
  assert.equal(access.status, "active");
});

test("resolveAccess keeps a future paid-until date active", () => {
  const access = resolveAccess("2026-08-31", "2026-08-02");
  assert.equal(access.status, "active");
});
