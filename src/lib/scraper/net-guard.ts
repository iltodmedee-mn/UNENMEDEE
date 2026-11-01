import dns, { type LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";

import { Agent, buildConnector, fetch as undiciFetch } from "undici";

/**
 * Keeps every request the scraper makes on the public internet.
 *
 * Publishers choose where our requests go: a redirect, a WordPress `link`, an advertised REST
 * base, a feed item. None of them may reach loopback, a private network or a cloud metadata
 * address (169.254.169.254) from the GitHub runner or a Vercel function. The check sits where
 * the address is known, at connect time (a custom DNS lookup plus a check of IP-literal hosts),
 * so redirects are covered hop by hop and a DNS answer cannot change between check and use.
 */

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => (n & (bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0)) >>> 0 === ipv4ToInt(base));
  }
  if (isIP(ip) === 6) {
    const bytes = ipv6Bytes(ip);
    if (!bytes) return true;
    const embedded = embeddedIpv4(bytes);
    if (embedded) return isPrivateAddress(embedded);
    // Classes from the bytes, not the spelling: "0:0:0:0:0:0:0:1" and "0000::1" are loopback too.
    const [b0, b1] = bytes;
    const loopback = bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1;
    return (
      bytes.every((b) => b === 0) || // unspecified
      loopback ||
      (b0 & 0xfe) === 0xfc || // unique local fc00::/7
      (b0 === 0xfe && (b1 & 0xc0) === 0x80) || // link-local fe80::/10
      (b0 === 0xfe && (b1 & 0xc0) === 0xc0) || // old site-local fec0::/10
      b0 === 0xff // multicast
    );
  }
  return true; // not an IP at all: refuse rather than guess
}

/** The 16 bytes of an IPv6 address ("::" expanded, an embedded dotted quad read), or null. */
export function ipv6Bytes(ip: string): number[] | null {
  let v = ip.toLowerCase().replace(/%.*$/, "");
  const dotted = v.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = ipv4ToInt(dotted[1]);
    v = `${v.slice(0, -dotted[1].length)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

/**
 * The IPv4 address an IPv6 one stands for: IPv4-mapped (::ffff:a.b.c.d, also written ::ffff:7f00:1),
 * IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::a.b.c.d) and 6to4 (2002:a.b.c.d::). Each of these
 * reaches the embedded IPv4 host, so it must pass the IPv4 private-range check.
 */
export function embeddedIpv4(bytes: number[]): string | null {
  const v4 = (at: number) => bytes.slice(at, at + 4).join(".");
  const zeros = (upTo: number) => bytes.slice(0, upTo).every((b) => b === 0);
  if (zeros(10) && bytes[10] === 0xff && bytes[11] === 0xff) return v4(12);
  if (zeros(12) && !(bytes[12] === 0 && bytes[13] === 0 && bytes[14] === 0 && bytes[15] <= 1)) return v4(12);
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((b) => b === 0)) return v4(12);
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return v4(2);
  return null;
}

export class PrivateDestinationError extends Error {
  readonly code = "EPRIVATEDEST";
  constructor(host: string) {
    super(`refused a request to a non-public address (${host})`);
    this.name = "PrivateDestinationError";
  }
}

const bare = (host: string) => host.replace(/^\[|\]$/g, "");

/** A host we refuse without asking DNS: a private IP literal or a localhost name. */
export function isBlockedHostLiteral(hostname: string): boolean {
  const h = bare(hostname).toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  return isIP(h) !== 0 && isPrivateAddress(h);
}

/** Throws for a URL whose host is a private IP literal or a localhost name. */
export function assertPublicHostLiteral(url: string | URL): void {
  const host = typeof url === "string" ? new URL(url).hostname : url.hostname;
  if (isBlockedHostLiteral(host)) throw new PrivateDestinationError(host);
}

/** `dns.lookup` that fails when any address of the name is not public. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    const bad = addresses.find((a) => isPrivateAddress(a.address));
    if (!addresses.length || bad) return callback(new PrivateDestinationError(`${hostname} → ${bad?.address ?? "none"}`), "", 0);
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

const baseConnect = buildConnector({ lookup: publicLookup } as buildConnector.BuildOptions);

/** undici dispatcher for our fetches: public destinations only, on every hop. */
export const publicDispatcher = new Agent({
  connect: (opts, callback) => {
    if (isBlockedHostLiteral(opts.hostname)) return callback(new PrivateDestinationError(opts.hostname), null);
    return baseConnect(opts, callback);
  },
});

/** fetch() restricted to public destinations (same API as the global fetch). */
export const publicFetch = ((input: string | URL, init: RequestInit = {}) =>
  undiciFetch(input, { ...(init as object), dispatcher: publicDispatcher }) as unknown as Promise<Response>) as typeof fetch;

const hostVerdicts = new Map<string, Promise<boolean>>();

/** Whether a host name resolves only to public addresses (cached per process). For the browser pass. */
export function isPublicHost(hostname: string): Promise<boolean> {
  const h = bare(hostname).toLowerCase();
  if (isBlockedHostLiteral(h)) return Promise.resolve(false);
  if (isIP(h)) return Promise.resolve(true);
  let verdict = hostVerdicts.get(h);
  if (!verdict) {
    verdict = new Promise<boolean>((resolve) => publicLookup(h, { all: true }, (err) => resolve(!err)));
    hostVerdicts.set(h, verdict);
  }
  return verdict;
}

/**
 * The same guard for got (Crawlee's HTTP pass, robots.txt): our DNS lookup, HTTP/1.1 (the HTTP/2
 * path resolves names on its own) and a check of every redirect target that is an IP literal.
 */
export function guardGotOptions<T extends object>(options: T): T {
  const o = options as T & { dnsLookup?: LookupFunction; http2?: boolean; hooks?: { beforeRedirect?: ((updated: { url?: URL | string }) => void)[] } };
  o.dnsLookup = publicLookup;
  o.http2 = false;
  o.hooks = { ...o.hooks, beforeRedirect: [...(o.hooks?.beforeRedirect ?? []), (updated) => updated.url && assertPublicHostLiteral(updated.url)] };
  return options;
}
