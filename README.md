# remote-request

Controlled remote request proxy for internal callers.

## Run

```bash
REMOTE_REQUEST_KEY=dev-secret bun src/index.ts
```

The service listens on `PORT` or `8787`.

## API

- `GET /healthz`
- `POST /v1/request`

`POST /v1/request` requires `X-Remote-Request-Key`.
