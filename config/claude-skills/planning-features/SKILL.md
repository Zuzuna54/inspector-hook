---
name: planning-features
description: Plans feature implementations with clear requirements, architecture decisions, and implementation steps. Use when planning new features, designing systems, breaking down tasks, or creating implementation roadmaps.
allowed-tools: Read, Write, Edit, Grep, Glob
---

# Planning Features

## Instructions

When planning features:

1. **Understand requirements**: What problem does this solve?
2. **Research existing code**: What patterns exist?
3. **Design the solution**: Consider tradeoffs
4. **Break into tasks**: Small, implementable steps
5. **Identify risks**: What could go wrong?

## Planning Process

### Step 1: Requirements Gathering
```markdown
## Feature: [Name]

### Problem Statement
What problem are we solving? Who has this problem?

### Success Criteria
- [ ] User can [specific action]
- [ ] System handles [edge case]
- [ ] Performance meets [metric]

### Out of Scope
- What we're NOT building
- Future considerations
```

### Step 2: Technical Research
```bash
# Understand existing patterns
grep -r "similar_feature" --include="*.{ts,js}"

# Find related code
find . -name "*related*" -type f

# Check dependencies
cat package.json | grep -A 20 "dependencies"
```

### Step 3: Solution Design

#### Option Analysis
```markdown
## Options Considered

### Option A: [Name]
**Approach**: [Description]
**Pros**: [Benefits]
**Cons**: [Drawbacks]
**Effort**: [Low/Medium/High]

### Option B: [Name]
**Approach**: [Description]
**Pros**: [Benefits]
**Cons**: [Drawbacks]
**Effort**: [Low/Medium/High]

### Recommendation
Option [X] because [reasoning]
```

### Step 4: Implementation Plan
```markdown
## Implementation Tasks

### Phase 1: Foundation
- [ ] Task 1 (2h) - [Description]
- [ ] Task 2 (4h) - [Description]
  - Depends on: Task 1
- [ ] Task 3 (2h) - [Description]

### Phase 2: Core Logic
- [ ] Task 4 (4h) - [Description]
- [ ] Task 5 (3h) - [Description]

### Phase 3: Polish
- [ ] Task 6 (2h) - [Description]
- [ ] Task 7 (1h) - [Description]
```

## Feature Design Template

```markdown
# Feature: [Name]

## Overview
[One paragraph description]

## User Stories
- As a [user type], I want to [action] so that [benefit]

## Requirements

### Functional
1. System shall [requirement]
2. User shall be able to [requirement]

### Non-Functional
- Performance: [requirement]
- Security: [requirement]
- Accessibility: [requirement]

## Technical Design

### Architecture
[High-level component description]

### Data Model
[New/modified database schema]

### API Changes
[New/modified endpoints]

### UI Changes
[New/modified screens]

## Implementation Plan

### Tasks
1. [Task] - [effort]
2. [Task] - [effort]

### Dependencies
- External: [dependencies]
- Internal: [dependencies]

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk] | [Impact] | [Mitigation] |

## Testing Strategy
- Unit tests: [coverage areas]
- Integration tests: [scenarios]
- Manual testing: [test cases]

## Rollout Plan
1. [Phase]: [description]
2. [Phase]: [description]
```

## Breaking Down Tasks

### Good Task Characteristics
- **Specific**: Clear deliverable
- **Small**: Completable in 1-4 hours
- **Testable**: Can verify completion
- **Independent**: Minimal dependencies

### Task Breakdown Example
```markdown
## Feature: User Profile Page

### Bad Breakdown
- [ ] Build profile page (16h)

### Good Breakdown
- [ ] Create profile page route (30m)
- [ ] Build profile header component (2h)
- [ ] Add profile avatar upload (3h)
- [ ] Create profile edit form (2h)
- [ ] Add form validation (1h)
- [ ] Connect to user API (1h)
- [ ] Add loading states (1h)
- [ ] Write component tests (2h)
- [ ] Add error handling (1h)
```

## Risk Assessment

### Common Risks
| Risk Type | Example | Mitigation |
|-----------|---------|------------|
| Technical | New technology | Spike/prototype first |
| Integration | Third-party API | Mock interface, fallback |
| Performance | Large data sets | Pagination, caching |
| Security | User input | Validation, sanitization |
| Scope | Requirements unclear | Clarify before building |

## Planning Checklist

- [ ] Problem clearly defined
- [ ] Success criteria measurable
- [ ] Existing code researched
- [ ] Options considered
- [ ] Solution chosen with reasoning
- [ ] Tasks broken down (<4h each)
- [ ] Dependencies identified
- [ ] Risks assessed with mitigations
- [ ] Testing strategy defined
- [ ] Stakeholder alignment confirmed
