import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { ProxyError } from "./types"

export type DnsResolver = (hostname: string) => Promise<string[]>

export const nodeDnsResolver: DnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

export async function assertPublicTargetUrl(url: URL, resolver: DnsResolver): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProxyError("UNSUPPORTED_SCHEME", "Target URL must use http or https")
  }

  if (url.username || url.password) {
    throw new ProxyError("INVALID_URL", "Target URL cannot include credentials")
  }

  const hostname = normalizeHostname(url.hostname)
  if (isLocalhostName(hostname) || isMetadataName(hostname)) {
    throw new ProxyError("PRIVATE_TARGET", "Target URL host is not public")
  }

  const directIpVersion = isIP(hostname)
  const addresses = directIpVersion ? [hostname] : await resolveHost(hostname, resolver)

  if (addresses.length === 0) {
    throw new ProxyError("DNS_LOOKUP_FAILED", "Target hostname did not resolve", 502)
  }

  for (const address of addresses) {
    if (!isPublicIp(address)) {
      throw new ProxyError("PRIVATE_TARGET", "Target URL resolves to a non-public address")
    }
  }
}

export function parseTargetUrl(value: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new ProxyError("INVALID_URL", "Target URL is not a valid absolute URL")
  }
}

export function resolveRedirectUrl(currentUrl: URL, location: string | null): URL {
  if (!location) {
    throw new ProxyError("INVALID_REDIRECT", "Redirect response is missing Location", 502)
  }
  try {
    return new URL(location, currentUrl)
  } catch {
    throw new ProxyError("INVALID_REDIRECT", "Redirect Location is invalid", 502)
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase()
}

async function resolveHost(hostname: string, resolver: DnsResolver): Promise<string[]> {
  try {
    return await resolver(hostname)
  } catch {
    throw new ProxyError("DNS_LOOKUP_FAILED", "Target hostname could not be resolved", 502)
  }
}

function isLocalhostName(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost")
}

function isMetadataName(hostname: string): boolean {
  return hostname === "metadata.google.internal"
}

export function isPublicIp(address: string): boolean {
  if (isIpv4(address)) return isPublicIpv4(address)
  if (isIP(address) === 6) return isPublicIpv6(address)
  return false
}

function isIpv4(address: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(address)
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number)
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  const [a, b] = octets

  if (a === 0) return false
  if (a === 10) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 0) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a >= 224) return false
  if (address === "169.254.169.254") return false

  return true
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === "::" || normalized === "::1") return false
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return false
  }
  if (normalized.startsWith("ff")) return false
  if (normalized.includes("ffff:127.") || normalized.includes("ffff:10.") || normalized.includes("ffff:192.168.")) {
    return false
  }
  return true
}
