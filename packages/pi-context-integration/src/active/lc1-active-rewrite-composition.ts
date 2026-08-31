import type {
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  createActiveRewriteExtension,
  type ActiveRewriteExtensionOptions,
} from "../extension/active-rewrite-extension";
import {
  createLc1RuntimeAdmissionPiExtension,
  type Lc1RuntimeAdmissionPiExtensionOptions,
} from "./lc1-runtime-admission-pi-extension";
import type { RunKillSwitch } from "./kill-switch";

/**
 * Explicit first-party composition for the pre-Active integration boundary.
 * LC1 is registered first, Active second, and both legs share one per-Run
 * kill switch. The wrapper is experimental and does not authorize live use.
 */
export interface Lc1ActiveRewriteExtensionOptions {
  readonly lc1: Lc1RuntimeAdmissionPiExtensionOptions;
  /**
   * Active options may omit `killSwitch`; the wrapper binds the LC1 switch.
   * Supplying a different switch is rejected instead of silently creating two
   * independent safety domains.
   */
  readonly active: ActiveRewriteExtensionOptions;
}

function requireSharedKillSwitch(
  options: Lc1ActiveRewriteExtensionOptions,
): RunKillSwitch {
  if (typeof options !== "object" || options === null) {
    throw new Error("lc1_active_rewrite_extension_configuration_invalid");
  }
  if (typeof options.active !== "object" || options.active === null) {
    throw new Error("lc1_active_rewrite_extension_configuration_invalid");
  }

  const sharedKillSwitch = options.lc1.composition.killSwitch;
  if (sharedKillSwitch === null) {
    throw new Error(
      "lc1_active_rewrite_extension_requires_runtime_owned_kill_switch",
    );
  }
  if (
    options.active.killSwitch !== undefined &&
    options.active.killSwitch !== sharedKillSwitch
  ) {
    throw new Error("lc1_active_rewrite_extension_requires_shared_kill_switch");
  }
  if (options.active.runId !== sharedKillSwitch.runId) {
    throw new Error("lc1_active_rewrite_extension_run_id_mismatch");
  }
  return sharedKillSwitch;
}

/**
 * Compose the runtime-owned LC1 Pi hook before the Active Rewrite hook.
 *
 * The returned factory deliberately registers both handlers in one explicit
 * order. It is the only supported composition seam for a future live canary:
 * authority mapping and LC1 observation complete first; the Active handler
 * can only see the resulting native message list and the same sticky switch.
 */
export function createLc1ActiveRewriteExtension(
  options: Lc1ActiveRewriteExtensionOptions,
): ExtensionFactory {
  // Constructing the LC1 factory performs its existing first-party/runtime-
  // owned validation before any handler can be registered.
  const lc1Factory = createLc1RuntimeAdmissionPiExtension(options.lc1);
  const sharedKillSwitch = requireSharedKillSwitch(options);
  const activeFactory = createActiveRewriteExtension({
    ...options.active,
    killSwitch: sharedKillSwitch,
  });

  return async (pi: ExtensionAPI) => {
    await lc1Factory(pi);
    await activeFactory(pi);
  };
}
