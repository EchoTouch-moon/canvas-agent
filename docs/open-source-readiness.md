# Open-source readiness checklist

This checklist covers repository publication and project governance. It does not authorize new product features or external distribution.

## Repository contents

- [x] Select Apache-2.0 and add the corresponding `LICENSE` file.
- [ ] Review the full Git history for credentials, tokens, private URLs, personal data and machine-specific paths.
- [x] Exclude maintainer-only planning material (`AGENTS.md`, `notes.md`, `task_plan.md` and the Chinese architecture prompt) from the public tree.
- [ ] Review committed screenshots, transcripts, fixtures and reports for personal or environment-specific data.
- [ ] Confirm all dependencies, fonts, icons, fixtures and copied text have compatible licenses or clear provenance.

## GitHub settings

- [x] Change repository visibility to **Public** (completed 2026-08-12; historical records intentionally retained).
- [x] Enable private vulnerability reporting (verified 2026-08-12).
- [x] Protect `main` with strict `check` and `macos-electron` status checks, one approving review, stale-review dismissal and resolved-conversation enforcement (verified 2026-08-12).
- [x] Confirm Actions uses standard `ubuntu-latest` and `macos-latest` labels, not larger runners.
- [x] Review Actions permissions and keep the default workflow token read-only without pull-request approval permission.

## Validation

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm check`
- [ ] `pnpm e2e:rc` on macOS when changing the Electron RC gate or release surface
- [ ] Verify the CI workflow remains credential-free by default; authenticated smoke stays opt-in.

## Current public repository status

- The repository is public as of 2026-08-12; historical planning records were intentionally retained.
- Maintainer-only planning material is removed from the current tree and remains ignored locally.
- README links to contribution, security and open-source readiness guidance.
- Public contribution, issue and pull-request entry points are present.
- Verification records are being normalized to avoid committing local absolute paths.
- The public tree uses Apache-2.0 and the existing standard `ubuntu-latest` / `macos-latest` CI runners.
- No product code, runtime contract or CI runner selection is changed by the publication-preparation work.
