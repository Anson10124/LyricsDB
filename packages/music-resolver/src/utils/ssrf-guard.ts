import { isIP } from "node:net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/**
 * Checks whether an IPv4 address is in a private, loopback, or reserved range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IPv4 is treated as unsafe
  }

  const [a, b] = parts as [number, number, number, number];

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private network)
  if (a === 10) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-local / AWS IMDS / Cloud Metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private network)
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
  if (a >= 224) return true;

  return false;
}

/**
 * Checks whether an IPv6 address is in a private, loopback, or reserved range.
 */
function isPrivateIPv6(ip: string): boolean {
  const cleanIp = ip.toLowerCase().trim();

  // Loopback (::1) or Unspecified (::)
  if (cleanIp === "::1" || cleanIp === "::" || cleanIp === "0:0:0:0:0:0:0:1") {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:127.0.0.1, etc.)
  if (cleanIp.startsWith("::ffff:")) {
    const ipv4Part = cleanIp.slice(7);
    if (isIP(ipv4Part) === 4) {
      return isPrivateIPv4(ipv4Part);
    }
  }

  // Unique local address (fc00::/7 -> fc00... to fdff...)
  if (cleanIp.startsWith("fc") || cleanIp.startsWith("fd")) {
    return true;
  }

  // Link-local unicast (fe80::/10)
  if (
    cleanIp.startsWith("fe8") ||
    cleanIp.startsWith("fe9") ||
    cleanIp.startsWith("fea") ||
    cleanIp.startsWith("feb")
  ) {
    return true;
  }

  // Multicast (ff00::/8)
  if (cleanIp.startsWith("ff")) {
    return true;
  }

  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "instance-data",
]);

/**
 * Validates whether a given URL is safe for outbound server-side fetching.
 * Protects against Server-Side Request Forgery (SSRF) targeting internal networks and metadata services.
 */
export function isSafeUrl(urlString: string): boolean {
  if (!urlString || typeof urlString !== "string") {
    return false;
  }

  try {
    const parsed = new URL(urlString.trim());

    // Only HTTP and HTTPS protocols are permitted
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    // Only standard web ports permitted (or default 80/443)
    if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase().trim();

    if (!hostname) {
      return false;
    }

    // Check blocked named hosts
    if (
      BLOCKED_HOSTNAMES.has(hostname) ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local")
    ) {
      return false;
    }

    // Strip square brackets from IPv6 hostnames
    const ipCandidate = hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

    const ipVersion = isIP(ipCandidate);
    if (ipVersion === 4) {
      return !isPrivateIPv4(ipCandidate);
    }
    if (ipVersion === 6) {
      return !isPrivateIPv6(ipCandidate);
    }

    // Check for decimal / octal / hex IP representations (e.g., 2130706433 = 127.0.0.1 or 0x7f000001)
    if (/^\d+$/.test(hostname) || /^0x[0-9a-fA-F]+$/i.test(hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Asserts that a URL is safe for outbound requests.
 * Throws `SsrfError` if the URL is unsafe or targeting private network ranges.
 */
export function assertSafeUrl(urlString: string): void {
  if (!isSafeUrl(urlString)) {
    throw new SsrfError(
      `Outbound request blocked: URL "${urlString}" is invalid or targets a restricted host/network.`,
    );
  }
}
