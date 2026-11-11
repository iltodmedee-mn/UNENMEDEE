import type { LookupFunction } from "node:net";
import tls from "node:tls";

import { publicLookup } from "./net-guard";

/**
 * Which sites are read without checking their TLS certificate (CLAUDE.md §3, scraper.md).
 *
 * Some .gov.mn sites serve an expired or incomplete certificate chain, and the crawler used to
 * skip the check for every site because of them (an outside audit, Nov 2026: anyone on the path
 * could then alter a story before it is summarised). Now every request is verified unless its
 * host is in `app_settings.tls_broken_hosts`, the list the weekly source re-check writes from
 * `certValid` (the same Node trust store the crawler uses, so the list is exactly the hosts a
 * verified request would refuse).
 */
export const TLS_BROKEN_KEY = "tls_broken_hosts";

export interface TlsReport {
  at: string;
  /** Hosts whose certificate fails verification: read unverified until it is repaired. */
  hosts: string[];
  /** Hosts that joined the list at this check (the watchdog names them once). */
  added: string[];
}

export function parseTlsReport(raw: string | null | undefined): TlsReport | null {
  try {
    const v = JSON.parse(raw ?? "") as Partial<TlsReport>;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((h): h is string => typeof h === "string" && h.length > 0 && h.length < 254).map((h) => h.toLowerCase()) : []);
    if (typeof v?.at !== "string" || !Array.isArray(v.hosts)) return null;
    return { at: v.at, hosts: list(v.hosts), added: list(v.added) };
  } catch {
    return null;
  }
}

function hostOf(url: string | URL): string | null {
  try {
    return (typeof url === "string" ? new URL(url) : url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True when this exact host is on the list. A subdomain is its own host. */
export function tlsExempt(url: string | URL, hosts: ReadonlySet<string>): boolean {
  const host = hostOf(url);
  return host !== null && hosts.has(host);
}

interface GotLike {
  https?: { rejectUnauthorized?: boolean };
  hooks?: { beforeRequest?: ((options: { url?: URL | string; https: { rejectUnauthorized?: boolean } }) => void)[] };
}

/**
 * Makes a got request (and each redirect it follows) verify the certificate unless the host it is
 * about to contact is on the list. A hook, not a plain option: Crawlee overwrites
 * `https.rejectUnauthorized` from its crawler-wide `ignoreSslErrors` after the navigation hooks ran.
 */
export function applyTlsPolicy<T extends object>(options: T, hosts: ReadonlySet<string>): T {
  const o = options as T & GotLike;
  o.https = { ...o.https, rejectUnauthorized: true };
  o.hooks = {
    ...o.hooks,
    beforeRequest: [
      ...(o.hooks?.beforeRequest ?? []),
      (req) => {
        req.https.rejectUnauthorized = !(req.url && tlsExempt(req.url, hosts));
      },
    ],
  };
  return options;
}

/** Node's verification failures that mean "the certificate", not "the network". */
const CERT_ERRORS = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REVOKED",
  "CERT_REJECTED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_CHAIN_TOO_LONG",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  "INVALID_CA",
  "INVALID_PURPOSE",
]);

export interface CertProbe {
  port?: number;
  timeoutMs?: number;
  lookup?: LookupFunction;
  ca?: string | Buffer;
}

/**
 * One verified TLS handshake: true = the certificate is good, false = it fails verification,
 * null = no answer (network, timeout, a private address), which proves nothing either way.
 */
export function certValid(host: string, probe: CertProbe = {}): Promise<boolean | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean | null) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    const socket = tls.connect({ host, port: probe.port ?? 443, servername: host, rejectUnauthorized: true, lookup: probe.lookup ?? publicLookup, ca: probe.ca });
    socket.setTimeout(probe.timeoutMs ?? 10_000, () => finish(null));
    socket.once("secureConnect", () => finish(true));
    socket.once("error", (err: NodeJS.ErrnoException) => finish(CERT_ERRORS.has(err.code ?? "") ? false : null));
  });
}

/** A per-run memo of `certValid`, for the browser pass (one handshake per host). */
export function certChecker(probe: CertProbe = {}): (host: string) => Promise<boolean | null> {
  const seen = new Map<string, Promise<boolean | null>>();
  return (host) => {
    const key = host.toLowerCase();
    let p = seen.get(key);
    if (!p) seen.set(key, (p = certValid(key, probe)));
    return p;
  };
}

/**
 * The next report from this check's verdicts. A host that did not answer keeps its place (a
 * network blip must not make a broken site unreadable for a week); a repaired one leaves.
 */
export function nextTlsReport(prev: TlsReport | null, verdicts: ReadonlyMap<string, boolean | null>, now: Date): TlsReport {
  const before = new Set(prev?.hosts ?? []);
  const hosts = new Set<string>();
  for (const [host, ok] of verdicts) if (ok === false || (ok === null && before.has(host))) hosts.add(host);
  const sorted = [...hosts].sort();
  return { at: now.toISOString(), hosts: sorted, added: sorted.filter((h) => !before.has(h)) };
}
