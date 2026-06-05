# remote-request

Controlled remote HTTP request proxy for internal callers.

`remote-request` accepts an authenticated JSON request envelope, performs an outbound HTTP request to a public `http` or `https` URL, and returns a JSON response envelope. It is designed for agent, CLI, and backend workflows that need remote HTTP access without exposing a raw open proxy.

## Features

- `GET /healthz` health check
- `POST /v1/request` remote request execution
- Internal API-key authentication with `X-Remote-Request-Key`
- `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`
- Text and binary request bodies via `bodyText` or `bodyBase64`
- Text and binary upstream responses via `bodyText` or `bodyBase64`
- Public URL validation and SSRF protection
- Manual redirect following with validation on every hop
- Request header allowlist and sensitive response header redaction
- Audit logs without request or response bodies
- GHCR image publishing on `v*` tags

## Quick Start

Install dependencies:

```bash
bun install
```

Run locally:

```bash
REMOTE_REQUEST_KEY=dev-secret bun src/index.ts
```

The service listens on `PORT`, or `8787` by default.

Check health:

```bash
curl http://localhost:8787/healthz
```

## API

### `POST /v1/request`

Required header:

```http
X-Remote-Request-Key: <REMOTE_REQUEST_KEY>
Content-Type: application/json
```

Request body:

```ts
type RemoteRequestInput = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
  url: string
  headers?: Record<string, string>
  bodyText?: string
  bodyBase64?: string
  timeoutMs?: number
}
```

Rules:

- Provide at most one of `bodyText` or `bodyBase64`.
- `GET` and `HEAD` cannot include a body.
- Target URLs must use public `http` or `https`.
- Localhost, private IPs, link-local addresses, multicast addresses, and cloud metadata addresses are blocked.

Example GET:

```bash
curl -s http://localhost:8787/v1/request \
  -H 'Content-Type: application/json' \
  -H 'X-Remote-Request-Key: dev-secret' \
  -d '{
    "method": "GET",
    "url": "https://httpbin.org/get?hello=world",
    "headers": {
      "Accept": "application/json"
    }
  }'
```

Example POST JSON:

```bash
curl -s http://localhost:8787/v1/request \
  -H 'Content-Type: application/json' \
  -H 'X-Remote-Request-Key: dev-secret' \
  -d '{
    "method": "POST",
    "url": "https://httpbin.org/post",
    "headers": {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    "bodyText": "{\"message\":\"hello\"}"
  }'
```

Example response:

```json
{
  "ok": true,
  "requestId": "0a5f6c80-5e58-4d9a-8d62-c69cfd83fb01",
  "upstream": {
    "status": 200,
    "statusText": "OK",
    "headers": {
      "content-type": "application/json"
    },
    "bodyText": "{\"args\":{\"hello\":\"world\"}}"
  },
  "timingMs": 312
}
```

If the upstream server returns `404` or `500`, the proxy still returns `ok: true` because the remote request completed and produced an upstream response. Proxy validation, DNS, timeout, network, size-limit, and SSRF failures return `ok: false`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `REMOTE_REQUEST_KEY` | required | Internal key required by `POST /v1/request`. |
| `PORT` | `8787` | HTTP listen port. |
| `MAX_REQUEST_BYTES` | `50mb` | Maximum decoded outbound request body size. |
| `MAX_RESPONSE_BYTES` | `100mb` | Maximum upstream response body size. |
| `DEFAULT_TIMEOUT_MS` | `60000` | Default per-request timeout. |
| `MAX_REDIRECTS` | `5` | Maximum manual redirect hops. |
| `ALLOWED_REQUEST_HEADERS` | `accept,content-type,authorization,user-agent,x-*` | Comma-separated outbound request header allowlist. |

## Docker

Build locally:

```bash
docker build -t remote-request .
```

Run locally:

```bash
docker run --rm -p 8787:8787 \
  -e REMOTE_REQUEST_KEY=dev-secret \
  remote-request
```

Use the published GHCR image:

```bash
docker run --rm -p 8787:8787 \
  -e REMOTE_REQUEST_KEY=dev-secret \
  ghcr.io/yattin/remote-request:v0.1.0
```

## Development

Run the fast local checks:

```bash
bun run typecheck
bun test
```

Run real network integration tests against `https://httpbin.org`:

```bash
bun run test:integration
```

The integration test starts the local service in-process and verifies GET, POST, base64 body forwarding, upstream status handling, redirects, and binary responses through httpbin.

## Release

Images are published to GHCR by GitHub Actions when a tag matching `v*` is pushed.

Create a release tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

For `v1.2.3`, the workflow publishes:

- `ghcr.io/yattin/remote-request:v1.2.3`
- `ghcr.io/yattin/remote-request:1.2.3`
- `ghcr.io/yattin/remote-request:1.2`
- `ghcr.io/yattin/remote-request:1`
- `ghcr.io/yattin/remote-request:latest`

The published image currently targets `linux/amd64`.
