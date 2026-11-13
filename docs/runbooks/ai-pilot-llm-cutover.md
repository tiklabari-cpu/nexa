# Runbook: moving the pilot from the mock AI to a real model and embeddings

Written in tm 283.4 (AI-16). **Nothing here is run by the autonomous loop** and nothing here
needs a secret in a file the repository tracks: the steps are for the owner, on the owner's
machines, with the owner's OpenAI account. Key _names_ appear below; values never do.

The decisions behind it are in [`docs/adr/pilot-llm-embedding-provider.md`](../adr/pilot-llm-embedding-provider.md)
(OpenAI, region `us`, structured JSON output yes, tool calling no — §0, §6a, §11) and the
order of operations for the whole pilot stack is
[`docs/production-checklist.md`](../production-checklist.md) §9. This runbook is the AI-specific
cut-over inside that order: what to do when the pilot stops answering from the mock and starts
spending real tokens.

## When to use it

- The first time `LLM_PROVIDER` / `EMBEDDING_PROVIDER` change from `mock` to `openai`.
- A change of model (`LLM_MODEL`, `LLM_MODEL_FAST`, `EMBEDDING_MODEL`), because every one of the
  steps below depends on the model that is configured.
- Never as a hot fix. If the AI is misbehaving in production, go to **Rolling back** first.

## 0. Before anything else

- [ ] The owner has an OpenAI account that accepts the standard data-processing agreement, and
      the project the key belongs to has a **budget limit**. That limit is the provider-side
      ceiling; the application's caps (step 4) sit under it, not instead of it.
- [ ] The tenant contract carries the cross-border transfer clause (K12). That is a contract
      matter, not a code one, and it is the owner's to confirm — nothing in the product checks it.
- [ ] `SIYAHTUS_REGION`, `LLM_PROVIDER_REGION` and `EMBEDDING_PROVIDER_REGION` are all `us`,
      and both `*_API_BASE_URL` keys are `https://us.api.openai.com/v1`. Region and base URL
      change together, never one alone. The global `api.openai.com` is refused at boot.
- [ ] `LLM_MODEL` answers without a reasoning phase (a reasoning model spends
      `LLM_MAX_OUTPUT_TOKENS` on hidden reasoning and returns no text; the api logs
      `llm.failed` / `no_answer` / `length`). `EMBEDDING_MODEL` stays `text-embedding-3-small`:
      the column is `vector(1536)` and `EMBEDDING_DIMENSIONS` is an assertion, not a setting.
- [ ] Decide `LLM_MODEL_FAST` or leave it unset. Unset means classification, summary, judge and
      cluster-title calls use `LLM_MODEL` (ADR §6a.5). It is a model id, not a secret.

## 1. Measure the retrieval threshold — in the new embedding space

`RETRIEVAL_THRESHOLD` (default `0.25`) was chosen in the mock's space. In OpenAI's space the
cosine distribution is different, so it has to be measured once, **before** real traffic
depends on it. The full procedure — and why it must not run on the pilot host — is
[`docs/production-checklist.md`](../production-checklist.md) §9 → _Measuring `RETRIEVAL_THRESHOLD`_.
In short:

1. In the owner's development checkout, on the pilot's commit, against throwaway development
   stores (`docker compose up -d db redis`), with the five `EMBEDDING_*` names in a mode-600
   file **outside** the repository:

   ```bash
   ( set -a; . <that file>; set +a; pnpm --filter @siyahtus/api measure:knowledge-recall > recall-report.json ); echo "exit $?"
   ```

2. `exit 0` is PASS, `1` is FAIL, `2` is SKIPPED (nothing was measured — not a pass).
3. The JSON's `sweep` says what recall@k and the false-answer count would be at each threshold.
   If it points at a different value, put `RETRIEVAL_THRESHOLD=<value>` (a number in
   `[-1, 1]`; never an empty `RETRIEVAL_THRESHOLD=`, which stops the boot) in the pilot's `.env`.
   It needs an api restart, not a rebuild. Measure again at that value for a PASS.
4. `shred -u` the key file.

What to write down: the model, the threshold you chose, the recall@k and false-answer figures
at that threshold, and the date. The next model change starts from those numbers.

## 2. Re-embed what is already stored

Switching the embedding provider changes the vector space. Vectors written by the mock and
vectors written by `text-embedding-3-small` are **not comparable**, so knowledge stored before
the switch has to be re-embedded (ADR §4.3). A pilot database that starts on `openai` has
nothing to re-embed.

1. From a development checkout, against that database (the images do not ship `tsx`):

   ```bash
   pnpm --filter @siyahtus/api knowledge:reembed --status      # measure only, change nothing
   pnpm --filter @siyahtus/api knowledge:reembed --limit 50    # a slice; run again to go on
   ```

2. The run is safe while the server keeps serving: sources move one at a time, atomically, and
   a question meanwhile searches whatever has already moved.
3. Its cost counts on the **deployment's** daily embedding cap, never on one workspace's. When
   that is full the report says `capped: true`; the sources not yet moved wait for a run after
   00:00 UTC. Exit 1 means a source failed or a workspace was refused; both are left as they
   were and running again retries them.
4. Finish with `--status`: nothing pending.

## 3. Switch the providers

Edit the pilot's `.env` only (never a ticket, a log or a commit):

- `LLM_PROVIDER=openai`, `LLM_API_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_PROVIDER_REGION`
- `EMBEDDING_PROVIDER=openai`, `EMBEDDING_API_BASE_URL`, `EMBEDDING_MODEL`,
  `EMBEDDING_API_KEY`, `EMBEDDING_PROVIDER_REGION`
- optionally `LLM_MODEL_FAST`, `RETRIEVAL_THRESHOLD` (step 1)

Then `docker compose -f docker-compose.pilot.yml up -d api` and watch the first minute of the
api's log: a refusal to boot names the key. `PILOT_MODE=true` in production **will not start**
on `LLM_PROVIDER=mock`, and that is intended.

## 4. Set the caps and the prices

Caps are per workspace per UTC day; the SiyahTuş team raises one for a workspace, a workspace
cannot (AI-16-S2). The order a cap is read in is `workspace override` → `plan default` →
`deployment default`.

- [ ] Deployment defaults, in `.env`: `AI_DAILY_LLM_TOKENS_PER_WORKSPACE` (200 000),
      `AI_DAILY_LLM_TOKENS_GLOBAL` (2 000 000), `AI_DAILY_EMBEDDING_TOKENS_PER_WORKSPACE`
      (2 000 000), `AI_DAILY_EMBEDDING_TOKENS_GLOBAL` (20 000 000). Pick them from the OpenAI
      project's budget limit, not the other way round.
- [ ] Prices, if you want a money estimate on the **AI usage** screen:
      `AI_PRICE_LLM_INPUT_USD_PER_MTOK`, `AI_PRICE_LLM_OUTPUT_USD_PER_MTOK`,
      `AI_PRICE_EMBEDDING_USD_PER_MTOK` — the provider's current list prices. Leave them unset
      and the screen shows tokens only, with no money field at all. They are read at display
      time and never stored; an estimate will not match the invoice (cached input, later price
      changes).
- [ ] The test (simulation) allowance is 20% of the live one and cannot be raised on its own.

## 5. Compliance scenarios to walk through (by hand)

Do each once on the pilot before the sign-up gate opens. Each has an expected result; if it does
not happen, stop and roll back.

1. **Region gate.** Set `LLM_PROVIDER_REGION=eu` with the `us` base URL in a scratch copy of
   `.env` and start the api there: it must refuse to boot with a message naming the mismatch.
   Same for `EMBEDDING_PROVIDER_REGION`. The global `api.openai.com` host must also be refused.
2. **Masking before the model (K12 / AI-26).** As a visitor, send a message containing a card
   number and an e-mail address to a workspace with the AI agent on. The stored transcript shows
   the masked text, and the request OpenAI receives carries the masked text — check this on
   the provider project's request log, not in ours. Nothing sensitive is visible to the model.
3. **A HIPAA-scoped workspace.** With a workspace in HIPAA scope and a provider region that does
   not match the workspace's, a customer question must **not** reach the provider (the AI stays
   silent and the chat goes to a human). With matching regions it answers.
4. **Cap exhaustion.** In a throwaway workspace, ask the platform team to set a tiny override
   (for example 2 000 tokens). Drive it past the cap: the AI goes quiet, the chat goes to a
   human, and the owner receives the **100%** alert exactly once for that meter and day (the
   80% alert before it exactly once, too).
5. **One workspace cannot spend another's allowance.** With two workspaces, exhaust the first.
   The second still gets AI answers.
6. **Invalid structured output.** (Only when something calls with `responseFormat`.) A reply
   that is not valid JSON for the schema is treated as _no answer_: the chat is left to a human
   and the circuit breaker is not tripped.
7. **A visitor cannot read usage.** An agent-role teammate gets neither the **AI usage**
   settings entry nor the numbers (`GET /ai/usage` is a 403 for the role); the performance tab
   shows them no token card.

## 6. Verify on the AI usage screen

Settings › **Usage and quotas** › **AI usage** (owner and admin). After a few real
conversations:

- [ ] Today's bar for _Language model tokens_ and _Embedding tokens_ moves, and the figure is
      in the same order of magnitude as the OpenAI project's own usage page. (A small gap is
      normal: the application counts the provider's `usage`, rounded per request.)
- [ ] The breakdown names the features that spent them (AI agent, Knowledge indexing, …).
- [ ] If prices are set, an _Estimated cost today_ figure appears, labelled as an estimate; if
      they are not, there is no money anywhere on the screen.
- [ ] The screen says the day is UTC and when the allowance renews.
- [ ] The owner can pick who else is warned at 80% and 100%. Save, reload, the choice stays.
- [ ] The AI performance tab shows the same token and cost figures for an owner or admin.

## Moving the model to Claude (Anthropic)

Added in tm 479 (K51, ADR §13). Claude replaces only the **chat** model: Anthropic has no
embedding endpoint, so `EMBEDDING_PROVIDER` stays `openai` (or `mock` — and on `mock` the
knowledge base answers much worse: it matches words, not meaning). Nothing in steps 1–2 changes
when only the chat model moves; the embedding space is the same.

- [ ] An Anthropic account with a key and a **spend limit** on its workspace (the provider-side
      ceiling, as in step 0). The key goes in the pilot's `.env` only.
- [ ] The region. Anthropic pins inference per request with `inference_geo`, and only to the
      US: `LLM_PROVIDER_REGION=us` sends `inference_geo: us` on every call (priced at 1.1× the
      list rate — put that in `AI_PRICE_LLM_*`). There is **no EU pin**: production refuses
      `LLM_PROVIDER_REGION=eu` with `LLM_PROVIDER=anthropic`, and under `PILOT_MODE=true` the
      region must equal `SIYAHTUS_REGION`, so an EU pilot cannot use Claude.
- [ ] The env lines (names only; the owner picks the models):

  ```
  LLM_PROVIDER=anthropic
  LLM_PROVIDER_REGION=us
  LLM_MODEL=claude-opus-5-5          # example — the owner chooses
  LLM_MODEL_FAST=claude-haiku-5-5    # example — classifying and summarising calls
  LLM_API_KEY=<from Anthropic>
  # LLM_API_BASE_URL unset → https://api.anthropic.com (the only host production accepts;
  #   a value ending in /v1 is refused — the SDK adds /v1/messages itself)
  # LLM_EFFORT=low                   # low | medium | high — how hard Claude thinks; unset = low
  # LLM_ANTHROPIC_FALLBACK=true      # a request Claude's safety classifier declines is re-run
  #                                  #   on Anthropic's recommended fallback model; unset = true
  ```

- [ ] `LLM_MAX_OUTPUT_TOKENS`. Current Claude models always think before they answer, and the
      thinking counts against this limit. The default (400) can run out before any text on a
      hard question; the api then logs `llm.failed` / `no_answer` / `length` with a hint that
      names `LLM_MAX_OUTPUT_TOKENS` and `LLM_EFFORT`. Start at 1024 and watch for that line.
      Calls with their own small ceiling (question kind: 20 tokens, cluster titles: 120) are
      the first to show it.
- [ ] Restart the api as in step 3. A refusal to boot names the key. Four refusals only Claude
      has: an `LLM_EFFORT` that is not low, medium or high; an `LLM_ANTHROPIC_FALLBACK` that is
      not true or false; a base URL that is not Anthropic's API host; and region `eu`.
- [ ] Or from the root panel (Settings › AI › Model): provider "Anthropic (Claude)", leave the
      base URL empty, model, region US, key. "Test the connection" sends one small request.
- [ ] Watch the log: `llm.completed` per call; `llm.fallback_served` with `servedModel` when a
      declined request was answered by the fallback model; `llm.inference_geo_mismatch` if a
      reply does not report `us` — that one is a residency question, raise it with Anthropic.

Rolling back from Claude is a provider switch like any other: the previous `LLM_*` lines (or
the panel's previous row) and a restart. Nothing stored depends on the chat model.

## Moving the model to DeepSeek or Kimi (Moonshot)

Added in tm 480 (K51, ADR §14). Like Claude, either replaces only the **chat** model:
`EMBEDDING_PROVIDER` stays `openai` (or `mock`, which answers knowledge questions much worse),
independent of the chat provider. Steps 1–2 do not change.

**Where the data goes — read this first.** DeepSeek processes and stores data in the People's
Republic of China; Kimi's international platform (Moonshot AI Pte. Ltd.) in Singapore. Both are
outside the US and the EU, and no region can be declared for them. So:

- [ ] Every workspace **covered by a BAA** (HIPAA scope) gets no AI while either is the
      provider: each AI request is refused with 403 `not_allowed` and an audit entry
      `compliance.ai_region_blocked` (`provider_region: outside`). Workspaces without a BAA
      keep their AI. Check the covered workspaces before switching.
- [ ] The privacy policy's list of sub-processors has to name the provider and the country —
      that is the owner's legal step, not code (ADR §14.2 has the sources).
- [ ] The root panel says nothing about the data location (the owner's decision); this runbook
      and ADR §14 are where it is written down.

The checklist:

- [ ] An account on the vendor's platform with a key and a balance or spend limit. DeepSeek is
      prepaid: an exhausted balance answers 402, which the api treats as permanent
      (`quota_exhausted`, no retry). Kimi answers `exceeded_current_quota_error` the same way.
      Keys are per platform: a key from Kimi's China platform (`api.moonshot.cn`) does not work
      on the international one, and production accepts only `api.moonshot.ai`.
- [ ] The env lines (names only; the owner picks the models). **No `LLM_PROVIDER_REGION`:**
      production refuses one for these two providers.

  ```
  LLM_PROVIDER=deepseek              # or moonshot (Kimi)
  LLM_MODEL=<model id>               # e.g. a DeepSeek or Kimi model the owner chooses
  # LLM_MODEL_FAST=<model id>        # classifying and summarising calls; unset = LLM_MODEL
  LLM_API_KEY=<from the vendor>
  # LLM_API_BASE_URL unset → https://api.deepseek.com (no /v1) or https://api.moonshot.ai/v1,
  #   the only host production accepts for each
  ```

- [ ] Reasoning. Choose a model that answers without long reasoning where the vendor offers
      one. DeepSeek's current models think by default; the adapter switches that off on every
      request (`thinking: disabled`). Kimi's K3 models always reason; the adapter asks for the
      least (`reasoning_effort: low`), and the reasoning still counts against
      `LLM_MAX_OUTPUT_TOKENS`. On Kimi, start at 1024 and watch for `llm.failed` /
      `no_answer` / `length` with the hint that names `LLM_MAX_OUTPUT_TOKENS`.
- [ ] Structured output (the AI features that ask for JSON — understanding, knowledge answers,
      question kinds, guidance checks, cluster titles). DeepSeek has JSON mode only: the schema
      travels in the prompt and every reply is validated, an invalid one retried once. Kimi
      gets `json_schema` first; a model that refuses it is logged once as
      `llm.json_schema_unsupported` and moved to JSON mode for the life of the process.
- [ ] Restart the api as in step 3. A refusal to boot names the key; the ones only these two
      have: `LLM_PROVIDER_REGION` set, and a base URL that is not the vendor's API host.
- [ ] Or from the root panel (Settings › AI › Model): provider "DeepSeek" or "Kimi (Moonshot)",
      leave the base URL empty, model, key — there is no region field for them. "Test the
      connection" sends one small request.
- [ ] Watch the log: `llm.completed` per call; `llm.retry` on 429 / 5xx; DeepSeek's
      `insufficient_system_resource` finish is retried as an outage.

Rolling back is a provider switch like any other; nothing stored depends on the chat model.

## Choosing the chat provider

Added in tm 481 (K51). Four providers can write the AI's text; one is chosen per deployment by
`LLM_PROVIDER`, or from the root panel. The embedding provider is a separate choice and does not
follow it (see the last column).

| `LLM_PROVIDER` | Env the owner sets                                                                               | Base URL when `LLM_API_BASE_URL` is unset             | Region rule                                                                                               | BAA-covered workspaces                        | Embedding                                                     |
| -------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `openai`       | `LLM_API_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_PROVIDER_REGION`, optional `LLM_MODEL_FAST` | none: the base URL is required                        | `us` or `eu` with the matching regional host (`https://us.api.openai.com/v1`); the global host is refused | allowed when the region matches the workspace | `EMBEDDING_PROVIDER=openai` (or `mock`)                       |
| `anthropic`    | `LLM_MODEL`, `LLM_API_KEY`, `LLM_PROVIDER_REGION`, optional `LLM_MODEL_FAST`, `LLM_EFFORT`       | `https://api.anthropic.com`                           | `us` only (`inference_geo: us`, 1.1× the list price); `eu` is refused in production                       | allowed in `us`                               | stays `openai` or `mock`: Anthropic has no embedding endpoint |
| `deepseek`     | `LLM_MODEL`, `LLM_API_KEY`, optional `LLM_MODEL_FAST`                                            | `https://api.deepseek.com` (no `/v1`)                 | none: processed outside the US and EU; `LLM_PROVIDER_REGION` is refused in production                     | refused: 403 `not_allowed`, `provider_region` | stays `openai` or `mock`                                      |
| `moonshot`     | `LLM_MODEL`, `LLM_API_KEY`, optional `LLM_MODEL_FAST`                                            | `https://api.moonshot.ai/v1` (international platform) | none: processed outside the US and EU (Singapore); `LLM_PROVIDER_REGION` is refused in production         | refused: 403 `not_allowed`, `provider_region` | stays `openai` or `mock`                                      |

The model ids are the owner's to choose in the vendor's console; none is written in code or in
this table. The sections above say what to look for in each (reasoning, output ceiling,
structured output). `LLM_MODEL_FAST` is optional on all four: unset, every call uses `LLM_MODEL`.
A chat provider other than `openai` with `EMBEDDING_PROVIDER=openai` is a supported pair: two
accounts, two keys (`LLM_API_KEY` and `EMBEDDING_API_KEY`), and the knowledge base keeps its
vectors.

**BAA.** A workspace covered by a BAA (HIPAA scope) is served only when the model's region is the
workspace's own. `deepseek` and `moonshot` have no region to match, so with either selected those
workspaces get no AI at all (the audit entry is `compliance.ai_region_blocked`); everyone else
keeps theirs. Look at which workspaces are covered before switching.

### Changing the provider

- **From the env** (the pilot's `.env`, then `docker compose -f docker-compose.pilot.yml up -d api`):
  edit `LLM_*` as in the table. A refusal to boot names the variable, never its value.
- **From the root panel** (Settings › AI › Model): pick the provider, model and key and save. The
  provider is rebuilt in the running api — no restart. "Test the connection" sends one small
  request. The panel's values win over the env while they are set; to go back to the env's,
  choose "env" in the panel.
- Either way, run the smoke below **before** pointing customers at it. The smoke reads the
  **env**, not the panel's stored settings; to try what the panel holds, use its "Test the
  connection".

### Checking a provider with your own key: `llm:smoke`

The code was tested against fake servers only. A real key is the owner's, so this is the one
command that finds out whether the vendor accepts what the adapter sends. It builds the provider
from the environment exactly as the api does and makes three small calls: a short Turkish
question (plain text), a small schema through the structured-output path every AI feature uses,
and the plain question again on the `fast` tier. It costs a few hundred tokens.

On the pilot host (the api image has the script; the key comes from the pilot's `.env`, nothing is
typed on the command line and nothing is written to a file):

```
docker compose -f docker-compose.pilot.yml run --rm --no-deps api node dist/scripts/llm-smoke.js
```

In a checkout, with the root `.env` holding the `LLM_*` lines (the compiled `node dist/scripts/llm-smoke.js` works only inside the image, where the workspace packages are built too):

```
pnpm --filter @siyahtus/api llm:smoke
```

It prints one JSON line per call (provider, model, tier, `ms`, `inputTokens`, `outputTokens`,
`chars`, `state`; a failure adds `status`, vendor `code`, `requestId`, `hint`) and a last line
`llm:smoke PASSED 3/3` or `FAILED n/3`. It never prints the key, the prompt or the reply — only
the reply's length — and it replaces the value of any variable named `*KEY`, `*SECRET`, `*TOKEN`
or `*PASSWORD` in whatever it prints. Pasting the output into a ticket is safe.

| Exit | Meaning                                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | All three calls answered.                                                                                                                                                             |
| 1    | At least one failed. Read its `state`: `auth` (wrong key or platform), `quota_exhausted`, `no_answer:length` (see the hint), `no_answer:refusal`, `no_answer:schema`, `rate_limited`. |
| 2    | Not configured; nothing was sent: the env is invalid, `LLM_PROVIDER` is `mock`, or the model or key is missing.                                                                       |

What to look at on the first real run:

- `no_answer:length` on Kimi or Claude: raise `LLM_MAX_OUTPUT_TOKENS` (start at 1024), run again.
- DeepSeek: that `thinking: disabled` is accepted (the call passes and `outputTokens` is small).
- Kimi: the line `events: llm.json_schema_unsupported` means the model does not take
  `json_schema`; the adapter moved to JSON mode and the structured call still passes.
- `inputTokens` and `outputTokens` against the vendor's usage page: they should match to within
  the cached-input difference.

## Rolling back

- **A provider switch is the rollback.** Nothing stored depends on the chat model: put the
  previous `LLM_*` lines back (or the panel's previous row) and restart the api (env) or save
  (panel). No rebuild, no migration. `LLM_PROVIDER=mock` is the rollback for a deployment that
  is not in pilot mode (development, staging); under `PILOT_MODE=true` in production the api
  will not boot on it, so there the way back is the previous real provider.
- **The AI is wrong or too expensive:** the pilot cannot fall back to the mock — `PILOT_MODE=true`
  in production will not boot on `LLM_PROVIDER=mock`. Lower a cap (step 4), or switch the
  workspace's AI agent off in its own settings, and fix the cause before turning it back on.
- **Retrieval is returning nothing, or wrong passages:** the threshold. Raise or lower
  `RETRIEVAL_THRESHOLD` per the sweep from step 1 and restart the api; no rebuild.
- **Knowledge was re-embedded and the provider is switched back:** run
  `knowledge:reembed` again under the provider now configured; the stored vectors follow it.
- **Spend is running away:** the provider's project budget limit is the hard stop. Lower it in
  the OpenAI dashboard; the application's caps take effect at the next call.

## What this runbook does not do

It does not provision accounts, put keys on the host, or open sign-up; those are the owner's
and the checklist's. It does not describe the root (platform) panel's AI settings — tm 389 owns
those. And it was written, not rehearsed: no step in it has been run against OpenAI.
