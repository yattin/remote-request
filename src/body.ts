import { ProxyError } from "./types"

export function encodeRequestBody(input: {
  method: string
  bodyText?: string
  bodyBase64?: string
  maxRequestBytes: number
}): BodyInit | undefined {
  const hasText = input.bodyText !== undefined
  const hasBase64 = input.bodyBase64 !== undefined

  if (hasText && hasBase64) {
    throw new ProxyError("INVALID_BODY", "Exactly one of bodyText or bodyBase64 may be provided")
  }

  if ((input.method === "GET" || input.method === "HEAD") && (hasText || hasBase64)) {
    throw new ProxyError("BODY_NOT_ALLOWED", `${input.method} requests cannot include a body`)
  }

  if (!hasText && !hasBase64) return undefined

  const bytes = hasBase64 ? decodeBase64(input.bodyBase64 ?? "") : new TextEncoder().encode(input.bodyText ?? "")
  if (bytes.byteLength > input.maxRequestBytes) {
    throw new ProxyError("REQUEST_BODY_TOO_LARGE", "Request body exceeds MAX_REQUEST_BYTES", 413)
  }

  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return new Blob([copy])
}

export async function decodeResponseBody(response: Response, maxResponseBytes: number) {
  const contentLength = response.headers.get("content-length")
  if (contentLength && Number(contentLength) > maxResponseBytes) {
    throw new ProxyError("RESPONSE_BODY_TOO_LARGE", "Response body exceeds MAX_RESPONSE_BYTES", 502)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxResponseBytes) {
    throw new ProxyError("RESPONSE_BODY_TOO_LARGE", "Response body exceeds MAX_RESPONSE_BYTES", 502)
  }

  if (isTextualResponse(response.headers.get("content-type"), bytes)) {
    return { bodyText: new TextDecoder().decode(bytes), responseBytes: bytes.byteLength }
  }

  return { bodyBase64: Buffer.from(bytes).toString("base64"), responseBytes: bytes.byteLength }
}

function decodeBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(Buffer.from(value, "base64"))
  } catch {
    throw new ProxyError("INVALID_BODY_BASE64", "bodyBase64 is not valid base64")
  }
}

function isTextualResponse(contentType: string | null, bytes: Uint8Array): boolean {
  const normalized = contentType?.toLowerCase() ?? ""
  if (normalized.includes("application/octet-stream")) return false
  if (
    normalized.startsWith("text/") ||
    normalized.includes("application/json") ||
    normalized.includes("+json") ||
    normalized.includes("application/xml") ||
    normalized.includes("+xml") ||
    normalized.includes("application/x-www-form-urlencoded")
  ) {
    return true
  }

  if (bytes.length === 0) return true

  const sample = bytes.slice(0, Math.min(bytes.length, 64))
  return !sample.some((byte) => byte === 0 || byte < 8 || (byte > 13 && byte < 32))
}
