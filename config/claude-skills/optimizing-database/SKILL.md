---
name: optimizing-database
description: Optimizes database queries and schema design for performance. Use when writing SQL queries, fixing slow queries, designing schemas, or troubleshooting database performance.
allowed-tools: Read, Edit, Bash, Grep, Glob
---

# Optimizing Database

## Instructions

When optimizing databases:

1. **Measure first**: Use EXPLAIN to understand query plans
2. **Index strategically**: Add indexes for common query patterns
3. **Optimize queries**: Rewrite inefficient queries
4. **Monitor continuously**: Track slow queries in production

## Query Analysis

### PostgreSQL
```sql
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE user_id = 123
AND status = 'pending';
```

### MySQL
```sql
EXPLAIN
SELECT * FROM orders
WHERE user_id = 123
AND status = 'pending';

-- More details
EXPLAIN FORMAT=JSON SELECT ...;
```

### Key Metrics to Watch
- **Seq Scan**: Full table scan (often bad)
- **Index Scan**: Using index (usually good)
- **Rows**: Estimated vs actual rows
- **Cost**: Relative query cost
- **Time**: Actual execution time

## Indexing Strategies

### When to Add Indexes
- Columns in WHERE clauses
- Columns in JOIN conditions
- Columns in ORDER BY
- Columns with high selectivity

### Index Types
```sql
-- B-tree (default, most common)
CREATE INDEX idx_users_email ON users(email);

-- Composite index (column order matters!)
CREATE INDEX idx_orders_user_status ON orders(user_id, status);

-- Covering index (includes extra columns)
CREATE INDEX idx_orders_covering ON orders(user_id, status)
INCLUDE (total, created_at);

-- Partial index (subset of rows)
CREATE INDEX idx_orders_pending ON orders(user_id)
WHERE status = 'pending';
```

### Index Column Order
```sql
-- For queries like: WHERE user_id = ? AND status = ?
-- Index on (user_id, status) works for:
WHERE user_id = 123                    -- ✓ Uses index
WHERE user_id = 123 AND status = 'x'   -- ✓ Uses index
WHERE status = 'pending'               -- ✗ Cannot use index

-- Column order should match query patterns
```

## Common Performance Issues

### N+1 Queries
```sql
-- Bad: N+1 (1 query for users + N queries for orders)
SELECT * FROM users;
-- Then for each user:
SELECT * FROM orders WHERE user_id = ?;

-- Good: Single query with JOIN
SELECT u.*, o.*
FROM users u
LEFT JOIN orders o ON o.user_id = u.id;

-- Or batch query
SELECT * FROM orders WHERE user_id IN (1, 2, 3, 4, 5);
```

### SELECT *
```sql
-- Bad: Fetches all columns
SELECT * FROM users WHERE id = 123;

-- Good: Only needed columns
SELECT id, name, email FROM users WHERE id = 123;
```

### Missing LIMIT
```sql
-- Bad: Could return millions of rows
SELECT * FROM logs WHERE level = 'error';

-- Good: Bounded result set
SELECT * FROM logs WHERE level = 'error'
ORDER BY created_at DESC
LIMIT 100;
```

### Inefficient JOINs
```sql
-- Bad: Joining large tables without filters
SELECT * FROM orders o
JOIN order_items oi ON oi.order_id = o.id;

-- Good: Filter first, then join
SELECT * FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.created_at > '2024-01-01';
```

## Query Optimization Patterns

### Use EXISTS Instead of IN
```sql
-- Slower for large subqueries
SELECT * FROM users
WHERE id IN (SELECT user_id FROM orders WHERE total > 100);

-- Faster with EXISTS
SELECT * FROM users u
WHERE EXISTS (
  SELECT 1 FROM orders o
  WHERE o.user_id = u.id AND o.total > 100
);
```

### Avoid Functions on Indexed Columns
```sql
-- Bad: Cannot use index on created_at
WHERE YEAR(created_at) = 2024

-- Good: Index can be used
WHERE created_at >= '2024-01-01'
  AND created_at < '2025-01-01'
```

### Pagination
```sql
-- Offset pagination (slow for large offsets)
SELECT * FROM users
ORDER BY id
LIMIT 20 OFFSET 10000;  -- Scans 10020 rows

-- Cursor pagination (consistent performance)
SELECT * FROM users
WHERE id > 10000
ORDER BY id
LIMIT 20;
```

## Schema Design Tips

### Normalize vs Denormalize
- **Normalize** for data integrity, less storage
- **Denormalize** for read performance, simpler queries
- **Balance**: Normalize writes, denormalize read-heavy data

### Data Types
```sql
-- Use appropriate sizes
user_id INT           -- Not BIGINT if < 2 billion
status VARCHAR(20)    -- Not VARCHAR(255)
price DECIMAL(10,2)   -- Not FLOAT for money
```

### Constraints
```sql
-- Foreign keys for integrity
ALTER TABLE orders
ADD CONSTRAINT fk_user
FOREIGN KEY (user_id) REFERENCES users(id);

-- NOT NULL where appropriate
email VARCHAR(255) NOT NULL
```

## Performance Checklist

- [ ] EXPLAIN shows Index Scan (not Seq Scan)
- [ ] Indexes exist for common WHERE clauses
- [ ] No N+1 query patterns
- [ ] SELECT specifies needed columns only
- [ ] Large queries have LIMIT
- [ ] JOINs are on indexed columns
- [ ] No functions on indexed columns in WHERE
