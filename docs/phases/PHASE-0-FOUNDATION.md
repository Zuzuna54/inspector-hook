# Phase 0: Foundation & Project Setup

**Duration**: 1 week
**Goal**: Establish project infrastructure, tooling, and development environment

---

## Objectives

1. Set up monorepo structure with pnpm workspaces
2. Configure TypeScript for all packages
3. Establish build tooling with esbuild
4. Create package scaffolding for core, protocol, and vscode
5. Set up basic development workflow

---

## Deliverables

### 1. Monorepo Structure

```
inspector-hook/
├── packages/
│   ├── core/                      # Core business logic
│   │   ├── src/
│   │   │   ├── index.ts          # Main entry point
│   │   │   ├── server/           # HTTP server for hooks
│   │   │   ├── managers/         # Business logic managers
│   │   │   ├── ipc/              # IPC communication layer
│   │   │   └── types/            # Core-specific types
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── protocol/                  # Shared protocol definitions
│   │   ├── src/
│   │   │   ├── index.ts          # Re-exports all types
│   │   │   ├── messages.ts       # IPC message types
│   │   │   ├── models.ts         # Data model interfaces
│   │   │   └── events.ts         # Event type definitions
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── vscode/                    # VS Code extension
│   │   ├── src/
│   │   │   ├── extension.ts      # Extension entry point
│   │   │   ├── panel.ts          # Webview panel management
│   │   │   ├── core-bridge.ts    # Communication with core
│   │   │   └── commands.ts       # VS Code commands
│   │   ├── media/                # Webview assets
│   │   │   ├── index.html
│   │   │   ├── styles/
│   │   │   └── scripts/
│   │   ├── package.json          # VS Code extension manifest
│   │   └── tsconfig.json
│   │
│   └── hooks/                     # Hook scripts for AI agents
│       ├── claude/               # Claude Code hooks
│       │   ├── pre-tool-use.sh
│       │   ├── post-tool-use.sh
│       │   └── lib/
│       │       ├── http-logger.sh
│       │       └── http_logger.py
│       └── install.sh            # Hook installation script
│
├── package.json                   # Root workspace config
├── pnpm-workspace.yaml           # Workspace definition
├── tsconfig.base.json            # Shared TS config
└── .gitignore
```

### 2. Root Configuration Files

**pnpm-workspace.yaml**
```yaml
packages:
  - 'packages/*'
```

**package.json** (root)
```json
{
  "name": "inspector-hook",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm -r --parallel dev",
    "clean": "pnpm -r clean",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "esbuild": "^0.20.0"
  },
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=8.0.0"
  }
}
```

**tsconfig.base.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

### 3. Package Configurations

**packages/protocol/package.json**
```json
{
  "name": "@inspector-hook/protocol",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit"
  }
}
```

**packages/core/package.json**
```json
{
  "name": "@inspector-hook/core",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "inspector-hook-core": "./dist/cli.js"
  },
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js && tsc --emitDeclarationOnly",
    "dev": "esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js --watch",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@inspector-hook/protocol": "workspace:*"
  }
}
```

**packages/vscode/package.json**
```json
{
  "name": "@inspector-hook/vscode",
  "displayName": "Inspector Hook",
  "description": "AI Agent Monitoring & Orchestration",
  "version": "0.1.0",
  "publisher": "inspector-hook",
  "engines": {
    "vscode": "^1.85.0"
  },
  "main": "./dist/extension.js",
  "activationEvents": ["*"],
  "contributes": {
    "commands": [
      {
        "command": "inspectorHook.showPanel",
        "title": "Inspector Hook: Show Panel"
      }
    ]
  },
  "scripts": {
    "build": "esbuild src/extension.ts --bundle --platform=node --external:vscode --outfile=dist/extension.js",
    "dev": "pnpm build --watch",
    "package": "vsce package --no-dependencies",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@inspector-hook/protocol": "workspace:*"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^2.22.0"
  }
}
```

---

## Tasks

### Task 0.1: Initialize Repository
- [ ] Create directory structure
- [ ] Initialize git repository
- [ ] Create root package.json
- [ ] Create pnpm-workspace.yaml
- [ ] Create tsconfig.base.json
- [ ] Create .gitignore

### Task 0.2: Create Protocol Package
- [ ] Create packages/protocol directory
- [ ] Set up package.json
- [ ] Set up tsconfig.json extending base
- [ ] Create placeholder src/index.ts
- [ ] Verify build works

### Task 0.3: Create Core Package
- [ ] Create packages/core directory
- [ ] Set up package.json with esbuild
- [ ] Set up tsconfig.json
- [ ] Create placeholder src/index.ts
- [ ] Add dependency on protocol
- [ ] Verify build works

### Task 0.4: Create VS Code Package
- [ ] Create packages/vscode directory
- [ ] Set up package.json as extension manifest
- [ ] Set up tsconfig.json
- [ ] Create placeholder src/extension.ts
- [ ] Create media directory structure
- [ ] Add dependency on protocol
- [ ] Verify extension builds

### Task 0.5: Create Hooks Package
- [ ] Create packages/hooks directory
- [ ] Create Claude Code hook library (bash)
- [ ] Create Claude Code hook library (python)
- [ ] Create installation script
- [ ] Document hook setup

### Task 0.6: Verify Development Workflow
- [ ] `pnpm install` works
- [ ] `pnpm build` builds all packages
- [ ] `pnpm dev` runs in watch mode
- [ ] VS Code extension loads in development host

---

## Acceptance Criteria

1. **Monorepo builds successfully**
   - `pnpm install` completes without errors
   - `pnpm build` compiles all packages
   - TypeScript type checking passes

2. **Package dependencies work**
   - Core can import from Protocol
   - VS Code can import from Protocol
   - No circular dependencies

3. **VS Code extension loads**
   - Extension activates in development host
   - Command "Inspector Hook: Show Panel" appears
   - No activation errors in console

4. **Development workflow functional**
   - Watch mode updates on file changes
   - Type errors surface in editor
   - IntelliSense works across packages

---

## Dependencies

None - this is the foundation phase.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| pnpm workspace issues | Use explicit `workspace:*` protocol |
| TypeScript project references complexity | Start with simple extends, avoid refs |
| esbuild bundling issues | Externalize vscode, keep core simple |

---

## Success Metrics

- [ ] All packages build in < 5 seconds
- [ ] Zero TypeScript errors
- [ ] Extension loads without errors
- [ ] Development iteration < 2 seconds
