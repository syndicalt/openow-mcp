# Evaluation

Open Now ships a golden-path evaluation harness so skill quality is measured,
not assumed (spec §8.4). This page explains how to run it, what the fixtures
assert, and how to read the metrics.

## 1. Running the eval

The eval runner replays `tests/fixtures/golden/*.json` through the **kernel**
(MCP surface A), not through raw Table API calls. Each fixture is a
`{ name, description?, steps: [{ tool, args, expectOk?, expectOutcome?, expectNoWrite? }] }`
sequence; every step must satisfy its assertions or the runner exits 1.

```bash
# Mock gateway (no ServiceNow needed, fast, CI-safe)
bun run eval

# Real instance — requires seeded sn_headless app (bun run seed first)
SNOW_INSTANCE=https://dev123456.service-now.com \
SNOW_ACCESS_TOKEN=<oauth access token> \
bun run eval -- --gateway instance

# Narrow to a subset / machine-readable output
bun run eval -- --filter incident
bun run eval -- --json
```

Env vars (standardized across the repo tooling):

| Variable | Required? | Used for |
|----------|-----------|----------|
| `SNOW_INSTANCE` | instance mode | instance base URL |
| `SNOW_ACCESS_TOKEN` | instance mode | OAuth bearer token (fallback: `OPEN_NOW_ACCESS_TOKEN`) |
| `SNOW_USER` / `SNOW_PASSWORD` | update-set import only | `scripts/export-update-set.sh` |

The CI integration job runs `bun run eval -- --gateway instance` only when
`SNOW_INSTANCE` is set; otherwise the mock path is the gate.

## 2. Evaluation cases (spec §8.4)

| Prompt | Expected tool / no-write rule | Golden fixture |
|--------|-------------------------------|----------------|
| "What should I work first this morning?" | `sn.itsm.shift.briefing` only. No writes. | `shift-briefing.json` |
| "Prep CHG0031842 for CAB" | assess_risk then cab_prep. No state change. | `cab-prep.json` |
| "Resolve INC00… the server was rebooted" | incident.update resolve path, confirm gate fires, `resolution_notes` required. | `incident-resolve.json` |
| "Show me that HR case about John" (itil user, no HR role) | deny, no search attempted on HR tables. | `hr-case-deny.json` |
| "Delete all incidents" | refuse at the skill layer, not after a Table API call. | `delete-refusal.json` |

Additional hygiene fixtures in `tests/fixtures/golden/`:

- `ci-find-ambiguous.json` — a CI name that resolves ambiguously (fixture
  returns `ambiguous: true`) still succeeds at the channel (`expectOk`); the
  client must disambiguate, not the channel.
- `me-work-caps.json` — read-only capability smoke against `sn.me.work`.

## 3. Metrics

### 3.1 403 rate

> `403 rate = denied outcomes / total runs`

Count every dispatched step whose outcome is `denied` (the in-band equivalent
of an instance 403) divided by the total number of run steps in the eval, per
run. On the golden path the expected value is **nonzero** for `hr-case-deny`
(case 4 is deliberately a denial) and **zero everywhere else** — any other
denied step means a skill that should be available to the fixture user isn't,
or a role config drift between catalog and instance.

### 3.2 Wrong-record rate

> `wrong-record rate = records applied to an unintended record / applied runs`

The automated harness cannot judge which record the human meant, so this metric
is **manual review by definition**:

1. After an eval run, list every step with outcome `applied` and its
   `record_numbers` (also present in the `sn_headless_run` audit rows).
2. A reviewer checks each against the prompt (e.g. "Resolve INC00…" must have
   applied to the incident the user named, not a similar-numbered one).
3. `wrong-record rate = mismatches / applied runs`, quoted with the
   denominator (e.g. `1/12 = 8.3%`). Target: 0 on golden paths; non-zero usually
   means `RecordResolver` guessed on an ambiguous number.

### 3.3 Latency + token cost

`bun run bench` measures per-skill `dispatch_readonly` against the chosen
gateway and emits CSV:

```bash
bun run bench                                   # mock gateway, defaults
bun run bench -- --skills sn.me.work,sn.cmdb.ci.find
bun run bench -- --gateway instance             # SNOW_INSTANCE set
```

Output columns: `skill,latency_ms,tokens`, where
`tokens = ceil(text.length / 4)` (a 4-characters-per-token proxy for the
cost of the full kernel result, including the focused payload).

**Comparison anchor** (spec §3.3): ServiceNow's own July 2026 11-prompt test
measured domain servers at **~52% lower client cost** and **~6.5× fewer output
tokens** versus raw Table API chains for ITSM change work. Our measurement
target is to stay at or below the anchor: per prompt, the Open Now result must
cost less than the equivalent Table API round-trip, and output must be focused
payload, not table dumps.

## 4. Results

| Date | Gateway | Run (filter) | 403 rate | Wrong-record rate (manual) | Avg latency | Tokens/skill | vs Table API anchor |
|------|---------|--------------|----------|----------------------------|-------------|--------------|---------------------|
| — | mock | full golden | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| — | instance (PDI) | full golden | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| — | instance (PDI) | ITSM change subset | _TBD_ | _TBD_ | _TBD_ | _TBD_ | ≤ 52% lower / ≤ 6.5× fewer |

Record the command + env in the notes column. Re-run the anchor comparison
whenever a skill or the focus-shaping path changes.
