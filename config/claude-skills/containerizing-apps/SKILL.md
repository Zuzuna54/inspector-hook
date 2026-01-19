# Containerizing Applications

## Overview
This skill covers best practices for containerizing applications with Docker, focusing on security, performance, and production-readiness.

## Core Principles

1. **Minimal images** - Smaller attack surface, faster deploys
2. **Multi-stage builds** - Separate build and runtime
3. **Non-root users** - Security by default
4. **Layer optimization** - Leverage build cache
5. **Reproducibility** - Pinned versions, deterministic builds

## Base Image Selection

### Recommended Base Images
| Language | Development | Production |
|----------|-------------|------------|
| Node.js | node:20-alpine | node:20-alpine |
| Python | python:3.12-slim | python:3.12-slim |
| Go | golang:1.22-alpine | scratch or distroless |
| Java | eclipse-temurin:21 | eclipse-temurin:21-jre-alpine |
| Rust | rust:1.75-alpine | scratch or distroless |

### Image Size Comparison
```
ubuntu:22.04     ~77MB
debian:12-slim   ~52MB
alpine:3.19      ~7MB
scratch          ~0MB
```

## Multi-Stage Build Patterns

### Node.js Application
```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build && npm prune --production

# Production stage
FROM node:20-alpine AS production
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app
WORKDIR /app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./

USER app
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

### Python Application
```dockerfile
# Build stage
FROM python:3.12-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Production stage
FROM python:3.12-slim AS production
RUN useradd -m -u 1001 app
WORKDIR /app

COPY --from=builder /root/.local /home/app/.local
ENV PATH=/home/app/.local/bin:$PATH

COPY --chown=app:app . .
USER app
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Go Application (Minimal)
```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o server

# Scratch for minimal image (~10MB total)
FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
```

## Security Best Practices

### Non-Root User
```dockerfile
# Alpine
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app
USER app

# Debian/Ubuntu
RUN useradd -m -u 1001 app
USER app

# Numeric UID (most secure)
USER 1001
```

### Read-Only Filesystem
```dockerfile
# In Dockerfile
RUN chmod -R a-w /app

# At runtime
docker run --read-only --tmpfs /tmp myapp
```

### No Shell (Distroless)
```dockerfile
FROM gcr.io/distroless/python3-debian12
COPY --from=builder /app /app
CMD ["app/main.py"]
```

### Security Scanning
```bash
# Docker Scout
docker scout cves myimage:latest

# Trivy
trivy image myimage:latest

# Grype
grype myimage:latest
```

## Layer Optimization

### Order Matters (Most → Least Changed)
```dockerfile
# 1. Base image (rarely changes)
FROM node:20-alpine

# 2. System dependencies (occasional)
RUN apk add --no-cache dumb-init

# 3. App dependencies (weekly)
COPY package*.json ./
RUN npm ci

# 4. Source code (frequently)
COPY . .
RUN npm run build
```

### Combine RUN Commands
```dockerfile
# Bad - 3 layers
RUN apt-get update
RUN apt-get install -y curl
RUN rm -rf /var/lib/apt/lists/*

# Good - 1 layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
```

## .dockerignore
```
# Git
.git
.gitignore

# Node
node_modules
npm-debug.log

# Python
__pycache__
*.pyc
.venv
venv

# Build artifacts
dist
build
*.log

# Docker
Dockerfile*
docker-compose*
.dockerignore

# IDE
.vscode
.idea

# Docs/Tests
docs
tests
*.md
```

## Health Checks
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# For minimal images without curl
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD ["/app/healthcheck"]
```

## Environment Configuration
```dockerfile
# Build-time args
ARG NODE_ENV=production
ARG APP_VERSION=unknown

# Runtime env
ENV NODE_ENV=${NODE_ENV}
ENV APP_VERSION=${APP_VERSION}

# Labels for metadata
LABEL org.opencontainers.image.version=${APP_VERSION}
LABEL org.opencontainers.image.source="https://github.com/org/repo"
```

## Docker Compose for Development
```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: development  # Use dev stage
    volumes:
      - .:/app
      - /app/node_modules  # Preserve node_modules
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
    command: npm run dev
```

## Build Commands
```bash
# Basic build
docker build -t myapp:latest .

# With build args
docker build --build-arg NODE_ENV=production -t myapp:prod .

# Specific stage
docker build --target builder -t myapp:builder .

# No cache
docker build --no-cache -t myapp:latest .

# Multi-platform
docker buildx build --platform linux/amd64,linux/arm64 -t myapp:latest .
```

## Optimization Checklist

- [ ] Multi-stage build used
- [ ] Alpine or distroless base
- [ ] Non-root user configured
- [ ] .dockerignore present
- [ ] Layers ordered by change frequency
- [ ] Dependencies cached properly
- [ ] No secrets in image
- [ ] Health check defined
- [ ] Image scanned for vulnerabilities
- [ ] Labels for metadata
