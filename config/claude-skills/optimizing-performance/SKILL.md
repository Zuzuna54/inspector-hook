---
name: optimizing-performance
description: Optimizes application performance through profiling and targeted improvements. Use when investigating slow code, improving response times, reducing memory usage, or optimizing frontend loading.
allowed-tools: Read, Edit, Bash, Grep, Glob
---

# Optimizing Performance

## Instructions

When optimizing performance:

1. **Measure first**: Profile before optimizing
2. **Find bottlenecks**: 80% of time is in 20% of code
3. **Target high-impact**: Biggest gains with least effort
4. **Verify improvements**: Benchmark before and after

## Profiling

### Node.js
```bash
# CPU profiling
node --prof app.js
node --prof-process isolate-*.log > profile.txt

# Heap snapshot
node --heapsnapshot-signal=SIGUSR2 app.js
kill -USR2 <pid>

# With clinic.js
npx clinic doctor -- node app.js
```

### Python
```bash
# CPU profiling
python -m cProfile -s cumulative script.py

# Line profiling
pip install line_profiler
kernprof -l -v script.py

# Memory profiling
pip install memory_profiler
python -m memory_profiler script.py
```

### Browser
```javascript
// Performance timing
console.time('operation');
// ... code
console.timeEnd('operation');

// Performance API
performance.mark('start');
// ... code
performance.mark('end');
performance.measure('operation', 'start', 'end');
```

## Common Bottlenecks

### Synchronous Operations
```javascript
// SLOW: Blocking I/O
const data = fs.readFileSync('large-file.json');

// FAST: Non-blocking
const data = await fs.promises.readFile('large-file.json');
```

### Sequential vs Parallel
```javascript
// SLOW: Sequential (3 seconds total)
const users = await fetchUsers();      // 1s
const orders = await fetchOrders();    // 1s
const products = await fetchProducts(); // 1s

// FAST: Parallel (1 second total)
const [users, orders, products] = await Promise.all([
  fetchUsers(),
  fetchOrders(),
  fetchProducts()
]);
```

### N+1 Queries
```javascript
// SLOW: N+1 queries
const users = await User.findAll();
for (const user of users) {
  user.orders = await Order.findByUser(user.id);
}

// FAST: Eager loading
const users = await User.findAll({
  include: [Order]
});

// FAST: Batch query
const userIds = users.map(u => u.id);
const orders = await Order.findAll({
  where: { userId: userIds }
});
```

### Inefficient Algorithms
```javascript
// SLOW: O(n²) - nested loops
for (const a of listA) {
  for (const b of listB) {
    if (a.id === b.id) match(a, b);
  }
}

// FAST: O(n) - hash lookup
const mapB = new Map(listB.map(b => [b.id, b]));
for (const a of listA) {
  const b = mapB.get(a.id);
  if (b) match(a, b);
}
```

## Caching Strategies

### In-Memory Cache
```javascript
const cache = new Map();
const CACHE_TTL = 60000; // 1 minute

async function getCached(key, fetchFn) {
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiry) {
    return cached.value;
  }

  const value = await fetchFn();
  cache.set(key, {
    value,
    expiry: Date.now() + CACHE_TTL
  });
  return value;
}
```

### HTTP Caching
```javascript
// Cache-Control headers
res.set('Cache-Control', 'public, max-age=3600'); // 1 hour
res.set('ETag', hash(data));
```

### Redis Caching
```javascript
async function getCached(key, fetchFn, ttl = 3600) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const value = await fetchFn();
  await redis.setex(key, ttl, JSON.stringify(value));
  return value;
}
```

## Frontend Performance

### Bundle Optimization
```javascript
// Code splitting
const Dashboard = React.lazy(() => import('./Dashboard'));

// Tree shaking - import only what's needed
import { map, filter } from 'lodash-es';
// NOT: import _ from 'lodash';
```

### Image Optimization
```html
<!-- Responsive images -->
<img
  srcset="image-400.jpg 400w, image-800.jpg 800w"
  sizes="(max-width: 600px) 400px, 800px"
  loading="lazy"
  alt="Description"
/>
```

### Core Web Vitals
- **LCP** (Largest Contentful Paint): < 2.5s
- **FID** (First Input Delay): < 100ms
- **CLS** (Cumulative Layout Shift): < 0.1

## Performance Patterns

### Debouncing
```javascript
function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

// Usage: Only search after user stops typing
const debouncedSearch = debounce(search, 300);
```

### Throttling
```javascript
function throttle(fn, limit) {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Usage: Limit scroll handler
window.addEventListener('scroll', throttle(onScroll, 100));
```

### Pagination/Virtualization
```javascript
// Only render visible items
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={400}
  itemCount={10000}
  itemSize={50}
>
  {({ index, style }) => (
    <div style={style}>{items[index]}</div>
  )}
</FixedSizeList>
```

## Performance Checklist

- [ ] Profiled to find actual bottlenecks
- [ ] No unnecessary blocking operations
- [ ] Parallel execution where possible
- [ ] Efficient algorithms (check Big O)
- [ ] Caching for repeated operations
- [ ] Database queries optimized
- [ ] Bundle size minimized
- [ ] Images optimized and lazy loaded
- [ ] Benchmarks show improvement
