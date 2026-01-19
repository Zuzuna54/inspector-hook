---
name: debugging-errors
description: Systematically debugs errors, exceptions, and unexpected behavior. Use when investigating bugs, analyzing stack traces, fixing errors, or troubleshooting issues.
allowed-tools: Read, Edit, Bash, Grep, Glob
---

# Debugging Errors

## Instructions

When debugging:

1. **Reproduce**: Confirm you can trigger the issue
2. **Isolate**: Find the smallest case that fails
3. **Understand**: Trace the root cause
4. **Fix**: Address the cause, not symptoms
5. **Verify**: Confirm fix works, no regressions

## Debugging Process

### Step 1: Gather Information
```bash
# Recent changes that might have caused the bug
git log --oneline -20
git diff HEAD~5

# Search for error patterns
grep -r "ErrorMessage" --include="*.{ts,js,py}"
```

### Step 2: Form Hypotheses
List 3-5 possible causes ranked by likelihood:
1. Most likely: [hypothesis]
2. Possible: [hypothesis]
3. Less likely: [hypothesis]

### Step 3: Test Each Hypothesis
For each, identify what evidence would confirm/refute it.

### Step 4: Find Root Cause
Trace backward from the error to its origin.

## Common Error Categories

### Null/Undefined Errors
```
TypeError: Cannot read property 'x' of undefined
```
**Debug**: Trace data flow backward to find where value is lost.

### Type Errors
```
TypeError: x is not a function
```
**Debug**: Check variable type at each step, look for shadowing.

### Async Errors
```
UnhandledPromiseRejection
```
**Debug**: Add try/catch, check all await points, verify error propagation.

### Network Errors
```
ECONNREFUSED, ETIMEDOUT
```
**Debug**: Check endpoint availability, auth, request format, timeout settings.

### Database Errors
```
Connection refused, Query timeout
```
**Debug**: Check connection string, pool settings, query performance.

## Debugging Techniques

### Strategic Logging
```javascript
console.log('[DEBUG] Function entry:', { param1, param2 });
console.log('[DEBUG] After API call:', { response });
console.log('[DEBUG] State before return:', { result });
```

### Binary Search Debugging
Comment out half the code. If error persists, it's in remaining half. Repeat.

### Rubber Duck Debugging
Explain the problem step by step out loud. Often reveals the issue.

### Check Assumptions
```javascript
// Add assertions for assumptions
console.assert(user !== null, 'User should exist at this point');
console.assert(Array.isArray(items), 'Items should be an array');
```

## Reading Stack Traces

```
Error: User not found
    at findUser (/app/services/user.js:45:11)     <- Error thrown here
    at processRequest (/app/handlers/api.js:23:5) <- Called from here
    at Router.handle (/app/routes/index.js:12:3)  <- Called from here
```

**Read bottom to top** to understand the call chain.
**Focus on YOUR code** - skip framework/library frames.

## Error Pattern Solutions

### "Cannot read property of undefined"
```javascript
// Problem
user.profile.name  // user.profile is undefined

// Solution 1: Optional chaining
user?.profile?.name

// Solution 2: Guard clause
if (!user?.profile) return null;
```

### "x is not a function"
```javascript
// Problem: callback is undefined
callback(result);

// Solution: Check before calling
if (typeof callback === 'function') {
  callback(result);
}
```

### Race Conditions
```javascript
// Problem: Data not ready
const data = fetchData();  // Missing await
process(data);  // data is a Promise, not data

// Solution
const data = await fetchData();
process(data);
```

## Debug Checklist

- [ ] Can reproduce consistently
- [ ] Identified exact error location
- [ ] Understood full call chain
- [ ] Found root cause (not just symptom)
- [ ] Fix addresses root cause
- [ ] Added test to prevent regression
- [ ] Cleaned up debug statements
- [ ] Verified no new issues introduced

## When Stuck

1. Take a break (fresh eyes help)
2. Explain to someone else
3. Check if it ever worked (git bisect)
4. Search error message + framework
5. Check framework/library issues
6. Simplify to minimal reproduction
