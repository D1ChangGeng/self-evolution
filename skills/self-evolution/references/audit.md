# Knowledge Audit

## Contents

- Purpose and method
- Risk categories
- Severity and finding contract

## Purpose

Audit whether project knowledge improves real work without creating correctness,
retrieval, authority, maintenance, or security risk. Report actionable findings; do
not compute an overall score.

## Method

1. Read root and relevant nested AGENTS files and inspect their routes.
2. Run `kb check --format json` with the installed Skill's resolved absolute CLI.
3. Sample active Guides and accepted Decisions, prioritizing high-risk operations,
   broad scopes, source-change signals, and documents heavily routed from AGENTS.
4. Verify sampled material claims against code, tests, configuration, runtime
   evidence, adopted policy, or authoritative external documentation as appropriate.
5. Inspect Observations only for valuable unresolved material, sensitive data, and
   entries that now have an obvious destination.
6. Search for duplicated guidance and superseded content still presented as current.
7. Report findings by severity and state sampling or verification limits.

## Risk Categories

### Correctness

Find claims contradicted by reality, broken evidence, missing sources, changed source
baselines, and operational instructions that no longer produce the described result.
Treat `SOURCE_CHANGED` as a review signal, not proof that the document is wrong.

### Retrieval

Find important knowledge with no route, scopes or `use_when` that fail to select the
document for its real consumer, exact duplicate routes, and routing that causes broad
irrelevant loading. Do not require every directory to have a Guide.

### Authority

Find hypotheses written as facts, implementation details presented as adopted policy,
rejected or superseded Decisions presented as current, and claims whose authority
source does not match their type.

### Maintenance

Find duplicate facts, copied Guide bodies in AGENTS or generated rules, fields with no
consumer, bloated files mixing unrelated scopes, and documents with no plausible
future action. Low usage alone is not proof of low value for rare high-risk runbooks.

### Security and Publication

Find secrets, credentials, personal data, unnecessary internal addresses, exploitable
operational details, and content inappropriate for the repository's publication
boundary. Report the location without reproducing secret values.

### Value Gaps

Find expensive recurring investigations, high-risk operations, or known failure areas
where a concise Guide or route would materially improve future outcomes. Require
evidence of the cost or risk; do not infer a gap from directory coverage.

## Severity

- Critical: likely immediate data loss, security exposure, destructive operation, or
  consistently wrong high-impact action.
- High: material design, release, production, migration, or cross-team risk with a
  plausible near-term consumer.
- Medium: retrieval or maintenance problem likely to waste meaningful effort or cause
  a contained error.
- Low: bounded clarity or cleanup issue with modest expected benefit.

## Finding Contract

Each finding must include:

- the specific file, route, or claim;
- evidence and verification performed;
- the concrete risk;
- the recommended action;
- expected benefit;
- why the chosen severity is justified.

Use this report shape:

```markdown
# Knowledge Audit

## Findings

### [High] Short finding title
- Location: `.agents/knowledge/guides/example.md`
- Evidence: ...
- Risk: ...
- Action: ...
- Expected benefit: ...
- Priority rationale: ...

## No-Finding Areas

## Verification Limits

## Recommended Action Order
1. ...
```

Do not hide a critical issue inside a thematic summary. If no findings are discovered,
state that explicitly and identify residual sampling, runtime, or external-system gaps.
