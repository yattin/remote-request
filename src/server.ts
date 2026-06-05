import type { RemoteRequestConfig } from "./config"
import { executeRemoteRequest } from "./proxy"

export function createServer(config: RemoteRequestConfig) {
  return {
    port: config.port,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)

      if (request.method === "GET" && url.pathname === "/healthz") {
        return json({ ok: true })
      }

      if (request.method === "POST" && url.pathname === "/v1/request") {
        const auth = authenticate(request, config)
        if (auth) return auth

        const tooLarge = rejectTooLarge(request, config.maxRequestBytes)
        if (tooLarge) return tooLarge

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be JSON" } }, 400)
        }

        const result = await executeRemoteRequest(body, config)
        return json(result, result.ok ? 200 : statusForError(result.error.code))
      }

      return json({ ok: false, error: { code: "NOT_FOUND", message: "Route not found" } }, 404)
    },
  }
}

function authenticate(request: Request, config: RemoteRequestConfig): Response | null {
  if (!config.remoteRequestKey) {
    return json({ ok: false, error: { code: "NOT_CONFIGURED", message: "REMOTE_REQUEST_KEY is required" } }, 503)
  }

  if (request.headers.get("x-remote-request-key") !== config.remoteRequestKey) {
    return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid remote request key" } }, 401)
  }

  return null
}

function rejectTooLarge(request: Request, maxRequestBytes: number): Response | null {
  const contentLength = request.headers.get("content-length")
  if (contentLength && Number(contentLength) > maxRequestBytes) {
    return json(
      { ok: false, error: { code: "REQUEST_BODY_TOO_LARGE", message: "Request body exceeds MAX_REQUEST_BYTES" } },
      413,
    )
  }
  return null
}

function statusForError(code: string): number {
  switch (code) {
    case "REQUEST_BODY_TOO_LARGE":
      return 413
    case "UPSTREAM_TIMEOUT":
      return 504
    case "UPSTREAM_NETWORK_ERROR":
    case "DNS_LOOKUP_FAILED":
    case "RESPONSE_BODY_TOO_LARGE":
    case "INVALID_REDIRECT":
    case "TOO_MANY_REDIRECTS":
      return 502
    default:
      return 400
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
    },
  })
}
