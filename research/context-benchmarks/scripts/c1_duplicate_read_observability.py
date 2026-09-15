#!/usr/bin/env python3
"""Observational analysis: how often do same-arguments tool re-invocations
(duplicate-read candidates) occur in real C1 provider traces?

Zero provider calls. Reads only recorded evidence (checkpoints.jsonl).

Definitions (frozen for the 2026-09-08 report):
- Population: every RESPONSE_RECORDED capture in the given checkpoints.jsonl.
- A "same-args re-invocation" = identical (toolName, argumentHash) appearing
  at least twice within one leg (runId). argumentHash = sha256(argumentsJson),
  so equality means byte-identical arguments (same path for read, same
  command for bash). File CONTENT equality cannot be verified from metadata;
  an intervening mutation check bounds it:
  - strict: an edit/write tool between two occurrences makes the re-read
    potentially legitimate (content may have changed);
  - broad: additionally counting any bash invocation as a potential mutator.
- Bootstrap duplicate: a model read whose argumentHash matches the known
  bootstrap read ({"path":"README.md"}), i.e. the model re-reading the file
  the bootstrap already showed it.
"""
import hashlib
import json
import sys
from collections import Counter, defaultdict

BOOTSTRAP_READ_HASHES = {
    hashlib.sha256(v.encode()).hexdigest()
    for v in (
        '{"path":"README.md"}',
        '{"path": "README.md"}',
        '{"path":"./README.md"}',
        '{"path": "./README.md"}',
    )
}
STRICT_MUTATORS = {"edit", "write"}
BROAD_MUTATORS = {"edit", "write", "bash"}


def load_legs(path):
    legs = defaultdict(list)
    meta = {}
    for line in open(path):
        event = json.loads(line)
        if event.get("phase") != "RESPONSE_RECORDED":
            continue
        ev = event["evidence"]
        run_id = ev["runId"]
        meta[run_id] = {
            "taskId": ev["taskId"],
            "stratum": ev["stratum"],
            "pairId": ev["pairId"],
            "arm": ev["arm"],
            "contextStrategy": ev["contextStrategy"],
        }
        requests = [
            {
                "toolCallId": t["toolCallId"],
                "toolName": t["toolName"],
                "argumentHash": t["argumentHash"],
            }
            for t in ev.get("toolRequestEvidence", [])
        ]
        legs[run_id].append({"callOrdinal": ev["callOrdinal"], "requests": requests})
    for run_id in legs:
        legs[run_id].sort(key=lambda c: c["callOrdinal"])
    return legs, meta


def analyze(path):
    legs, meta = load_legs(path)
    tool_totals = Counter()
    legs_with_dup = set()
    legs_with_bootstrap_dup = set()
    dup_groups = []
    bootstrap_reads = []
    for run_id, calls in sorted(legs.items()):
        sequence = []  # flat ordered tool requests with call ordinals
        for call in calls:
            for req in call["requests"]:
                sequence.append((call["callOrdinal"], req))
                tool_totals[req["toolName"]] += 1
                if req["toolName"] == "read" and req["argumentHash"] in BOOTSTRAP_READ_HASHES:
                    bootstrap_reads.append(
                        {
                            "runId": run_id,
                            "callOrdinal": call["callOrdinal"],
                            **{k: meta[run_id][k] for k in ("taskId", "pairId", "arm")},
                        }
                    )
                    legs_with_bootstrap_dup.add(run_id)
        groups = defaultdict(list)
        for ordinal, req in sequence:
            groups[(req["toolName"], req["argumentHash"])].append(ordinal)
        for (tool_name, arg_hash), ordinals in groups.items():
            if len(ordinals) < 2:
                continue
            legs_with_dup.add(run_id)
            between_strict = between_broad = False
            for first, second in zip(ordinals, ordinals[1:]):
                # any mutator in a call strictly between the two occurrences
                for ordinal, req in sequence:
                    if first < ordinal < second:
                        if req["toolName"] in STRICT_MUTATORS:
                            between_strict = True
                        if req["toolName"] in BROAD_MUTATORS:
                            between_broad = True
            dup_groups.append(
                {
                    "runId": run_id,
                    "taskId": meta[run_id]["taskId"],
                    "pairId": meta[run_id]["pairId"],
                    "arm": meta[run_id]["arm"],
                    "toolName": tool_name,
                    "occurrences": len(ordinals),
                    "callOrdinals": ordinals,
                    "interveningMutationStrict": between_strict,
                    "interveningMutationBroad": between_broad,
                }
            )
    arm_counter = Counter(m["arm"] for m in meta.values())
    return {
        "legs": len(legs),
        "legsByArm": dict(arm_counter),
        "responseCalls": sum(len(c) for c in legs.values()),
        "toolCalls": sum(tool_totals.values()),
        "toolCallsByName": dict(tool_totals.most_common()),
        "legsWithSameArgsReinvocation": len(legs_with_dup),
        "legsWithBootstrapReadDuplicate": len(legs_with_bootstrap_dup),
        "duplicateGroups": dup_groups,
        "bootstrapReads": bootstrap_reads,
    }


if __name__ == "__main__":
    result = analyze(sys.argv[1])
    json.dump(result, sys.stdout, indent=1, ensure_ascii=False)
    sys.stdout.write("\n")
