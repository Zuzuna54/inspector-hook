---
name: generating-commit-messages
description: Generates clear, conventional commit messages from git diffs. Use when writing commit messages, reviewing staged changes, or preparing commits.
allowed-tools: Read, Bash(git:*)
---

# Generating Commit Messages

## Instructions

When generating commit messages:

1. **Analyze changes**: Run `git diff --staged` to see what's being committed
2. **Identify the type**: Determine the primary change category
3. **Write the message**: Follow conventional commit format
4. **Include context**: Explain why, not just what

## Conventional Commit Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Types

| Type | When to Use |
|------|-------------|
| `feat` | New feature for the user |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change, no feature/fix |
| `perf` | Performance improvement |
| `test` | Adding/fixing tests |
| `chore` | Maintenance, deps, config |
| `ci` | CI/CD changes |
| `build` | Build system changes |

### Scope

Optional, identifies the affected area:
- `auth`, `api`, `ui`, `db`, `config`, etc.

### Subject Line Rules

- **50 characters max** (hard limit: 72)
- Imperative mood: "add" not "added" or "adds"
- No period at end
- Lowercase first letter

## Examples

**Single file change:**
```
fix(auth): prevent session timeout on idle

Users were being logged out after 5 minutes even with
activity. Extended timeout check to include API calls.

Fixes #234
```

**Multiple related changes:**
```
feat(dashboard): add real-time notifications

- Implement WebSocket connection for live updates
- Add notification bell component with badge count
- Store notification preferences in user settings

Closes #567
```

**Refactoring:**
```
refactor(utils): consolidate date formatting functions

Replace scattered date utilities with unified DateFormatter class.
No functional changes - all existing tests pass.
```

**Breaking change:**
```
feat(api)!: change authentication to JWT

BREAKING CHANGE: API now requires Bearer token instead of
session cookie. See migration guide in docs/auth-migration.md
```

## Anti-Patterns

- "Fixed stuff" - Too vague
- "WIP" - Not ready to commit
- "asdfasdf" - Meaningless
- "Updated file.js" - Describes what, not why
- Commit message longer than the code change
