# Admin Runtime

This repository is a streamlined admin automation workspace focused on local task execution, mock-admin flows, and a clean white/grey web UI.

## What Is Included

- Web client (`apps/web`) with a neutral white/grey interface.
- Desktop runtime (`apps/desktop`) for Electron-based local execution.
- Mock admin server (`apps/mock-admin`) for demo and testing workflows.
- Shared orchestration core (`packages/agent-core`) for task execution and MCP-style tools.

## Recent Product Updates

- Reworked UI theme to a professional white/grey visual system.
- Increased visual separation in the chat panel and page surfaces.
- Removed image and PDF attachment options from prompt/follow-up input.
- Updated home hero copy for admin-panel-oriented workflows.
- Reduced unused test and skill surface area for a leaner demo runtime.

## Monorepo Structure

- `apps/web`: React + Vite frontend.
- `apps/desktop`: Electron app shell and IPC runtime.
- `apps/mock-admin`: Local mock admin backend.
- `packages/agent-core`: Shared runtime logic and tool integrations.
- `scripts`: Workspace-level development scripts.

## Prerequisites

- Node.js 20+
- pnpm 9+

## Install

```bash
pnpm install
```

## Development

Run the full workspace flow:

```bash
pnpm dev
```

Run web app only:

```bash
pnpm dev:web
```

Run mock-admin backend only:

```bash
pnpm dev:mock-admin
```

## Validation

Typecheck all packages:

```bash
pnpm typecheck
```

Build web app:

```bash
pnpm build:web
```

Build desktop app:

```bash
pnpm build:desktop
```

## Deployment Note

The web client can be hosted on standard web platforms, but full task execution currently depends on desktop/runtime APIs. For cloud deployment, split runtime responsibilities into a long-running backend service and connect the web app over HTTP/WebSocket.

## License

MIT
