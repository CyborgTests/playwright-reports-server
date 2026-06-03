# pwrs-cli — setup reference

This is one-time setup, performed by the user. The model should not need this
during normal invocations.

## Persist server + token

```
pwrs-cli config set server https://reports.example.com
pwrs-cli config set token <api-token>
```

Saved to `~/.config/pwrs-cli/config.json`.

## Or use environment variables (override the saved config)

```
export PWRS_SERVER_URL=https://reports.example.com
export PWRS_API_TOKEN=<api-token>
```

## Single-project default

Export `PWRS_PROJECT=<name>` to default `--project` across every command.
Explicit `--project` on the command line still wins.

## Verify

```
pwrs-cli ping
```
Returns `{ ok, server, tokenConfigured, latencyMs, … }`.
