# Local API notes

SkillPilot listens on `127.0.0.1` by default. Mutating requests are accepted only from the same loopback origin. External API responses are treated as untrusted data and normalized before reaching the UI.

The GitHub discovery implementation follows [GitHub's repository search REST contract](https://docs.github.com/en/rest/search/search#search-repositories). AI classification uses the OpenAI-compatible `POST /v1/chat/completions` shape documented in [Ollama's compatibility reference](https://docs.ollama.com/api/openai-compatibility). Express hardening follows its [official production security guidance](https://expressjs.com/en/advanced/best-practice-security.html).

## Discovery inspection and installation

Discovery installation is a two-phase contract. Inspection never changes the filesystem. Installation is pinned to the immutable commit returned by inspection and repeats the archive validation before writing files.

- `POST /api/discovery/inspections`
  - Input: `{ "repository": "owner/repo", "useAI": true }`
  - Output: repository metadata, immutable `commitSha`, discovered `SKILL.md` roots, bounded archive scan, risk findings and optional AI assessment.
- `POST /api/discovery/recommendations`
  - Input: `{ "query": "medical writing", "repositories": [...] }`, at most eight normalized discovery results.
  - Output: ranked repository IDs with reasons and complementary capabilities. Requires configured AI.
- `POST /api/skill-installations`
  - Input: `{ "repository", "commitSha", "targetAgent", "skillPaths", "acknowledgeRisk" }`.
  - Output: installed paths, tracked source metadata and backup paths. Existing directories are never overwritten unless explicitly requested in a future contract.

Supported `targetAgent` values are `claude`, `codex`, `agents`, `openclaw`, `gemini`, and `cursor`. Repository identifiers, commit SHAs, target values, archive paths, sizes and file counts are validated at the route boundary. GitHub responses and AI output are always treated as untrusted data.

## Application updates

- `GET /api/app-updates/status?force=1` checks the latest published, non-prerelease GitHub Release for `Mxxy111/Skill-Pilot`.
- The response contains current/latest versions, availability, a trusted release page and matching Windows assets.
- The endpoint never downloads or executes an installer. A one-hour in-memory cache avoids unnecessary GitHub API usage; `force=1` is reserved for an explicit user refresh.
- Legacy `GET /api/version` remains as a reduced compatibility view of the same GitHub Release result.

The implementation uses GitHub's versioned REST headers and follows its official [Git tree](https://docs.github.com/en/rest/git/trees#get-a-tree), [commit](https://docs.github.com/en/rest/commits/commits#get-a-commit), and [repository archive](https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-zip) contracts.

No endpoint returns saved AI or GitHub credentials. A settings response uses `hasApiKey` and `hasGithubToken` booleans instead.
