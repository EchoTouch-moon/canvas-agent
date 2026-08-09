# PROPOSAL-028B — Local Agent executable discovery and readiness

- **Status:** APPROVED — exact command intent frozen for DS-005
- **Decision owner:** Lead architect
- **Date:** 2026-08-09
- **Parent:** `PROPOSAL-028-local-cli-adapter-v1.md`

## Problem

A packaged macOS application launched from Finder often does not inherit the interactive shell's PATH. The verified local `codex` launcher is an npm-installed symlink whose shebang also needs a resolvable `node`. Assuming `spawn("codex")` works would make the real-Agent path pass in development and fail in the packaged product.

## Decision

Main owns an `AgentRuntimeLocator` for the fixed v0.2 provider `codex-cli`. It discovers, validates, probes and persists a launcher path; Renderer receives readiness data and path-free actions only.

Discovery precedence:

1. previously user-selected launcher from `agent-settings-v1.json`;
2. executable found in the inherited process PATH;
3. platform candidates derived from system install prefixes and `app.getPath("home")`, including Homebrew/local-user bin locations on macOS;
4. no candidate → `NOT_FOUND` and offer native selection.

Candidates may be symlinks. Main resolves the target for validation, confirms an executable regular file, then runs bounded `--version` and `login status` probes through the provider-neutral runner. The originally selected launcher path may be retained so package-manager upgrades can update the symlink target.

No login flow, API key entry or secret storage is added. Users authenticate with the provider CLI outside Canvas Agent.

## Public command intent

The exact Zod object names may follow existing command conventions; these fields and semantics are frozen:

```text
agent.status {}
  → {
      provider: "codex-cli",
      state: "READY" | "NOT_FOUND" | "UNSUPPORTED_VERSION" |
             "AUTH_REQUIRED" | "INTERPRETER_MISSING" | "ERROR",
      version: string | null,
      source: "USER_SELECTED" | "PATH" | "KNOWN_LOCATION" | null,
      displayPath: string | null,
      lastError: { reasonCode: string, recoverable: boolean } | null
    }

agent.chooseExecutable {}
  → { cancelled: boolean, status: AgentRuntimeStatus }

agent.clearExecutable {}
  → AgentRuntimeStatus
```

`agent.chooseExecutable` opens a Main-owned native file picker and accepts no path in its payload. Returned `displayPath` is informational and is never trusted as input to a later privileged operation.

## Settings

`userData/agent-settings-v1.json` contains only:

```ts
{
  schemaVersion: 1,
  codexCliLauncherPath: string | null
}
```

It is Zod-validated and atomically replaced. Corrupt/missing settings fall back to discovery. Credentials, tokens, model prompts and arbitrary argv are prohibited.

## Launch environment

The adapter constructs an explicit environment rather than inheriting all of `process.env`.

- Include a controlled PATH sufficient for the selected launcher/interpreter and minimal system tools.
- Permit required identity/config pointers such as HOME/CODEX_HOME and provider auth variables by exact key.
- Permit locale/temp/certificate/proxy keys by reviewed allowlist where needed.
- Never log values for secret-bearing keys.
- If an npm launcher cannot resolve its interpreter, return `INTERPRETER_MISSING`; do not run a login shell or source shell profiles.

## Lifecycle integration

- Agent status is independent of workspace `READY`; the UI may show both.
- `execution.dispatch` requires workspace READY and Agent READY for the production profile.
- The absolute trusted launch plan is passed Main → Utility Process in a runtime-validated init frame; it is not placed in Renderer-controlled payloads.
- Changing/clearing the executable is blocked while an execution is active and applies to the next WorkerHost lifecycle.

## Required tests

- PATH success, known-location success and no-candidate state;
- symlink launcher validation;
- invalid/non-executable/wrong-version selection;
- picker cancellation preserves prior READY launcher;
- missing shebang interpreter maps to `INTERPRETER_MISSING`;
- auth probe maps to `AUTH_REQUIRED` without exposing output secrets;
- corrupt settings recovery and atomic persistence;
- untrusted sender rejection and empty/path-free payload schemas;
- packaged smoke with a deterministic fake launcher selected through the picker seam;
- active execution blocks launcher change.

## Rejected alternatives

1. **Trust Finder PATH:** unreliable across launch methods.
2. **Run a login shell to call `command -v`:** executes user shell startup and reintroduces shell-string behavior.
3. **Renderer text field for an executable path:** grants unnecessary process-selection authority.
4. **Bundle a provider CLI immediately:** creates licensing, update, platform and signing obligations outside v0.2.
5. **Store API keys in app settings:** expands the secret boundary without need.

## Non-goals

- performing provider login;
- model/profile management;
- more than one provider;
- downloading/updating Codex CLI;
- Windows/Linux launcher compatibility beyond preserving portable abstractions.
