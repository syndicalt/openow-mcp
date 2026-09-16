# Bootstrapping a PDI for Open Now

Step-by-step guide to run the Open Now headless stack (kernel + `sn_headless`
scoped app) against a personal developer instance (PDI). Every step is scripted
or documented below; the goal is a working `bun run eval -- --gateway instance`
at the end.

## 0. Prerequisites

- Bun **1.3.14** (`bun --version`; the lockfile is frozen to this version).
- A ServiceNow PDI account with **admin** access and an active instance URL
  (e.g. `https://dev123456.service-now.com`).

## 1. Create the PDI

1. Request a personal developer instance from ServiceNow Developer
   (developer.servicenow.com → "Manage instance" → request new PDI).
2. Note the instance URL (`https://dev<NNNNNN>.service-now.com`), the admin
   username, and the password (for the update-set XML import via curl in §6).
3. Wait for the "Upgrade completed" email before loading the update set.

## 2. Build the app

From the repo root:

```bash
bun install --frozen-lockfile
bun run build:app
```

This emits the packaged scoped app to
`dist/sn_headless/update-set.xml`. If it is missing, re-run `bun run build:app`
— `scripts/export-update-set.sh` and CI both fail loudly (with the same
guidance) when the file is absent.

## 3. Import the update set

Web UI path:

1. Log in to the PDI as admin.
2. Navigate to **System Update Sets → Retrieved Update Sets**.
3. Click **Import Update Set from XML** (or drag the file into the upload zone).
4. Select `dist/sn_headless/update-set.xml` and upload.
5. Open the retrieved "Open Now Headless" update set and click
   **Preview** → confirm no errors → **Commit**.

CLI alternative (same file):

```bash
SNOW_INSTANCE=https://dev123456.service-now.com \
SNOW_USER=admin SNOW_PASSWORD='<your password>' \
bash scripts/export-update-set.sh
```

## 4. Register the OAuth application

The kernel authenticates as the user via OAuth 2.0 Authorization Code + PKCE
(public client, no secret):

1. Navigate to **System OAuth → Application Registry**.
2. Click **New → Create an OAuth application** (Native application).
3. Fill in:
   - **Name**: `open-now`
   - **Grant type**: Authorization Code
   - **OAuth API**: Default
   - **PKCE**: Enabled (check **Use PKCE** / code verifier)
   - **Redirect URL**: `http://localhost:8787/oauth/callback`
4. Save and copy the **Client ID** value (for a native OAuth application this
   is the record's `sys_id`; it is shown on the form).

You do **not** need a client secret — the kernel is a public client and sends
`code_verifier` directly to `/oauth_token.do` (default endpoints:
`/oauth_auth.do` for authorize, `/oauth_token.do` for token).

## 5. Environment configuration

All tooling reads environment variables (never hard-coded secrets):

```bash
export SNOW_INSTANCE=https://dev123456.service-now.com

# OAuth bearer token for API/eval/bench (fallback name: OPEN_NOW_ACCESS_TOKEN).
# Obtain via the kernel OAuth flow (first run opens the authorize URL) or a
# token from /oauth_token.do after exchanging the code.
export SNOW_ACCESS_TOKEN='<access token>'

# Alternative for stdio transport: OPEN_NOW_ACCESS_TOKEN is accepted anywhere
# SNOW_ACCESS_TOKEN is expected.
```

| Variable | Purpose | Used by |
|----------|---------|---------|
| `SNOW_INSTANCE` | instance base URL (no trailing slash) | seed, eval `--gateway instance`, bench, export script |
| `SNOW_ACCESS_TOKEN` | OAuth bearer token | seed, eval, bench |
| `OPEN_NOW_ACCESS_TOKEN` | fallback token name | seed, eval, bench (stdio mode) |
| `SNOW_USER` / `SNOW_PASSWORD` | admin basic auth | `scripts/export-update-set.sh` (curl xmlimport) |

## 6. Seed the skill registry

The `sn_headless` app runs on an empty registry. Seed the catalog (upserts skill
docs; admin-only endpoint):

```bash
bun run seed                    # uses SNOW_INSTANCE + SNOW_ACCESS_TOKEN
bun run seed -- --dry-run       # print count + ids, no HTTP
bun run seed -- --skill sn.me.work
```

Dry runs also work without `SNOW_INSTANCE` set. The import endpoint
(`POST /api/now/sn_headless/import`) upserts by `id + version`; new versions
arrive inactive until reviewed (rollout control).

## 7. Run the evaluation against the instance

```bash
bun run eval -- --gateway instance
```

This replays `tests/fixtures/golden/*.json` (shift briefing, CAB prep, incident
resolve confirm flow, HR-case deny, delete refusal, CI ambiguity, my-work caps)
against the live instance. See `docs/evaluation.md` for the full suite, metrics
definitions, and how to run the mock path (`bun run eval`).

Sanity checks after the run:

- every step except `hr-case-deny` reports `PASS` with a non-denied outcome;
- `sn_headless_run` contains an audit row for every invoked step;
- `bun run eval -- --json` gives machine-readable results.

## 8. Connect an MCP client

The kernel is an MCP server (stdio transport). Minimal
`claude_desktop_config.json` sample:

```json
{
  "mcpServers": {
    "open-now": {
      "command": "bun",
      "args": ["run", "packages/mcp-server/src/bin/open-now.ts", "--transport", "stdio"],
      "env": {
        "SNOW_INSTANCE": "https://dev123456.service-now.com",
        "OPEN_NOW_ACCESS_TOKEN": "<access token>"
      }
    }
  }
}
```

Notes:

- `--transport stdio` is the default; the flag is shown for clarity.
- The kernel exposes four stable tools: `discover`, `describe`,
  `dispatch_readonly`, `dispatch` (see `docs/wire-contract.md`).
- For HTTP transport use `--transport http` (check `packages/mcp-server/src/bin/open-now.ts`
  for the port flag; config defaults to `OPEN_NOW_TRANSPORT`/`OPEN_NOW_PORT`).

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `import failed: HTTP 401` | Token missing/expired — refresh via OAuth or set `SNOW_ACCESS_TOKEN` |
| `import failed: HTTP 403` | Token user lacks `admin`/write on `sn_headless_skill` |
| `describe` returns `available: false` | Registry not seeded — run `bun run seed` |
| `curl xmlimport` returns HTML/garbage | Wrong credentials or missing `sysparm_import_set_url=false` param |
| `bun run eval -- --gateway instance` skips nothing but all steps fail `ok=false` | Instance unreachable from the shell (VPN/network) — `GatewayError` text says so |
