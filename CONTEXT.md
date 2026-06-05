# Remote Request Proxy

The Remote Request Proxy context owns controlled outbound HTTP execution for internal callers that need to reach public URLs without exposing a raw tunnel.

## Language

**Remote Request Proxy**:
An internal service that receives a structured request description and performs the outbound HTTP request under safety rules.
_Avoid_: raw proxy, tunnel

**Remote Request**:
A single requested outbound HTTP operation described by method, target URL, headers, and optional body.
_Avoid_: browser request, client request

**Target URL**:
The absolute public HTTP or HTTPS URL that a Remote Request asks the service to contact.
_Avoid_: proxy URL, callback URL

**Upstream Response**:
The HTTP response returned by the Target URL after redirects and validation have completed.
_Avoid_: proxy response

**Proxy Error**:
A failure produced by the Remote Request Proxy before an Upstream Response is available.
_Avoid_: upstream error

**Public URL**:
An HTTP or HTTPS URL whose hostname resolves only to public routable addresses and is not localhost or cloud metadata.
_Avoid_: safe URL, allowed URL

## Relationships

- A **Remote Request Proxy** receives one **Remote Request**
- A **Remote Request** has exactly one **Target URL**
- A **Remote Request** produces either one **Upstream Response** or one **Proxy Error**
- A **Public URL** is required for every **Target URL** and redirect hop

## Example dialogue

> **Dev:** "If the third-party API returns 500, is that a Proxy Error?"
> **Domain expert:** "No. That is an Upstream Response with status 500. A Proxy Error means the proxy could not safely or successfully perform the remote request."

## Flagged ambiguities

- "proxy" was narrowed to **Remote Request Proxy**, a controlled JSON-envelope service rather than a raw HTTP tunnel.
