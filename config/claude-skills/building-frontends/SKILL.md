# Building Frontend Applications

## Overview
This skill covers best practices for building modern frontend applications with React, Next.js, and TypeScript.

## Project Structure (Next.js App Router)
```
src/
├── app/                    # App router pages
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home page
│   ├── (auth)/             # Auth route group
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   └── api/                # API routes
│       └── chat/route.ts
├── components/
│   ├── ui/                 # Primitive components
│   ├── forms/              # Form components
│   └── features/           # Feature-specific
├── hooks/                  # Custom hooks
├── lib/                    # Utilities
├── types/                  # TypeScript types
└── styles/                 # Global styles
```

## Component Patterns

### TypeScript Component
```tsx
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  children,
  onClick,
}: ButtonProps) {
  return (
    <button
      className={cn(variants[variant], sizes[size])}
      onClick={onClick}
      disabled={isLoading}
    >
      {isLoading ? <Spinner /> : children}
    </button>
  );
}
```

### Custom Hook
```tsx
export function useAsync<T>(
  asyncFn: () => Promise<T>,
  deps: unknown[] = []
) {
  const [state, setState] = useState<{
    data: T | null;
    error: Error | null;
    isLoading: boolean;
  }>({ data: null, error: null, isLoading: true });

  useEffect(() => {
    setState(s => ({ ...s, isLoading: true }));
    asyncFn()
      .then(data => setState({ data, error: null, isLoading: false }))
      .catch(error => setState({ data: null, error, isLoading: false }));
  }, deps);

  return state;
}
```

## Next.js Patterns

### Server Component (Default)
```tsx
// app/users/page.tsx
async function getUsers() {
  const res = await fetch('https://api.example.com/users', {
    next: { revalidate: 60 } // ISR
  });
  return res.json();
}

export default async function UsersPage() {
  const users = await getUsers();
  return <UserList users={users} />;
}
```

### Client Component
```tsx
'use client';

import { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(c => c + 1)}>
      Count: {count}
    </button>
  );
}
```

### Streaming Response
```tsx
// app/api/chat/route.ts
export async function POST(request: NextRequest) {
  const { message } = await request.json();

  const stream = new ReadableStream({
    async start(controller) {
      const response = await generateAI(message);
      for await (const chunk of response) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// Client consumption
'use client';

async function handleSubmit(message: string) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;
    setResponse(prev => prev + decoder.decode(value));
  }
}
```

## State Management

### Zustand (Simple Global State)
```tsx
import { create } from 'zustand';

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  login: (user) => set({ user, isAuthenticated: true }),
  logout: () => set({ user: null, isAuthenticated: false }),
}));
```

### TanStack Query (Server State)
```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => fetch('/api/users').then(r => r.json()),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateUserDTO) =>
      fetch('/api/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
```

## Styling with Tailwind

### Component Variants
```tsx
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md font-medium',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground',
        outline: 'border border-input bg-background hover:bg-accent',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);
```

## Performance Optimization

### Image Optimization
```tsx
import Image from 'next/image';

<Image
  src="/hero.jpg"
  alt="Hero"
  width={1200}
  height={600}
  priority           // Above the fold
  placeholder="blur" // Show blur while loading
/>
```

### Code Splitting
```tsx
import dynamic from 'next/dynamic';

const HeavyComponent = dynamic(
  () => import('@/components/HeavyComponent'),
  {
    loading: () => <Skeleton />,
    ssr: false,
  }
);
```

### Memoization
```tsx
import { memo, useMemo, useCallback } from 'react';

const ExpensiveList = memo(function ExpensiveList({ items }) {
  const sorted = useMemo(
    () => items.sort((a, b) => a.name.localeCompare(b.name)),
    [items]
  );

  const handleClick = useCallback((id: string) => {
    // handle click
  }, []);

  return <ul>{sorted.map(item => <Item key={item.id} onClick={handleClick} />)}</ul>;
});
```

## Accessibility

### Semantic HTML
```tsx
<nav aria-label="Main navigation">
  <ul role="menubar">
    <li role="none">
      <a role="menuitem" href="/dashboard">Dashboard</a>
    </li>
  </ul>
</nav>

<button
  aria-expanded={isOpen}
  aria-controls="dropdown-menu"
  onClick={() => setIsOpen(!isOpen)}
>
  Menu
</button>

<span className="sr-only">Loading...</span>
```

## Form Handling

### React Hook Form + Zod
```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type FormData = z.infer<typeof schema>;

export function LoginForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = (data: FormData) => {
    // handle submit
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('email')} />
      {errors.email && <span>{errors.email.message}</span>}

      <input type="password" {...register('password')} />
      {errors.password && <span>{errors.password.message}</span>}

      <button type="submit">Login</button>
    </form>
  );
}
```

## Error Handling

### Error Boundary
```tsx
'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <button onClick={() => reset()}>Try again</button>
    </div>
  );
}
```

## Frontend Checklist

- [ ] TypeScript strict mode enabled
- [ ] Components are accessible (ARIA)
- [ ] Loading states handled
- [ ] Error boundaries in place
- [ ] Images optimized (next/image)
- [ ] Code split where appropriate
- [ ] Core Web Vitals optimized
- [ ] Mobile responsive
- [ ] Forms validated (client + server)
- [ ] SEO meta tags added
