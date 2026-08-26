# L3 noisy-repo bug hunt

CommonJS job-scheduling system: jobs are registered, kept in a registry,
paged through a paginator, and executed by an injected runner. Several
utility modules around the scheduler look suspicious but behave correctly.
Exactly one real defect causes the primary test failure.
