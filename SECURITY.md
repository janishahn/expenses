# Security Policy

## Reporting Vulnerabilities

Please do not report suspected vulnerabilities through public issues. Instead, use GitHub's private vulnerability reporting on this repository.

To help triage a report quickly, include enough detail to reproduce the issue, along with:

- The affected version or commit.
- The deployment shape (Docker or bare metal) and how the instance is exposed (tailnet, reverse proxy, or public domain).
- Whether the affected instance is reachable from the public internet.

This is a small noncommercial project maintained on a best-effort basis. Reports are reviewed as time allows, and there is no formal service-level agreement for response or remediation.

## Deployment Threat Model

This app is designed for private self-hosting on hardware you control, such as Raspberry Pi-class hardware, a Mac mini, or a small VPS. Treat the SQLite database, receipt files, generated CSRF secret, logs, and backups as sensitive personal financial data.

The web app and the API share a single origin: one process serves the React SPA and every `/api/*` endpoint on one host and port. Any front door you place in front of that origin exposes the full API surface — the web session, the mobile bearer sessions (`/api/mobile/*`), and ingest (`/api/ingest`). There is no per-endpoint port split, so transport-level access control plus the app's own authentication are the boundaries that matter.

Recommended baseline:

- Prefer a single Tailscale tailnet for the host and all devices, and serve HTTPS over the tailnet with `tailscale serve`. This keeps the app off the public internet, provides a valid certificate without manual management, and is the recommended setup (see `README.md`, "Serving & Access").
- Put the app behind HTTPS before exposing it outside localhost or a private network. The app speaks plain HTTP and expects TLS to be terminated by a trusted local reverse proxy or tunnel that forwards `X-Forwarded-Proto`; keep `--forwarded-allow-ips` scoped to that local proxy.
- If you expose the web app on a public domain, remember that the same origin also exposes `/api/ingest` and `/api/mobile/*`. Consider putting an SSO/identity gate in front of the public door, or restricting the public reverse-proxy host to the web app and blocking the device/ingest endpoints there, while devices continue to reach them over the tailnet.
- Treat the ingest token as a secret with write access to your ledger: mint it per user, prefer carrying it only over the tailnet, and rotate or revoke it from Settings if it may have leaked.
- Keep `EXPENSES_LLM_ENABLED=false` unless you have intentionally configured a trusted OpenAI-compatible endpoint.
- Persist and back up the data directory, including `expenses.db`, `receipts/`, and `secrets/csrf_secret`.
- Do not commit `.env`, `data/`, logs, database backups, receipt files, or generated secrets.
- Keep host packages, Python dependencies, npm dependencies, and Docker base images updated.

## Supported Versions

Only the current `main` branch is supported. Fixes land on `main`, and self-hosted operators are expected to track it. Older commits and tags do not receive separate backported security fixes.
