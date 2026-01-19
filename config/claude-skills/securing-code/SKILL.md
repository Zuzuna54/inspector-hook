---
name: securing-code
description: Identifies and fixes security vulnerabilities following OWASP guidelines. Use when reviewing code for security, implementing authentication, handling user input, or addressing security concerns.
allowed-tools: Read, Edit, Grep, Glob, Bash
---

# Securing Code

## Instructions

When securing code:

1. **Think like an attacker**: What could be exploited?
2. **Validate all inputs**: Never trust user data
3. **Apply defense in depth**: Multiple security layers
4. **Follow least privilege**: Minimum access required

## OWASP Top 10 Quick Reference

### 1. Injection (SQL, Command, etc.)
```javascript
// VULNERABLE: SQL injection
const query = `SELECT * FROM users WHERE id = ${userId}`;

// SECURE: Parameterized query
const query = 'SELECT * FROM users WHERE id = $1';
await db.query(query, [userId]);
```

```javascript
// VULNERABLE: Command injection
exec(`convert ${filename} output.png`);

// SECURE: Use array arguments
execFile('convert', [filename, 'output.png']);
```

### 2. Broken Authentication
```javascript
// SECURE: Strong password hashing
const bcrypt = require('bcrypt');
const hash = await bcrypt.hash(password, 12);
const valid = await bcrypt.compare(password, hash);

// SECURE: Session management
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,      // HTTPS only
    httpOnly: true,    // No JS access
    sameSite: 'strict' // CSRF protection
  }
}));
```

### 3. Sensitive Data Exposure
```javascript
// VULNERABLE: Logging sensitive data
console.log('User login:', { email, password });

// SECURE: Redact sensitive fields
console.log('User login:', { email, password: '[REDACTED]' });

// SECURE: Never return sensitive data
return {
  id: user.id,
  email: user.email
  // NOT: password, tokens, etc.
};
```

### 4. XSS (Cross-Site Scripting)
```javascript
// VULNERABLE: Direct HTML insertion
element.innerHTML = userInput;

// SECURE: Text content or sanitization
element.textContent = userInput;
// Or sanitize HTML
element.innerHTML = DOMPurify.sanitize(userInput);
```

```javascript
// SECURE: React automatically escapes
return <div>{userInput}</div>;

// VULNERABLE: Bypassing React's protection
return <div dangerouslySetInnerHTML={{__html: userInput}} />;
```

### 5. Broken Access Control
```javascript
// VULNERABLE: No authorization check
app.get('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  res.json(user);
});

// SECURE: Check authorization
app.get('/users/:id', async (req, res) => {
  if (req.user.id !== req.params.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const user = await User.findById(req.params.id);
  res.json(user);
});
```

### 6. Security Misconfiguration
```javascript
// SECURE: Security headers
app.use(helmet());  // Sets many security headers

// SECURE: CORS configuration
app.use(cors({
  origin: ['https://example.com'],
  credentials: true
}));

// SECURE: Disable debug in production
if (process.env.NODE_ENV === 'production') {
  app.set('env', 'production');
}
```

## Input Validation

### Validation Rules
```javascript
// SECURE: Comprehensive validation
const schema = Joi.object({
  email: Joi.string().email().required(),
  age: Joi.number().integer().min(0).max(150),
  name: Joi.string().max(100).pattern(/^[a-zA-Z\s]+$/),
  url: Joi.string().uri({ scheme: ['http', 'https'] })
});
```

### Sanitization
```javascript
// Sanitize for different contexts
const sanitizeHtml = require('sanitize-html');
const clean = sanitizeHtml(dirty, {
  allowedTags: ['b', 'i', 'em', 'strong'],
  allowedAttributes: {}
});
```

## Authentication Best Practices

### Password Requirements
- Minimum 8 characters
- No maximum length (up to reasonable limit)
- Check against breached password lists
- Allow all printable characters

### Token Security
```javascript
// SECURE: JWT best practices
const token = jwt.sign(
  { userId: user.id },
  process.env.JWT_SECRET,
  {
    expiresIn: '1h',
    algorithm: 'RS256'  // Use asymmetric if possible
  }
);
```

## Secrets Management

```javascript
// NEVER: Hardcoded secrets
const API_KEY = 'sk_live_abc123';

// SECURE: Environment variables
const API_KEY = process.env.API_KEY;

// SECURE: Check for required secrets at startup
const required = ['API_KEY', 'DB_PASSWORD', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}
```

## Security Checklist

- [ ] All user input validated and sanitized
- [ ] Parameterized queries (no SQL injection)
- [ ] Output encoding (no XSS)
- [ ] Authentication on all protected routes
- [ ] Authorization checks (access control)
- [ ] Sensitive data encrypted at rest and in transit
- [ ] No secrets in code or logs
- [ ] Security headers configured
- [ ] Dependencies up to date
- [ ] Error messages don't leak information

## Common Vulnerabilities to Check

```bash
# Search for potential issues
grep -r "innerHTML" --include="*.js"
grep -r "eval(" --include="*.js"
grep -r "exec(" --include="*.js"
grep -r "password" --include="*.{js,json,env}"
grep -rE "(api_key|apikey|secret)" --include="*.{js,json}"
```
