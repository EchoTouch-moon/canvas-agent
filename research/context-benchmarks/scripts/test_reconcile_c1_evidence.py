"""Synthetic offline tests; no live files, credentials, or network imports."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from reconcile_c1_evidence import PROJECTIONS, reconcile


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.manifest = dict(studyId='study', executionRevision='revision', studyTerminal=True,
                             plannedLegs=4, attemptedLegs=2, completedLegs=1, responseCalls=1,
                             toolExecutions=1, failures=[{'code': 'PREFLIGHT_FAILURE'}])
        base = dict(studyId='study', taskId='task', stratum='stratum', pairId='pair',
                    arm='NATIVE', runId='done', callOrdinal=1, turnId='turn', modelCallId='model',
                    usage=dict(inputTokens=10, outputTokens=2, totalTokens=12),
                    toolCalls=1, toolRequestEvidence=[{'toolCallId': 'tool'}],
                    toolEvents=[{'toolCallId': 'tool'}], taskOutcome='SUCCESS',
                    runtimeContextChanged=False, lifecycleEligible=False, transitionDecisionKinds=[])
        self.done = base
        self.incomplete = dict(base, runId='incomplete', arm='RUNTIME', taskOutcome='CONTINUE')
        self.checkpoints = []
        for row in (base, self.incomplete):
            self.checkpoints.extend([
                dict(checkpointOrdinal=len(self.checkpoints)+1, phase='OUTBOUND_PERMITTED',
                     callOrdinal=1, capture=row),
                dict(checkpointOrdinal=len(self.checkpoints)+2, phase='RESPONSE_RECORDED',
                     callOrdinal=1, evidence=row)])
        self.leg = dict(studyId='study', runId='done', status='COMPLETED', arm='NATIVE',
                        pairId='pair', stratum='stratum', providerCallPermits=1, toolExecutions=1)
        self.projections = {name: [copy.deepcopy(base)] for name in PROJECTIONS}

    def write(self):
        def save(name, value, lines=False):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(('\n'.join(json.dumps(x) for x in value) if lines else json.dumps(value))+'\n')
        save('run-manifest.json', self.manifest)
        save('checkpoints.jsonl', self.checkpoints, True)
        save('legs/done/leg-manifest.json', self.leg)
        for name, rows in self.projections.items():
            save(name, rows, True)
        return dict(studyId='study', executionRevision='revision', evidenceSha256={
            p.relative_to(self.root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in self.root.rglob('*') if p.is_file()})

    def rejected(self, message):
        with self.assertRaisesRegex(ValueError, message):
            reconcile(self.root, self.write())

    def test_partial_accounting_preserves_unknown(self):
        result = reconcile(self.root, self.write())
        self.assertEqual(result['allRecorded']['totalTokens'], 24)
        self.assertEqual(result['completedLegsOnly']['totalTokens'], 12)
        self.assertEqual(result['incompleteLegsOnly']['totalTokens'], 12)
        self.assertEqual(result['incompleteLegs'][0]['finalOracle'], 'UNOBSERVED')
        self.assertEqual(result['coverage']['unexecutedLegs'], 2)
        self.assertEqual(result['coverage']['completePairs'], 0)

    def test_snapshot_tampering(self):
        baseline = self.write()
        (self.root/'run-manifest.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'snapshot'):
            reconcile(self.root, baseline)

    def test_duplicate_response(self):
        duplicate = copy.deepcopy(self.checkpoints[-1])
        duplicate['checkpointOrdinal'] = 5
        self.checkpoints.append(duplicate)
        self.rejected('duplicate checkpoint')

    def test_response_without_permit(self):
        self.checkpoints[0]['capture'] = dict(self.done, modelCallId='different')
        self.rejected('without prior permit')

    def test_sequence_gap(self):
        self.checkpoints[-1]['checkpointOrdinal'] = 9
        self.rejected('sequence gap')

    def test_duplicate_projection(self):
        self.projections[PROJECTIONS[0]].append(self.done)
        self.rejected('duplicate projection')

    def test_missing_projection(self):
        self.projections[PROJECTIONS[0]] = []
        self.rejected('coverage mismatch')

    def test_projection_fact_corruption(self):
        self.projections[PROJECTIONS[0]][0]['usage']['totalTokens'] = 999
        self.rejected('fact mismatch')

    def test_missing_usage_not_zero(self):
        self.incomplete['usage'] = dict(outputTokens=2, totalTokens=12)
        self.rejected('missing or invalid core usage')

    def test_tool_without_request(self):
        self.incomplete['toolEvents'] = [{'toolCallId': 'unknown'}]
        self.rejected('execution without request')

    def test_unanswered_permit_remains_visible(self):
        self.checkpoints.pop()
        result = reconcile(self.root, self.write())
        self.assertEqual(result['permitsWithoutRecordedResponse'], 1)
        self.assertEqual(result['incompleteLegs'][0]['recordedResponses'], 0)
        self.assertEqual(result['incompleteLegs'][0]['finalOracle'], 'UNOBSERVED')

    def test_leg_identity_mismatch(self):
        self.leg['arm'] = 'RUNTIME'
        self.rejected('leg identity mismatch')

    def test_cross_study(self):
        self.incomplete['studyId'] = 'other'
        self.rejected('cross-study')


if __name__ == '__main__':
    unittest.main()
