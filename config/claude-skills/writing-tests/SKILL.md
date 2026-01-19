---
name: writing-tests
description: Writes effective tests following TDD principles and testing best practices. Use when creating tests, improving coverage, implementing TDD, or fixing flaky tests.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Writing Tests

## Instructions

When writing tests:

1. **Understand what to test**: Behavior, not implementation
2. **Follow the test pyramid**: Many unit, some integration, few E2E
3. **Use AAA pattern**: Arrange, Act, Assert
4. **Keep tests focused**: One logical assertion per test

## Test Pyramid

```
        /\
       /E2E\     Few, slow, high-value
      /------\
     /Integr- \  Some, moderate speed
    /  ation   \
   /------------\
  /    Unit      \ Many, fast, focused
 /________________\
```

## Test Structure (AAA Pattern)

```javascript
describe('Calculator', () => {
  it('should add two positive numbers', () => {
    // Arrange
    const calc = new Calculator();

    // Act
    const result = calc.add(2, 3);

    // Assert
    expect(result).toBe(5);
  });
});
```

## Naming Convention

Pattern: `should [expected behavior] when [condition]`

```javascript
it('should return null when user is not found')
it('should throw error when input is invalid')
it('should retry three times when request fails')
```

## What to Test

### Unit Tests
- Pure functions
- Business logic
- Edge cases (null, empty, boundaries)
- Error conditions

### Integration Tests
- API endpoints
- Database operations
- External service calls
- Authentication flows

### E2E Tests
- Critical user journeys
- Payment flows
- Sign-up/login
- Core business processes

## Edge Cases Checklist

- [ ] Null/undefined inputs
- [ ] Empty strings/arrays/objects
- [ ] Zero and negative numbers
- [ ] Boundary values (0, 1, MAX_INT)
- [ ] Very large inputs
- [ ] Special characters
- [ ] Concurrent operations
- [ ] Network failures
- [ ] Timeout conditions

## Testing Patterns

### Testing Async Code
```javascript
it('should fetch user data', async () => {
  const user = await fetchUser(123);
  expect(user.name).toBe('John');
});
```

### Testing Errors
```javascript
it('should throw on invalid input', () => {
  expect(() => validate(null)).toThrow('Input required');
});

// Async errors
it('should reject on network failure', async () => {
  await expect(fetchData()).rejects.toThrow('Network error');
});
```

### Testing with Mocks
```javascript
it('should call payment gateway', async () => {
  const mockGateway = jest.fn().mockResolvedValue({ success: true });

  await processPayment(mockGateway, 100);

  expect(mockGateway).toHaveBeenCalledWith(100);
});
```

## TDD Workflow

1. **Red**: Write a failing test
2. **Green**: Write minimal code to pass
3. **Refactor**: Clean up while tests pass

```javascript
// 1. RED - Write test first
it('should calculate discount for premium users', () => {
  const user = { isPremium: true };
  expect(calculateDiscount(user, 100)).toBe(20);
});

// 2. GREEN - Make it pass (minimal)
function calculateDiscount(user, amount) {
  if (user.isPremium) return amount * 0.2;
  return 0;
}

// 3. REFACTOR - Improve code
const PREMIUM_DISCOUNT_RATE = 0.2;
function calculateDiscount(user, amount) {
  return user.isPremium ? amount * PREMIUM_DISCOUNT_RATE : 0;
}
```

## Test Quality Checklist

- [ ] Tests are independent (no shared state)
- [ ] Tests are deterministic (no randomness)
- [ ] Tests are fast (unit < 100ms)
- [ ] Tests are readable
- [ ] Tests cover happy path AND edge cases
- [ ] Tests don't test implementation details
- [ ] Mocks are minimal and appropriate
- [ ] Test data is clear and minimal

## Anti-Patterns to Avoid

- **Testing implementation**: Assert on behavior, not internals
- **Flaky tests**: No timing, randomness, or order dependence
- **Too many mocks**: If mocking everything, test is meaningless
- **Duplicate setup**: Use beforeEach for common setup
- **Assertions in loops**: Make each case a separate test
- **No assertions**: Every test must assert something
