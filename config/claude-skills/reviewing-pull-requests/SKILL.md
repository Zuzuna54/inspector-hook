---
name: reviewing-pull-requests
description: Reviews pull requests for code quality, security, performance, and best practices. Use when reviewing PRs, checking changes, auditing code, or preparing code review feedback.
allowed-tools: Read, Grep, Glob, Bash(git:*)
---

# Reviewing Pull Requests

## Instructions

When reviewing a PR:

1. **Understand context**: Read PR description and linked issues
2. **Review changes**: `git diff main...HEAD` or `git diff origin/main`
3. **Check systematically**: Follow the review checklist
4. **Provide actionable feedback**: Specific, constructive, prioritized

## Review Checklist

### Code Quality
- [ ] Clear, readable, self-documenting code
- [ ] Functions have single responsibility
- [ ] No code duplication (DRY)
- [ ] Appropriate naming conventions
- [ ] Dead code removed

### Logic & Correctness
- [ ] Edge cases handled (null, empty, boundaries)
- [ ] Error handling comprehensive
- [ ] No off-by-one errors
- [ ] Async/await used correctly
- [ ] Race conditions considered

### Security
- [ ] No hardcoded secrets
- [ ] Input validation present
- [ ] SQL injection prevented
- [ ] XSS prevented
- [ ] Auth/authz checks in place

### Performance
- [ ] No N+1 queries
- [ ] Appropriate data structures
- [ ] No memory leaks
- [ ] Large data paginated

### Testing
- [ ] Tests cover changes
- [ ] Edge cases tested
- [ ] Tests aren't brittle

### Documentation
- [ ] Complex logic commented
- [ ] Public APIs documented
- [ ] README updated if needed

## Feedback Format

Organize by severity:

### Critical (Must Fix)
Bugs, security issues, data loss risks.

### Warnings (Should Fix)
Performance issues, code smells, potential problems.

### Suggestions (Consider)
Style improvements, alternative approaches.

### Praise
Highlight good patterns worth replicating.

## Comment Templates

**Bug found:**
```
**Bug**: [description]
**Impact**: [what could go wrong]
**Suggestion**: [how to fix]
```

**Suggestion:**
```
**Consider**: [alternative approach]
**Reason**: [why it might be better]
```

**Question:**
```
**Question**: [what you're unclear about]
**Context**: [why it matters]
```

## Example Review Comments

**Security issue:**
```
Critical: SQL injection vulnerability

This query interpolates user input directly:
`query = f"SELECT * FROM users WHERE id = {user_id}"`

Use parameterized queries instead:
`query = "SELECT * FROM users WHERE id = %s", (user_id,)`
```

**Performance concern:**
```
Warning: N+1 query detected

This fetches orders in a loop, causing N+1 queries:
for user in users:
    orders = get_orders(user.id)

Consider eager loading or batch fetching.
```

**Style suggestion:**
```
Suggestion: Extract magic number

`if retries > 3` - consider `MAX_RETRIES = 3`
for clarity and easy modification.
```

## Review Mindset

- **Assume good intent**: Author made reasonable choices
- **Ask questions**: "What happens if...?" not "This is wrong"
- **Be specific**: Point to exact lines, suggest exact fixes
- **Prioritize**: Not everything needs to block merge
- **Learn**: Good reviews teach both parties
