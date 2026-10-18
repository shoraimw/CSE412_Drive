/**
 * Optional Cloudflare public API edge for a CUSTOM HTTPS API domain only.
 * Firebase's direct SDK endpoints (auth/firestore/RTDB) do NOT travel here.
 * This rate limit is a cost/abuse guard, not authentication or a DDoS guarantee.
 */
const json = (status, code, extra = {}) =>
  new Response(JSON.stringify({error: code}), {
    status, headers: {"content-type": "application/json; charset=utf-8",
      "cache-control": "no-store", ...extra}
  });
const encoder = new TextEncoder();
async function keyDigest(value) {
  const array = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(array)].slice(0, 12)
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") {
      return new Response(JSON.stringify({edge: "drive", status: "ok"}), {
        headers: {"content-type": "application/json", "cache-control": "no-store"}
      });
    }
    if (!url.pathname.startsWith("/api/v1/") ||
        !["GET", "POST"].includes(request.method)) {
      return json(404, "route_not_found");
    }
    const length = Number(request.headers.get("content-length") || "0");
    if (length > 16384 || !Number.isFinite(length) || length < 0) {
      return json(413, "request_too_large");
    }
    const ip = request.headers.get("cf-connecting-ip");
    if (!ip) return json(400, "cloudflare_header_missing");
    const outer = await env.PUBLIC_IP_LIMIT.limit({key: "ip:" + ip});
    if (!outer.success) return json(429, "edge_rate_limited", {"retry-after": "60"});

    // JWT is checked by the ORIGIN. At this edge stage it is intentionally
    // UNVERIFIED; token-rotation abuse needs WAF/Bot rules and origin quota.
    const bearer = request.headers.get("authorization");
    const appCheck = request.headers.get("x-firebase-appcheck");
    if (!bearer?.startsWith("Bearer ") || !appCheck) {
      return json(401, "auth_and_app_check_required");
    }
    const tokenKey = await keyDigest(bearer.slice(7));
    const perToken = await env.USER_LIMIT.limit({key: "auth:" + tokenKey});
    if (!perToken.success) return json(429, "account_rate_limited", {"retry-after": "60"});

    // Also enforce byte limits on streamed/chunked bodies. Content-Length can
    // be absent or untrustworthy, so a header-only limit is insufficient.
    let limitedBody;
    if (request.method === "POST" && request.body) {
      const reader = request.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 16384) {
            await reader.cancel();
            return json(413, "request_too_large");
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      limitedBody = new Uint8Array(size);
      let copied = 0;
      for (const part of chunks) {
        limitedBody.set(part, copied);
        copied += part.byteLength;
      }
    }
    const baseText = env.DRIVE_ORIGIN_URL || "";
    let base;
    try { base = new URL(baseText); } catch { return json(503, "origin_unconfigured"); }
    if (base.protocol !== "https:" || base.username || base.password ||
        base.pathname !== "/" || base.search || base.hash ||
        !env.DRIVE_ORIGIN_AUTH) {
      return json(503, "origin_unconfigured");
    }
    // Do not allow the client to choose the upstream host, protocol or port.
    const upstream = new URL(url.pathname + url.search, base.origin);
    const headers = new Headers(request.headers);
    headers.delete("cf-connecting-ip");
    headers.delete("x-drive-origin-key");
    headers.set("x-drive-origin-key", env.DRIVE_ORIGIN_AUTH);
    headers.set("x-forwarded-proto", "https");
    try {
      const response = await fetch(new Request(upstream, {
        method: request.method,
        headers,
        body: request.method === "GET" ? undefined : limitedBody,
        redirect: "manual",
        signal: AbortSignal.timeout(6000),
      }));
      // Never follow or leak an upstream open redirect through the API edge.
      if (response.status >= 300 && response.status < 400) {
        return json(502, "origin_redirect_rejected");
      }
      const result = new Response(response.body, response);
      result.headers.set("cache-control", "no-store");
      result.headers.delete("set-cookie");
      return result;
    } catch (_) {
      return json(503, "origin_unavailable", {"retry-after": "10"});
    }
  }
};
