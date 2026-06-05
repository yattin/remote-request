export type RemoteRequestConfig = {
  port: number
  remoteRequestKey: string | null
  maxRequestBytes: number
  maxResponseBytes: number
  defaultTimeoutMs: number
  maxRedirects: number
  allowedRequestHeaders: string[]
}

const DEFAULT_ALLOWED_HEADERS = ["accept", "content-type", "authorization", "user-agent", "x-*"]

export function loadConfig(env: Record<string, string | undefined> = Bun.env): RemoteRequestConfig {
  return {
    port: parseInteger(env.PORT, 8787),
    remoteRequestKey: env.REMOTE_REQUEST_KEY ?? null,
    maxRequestBytes: parseBytes(env.MAX_REQUEST_BYTES, 50 * 1024 * 1024),
    maxResponseBytes: parseBytes(env.MAX_RESPONSE_BYTES, 100 * 1024 * 1024),
    defaultTimeoutMs: parseInteger(env.DEFAULT_TIMEOUT_MS, 60_000),
    maxRedirects: parseInteger(env.MAX_REDIRECTS, 5),
    allowedRequestHeaders: parseList(env.ALLOWED_REQUEST_HEADERS, DEFAULT_ALLOWED_HEADERS),
  }
}

export function parseBytes(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const match = value.trim().toLowerCase().match(/^(\d+)(b|kb|mb|gb)?$/)
  if (!match) return fallback

  const amount = Number(match[1])
  const unit = match[2] ?? "b"
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  }
  return amount * multipliers[unit]
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback
  const parsed = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  return parsed.length > 0 ? parsed : fallback
}
