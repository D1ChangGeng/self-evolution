---
type: skill-local
project_type: ""
base_skill: self-evolution
confidence: observed
last_reviewed: {{DATE}}
created: {{DATE}}
---

# Self-Evolution Local Specialization

This file extends the global self-evolution skill with project-specific behavior. It is an overlay, not a fork — the global skill governs all base behavior. Rules here take higher priority only for this project.

## Project Profile

<!-- Describe the project type in 1-2 lines. This helps future sessions understand
     why certain specializations exist and whether they apply to similar projects.
     Example: "Rust async web service with OAuth integration, distributed as Docker image" -->

## Active Overrides

<!-- Rules that modify default skill behavior for this project.
     Each entry should have: what it changes, why, and when it was added.
     Keep entries minimal — only override what the default gets wrong for this project type. -->

### Capture Conditions
<!-- Additional conditions beyond the default 5 that trigger knowledge capture.
     These should be specific to this project's risk areas.
     Example (illustrative — adapt to your project):
       "Any change to migration files requires domain knowledge update" -->

- 

### Health Threshold Overrides
<!-- Override default staleness thresholds for specific domains.
     Default: domains 60 days, reference 90 days, patterns 90 days.
     Only override when the default is too slow for a high-risk area.
     Format: domain-file: N days (reason) -->

- 

### Promotion Criteria Overrides
<!-- Override default promotion requirements for specific knowledge types.
     Only when the default criteria don't fit this project's verification methods. -->

- 

## Candidate Specializations

<!-- Observations that may become active overrides after evidence accumulates.
     Mode 4 (Evolve) adds candidates here when project-specific patterns emerge.
     Mode 7 (Skill Maintenance) promotes candidates to Active Overrides.
     
     Format:
     - Candidate: [what to specialize]
       Evidence: [where this was observed]
       Status: observed | needs-evidence | ready-to-promote -->

- 
