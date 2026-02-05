import ipaddr from "ipaddr.js";

export function parseAllowlist(raw?: string): string[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseBasicAuth(
  header?: string
): { user: string; pass: string } | null {
  if (!header) return null;

  const [scheme, encoded] = header.split(" ");
  if (!encoded || scheme.toLowerCase() !== "basic") return null;

  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch (error) {
    return null;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return null;

  return {
    user: decoded.slice(0, separatorIndex),
    pass: decoded.slice(separatorIndex + 1),
  };
}

export function isIpAllowed(ip: string, allowlist: string[]): boolean {
  if (!allowlist.length) return false;

  let candidate: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    candidate = ipaddr.process(ip);
  } catch (error) {
    return false;
  }

  for (const entry of allowlist) {
    if (!entry) continue;
    try {
      if (entry.includes("/")) {
        const [range, prefix] = ipaddr.parseCIDR(entry);
        if (candidate.match([range, prefix])) return true;
      } else {
        const allowed = ipaddr.process(entry);
        if (
          candidate.kind() === allowed.kind() &&
          candidate.toString() === allowed.toString()
        ) {
          return true;
        }
      }
    } catch (error) {
      continue;
    }
  }

  return false;
}
