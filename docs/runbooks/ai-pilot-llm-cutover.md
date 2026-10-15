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

## Rolling back

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
