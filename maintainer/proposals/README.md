# Proposals

Use proposals for changes that add or materially alter a runtime mechanism,
public contract, migration behavior, or evaluation threshold. Small fixes that
restore already specified behavior need a failure case and regression test, but
not a separate proposal.

Before acceptance, a proposal must:

- link at least one observed failure case or explicit user goal;
- describe the future action it changes and why current behavior is insufficient;
- state context, execution, compatibility, and maintenance costs;
- analyze false triggers, unsafe failure modes, and a default-off alternative;
- define a task-outcome evaluation and a removal condition;
- identify producer, consumer, consumption point, lifecycle, and deletion rule
  for every new persisted field;
- include migration and rollback implications when public data changes.

Copy `TEMPLATE.md`, assign the next proposal ID, and keep rejected proposals
with their evidence and decision. Structural simplification alone is not proof
of improved task outcomes.
