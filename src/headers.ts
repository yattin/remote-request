const FORBIDDEN_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

const SENSITIVE_RESPONSE_HEADERS = new Set(["authorization", "proxy-authorization", "set-cookie"])

export function filterRequestHeaders(
  headers: Record<string, string> | undefined,
  allowedPatterns: string[],
): Headers {
  const output = new Headers()
  if (!headers) return output

  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase()
    if (!isHeaderNameSafe(normalized)) continue
    if (FORBIDDEN_REQUEST_HEADERS.has(normalized)) continue
    if (!matchesAllowedHeader(normalized, allowedPatterns)) continue
    output.set(name, value)
  }

  return output
}

export function envelopeResponseHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [name, value] of headers.entries()) {
    output[name.toLowerCase()] = SENSITIVE_RESPONSE_HEADERS.has(name.toLowerCase()) ? "[redacted]" : value
  }
  return output
}

export function redactHeadersForLog(headers: Record<string, string> | undefined): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.toLowerCase()
    output[normalized] =
      SENSITIVE_RESPONSE_HEADERS.has(normalized) || normalized === "cookie" ? "[redacted]" : value
  }
  return output
}

function matchesAllowedHeader(name: string, allowedPatterns: string[]): boolean {
  return allowedPatterns.some((pattern) => {
    if (pattern.endsWith("*")) return name.startsWith(pattern.slice(0, -1))
    return name === pattern
  })
}

function isHeaderNameSafe(name: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(name)
}
