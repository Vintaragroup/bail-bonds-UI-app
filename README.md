# Bail-Bonds Dashboard (UI + API)

This repository contains:
- Frontend: React + Vite app under `src/`
- Backend API: Express + Mongoose under `server/`

Swagger UI: http://localhost:8080/api/docs (when the server is running)

For full server details (environment, troubleshooting, scripts), see `server/README.md`.

## Documentation

- `SCHEMA_CONTRACT.md` – data field contracts
- `WINDOW_CONTRACT.md` – canonical window semantics (design + mapping)
- `WINDOWS_V2_STATUS.md` – windows v2 migration status, validation snapshot, ops playbook

## Quick Start

1) Install dependencies

```bash
# Frontend deps
npm install

# Server deps
cd server && npm install && cd ..
```

2) Configure environment

```bash
# Frontend API base URL
cp .env.example .env   # if you want to customize VITE_API_URL

# Server Mongo connection
cp server/.env.example server/.env
# then edit server/.env and set MONGO_URI (and optionally MONGO_DB, PORT, WEB_ORIGIN)
```

3) Run

```bash
# Terminal A — start API server (with auto-restart)
cd server
npm run dev

# Terminal B — start frontend
cd ..
npm run dev
```

Frontend will typically be at http://localhost:5173 and proxy requests to the API at http://localhost:8080/api (via `VITE_API_URL`).

## Environment

Root `.env` (frontend):
- `VITE_API_URL` — default is `http://localhost:8080/api`

Server `.env` (see `server/.env.example`):
- `MONGO_URI` — MongoDB connection string (Atlas or local)
- `MONGO_DB` — Database name (default: `warrantdb`)
- `PORT` — API server port (default: `8080`)
- `WEB_ORIGIN` — CORS origin for the UI (e.g., `http://localhost:5173`)
- `DASHBOARD_TZ` — Timezone for booking-day window (default: `America/Chicago`)

## Troubleshooting

- Port conflict (EADDRINUSE):
	```bash
	lsof -iTCP:8080 -sTCP:LISTEN -n -P
	kill -9 <pid>
	```
- DB errors / timeouts: ensure `MONGO_URI` is set and Atlas network access allows your host.
- Swagger not loading routes: ensure the server is running and browse to http://localhost:8080/api/docs.

---

## Original Vite README

Below is the original Vite starter content for reference.

### React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs) for Fast Refresh

#### Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
