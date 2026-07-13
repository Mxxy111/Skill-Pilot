# Local API notes

SkillPilot listens on `127.0.0.1` by default. Mutating requests are accepted only from the same loopback origin. External API responses are treated as untrusted data and normalized before reaching the UI.

The GitHub discovery implementation follows [GitHub's repository search REST contract](https://docs.github.com/en/rest/search/search#search-repositories). AI classification uses the OpenAI-compatible `POST /v1/chat/completions` shape documented in [Ollama's compatibility reference](https://docs.ollama.com/api/openai-compatibility). Express hardening follows its [official production security guidance](https://expressjs.com/en/advanced/best-practice-security.html).

No endpoint returns saved AI or GitHub credentials. A settings response uses `hasApiKey` and `hasGithubToken` booleans instead.
