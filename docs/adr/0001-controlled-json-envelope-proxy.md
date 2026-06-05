# Controlled JSON Envelope Proxy

We will build `remote-request` as a controlled JSON-envelope proxy instead of a raw HTTP tunnel. Callers submit method, URL, headers, and optional body to `POST /v1/request`; the service validates the target as a Public URL, manually revalidates redirects, applies header and size policies, and returns either an Upstream Response envelope or a Proxy Error. This trades some HTTP transparency for SSRF protection, stable agent/CLI consumption, and auditable internal operation.
