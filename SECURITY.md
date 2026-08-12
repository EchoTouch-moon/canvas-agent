# Security Policy

## Supported versions

Canvas Agent does not currently publish signed releases. Security fixes are evaluated against the latest `main` revision.

| Version | Supported |
| --- | --- |
| Latest `main` | Yes, best effort |
| Older revisions | No guarantee |

## Reporting a vulnerability

Please do not disclose a suspected vulnerability in a public issue, pull request or discussion.

Use the repository's private vulnerability reporting flow from the **Security** tab. If private reporting is unavailable, contact the repository maintainers privately through the GitHub profile associated with the repository and include:

- a concise description of the impact;
- affected revision, package or workflow;
- minimal reproduction steps or a proof of concept;
- any suggested mitigation.

Redact credentials, tokens, personal data and provider payloads from reports. Please allow maintainers reasonable time to investigate before public disclosure.

## Sensitive areas

Reports involving Electron Main/preload boundaries, Worker isolation, Git/worktree handling, credential handling, dependency installation, CI workflows or persisted execution evidence should be treated as security-sensitive even when the observed impact is not yet clear.
