import { redactHeadersForLog } from "./headers"

export type AuditEvent = {
  requestId: string
  caller: string
  method?: string
  target?: URL
  status?: number
  durationMs: number
  requestBytes?: number
  responseBytes?: number
  errorCode?: string
  requestHeaders?: Record<string, string>
}

export function audit(event: AuditEvent): void {
  const payload = {
    requestId: event.requestId,
    caller: event.caller,
    method: event.method,
    targetHost: event.target?.host,
    targetPath: event.target ? `${event.target.pathname}${event.target.search}` : undefined,
    status: event.status,
    durationMs: event.durationMs,
    requestBytes: event.requestBytes,
    responseBytes: event.responseBytes,
    errorCode: event.errorCode,
    requestHeaders: redactHeadersForLog(event.requestHeaders),
  }
  console.info(JSON.stringify(payload))
}
