# Admin Agentic Automation

Admin Agentic Automation is a monorepo for running AI-driven admin workflows through a desktop runtime and a web interface. It combines a local task runner, provider integrations, and a mock admin target environment so you can build and test automation flows end to end.

## What This Project Includes

- A React + Vite web client for task input, execution view, and settings.
- An Electron desktop runtime that hosts and coordinates local automation services.
- A mock admin backend for development and automated scenario testing.
- A shared core package for agent execution, storage, provider handling, and tool integrations.

## Workspace Structure

- apps/web: Frontend client (React, TypeScript, Vite).
- apps/desktop: Electron application and IPC/runtime layer.
- apps/mock-admin: Mock admin server used as a controlled automation target.
- packages/agent-core: Shared runtime logic, connectors, and MCP-style tools.
- scripts: Workspace-level development and maintenance scripts.

## Requirements

- Node.js 20 or newer
- pnpm 9 or newer

## Install

```bash
pnpm install
```

## Run Locally

Start the full development workflow:

```bash
pnpm dev
```

Start only the web client:

```bash
pnpm dev:web
```

Start only the mock admin service:

```bash
pnpm dev:mock-admin
```

## Build And Validate

Type-check all workspace packages:

```bash
pnpm typecheck
```

Build all workspace packages:

```bash
pnpm build
```

Build web only:

```bash
pnpm build:web
```

Build desktop only:

```bash
pnpm build:desktop
```

## Deployment Model

The web client can be deployed independently, but full agent execution currently depends on the runtime layer used by the desktop app. For cloud deployment, split the runtime into a dedicated backend service and connect the web app to it via HTTP/WebSocket APIs.

## License

MIT
