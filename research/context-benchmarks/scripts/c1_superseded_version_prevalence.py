#!/usr/bin/env python3
"""Offline prevalence study: SUPERSEDED_VERSION intervention opportunities.

Zero provider calls. Answers: in real C1 traces, how often does read evidence
of a file become stale because that file is later edited, and how long does
the stale evidence persist in the model-visible context?

Definitions (frozen for the 2026-09-08 report):
- Read attribution: a read call is attributed to path P when its argumentHash
  equals sha256 of a known serialization of {"path": P} for a task-known path
  (relevant + distractor + writable + README.md). Unattributed reads are
  counted separately (UNKNOWN_PATH).
- Stale-read event: read(P) at call i, an edit at call j > i, and P is in the
  leg's actual changedPaths (from leg-manifest.json, sandbox-diffed). The read
  evidence of P no longer describes the file from call j onward.
  Caveat: for multi-writable tasks the edit at j may not be the one that
  touched P (leg-level approximation; single-writable tasks are exact).
- Refresh: a re-read of P at call k > j. (Prior analysis found zero same-args
  re-reads, so refresh is expected to be 0.)
- Persistence: number of subsequent calls (j..leg end) in which the stale
  evidence remains model-visible (nothing removes it in either arm).
- Dose metrics (four, kept distinct):
  staleEvents; staleElementCallExposures (sum of per-event persistence);
  uniqueCallsWithStaleEvidence (calls carrying >=1 active stale element);
  maxConcurrentStaleElements (per leg, then study max).
- Attribution strength: single-writable tasks allow exact edit->file
  attribution; multi-writable tasks are a leg-level upper bound only.
- Source-size proxy: fixture file size in bytes for P; tokens ~= bytes / 4
  (rough proxy, NOT an actual intervention dose - real dose is measured at
  composition time as removedTokens / tokenRatio).
"""
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path


def read_hashes(path):
    return {
        hashlib.sha256(v.encode()).hexdigest()
        for v in (f'{{"path":"{path}"}}', f'{{"path": "{path}"}}')
    }


def load_task_paths(manifest_path):
    manifest = json.load(open(manifest_path))
    tasks = {}
    for task in manifest["tasks"]:
        paths = set(task.get("relevantSources", []))
        paths |= set(task.get("distractorSources", []))
        paths |= set(task.get("expectedWritablePaths", []))
        paths.add("README.md")
        tasks[task["taskId"]] = {
            "paths": sorted(paths),
            "writable": set(task.get("expectedWritablePaths", [])),
            "fixturePath": task["fixturePath"],
        }
    return tasks


def load_changed_paths(legs_dir):
    changed = {}
    for leg_dir in Path(legs_dir).iterdir():
        manifest_file = leg_dir / "leg-manifest.json"
        if manifest_file.exists():
            m = json.load(open(manifest_file))
            changed[m["runId"]] = {
                "changedPaths": m.get("changedPaths", []),
                "status": m.get("status"),
                "taskOutcome": (m.get("taskEvaluation") or {}).get("taskOutcome"),
            }
    return changed


def analyze(checkpoints_path, manifest_path, repo_root):
    tasks = load_task_paths(manifest_path)
    legs_dir = Path(checkpoints_path).parent / "legs"
    changed = load_changed_paths(legs_dir)

    legs = defaultdict(list)
    meta = {}
    for line in open(checkpoints_path):
        event = json.loads(line)
        if event.get("phase") != "RESPONSE_RECORDED":
            continue
        ev = event["evidence"]
        run_id = ev["runId"]
        meta[run_id] = {"taskId": ev["taskId"], "arm": ev["arm"], "pairId": ev["pairId"]}
        legs[run_id].append(
            {
                "callOrdinal": ev["callOrdinal"],
                "requests": [
                    {"toolName": t["toolName"], "argumentHash": t["argumentHash"]}
                    for t in ev.get("toolRequestEvidence", [])
                ],
            }
        )

    results = []
    totals = defaultdict(int)
    for run_id, calls in sorted(legs.items()):
        calls.sort(key=lambda c: c["callOrdinal"])
        task = tasks.get(meta[run_id]["taskId"])
        if task is None:
            continue
        hash_to_path = {}
        for p in task["paths"]:
            for h in read_hashes(p):
                hash_to_path[h] = p
        reads = []  # (callOrdinal, path|None)
        edit_ordinals = []
        unknown_reads = 0
        for call in calls:
            for req in call["requests"]:
                if req["toolName"] == "read":
                    path = hash_to_path.get(req["argumentHash"])
                    if path is None:
                        unknown_reads += 1
                    reads.append((call["callOrdinal"], path))
                elif req["toolName"] in ("edit", "write"):
                    edit_ordinals.append(call["callOrdinal"])
        leg_changed = set(changed.get(run_id, {}).get("changedPaths", []))
        total_calls = len(calls)
        stale_events = []
        for ordinal, path in reads:
            if path is None or path not in leg_changed:
                continue
            later_edits = [e for e in edit_ordinals if e > ordinal]
            if not later_edits:
                continue
            first_edit = min(later_edits)
            refresh = any(r_ord > first_edit and r_path == path for r_ord, r_path in reads)
            persistence = total_calls - first_edit + 1
            stale_events.append(
                {
                    "path": path,
                    "readCall": ordinal,
                    "staleFromCall": first_edit,
                    "persistenceCalls": persistence,
                    "refreshReRead": refresh,
                }
            )
        fixture = Path(repo_root) / task["fixturePath"]
        dose_bytes = {}
        for event in stale_events:
            file_path = fixture / event["path"]
            if file_path.exists():
                dose_bytes[event["path"]] = file_path.stat().st_size
        # unique calls carrying >=1 active stale element, and peak concurrency
        active_per_call = defaultdict(int)
        for event in stale_events:
            for ordinal in range(event["staleFromCall"], total_calls + 1):
                active_per_call[ordinal] += 1
        unique_calls_with_stale = len(active_per_call)
        max_concurrent = max(active_per_call.values(), default=0)
        exact_attribution = len(task["writable"]) == 1
        results.append(
            {
                "runId": run_id,
                "taskId": meta[run_id]["taskId"],
                "arm": meta[run_id]["arm"],
                "calls": total_calls,
                "reads": len(reads),
                "unknownPathReads": unknown_reads,
                "edits": len(edit_ordinals),
                "changedPaths": sorted(leg_changed),
                "taskOutcome": changed.get(run_id, {}).get("taskOutcome"),
                "staleEvents": stale_events,
                "uniqueCallsWithStaleEvidence": unique_calls_with_stale,
                "maxConcurrentStaleElements": max_concurrent,
                "attribution": "EXACT" if exact_attribution else "LEG_LEVEL_UPPER_BOUND",
                "staleDoseBytes": dose_bytes,
            }
        )
        totals["legs"] += 1
        totals["calls"] += total_calls
        totals["legsWithStale"] += bool(stale_events)
        totals["legsWithStaleExact"] += bool(stale_events) and exact_attribution
        totals["legsWithStaleUpperBoundOnly"] += bool(stale_events) and not exact_attribution
        totals["staleEvents"] += len(stale_events)
        totals["staleElementCallExposures"] += sum(e["persistenceCalls"] for e in stale_events)
        totals["uniqueCallsWithStaleEvidence"] += unique_calls_with_stale
        totals["maxConcurrentStaleElements"] = max(
            totals["maxConcurrentStaleElements"], max_concurrent
        )
        totals["refreshReReads"] += sum(e["refreshReRead"] for e in stale_events)
        totals["unknownPathReads"] += unknown_reads
        totals["reads"] += len(reads)
        totals["staleDoseBytes"] += sum(dose_bytes.values())
    return {"totals": dict(totals), "legs": results}


if __name__ == "__main__":
    checkpoints, manifest, repo_root = sys.argv[1], sys.argv[2], sys.argv[3]
    json.dump(analyze(checkpoints, manifest, repo_root), sys.stdout, indent=1, ensure_ascii=False)
    sys.stdout.write("\n")
