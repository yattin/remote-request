import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { loadConfig } from "../src/config"
import { createServer } from "../src/server"
import type { RemoteRequestResult } from "../src/types"

const remoteRequestKey = "integration-secret"
const httpbinBaseUrl = "https://httpbin.org"

let server: ReturnType<typeof Bun.serve>
let proxyBaseUrl: string

beforeAll(() => {
  server = Bun.serve(
    createServer({
      ...loadConfig({
        REMOTE_REQUEST_KEY: remoteRequestKey,
        MAX_REQUEST_BYTES: "1mb",
        MAX_RESPONSE_BYTES: "2mb",
        DEFAULT_TIMEOUT_MS: "15000",
        MAX_REDIRECTS: "5",
      }),
      port: 0,
    }),
  )
  proxyBaseUrl = `http://localhost:${server.port}`
})

afterAll(() => {
  server.stop(true)
})

describe("httpbin integration", () => {
  test("proxies GET requests with query parameters", async () => {
    const result = await callProxy({
      method: "GET",
      url: `${httpbinBaseUrl}/get?hello=world`,
      headers: {
        Accept: "application/json",
        "X-Remote-Test": "get",
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.upstream.status).toBe(200)
    const body = JSON.parse(result.upstream.bodyText ?? "{}")
    expect(body.args.hello).toBe("world")
    expect(body.headers["X-Remote-Test"]).toBe("get")
  })

  test("proxies POST requests with a JSON text body", async () => {
    const payload = { message: "hello httpbin", count: 2 }
    const result = await callProxy({
      method: "POST",
      url: `${httpbinBaseUrl}/post`,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      bodyText: JSON.stringify(payload),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.upstream.status).toBe(200)
    const body = JSON.parse(result.upstream.bodyText ?? "{}")
    expect(body.json).toEqual(payload)
    expect(body.headers["Content-Type"]).toContain("application/json")
  })

  test("proxies POST requests with a base64 body", async () => {
    const raw = "encoded body from remote-request"
    const result = await callProxy({
      method: "POST",
      url: `${httpbinBaseUrl}/post`,
      headers: {
        "Content-Type": "text/plain",
        Accept: "application/json",
      },
      bodyBase64: Buffer.from(raw).toString("base64"),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.upstream.status).toBe(200)
    const body = JSON.parse(result.upstream.bodyText ?? "{}")
    expect(body.data).toBe(raw)
  })

  test("returns upstream error status as a successful proxy execution", async () => {
    const result = await callProxy({
      method: "GET",
      url: `${httpbinBaseUrl}/status/418`,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.upstream.status).toBe(418)
  })

  test("follows public redirects manually", async () => {
    const result = await callProxy({
      method: "GET",
      url: `${httpbinBaseUrl}/redirect-to?url=/get?redirected=true`,
      headers: {
        Accept: "application/json",
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.upstream.status).toBe(200)
    const body = JSON.parse(result.upstream.bodyText ?? "{}")
    expect(body.args.redirected).toBe("true")
  })

  test("returns binary httpbin responses as base64", async () => {
    const result = await callProxy({
      method: "GET",
      url: `${httpbinBaseUrl}/bytes/16`,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.upstream.status).toBe(200)
    expect(result.upstream.bodyBase64).toBeString()
    expect(Buffer.from(result.upstream.bodyBase64 ?? "", "base64").byteLength).toBe(16)
  })
})

async function callProxy(input: Record<string, unknown>): Promise<RemoteRequestResult> {
  const response = await fetch(`${proxyBaseUrl}/v1/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Remote-Request-Key": remoteRequestKey,
    },
    body: JSON.stringify(input),
  })

  return (await response.json()) as RemoteRequestResult
}
