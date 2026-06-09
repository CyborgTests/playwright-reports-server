<!-- cspell:words pwrs -->

# pwrs-cli — setup reference

One-time setup, performed by the user. The model should not need this during normal invocations.

## Persist server + token

```bash
pwrs-cli config set server https://reports.example.com
pwrs-cli config set token <api-token>
```

Saved to `~/.config/pwrs-cli/config.json`.

## Inspect current config

```bash
pwrs-cli config get             # all keys (token is masked)
pwrs-cli config get server      # single key
```

## Or use environment variables (override the saved config)

```bash
export PWRS_SERVER_URL=https://reports.example.com
export PWRS_API_TOKEN=<api-token>
```

## Single-project default

Export `PWRS_PROJECT=<name>` to default `--project` across every command. Explicit `--project` on the command line still wins.

## Verify

```bash
pwrs-cli ping
```

Returns `{ ok, server, tokenConfigured, latencyMs, … }`. If `tokenConfigured: false` and the server requires auth, every other call will 401.
