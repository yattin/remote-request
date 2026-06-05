import { describe, expect, test } from "bun:test"
import { loadConfig } from "../src/config"
import { createServer } from "../src/server"

describe("server", () => {
  const config = loadConfig({ REMOTE_REQUEST_KEY: "secret", PORT: "8787" })
  const app = createServer(config)

  test("healthz is public", async () => {
    const response = await app.fetch(new Request("http://localhost/healthz"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  test("auth rejects missing and invalid keys", async () => {
    const missing = await app.fetch(
      new Request("http://localhost/v1/request", {
        method: "POST",
        body: "{}",
      }),
    )
    expect(missing.status).toBe(401)

    const invalid = await app.fetch(
      new Request("http://localhost/v1/request", {
        method: "POST",
        headers: { "x-remote-request-key": "wrong" },
        body: "{}",
      }),
    )
    expect(invalid.status).toBe(401)
  })

  test("rejects invalid JSON", async () => {
    const response = await app.fetch(
      new Request("http://localhost/v1/request", {
        method: "POST",
        headers: { "x-remote-request-key": "secret" },
        body: "{",
      }),
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe("INVALID_JSON")
  })
})
