export const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const

export type RemoteRequestMethod = (typeof ALLOWED_METHODS)[number]

export type RemoteRequestInput = {
  method: RemoteRequestMethod
  url: string
  headers?: Record<string, string>
  bodyText?: string
  bodyBase64?: string
  timeoutMs?: number
}

export type RemoteRequestSuccess = {
  ok: true
  requestId: string
  upstream: {
    status: number
    statusText: string
    headers: Record<string, string>
    bodyText?: string
    bodyBase64?: string
  }
  timingMs: number
}

export type RemoteRequestFailure = {
  ok: false
  requestId: string
  error: {
    code: string
    message: string
  }
  timingMs: number
}

export type RemoteRequestResult = RemoteRequestSuccess | RemoteRequestFailure

export class ProxyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = "ProxyError"
  }
}
