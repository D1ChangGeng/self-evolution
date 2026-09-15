# Historical public evaluation evidence

This file records an earlier public benchmark campaign. It remains historical
and is not substituted for the current engineering campaign.

The campaign measured three paired attempts on the declared LongMemEval cleaned
and LongMemEval-V2 small datasets. The published report recorded cleaned
accuracy 88.20% baseline versus 90.80% candidate, and V2 accuracy 9.31%
baseline versus 7.32% candidate. The candidate V2 result was within the
declared overall tolerance, while the absolute score remained low.

The report also recorded six read-only engineering samples with fixed checks
and independent review. Those samples covered selected routing, source review,
authority and Capture paths. They did not prove broad code repair, operating
system isolation, or all project-wiki cases.

The original campaign artifacts remain in their authorized execution storage.
This repository copy contains only the public summary and its recorded
limitations. The current release candidate adds a separate SWE-bench-based
engineering campaign whose measured pilot is described in
`maintainer/evals/engineering/public/RESULTS.md`. Stable release readiness
remains false until the current effect gates are complete.
