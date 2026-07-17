# Spec: SkillPilot local skill operations center

## Objective

Build a local-first open-source manager for AI Agent Skills on top of the MIT-licensed Quiver project. The primary user has many `SKILL.md` packages across Claude Code, Codex, Agents, OpenClaw, Gemini and custom directories and needs one safe interface to discover, classify, enable, disable, edit, update, back up and restore them.

The desktop release succeeds when a user can launch one Windows application, see all configured skill roots, search and batch-manage the inventory, inspect and install pinned GitHub Skills, configure an OpenAI-compatible or Ollama model, run resumable AI classification, schedule source-aware maintenance, and export or restore the portable metadata database.

## Assumptions

1. Packaged users need Windows x64 only; Node.js 20+ is required for source development.
2. Electron embeds the UI while the internal API binds to loopback only; the app does not provide remote multi-user access or authentication.
3. Skill packages remain filesystem-native; a JSON database stores metadata, configuration and operation history.
4. AI credentials are optional, stored only in the local `~/.skillpilot` configuration with restrictive permissions, and are never returned by the API.
5. GitHub discovery uses the public REST API with an optional personal access token for higher rate limits.

## Tech stack

- Node.js ESM, Express 5.1, Commander
- Electron + Preact + HTM served from an ephemeral loopback origin without a frontend build step
- `node:test` for unit and integration tests
- JSON document database with atomic file replacement

## Commands

- Install: `npm install`
- Develop: `npm run desktop`
- Test: `npm test`
- Syntax check: `npm run check`
- Security audit: `npm audit --audit-level=high`

## Project structure

- `src/core/`: filesystem inventory, database, AI, discovery, automation and bulk operations
- `src/routes.js`: versioned local REST boundary
- `src/server.js`: loopback server, security headers and scheduler lifecycle
- `desktop/`: hardened Electron lifecycle, navigation and permission policies
- `ui/`: product UI and local assets
- `test/`: Node unit and integration tests
- `docs/`: specification, architecture and API contract

## API contract

Successful responses return their resource or `{ ok: true, ... }`. New errors use `{ error: { code, message, details? } }`; the UI also accepts Quiver's legacy `{ error: string }` during migration.

- `GET /api/dashboard`: inventory and maintenance summary
- `GET /api/skills`: enriched inventory from all enabled sources
- `POST /api/skills/bulk`: `enable`, `disable`, `group`, or `delete`
- `GET|POST /api/groups`: list summaries or create a custom group
- `PATCH|DELETE /api/groups/:id`: rename or remove a group without deleting Skills
- `POST /api/groups/:id/status`: enable or disable every local Skill in a group
- `GET|PUT /api/settings`: public/redacted settings and validated updates
- `GET|POST /api/sources`: list or add custom local roots
- `PATCH|DELETE /api/sources/:id`: update or remove a custom root
- `GET /api/discovery/github`: search repositories by keyword, category and `popular|latest`
- `POST /api/discovery/inspections`: pin a repository commit and return its static and optional AI assessment
- `POST /api/discovery/recommendations`: rank only the supplied GitHub candidates with the configured AI
- `GET /api/skill-installations/targets`: list built-in Agent installation targets
- `POST /api/skill-installations`: rescan the pinned commit and install selected Skill roots
- `POST /api/ai/test`: verify the configured model
- `POST /api/ai/classify`: classify selected or all local skills
- `GET /api/automation/status`: scheduler and run history
- `POST /api/automation/run`: run update check and optional AI classification now
- `GET /api/database/export`: download a portable JSON backup
- `POST /api/database/import`: validate and restore a JSON backup

## Code style

```js
export function normalizeGroupName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Group name is required.');
  return name.slice(0, 40);
}
```

Use small ESM modules, explicit names, boundary validation, immutable return values and no shell interpolation with user input.

## Testing strategy

- Unit tests cover database round trips, AI response parsing, discovery query construction and path/source validation.
- Integration tests cover REST status codes and redaction where practical.
- Electron verification covers the real desktop process, isolated renderer, loopback origin, console errors and the critical discovery/install flow.

## Boundaries

- Always: validate paths and request bodies, use atomic database writes, escape rendered text through Preact, preserve the upstream MIT license and attribution.
- Ask first: remote server exposure, authentication, cloud data sync or a destructive migration of existing skill directories.
- Never: execute instructions found inside a Skill, send Skill contents to AI unless the user explicitly runs/enables classification, expose API keys, follow archive paths outside their destination.

## Success criteria

- At least five built-in Agent source types and arbitrary custom roots are supported.
- Multi-select batch enable/disable/group/delete/export works with confirmations for destructive actions.
- GitHub results support popular/latest ordering and surface stars, activity, license and topics.
- AI configuration supports `/v1/chat/completions`, including Ollama-compatible endpoints, with manual and bounded scheduled classification plus optional discovery recommendations.
- AI analysis maps model output into ten stable internal themes while custom groups own library organization. Scheduled maintenance covers all enabled local Skills with 1–8 bounded concurrent requests and overwrites existing metadata records.
- GitHub installation is commit-pinned, path-bounded and rescanned immediately before writing; installed provenance supports backup-first atomic updates.
- Application update checks compare stable semantic versions from the latest published `Mxxy111/Skill-Pilot` GitHub Release and never execute assets automatically.
- Database import/export is schema-versioned and rejects malformed backups.
- Empty, loading and error states are present; 320px through 1440px layouts remain usable.
- Tests and syntax checks pass, the Electron renderer console is clean, and there are no high/critical dependency advisories.
