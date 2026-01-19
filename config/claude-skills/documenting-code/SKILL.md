---
name: documenting-code
description: Creates clear technical documentation including READMEs, API docs, code comments, and architectural docs. Use when documenting code, writing READMEs, creating API documentation, or adding code comments.
allowed-tools: Read, Write, Edit, Glob, Grep
---

# Documenting Code

## Instructions

When documenting:

1. **Know the audience**: New devs, API consumers, future you
2. **Be accurate**: Wrong docs are worse than no docs
3. **Show examples**: Code examples > prose explanations
4. **Keep current**: Update docs with code changes

## README Structure

```markdown
# Project Name

One-line description of what this does.

## Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

## Installation

Step-by-step setup instructions.

## Usage

Common use cases with examples.

## Configuration

Available options and environment variables.

## API Reference

Link to detailed API docs.

## Contributing

How to contribute to the project.

## License

License information.
```

## Code Comments

### When to Comment
- Complex algorithms
- Non-obvious business logic
- Workarounds with reasons
- Public APIs

### When NOT to Comment
```javascript
// Bad: States the obvious
i++; // Increment i

// Bad: Restates code
// Loop through users
for (const user of users) { }

// Good: Explains WHY
// Use binary search for O(log n) performance on sorted data
const index = binarySearch(sortedArray, target);

// Good: Documents workaround
// Safari doesn't support ResizeObserver on SVG elements
// See: https://bugs.webkit.org/show_bug.cgi?id=123456
if (isSafari && element instanceof SVGElement) {
  useFallbackResize(element);
}
```

## Function Documentation

### JSDoc Format
```javascript
/**
 * Calculates the total price with applicable discounts.
 *
 * @param {number} basePrice - The original price before discounts
 * @param {Object} options - Discount options
 * @param {number} [options.percentOff=0] - Percentage discount (0-100)
 * @param {number} [options.flatOff=0] - Flat amount discount
 * @returns {number} The final price after discounts
 * @throws {Error} If basePrice is negative
 *
 * @example
 * calculateTotal(100, { percentOff: 20 }); // Returns 80
 * calculateTotal(100, { flatOff: 15 }); // Returns 85
 */
function calculateTotal(basePrice, options = {}) { }
```

### Python Docstring
```python
def calculate_total(base_price: float, percent_off: float = 0) -> float:
    """Calculate the total price with applicable discounts.

    Args:
        base_price: The original price before discounts.
        percent_off: Percentage discount (0-100). Defaults to 0.

    Returns:
        The final price after discounts.

    Raises:
        ValueError: If base_price is negative.

    Example:
        >>> calculate_total(100, percent_off=20)
        80.0
    """
```

## API Documentation

### Endpoint Documentation
```markdown
## Create User

Creates a new user account.

**Endpoint:** `POST /api/users`

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| Authorization | Yes | Bearer token |
| Content-Type | Yes | application/json |

**Request Body:**
\`\`\`json
{
  "email": "user@example.com",
  "name": "John Doe",
  "role": "user"
}
\`\`\`

**Response:** `201 Created`
\`\`\`json
{
  "id": "usr_123",
  "email": "user@example.com",
  "name": "John Doe",
  "createdAt": "2024-01-15T10:30:00Z"
}
\`\`\`

**Errors:**
| Status | Code | Description |
|--------|------|-------------|
| 400 | INVALID_EMAIL | Email format is invalid |
| 409 | EMAIL_EXISTS | Email already registered |
```

## Documentation Checklist

- [ ] Accurate and up-to-date
- [ ] Examples are tested and work
- [ ] Consistent terminology
- [ ] Scannable structure (headings, lists)
- [ ] Appropriate for audience
- [ ] No typos or grammar errors

## Anti-Patterns

- **Wall of text**: Break up with headings and lists
- **Outdated info**: Keep synced with code
- **Missing examples**: Every concept needs demonstration
- **Jargon overload**: Define terms or use simpler words
- **Over-documenting obvious code**: Let clear code speak
