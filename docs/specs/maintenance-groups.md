# Full maintenance and custom groups

## Objective

SkillPilot must maintain every enabled local Skill by default without freezing the desktop, and must use user-owned groups instead of AI categories as the primary library organization model.

## Product behavior

- A manual or scheduled AI maintenance run processes all enabled local Skills. Explicitly supplied IDs still limit a manual classification run to that selection.
- `classificationConcurrency` controls only the number of in-flight AI requests. It defaults to 3 and is bounded to 1–8.
- Re-running maintenance updates the existing metadata record for each Skill; it never appends duplicate classifications.
- Existing schema-v1 category metadata is cleared once while migrating to schema v2. No Skill file is modified or deleted.
- A Skill belongs to zero or one custom group. Groups can be created, renamed, deleted, filtered, and enabled or disabled as a unit.
- Deleting a group leaves its Skills intact and ungrouped.
- Group enable/disable applies to local Skills only and reports per-Skill failures without abandoning successful operations.
- Individual enable/disable is available directly in list and card views.

## Data and API

- Database schema v2 adds `groups` and `groupId` metadata.
- `GET/POST /api/groups`, `PATCH/DELETE /api/groups/:id`, and `POST /api/groups/:id/status` provide group management.
- Bulk action `group` assigns selected Skills to a group; `groupId: null` removes the assignment.
- Automation settings replace `classificationBatchSize` with `classificationConcurrency`.

## UI direction

- The library uses a compact group rail: All, Ungrouped, then custom groups with live enabled/total counts.
- Status switches are immediate, keyboard accessible, and optimistic only while the request is pending.
- The selection toolbar provides group assignment, enable, disable, AI refresh, export, and delete.
- AI categories are removed from the library table, cards, dashboard capability panel, and detail header. Groups carry the organizational role.
- Motion is restrained to state transitions, selection, and progress; reduced-motion preferences are respected.

## Verification

- Unit tests prove all eligible Skills are selected, concurrency never exceeds the configured limit, and reruns overwrite metadata.
- Database tests prove v1 migration clears legacy categories and preserves files/other metadata.
- Group tests cover CRUD, assignment, deletion, and partial group status results.
- Full tests, syntax checks, desktop smoke tests, packaged-app smoke tests, and a manual installed-app launch must pass.

## Out of scope

- Nested groups, multi-group membership, cloud synchronization, and editing frontmatter categories inside third-party Skill files.
