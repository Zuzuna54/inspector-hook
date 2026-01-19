---
name: designing-apis
description: Designs RESTful APIs and GraphQL schemas following best practices. Use when designing API endpoints, planning API structure, or reviewing API design decisions.
allowed-tools: Read, Write, Edit, Grep, Glob
---

# Designing APIs

## Instructions

When designing APIs:

1. **Understand requirements**: What operations, what data, who consumes
2. **Follow conventions**: RESTful principles, consistent naming
3. **Plan for evolution**: Versioning, backwards compatibility
4. **Document clearly**: Every endpoint, parameter, response

## REST API Principles

### Resource-Based URLs
```
# Good - Resources as nouns
GET    /users           # List users
GET    /users/123       # Get user
POST   /users           # Create user
PUT    /users/123       # Update user
DELETE /users/123       # Delete user

# Bad - Actions in URLs
GET    /getUsers
POST   /createUser
POST   /users/123/delete
```

### HTTP Methods

| Method | Purpose | Idempotent | Safe |
|--------|---------|------------|------|
| GET | Read resource | Yes | Yes |
| POST | Create resource | No | No |
| PUT | Replace resource | Yes | No |
| PATCH | Partial update | No | No |
| DELETE | Remove resource | Yes | No |

### Status Codes

| Code | Meaning | When to Use |
|------|---------|-------------|
| 200 | OK | Successful GET, PUT, PATCH |
| 201 | Created | Successful POST |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Invalid input |
| 401 | Unauthorized | Missing/invalid auth |
| 403 | Forbidden | Valid auth, no permission |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate, version conflict |
| 422 | Unprocessable | Validation failed |
| 500 | Server Error | Unexpected error |

## URL Design

### Hierarchical Resources
```
# Users and their orders
GET /users/123/orders
GET /users/123/orders/456

# But avoid deep nesting (>2 levels)
# Bad: /users/123/orders/456/items/789/reviews
# Better: /order-items/789/reviews
```

### Filtering, Sorting, Pagination
```
# Filtering
GET /users?status=active&role=admin

# Sorting
GET /users?sort=created_at&order=desc

# Pagination
GET /users?page=2&limit=20
GET /users?cursor=abc123&limit=20  # Cursor-based (better for large sets)
```

### Search
```
GET /users/search?q=john
GET /search?type=users&q=john
```

## Request/Response Design

### Request Body
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "preferences": {
    "notifications": true,
    "theme": "dark"
  }
}
```

### Success Response
```json
{
  "data": {
    "id": "usr_123",
    "email": "user@example.com",
    "name": "John Doe",
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "meta": {
    "requestId": "req_abc123"
  }
}
```

### List Response
```json
{
  "data": [
    { "id": "usr_123", "name": "John" },
    { "id": "usr_124", "name": "Jane" }
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "hasMore": true
  }
}
```

### Error Response
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input provided",
    "details": [
      {
        "field": "email",
        "message": "Must be a valid email address"
      }
    ]
  },
  "meta": {
    "requestId": "req_abc123"
  }
}
```

## Versioning

### URL Versioning (Recommended)
```
GET /v1/users
GET /v2/users
```

### Header Versioning
```
GET /users
Accept: application/vnd.api+json; version=2
```

## API Design Checklist

- [ ] Resources named as nouns (plural)
- [ ] Correct HTTP methods used
- [ ] Appropriate status codes
- [ ] Consistent response format
- [ ] Pagination for list endpoints
- [ ] Proper error responses
- [ ] Authentication documented
- [ ] Rate limiting considered
- [ ] Versioning strategy defined

## Anti-Patterns

- **Verbs in URLs**: `/getUser` vs `/users/{id}`
- **Inconsistent naming**: `/users` vs `/Orders`
- **Wrong status codes**: 200 for errors
- **No pagination**: Returning unbounded lists
- **Nested data overload**: Return only what's needed
- **Breaking changes**: Without version bump
