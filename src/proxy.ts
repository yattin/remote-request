import { audit } from "./audit"
import { decodeResponseBody, encodeRequestBody } from "./body"
import type { RemoteRequestConfig } from "./config"
import { envelopeResponseHeaders, filterRequestHeaders } from "./headers"
import {
  assertPublicTargetUrl,
  type DnsResolver,
  nodeDnsResolver,
  parseTargetUrl,
  resolveRedirectUrl,
} from "./security"
import { ALLOWED_METHODS, ProxyError, type RemoteRequestInput, type RemoteRequestResult } from "./types"

type ProxyDependencies = {
  fetchImpl?: FetchLike
  resolver?: DnsResolver
  now?: () => number
  requestId?: () => string
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export async function executeRemoteRequest(
  rawInput: unknown,
  config: RemoteRequestConfig,
  deps: ProxyDependencies = {},
): Promise<RemoteRequestResult> {
  const now = deps.now ?? (() => Date.now())
  const startedAt = now()
  const requestId = deps.requestId?.() ?? crypto.randomUUID()
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init))
  const resolver = deps.resolver ?? nodeDnsResolver

  let input: RemoteRequestInput | undefined
  let target: URL | undefined
  let requestBytes = 0

  try {
    input = validateInput(rawInput, config)
    target = parseTargetUrl(input.url)
    await assertPublicTargetUrl(target, resolver)

    const body = encodeRequestBody({
      method: input.method,
      bodyText: input.bodyText,
      bodyBase64: input.bodyBase64,
      maxRequestBytes: config.maxRequestBytes,
    })
    requestBytes = body ? byteLengthOfBody(body) : 0

    const upstream = await fetchWithRedirects({
      url: target,
      input,
      body,
      config,
      fetchImpl,
      resolver,
    })

    const decoded = await decodeResponseBody(upstream.response, config.maxResponseBytes)
    const timingMs = now() - startedAt

    audit({
      requestId,
      caller: "internal-key",
      method: input.method,
      target: upstream.finalUrl,
      status: upstream.response.status,
      durationMs: timingMs,
      requestBytes,
      responseBytes: decoded.responseBytes,
      requestHeaders: input.headers,
    })

    return {
      ok: true,
      requestId,
      upstream: {
        status: upstream.response.status,
        statusText: upstream.response.statusText,
        headers: envelopeResponseHeaders(upstream.response.headers),
        ...("bodyText" in decoded ? { bodyText: decoded.bodyText } : { bodyBase64: decoded.bodyBase64 }),
      },
      timingMs,
    }
  } catch (error) {
    const proxyError = toProxyError(error)
    const timingMs = now() - startedAt
    audit({
      requestId,
      caller: "internal-key",
      method: input?.method,
      target,
      durationMs: timingMs,
      requestBytes,
      errorCode: proxyError.code,
      requestHeaders: input?.headers,
    })
    return {
      ok: false,
      requestId,
      error: {
        code: proxyError.code,
        message: proxyError.message,
      },
      timingMs,
    }
  }
}

function validateInput(rawInput: unknown, config: RemoteRequestConfig): RemoteRequestInput {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw new ProxyError("INVALID_REQUEST", "Request body must be a JSON object")
  }

  const input = rawInput as Record<string, unknown>
  if (typeof input.method !== "string") {
    throw new ProxyError("INVALID_METHOD", "method is required")
  }

  const method = input.method.toUpperCase()
  if (!ALLOWED_METHODS.includes(method as RemoteRequestInput["method"])) {
    throw new ProxyError("UNSUPPORTED_METHOD", "Unsupported HTTP method")
  }

  if (typeof input.url !== "string") {
    throw new ProxyError("INVALID_URL", "url is required")
  }

  const bodyText = input.bodyText
  const bodyBase64 = input.bodyBase64
  if (bodyText !== undefined && typeof bodyText !== "string") {
    throw new ProxyError("INVALID_BODY", "bodyText must be a string")
  }
  if (bodyBase64 !== undefined && typeof bodyBase64 !== "string") {
    throw new ProxyError("INVALID_BODY", "bodyBase64 must be a string")
  }

  const headers = validateHeaders(input.headers)
  const timeoutMs = validateTimeout(input.timeoutMs, config.defaultTimeoutMs)

  return {
    method: method as RemoteRequestInput["method"],
    url: input.url,
    headers,
    bodyText,
    bodyBase64,
    timeoutMs,
  }
}

function validateHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProxyError("INVALID_HEADERS", "headers must be an object")
  }

  const headers: Record<string, string> = {}
  for (const [name, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string") {
      throw new ProxyError("INVALID_HEADERS", "header values must be strings")
    }
    headers[name] = headerValue
  }
  return headers
}

function validateTimeout(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ProxyError("INVALID_TIMEOUT", "timeoutMs must be a positive number")
  }
  return Math.min(value, fallback)
}

async function fetchWithRedirects(options: {
  url: URL
  input: RemoteRequestInput
  body: BodyInit | undefined
  config: RemoteRequestConfig
  fetchImpl: FetchLike
  resolver: DnsResolver
}): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = options.url

  for (let redirects = 0; redirects <= options.config.maxRedirects; redirects += 1) {
    await assertPublicTargetUrl(currentUrl, options.resolver)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.input.timeoutMs)

    let response: Response
    try {
      response = await options.fetchImpl(currentUrl.toString(), {
        method: options.input.method,
        headers: filterRequestHeaders(options.input.headers, options.config.allowedRequestHeaders),
        body: options.body,
        redirect: "manual",
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ProxyError("UPSTREAM_TIMEOUT", "Upstream request timed out", 504)
      }
      throw new ProxyError("UPSTREAM_NETWORK_ERROR", "Upstream request failed", 502)
    } finally {
      clearTimeout(timeout)
    }

    if (!isRedirect(response.status)) {
      return { response, finalUrl: currentUrl }
    }

    if (redirects === options.config.maxRedirects) {
      throw new ProxyError("TOO_MANY_REDIRECTS", "Redirect limit exceeded", 502)
    }
    currentUrl = resolveRedirectUrl(currentUrl, response.headers.get("location"))
  }

  throw new ProxyError("TOO_MANY_REDIRECTS", "Redirect limit exceeded", 502)
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304
}

function byteLengthOfBody(body: BodyInit): number {
  if (body instanceof Blob) return body.size
  if (typeof body === "string") return new TextEncoder().encode(body).byteLength
  return 0
}

function toProxyError(error: unknown): ProxyError {
  if (error instanceof ProxyError) return error
  return new ProxyError("INTERNAL_ERROR", "Unexpected proxy error", 500)
}
