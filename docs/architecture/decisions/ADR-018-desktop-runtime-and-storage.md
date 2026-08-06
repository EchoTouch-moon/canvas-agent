# ADR-018: Electron runtime, SQLite state and isolated Worker host

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

Canvas Agent needs deep local Git, filesystem, process and Agent CLI integration while presenting a React desktop workbench. The MVP team is two AI implementers on separate computers and should share one primary implementation language.

## Options considered

1. Tauri + Rust service: smallest distribution and strong capability model, but introduces a second language across the domain and Worker prototype before product risk is validated.
2. Web UI + standalone local service: clean separation, but adds service discovery, ports, lifecycle and browser security/packaging questions to the first prototype.
3. Electron + isolated processes: larger binary, but gives the fastest single-language path to Git, SQLite, Agent CLI and a mature React desktop UI.

## Decision

Choose Electron + React + TypeScript for the MVP. Use a sandboxed renderer, narrow preload API, privileged main process, and a separate Utility Process worker host. Use SQLite for durable application state and a SHA-256-addressed local directory for Blob content.

## Consequences

- The team can share contracts and types in TypeScript.
- Native desktop integrations are straightforward.
- Electron security hardening is a release gate, not optional polish.
- Distribution size is accepted for MVP validation.
- A future Tauri or local-service shell remains possible because domain and contracts do not import Electron.

## Revisit when

- memory or distribution size blocks adoption;
- Worker isolation requires a stronger OS sandbox;
- a browser client becomes a core requirement;
- the service must run without a desktop UI.
