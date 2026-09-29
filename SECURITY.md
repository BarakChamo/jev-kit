# Security

## Reporting a vulnerability

Open a [private security advisory](https://github.com/barakchamo/jev-kit/security/advisories/new) on this
repository. Please don't open a public issue for a vulnerability. Expect an acknowledgement within a week.

In scope: the scripts (`jev-run.mjs`, `jev-audit.mjs`), the audit library, and anything in the skills that would
lead an agent to write an unsafe map.

## What runs, and where data goes

- **Installing runs nothing.** The plugin declares skills only: no hooks, no MCP servers, no install scripts.
- **`jev-run`** sends each case's state to TypeSafe's API or to Vercel AI Gateway, with your key as a bearer token.
  It never logs or writes the key. `--map` and `--derive` import your JavaScript and run it, including under
  `--check`, which makes no network calls but does execute the map.
- **`jev-audit`** reads local files and makes no network calls.

## Verifying a copy

Each release is tagged `v<version>`. `SHA256SUMS` lists the scripts' checksums:

```bash
sha256sum -c SHA256SUMS
```

Installing by name follows the default branch, so a new publish changes the instructions your agent follows.
To pin, clone a tag and install from the folder:

```bash
git clone --depth 1 --branch v0.3.0 https://github.com/barakchamo/jev-kit
(cd jev-kit && sha256sum -c SHA256SUMS)
npx skills add ./jev-kit           # or: /plugin marketplace add ./jev-kit
```

This repository is published from a private research repository by a CI job; commits read "Publish jev-kit
<version> from <source commit>". The audit bundles are built from `audit/src` by `scripts/build-audit.mjs`, and
CI checks they match.

## Using Jev in security decisions

Jev can be one signal in a security control, not the control. See [the security notes](docs/production.md#security).
