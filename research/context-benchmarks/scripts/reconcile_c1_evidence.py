"""Read-only C1 checkpoint reconciliation; no provider or task execution.

Usage: python3 reconcile_c1_evidence.py STUDY --baseline AUDIT_JSON --output NEW_JSON
The baseline is the independent audit's evidenceSha256 map. This tool validates
that snapshot, not a frozen statistical analyzer or provider billing statement.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path


PROJECTIONS = (
    'decision-evidence.jsonl', 'outcome-evidence.jsonl',
    'provider-usage-ledger.jsonl', 'replay-evidence.jsonl',
    'tool-latency-evidence.jsonl', 'transition-evidence.jsonl',
)
JOIN = ('studyId', 'taskId', 'stratum', 'pairId', 'arm', 'runId',
        'callOrdinal', 'turnId', 'modelCallId')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def key(row):
    return tuple(row[field] for field in JOIN)


def totals(rows):
    result = {'responses': len(rows), 'toolRequests': 0, 'toolExecutions': 0}
    for field in ('inputTokens', 'outputTokens', 'totalTokens'):
        values = [row['usage'].get(field) for row in rows]
        require(all(type(v) is int and v >= 0 for v in values),
                'missing or invalid core usage')
        result[field] = sum(values)
    for row in rows:
        requested = row['toolRequestEvidence']
        executed = row['toolEvents']
        require(row['toolCalls'] == len(requested), 'tool request count mismatch')
        request_ids = [x['toolCallId'] for x in requested]
        event_ids = [x['toolCallId'] for x in executed]
        require(len(set(request_ids)) == len(request_ids), 'duplicate tool request')
        require(len(set(event_ids)) == len(event_ids), 'duplicate tool execution')
        require(set(event_ids) <= set(request_ids), 'tool execution without request')
        result['toolRequests'] += len(requested)
        result['toolExecutions'] += len(executed)
    return result


def reconcile(root, baseline):
    root = root.resolve()
    require(not any(p.is_symlink() for p in root.rglob('*')), 'symlink in evidence')
    files = {p.relative_to(root).as_posix(): p.read_bytes()
             for p in root.rglob('*') if p.is_file()}
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    require(hashes == baseline['evidenceSha256'], 'evidence snapshot hash/file mismatch')

    def obj(name):
        return json.loads(files[name])

    def rows(name):
        return [json.loads(line) for line in files[name].splitlines() if line.strip()]

    manifest = obj('run-manifest.json')
    require(manifest['studyId'] == baseline['studyId'], 'study identity mismatch')
    require(manifest['executionRevision'] == baseline['executionRevision'],
            'execution revision mismatch')
    require(manifest['studyTerminal'] is True, 'requires terminal evidence snapshot')
    checkpoints = rows('checkpoints.jsonl')
    permits, responses = {}, {}
    for ordinal, checkpoint in enumerate(checkpoints, 1):
        require(checkpoint['checkpointOrdinal'] == ordinal, 'checkpoint sequence gap')
        phase = checkpoint['phase']
        require(phase in ('OUTBOUND_PERMITTED', 'RESPONSE_RECORDED'), 'unknown phase')
        row = dict(checkpoint['capture'] if phase == 'OUTBOUND_PERMITTED'
                   else checkpoint['evidence'])
        row.setdefault('callOrdinal', checkpoint['callOrdinal'])
        require(row['callOrdinal'] == checkpoint['callOrdinal'], 'call ordinal mismatch')
        require(row['studyId'] == manifest['studyId'], 'cross-study checkpoint')
        join = key(row)
        bucket = permits if phase == 'OUTBOUND_PERMITTED' else responses
        require(join not in bucket, 'duplicate checkpoint join')
        if phase == 'RESPONSE_RECORDED':
            require(join in permits, 'response without prior permit')
        bucket[join] = row
    runs = defaultdict(list)
    for row in permits.values():
        runs[row['runId']].append(row['callOrdinal'])
    for ordinals in runs.values():
        require(ordinals == list(range(1, len(ordinals) + 1)), 'per-run call sequence gap')

    legs = [obj(name) for name in files if name.endswith('/leg-manifest.json')]
    completed = {}
    for leg in legs:
        require(leg['status'] == 'COMPLETED', 'unrecognized leg manifest status')
        require(leg['studyId'] == manifest['studyId'], 'cross-study leg')
        require(leg['runId'] not in completed, 'duplicate completed leg')
        require(leg['runId'] in runs, 'completed leg without permit')
        completed[leg['runId']] = leg
    done = [r for r in responses.values() if r['runId'] in completed]
    incomplete = [r for r in responses.values() if r['runId'] not in completed]
    done_keys = {key(row) for row in done}
    projection_counts = {}
    for name in PROJECTIONS:
        projection = rows(name)
        keys = [key(row) for row in projection]
        require(len(set(keys)) == len(keys), 'duplicate projection join')
        require(set(keys) == done_keys, 'projection coverage mismatch')
        for row in projection:
            # Compare overlapping response facts, but not derived oracle fields.
            source = responses[key(row)]
            for field in ('usage', 'toolEvents', 'toolCalls', 'runtimeContextChanged',
                          'lifecycleEligible', 'transitionDecisionKinds'):
                if field in row:
                    require(row[field] == source[field], 'projection fact mismatch')
        projection_counts[name] = len(keys)
    for run_id, leg in completed.items():
        own = [r for r in done if r['runId'] == run_id]
        for row in own:
            require(all(row[field] == leg[field] for field in ('studyId', 'pairId', 'arm', 'stratum')),
                    'completed leg identity mismatch')
        require(bool(own) and own[-1]['taskOutcome'] != 'CONTINUE',
                'completed leg has no terminal response')
        require(leg['providerCallPermits'] == len(own), 'leg permit count mismatch')
        require(leg['toolExecutions'] == totals(own)['toolExecutions'],
                'leg tool count mismatch')
    all_totals, done_totals, incomplete_totals = map(totals, (list(responses.values()), done, incomplete))
    require(manifest['completedLegs'] == len(completed), 'completed count mismatch')
    require(manifest['attemptedLegs'] == len(runs), 'attempted count mismatch')
    require(manifest['plannedLegs'] >= len(runs), 'attempted exceeds planned')
    require(manifest['responseCalls'] == len(done), 'legacy completed response mismatch')
    require(manifest['toolExecutions'] == done_totals['toolExecutions'], 'legacy tool mismatch')
    pairs = defaultdict(dict)
    for leg in legs:
        require(leg['arm'] not in pairs[leg['pairId']], 'duplicate pair arm')
        pairs[leg['pairId']][leg['arm']] = leg
    strata = Counter()
    for pair in pairs.values():
        if set(pair) == {'NATIVE', 'RUNTIME'}:
            require(pair['NATIVE']['stratum'] == pair['RUNTIME']['stratum'], 'pair stratum mismatch')
            strata[pair['NATIVE']['stratum']] += 1
    runtime = [r for r in responses.values() if r['arm'] == 'RUNTIME']
    return {
        'schemaVersion': 1, 'method': 'OFFLINE_CHECKPOINT_RECONCILIATION_NOT_FROZEN_ANALYZER',
        'studyId': manifest['studyId'], 'executionRevision': manifest['executionRevision'],
        'snapshotVerified': True, 'evidenceSha256': dict(sorted(hashes.items())),
        'allRecorded': all_totals, 'completedLegsOnly': done_totals,
        'incompleteLegsOnly': incomplete_totals,
        'coverage': {'plannedLegs': manifest['plannedLegs'], 'attemptedLegs': len(runs),
                     'completedLegs': len(completed), 'unexecutedLegs': manifest['plannedLegs'] - len(runs),
                     'completePairs': sum(strata.values()), 'pairsByObservedStratum': dict(strata)},
        'permits': len(permits), 'responses': len(responses),
        'permitsWithoutRecordedResponse': len(set(permits) - set(responses)),
        'projectionRows': projection_counts,
        'incompleteLegs': [{'runId': run_id, 'finalOracle': 'UNOBSERVED',
                            'recordedResponses': len([r for r in incomplete if r['runId'] == run_id])}
                           for run_id in runs if run_id not in completed],
        'runtime': {'recordedResponses': len(runtime),
                    'changed': sum(r['runtimeContextChanged'] is True for r in runtime),
                    'eligible': sum(r['lifecycleEligible'] is True for r in runtime),
                    'decisionEntries': dict(Counter(k for r in runtime for k in r['transitionDecisionKinds']))},
        'originalFailureCodes': [f['code'] for f in manifest['failures']],
        'lifecycleRates': 'NOT_ESTIMABLE', 'effectiveness': 'NOT_ADJUDICATED',
        'cacheCost': 'NOT_ESTIMABLE', 'providerCallsThisAnalysis': 0,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('study', type=Path)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require(not args.output.resolve().is_relative_to(args.study.resolve()),
            'output must be outside immutable evidence')
    result = reconcile(args.study, json.loads(args.baseline.read_text()))
    # Exclusive create: never overwrite an existing result or source artifact.
    with args.output.open('x') as out:
        out.write(json.dumps(result, indent=2, sort_keys=True) + '\n')


if __name__ == '__main__':
    main()
