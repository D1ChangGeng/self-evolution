# Health Check: Assessing Knowledge Base Quality

Read this during explicit health checks or as the first step of an evolution session.

## Health Metrics

### inbox_pressure

**What it measures**: Volume of unprocessed observations awaiting organization.

**How to calculate**: Count all entries across all inbox files (each `## ` heading is one entry).

**Interpretation**:
- 0-5: Healthy. Inbox is being processed regularly.
- 6-10: Moderate. Schedule an evolution session soon.
- 11-20: High pressure. Knowledge is accumulating without organization.
- 21+: Critical. Significant knowledge loss risk — observations may lose context as they age.

### staleness_ratio

**What it measures**: Percentage of knowledge files whose claims may no longer reflect current code.

**How to calculate**: Count files where `last_verified` exceeds the type-specific threshold (domains: 60 days, reference: 90 days, patterns: 90 days) AND source files in the declared scope have been modified since `last_verified`. Divide by total non-inbox, non-archive files.

**Interpretation**:
- 0-10%: Healthy. Knowledge is being verified regularly.
- 11-25%: Moderate. Some areas may have drifted.
- 26-50%: High. Significant portions of the knowledge base are unreliable.
- 51%+: Critical. The knowledge base may be actively misleading.

### confidence_distribution

**What it measures**: Balance between trust levels across all knowledge files.

**How to calculate**: Count files at each confidence level (observed, verified, canonical).

**Healthy shape**: Pyramid — many observed, fewer verified, few canonical. This means knowledge is flowing through the lifecycle normally.

**Unhealthy shapes**:
- All observed, nothing verified: Knowledge is being captured but never validated. The system is a raw dump, not a knowledge base.
- Many canonical, few observed: Either the system is mature and stable (good) or promotional standards are too low (bad). Check whether canonical entries have real evidence.
- No observed at all: Capture has stopped. The system is static and will rot.

### conflict_count

**What it measures**: Number of unresolved contradictions between knowledge entries.

**How to calculate**: Count entries in manifest.json `conflicts` array plus any `## Conflicting Knowledge` sections in domain files.

**Interpretation**: Any value above 0 needs attention. Conflicts that persist for more than 2 weeks are actively harmful — they mean the system contains contradictory guidance and consumers cannot know which to trust.

### coverage_gaps

**What it measures**: Project areas with active development but no corresponding knowledge.

**How to calculate**: Compare directories in the project's source tree (that have been modified in the last 30 days) against scope fields in all domain/pattern/crystallized files. Directories with no corresponding knowledge file are gaps.

**Interpretation**: Not all gaps are problems. Utility directories, generated code, and thin wrappers may not need knowledge files. Focus on gaps in directories that:
- Have been touched in 5+ recent sessions
- Contain complex logic or cross-cutting concerns
- Have caused bugs or confusion in the past

### compression_opportunity

**What it measures**: Inbox items that could be merged into domain files but haven't been.

**How to calculate**: Count clusters of 3+ inbox items with the same theme.

**Interpretation**: High compression opportunity means evolution sessions are overdue. Quick win — each compression reduces inbox noise and creates organized knowledge.

### crystallization_candidates

**What it measures**: Patterns or domain files with procedural content that has been referenced or refined multiple times.

**How to calculate**: Count pattern/domain files that contain step-by-step workflow sections AND have been read or updated in 3+ sessions.

**Interpretation**: High candidate count means the project has mature practices that could become executable skills. This is a positive signal, not a problem.

### archive_health

**What it measures**: Quality of the archival process.

**How to calculate**: Percentage of archived files that have `retirement_reason` in their frontmatter.

**Interpretation**:
- 90-100%: Good. Archives are well-documented.
- 70-89%: Acceptable. Some files were moved to archive without explanation.
- Below 70%: Archive is becoming a dump. Items were moved there without documenting why, making it hard to understand what changed and when.

## Health Scoring

Calculate an overall score from 0 to 100 using these weights:

| Metric | Weight | Scoring |
|--------|--------|---------|
| inbox_pressure | 20% | 0 items=100, 5=80, 10=50, 15=25, 20+=0 |
| staleness_ratio | 25% | 0%=100, 10%=80, 25%=50, 40%=25, 50%+=0 |
| confidence_distribution | 15% | Healthy pyramid=100, all observed=40, other imbalance=50 |
| conflict_count | 20% | 0=100, 1=70, 2=50, 3+=30 |
| coverage_gaps | 10% | 0 gaps in active dirs=100, proportional decrease per gap |
| compression_opportunity | 10% | 0 clusters=100, proportional decrease per cluster |

### Rating Scale

| Score | Rating | Meaning |
|-------|--------|---------|
| 80-100 | Healthy | Regular evolution is maintaining knowledge quality |
| 60-79 | Needs attention | Inbox accumulating, some staleness, minor gaps |
| 40-59 | Degrading | Significant staleness, unresolved conflicts, large backlog |
| 0-39 | Critical | Knowledge base is unreliable. Major evolution session needed |

## Triage: What to Fix First

When health is below 80, fix issues in this priority order:

### Priority 1: Unresolved Conflicts
Conflicts actively mislead. Two contradictory claims mean the system is giving wrong guidance at least half the time. Resolve conflicts before anything else.

### Priority 2: Stale Verified/Canonical Knowledge
High-confidence knowledge that has drifted is the most dangerous kind of stale knowledge because consumers trust it. Spot-check verified and canonical claims against current code. Update or downgrade confidence.

### Priority 3: Inbox Compression
Easy wins with immediate payoff. Merging clustered inbox items into domain files improves both organization and discoverability. Start with the largest clusters.

### Priority 4: Coverage Gaps in Active Areas
Focus on directories that have been worked on frequently but have no corresponding knowledge. These are areas where the next session will need to re-discover context from scratch.

### Priority 5: Stale Observed Knowledge
Lowest priority because observed knowledge is already marked as tentative. Consumers should not be relying heavily on it. Verify if convenient, retire if clearly wrong.

## Report Format

Generate this format after a health check:

```markdown
## Knowledge Base Health Report — {DATE}

**Score: {SCORE}/100** ({RATING})

### Summary
- {TOTAL_FILES} knowledge files ({OBSERVED} observed, {VERIFIED} verified, {CANONICAL} canonical)
- {INBOX_COUNT} inbox items awaiting processing
- {STALE_COUNT} potentially stale files
- {CONFLICT_COUNT} unresolved conflicts

### Priority Actions
1. {Highest priority action with specific file references}
2. {Second priority action}
3. {Third priority action}

### Metric Breakdown

| Metric | Value | Score | Status |
|--------|-------|-------|--------|
| Inbox pressure | {N} items | {SCORE}/100 | {STATUS} |
| Staleness ratio | {N}% | {SCORE}/100 | {STATUS} |
| Confidence distribution | {DESCRIPTION} | {SCORE}/100 | {STATUS} |
| Conflict count | {N} | {SCORE}/100 | {STATUS} |
| Coverage gaps | {N} active dirs uncovered | {SCORE}/100 | {STATUS} |
| Compression opportunity | {N} clusters | {SCORE}/100 | {STATUS} |

### Recommendations
{Specific, actionable recommendations based on the metric breakdown}
```

## When to Run Health Checks

- **On user request**: "Check KB health", "How is the knowledge base doing", "Knowledge base status"
- **During evolution**: As step 1, before making any changes. This establishes a baseline.
- **Periodic suggestion**: When manifest.json shows `days_since_evolution > 14`, suggest a health check to the user (do not run it automatically)
- **After major project changes**: Large refactors, migrations, or dependency upgrades likely invalidated multiple knowledge files. A health check identifies what needs updating.
