import type { SourceObservation } from "../../../src";
import type {
  LifecycleTraceEvent,
  RequestPatch,
  TraceEventKind,
} from "./types";

export function traceEvent(input: {
  readonly sequence: number;
  readonly id: string;
  readonly kind: TraceEventKind;
  readonly sourceKey?: string;
  readonly evidenceRef?: string;
  readonly observation?: SourceObservation;
  readonly request?: RequestPatch;
  readonly plan?: boolean;
}): LifecycleTraceEvent {
  return {
    sequence: input.sequence,
    id: input.id,
    kind: input.kind,
    ...(input.sourceKey !== undefined ? { sourceKey: input.sourceKey } : {}),
    ...(input.evidenceRef !== undefined
      ? { evidenceRef: input.evidenceRef }
      : {}),
    ...(input.observation !== undefined
      ? { observation: input.observation }
      : {}),
    ...(input.request !== undefined ? { request: input.request } : {}),
    ...(input.plan !== undefined ? { plan: input.plan } : {}),
  };
}

export function boundary(
  sequence: number,
  id: string,
  request: RequestPatch = {},
): LifecycleTraceEvent {
  return traceEvent({
    sequence,
    id,
    kind: "PLANNING_BOUNDARY",
    request,
    plan: true,
  });
}
