import { describe, expect, test } from "bun:test"
import { loadConfig } from "../src/config"
import { executeRemoteRequest } from "../src/proxy"
import { isPublicIp } from "../src/security"

const config = loadConfig({
  REMOTE_REQUEST_KEY: "test-key",
  MAX_REQUEST_BYTES: "20b",
  MAX_RESPONSE_BYTES: "30b",
  DEFAULT_TIMEOUT_MS: "1000",
  MAX_REDIRECTS: "2",
})

const resolver = async (hostname: string) => {
  if (hostname === "public.test") return ["93.184.216.34"]
  if (hostname === "private.test") return ["127.0.0.1"]
  return ["93.184.216.34"]
}

describe("executeRemoteRequest", () => {
  test.each(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])("dispatches %s", async (method) => {
    const seen: string[] = []
    const result = await executeRemoteRequest(
      { method, url: "https://public.test/ok" },
      config,
      {
        resolver,
        fetchImpl: async (_url, init) => {
          seen.push(init?.method ?? "")
          return new Response(method === "HEAD" ? null : "ok", { status: 200, headers: { "content-type": "text/plain" } })
        },
        requestId: () => "req-method",
      },
    )

    expect(result.ok).toBe(true)
    expect(seen).toEqual([method])
  })

  test("forwards bodyText and allowed headers while dropping forbidden headers", async () => {
    let forwardedBody = ""
    let forwardedHeaders: Headers | undefined
    const result = await executeRemoteRequest(
      {
        method: "POST",
        url: "https://public.test/echo",
        headers: {
          "Content-Type": "application/json",
          Host: "evil.test",
          Cookie: "secret",
          "X-Trace": "abc",
        },
        bodyText: "{\"hello\":true}",
      },
      config,
      {
        resolver,
        fetchImpl: async (_url, init) => {
          forwardedHeaders = init?.headers as Headers
          forwardedBody = await new Response(init?.body).text()
          return Response.json({ ok: true })
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(forwardedBody).toBe("{\"hello\":true}")
    expect(forwardedHeaders?.get("content-type")).toBe("application/json")
    expect(forwardedHeaders?.get("x-trace")).toBe("abc")
    expect(forwardedHeaders?.get("host")).toBeNull()
    expect(forwardedHeaders?.get("cookie")).toBeNull()
  })

  test("forwards bodyBase64", async () => {
    let forwardedBody: Uint8Array | undefined
    const result = await executeRemoteRequest(
      { method: "POST", url: "https://public.test/binary", bodyBase64: Buffer.from([1, 2, 3]).toString("base64") },
      config,
      {
        resolver,
        fetchImpl: async (_url, init) => {
          forwardedBody = new Uint8Array(await new Response(init?.body).arrayBuffer())
          return new Response("ok", { headers: { "content-type": "text/plain" } })
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(Array.from(forwardedBody ?? [])).toEqual([1, 2, 3])
  })

  test("rejects GET and HEAD bodies", async () => {
    for (const method of ["GET", "HEAD"]) {
      const result = await executeRemoteRequest({ method, url: "https://public.test", bodyText: "nope" }, config, {
        resolver,
      })
      expect(result.ok).toBe(false)
      expect(result.ok ? "" : result.error.code).toBe("BODY_NOT_ALLOWED")
    }
  })

  test("returns binary response as base64", async () => {
    const result = await executeRemoteRequest({ method: "GET", url: "https://public.test/image" }, config, {
      resolver,
      fetchImpl: async () =>
        new Response(Uint8Array.from([0, 1, 2, 3]), {
          headers: { "content-type": "application/octet-stream" },
        }),
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.upstream.bodyBase64).toBe(Buffer.from([0, 1, 2, 3]).toString("base64"))
  })

  test("upstream error statuses are successful proxy executions", async () => {
    for (const status of [404, 500]) {
      const result = await executeRemoteRequest({ method: "GET", url: "https://public.test/fail" }, config, {
        resolver,
        fetchImpl: async () => new Response("fail", { status, headers: { "content-type": "text/plain" } }),
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.upstream.status).toBe(status)
    }
  })

  test.each([
    ["invalid", "not-a-url", "INVALID_URL"],
    ["scheme", "ftp://public.test/file", "UNSUPPORTED_SCHEME"],
    ["localhost", "https://localhost/file", "PRIVATE_TARGET"],
    ["metadata", "http://169.254.169.254/latest", "PRIVATE_TARGET"],
    ["dns-private", "https://private.test/file", "PRIVATE_TARGET"],
  ])("rejects unsafe target: %s", async (_name, url, code) => {
    const result = await executeRemoteRequest({ method: "GET", url }, config, { resolver })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.error.code).toBe(code)
  })

  test("manually follows redirects and revalidates each hop", async () => {
    const seen: string[] = []
    const result = await executeRemoteRequest({ method: "GET", url: "https://public.test/one" }, config, {
      resolver,
      fetchImpl: async (url) => {
        seen.push(String(url))
        if (String(url).endsWith("/one")) {
          return new Response("", { status: 302, headers: { location: "https://public.test/two" } })
        }
        return new Response("done", { status: 200, headers: { "content-type": "text/plain" } })
      },
    })

    expect(result.ok).toBe(true)
    expect(seen).toEqual(["https://public.test/one", "https://public.test/two"])
  })

  test("rejects redirect to private target", async () => {
    const result = await executeRemoteRequest({ method: "GET", url: "https://public.test/one" }, config, {
      resolver,
      fetchImpl: async () => new Response("", { status: 302, headers: { location: "http://127.0.0.1/admin" } }),
    })

    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.error.code).toBe("PRIVATE_TARGET")
  })

  test("enforces request and response size limits", async () => {
    const requestTooLarge = await executeRemoteRequest(
      { method: "POST", url: "https://public.test", bodyText: "x".repeat(21) },
      config,
      { resolver },
    )
    expect(requestTooLarge.ok).toBe(false)
    expect(requestTooLarge.ok ? "" : requestTooLarge.error.code).toBe("REQUEST_BODY_TOO_LARGE")

    const responseTooLarge = await executeRemoteRequest({ method: "GET", url: "https://public.test" }, config, {
      resolver,
      fetchImpl: async () => new Response("x".repeat(31), { headers: { "content-type": "text/plain" } }),
    })
    expect(responseTooLarge.ok).toBe(false)
    expect(responseTooLarge.ok ? "" : responseTooLarge.error.code).toBe("RESPONSE_BODY_TOO_LARGE")
  })

  test("redacts sensitive response headers", async () => {
    const result = await executeRemoteRequest({ method: "GET", url: "https://public.test" }, config, {
      resolver,
      fetchImpl: async () =>
        new Response("ok", {
          headers: {
            "content-type": "text/plain",
            "set-cookie": "sid=secret",
          },
        }),
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.upstream.headers["set-cookie"]).toBe("[redacted]")
  })
})

describe("IP classification", () => {
  test("blocks private and special networks", () => {
    expect(isPublicIp("10.0.0.1")).toBe(false)
    expect(isPublicIp("172.16.0.1")).toBe(false)
    expect(isPublicIp("192.168.0.1")).toBe(false)
    expect(isPublicIp("127.0.0.1")).toBe(false)
    expect(isPublicIp("169.254.169.254")).toBe(false)
    expect(isPublicIp("93.184.216.34")).toBe(true)
    expect(isPublicIp("::1")).toBe(false)
    expect(isPublicIp("fd00::1")).toBe(false)
  })
})
