# Machine Dashboard

Futuristic, realtime dashboard that surfaces host system telemetry and allows optional power controls.

## Quickstart

```bash
docker compose up --build
```

Open http://localhost:3000.

## Environment

- `ENABLE_POWER_CONTROLS` (default `false`): when `true`, enables `/api/power/shutdown` and `/api/power/reboot`. Those commands must be permitted inside the container (may require `privileged: true`).
- `MACHINE_BIRTHDATE`: ISO date/time used to display machine age (e.g. `2020-06-01T00:00:00Z`). If omitted, age is shown as unknown.

## Host metrics vs container metrics

By default the container reports its own metrics. On Linux, uncomment `pid: host`, `network_mode: host`, and `privileged: true` in `docker-compose.yml` to gather closer-to-host telemetry. GPU utilization depends on driver support exposed to the container.

## Developing locally

```bash
npm install
npm run dev
```

Then visit http://localhost:3000.
