import axios from "axios";
import { lookup as dnsLookup } from "node:dns/promises";
import { Agent as HttpAgent } from "node:http";
import { isIP } from "node:net";
import { Agent as HttpsAgent } from "node:https";
import { checkServerIdentity } from "node:tls";
import { axiosTimeout } from "../../lib/timeout";
import { parseStringPromise } from "xml2js";
import { WebCrawler } from "./crawler";
import { Logger } from "../../lib/logger";

const nonPublicIpv4Ranges: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const ipv4ToNumber = (address: string): number =>
  address
    .split(".")
    .map(Number)
    .reduce((result, octet) => result * 256 + octet, 0);

const isInIpv4Range = (
  address: number,
  network: string,
  prefixLength: number
): boolean => {
  const blockSize = 2 ** (32 - prefixLength);
  return Math.floor(address / blockSize) ===
    Math.floor(ipv4ToNumber(network) / blockSize);
};

const ipv6ToBigInt = (address: string): bigint | null => {
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const octets = normalized
      .slice(lastColon + 1)
      .split(".")
      .map(Number);
    if (octets.length !== 4) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${normalized.slice(0, lastColon)}:${high}:${low}`;
  }

  const [left = "", right = ""] = normalized.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const missingParts = 8 - leftParts.length - rightParts.length;
  if (
    missingParts < 0 ||
    (normalized.includes("::") ? missingParts < 1 : missingParts !== 0)
  ) {
    return null;
  }

  const parts = [
    ...leftParts,
    ...Array(missingParts).fill("0"),
    ...rightParts,
  ];
  if (parts.length !== 8) return null;

  return parts.reduce(
    (result, part) => (result << 16n) | BigInt(`0x${part || "0"}`),
    0n
  );
};

const isInIpv6Range = (
  address: bigint,
  network: string,
  prefixLength: number
): boolean => {
  const shift = BigInt(128 - prefixLength);
  return address >> shift === BigInt(`0x${network}`) >> shift;
};

const isPublicIp = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) {
    const numericAddress = ipv4ToNumber(address);
    return !nonPublicIpv4Ranges.some(([network, prefixLength]) =>
      isInIpv4Range(numericAddress, network, prefixLength)
    );
  }
  if (family !== 6) return false;

  const numericAddress = ipv6ToBigInt(address);
  if (numericAddress === null) return false;

  return (
    isInIpv6Range(numericAddress, "20000000000000000000000000000000", 3) &&
    !isInIpv6Range(numericAddress, "20010000000000000000000000000000", 23) &&
    !isInIpv6Range(numericAddress, "20010db8000000000000000000000000", 32) &&
    !isInIpv6Range(numericAddress, "20020000000000000000000000000000", 16) &&
    !isInIpv6Range(numericAddress, "3fff0000000000000000000000000000", 20)
  );
};

const getSafeSitemapRequestOptions = async (
  sitemapUrl: string,
  timeout: number,
  requestPath: string,
  requestSearch = ""
) => {
  const parsedUrl = new URL(sitemapUrl);
  if (
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error("Invalid sitemap URL");
  }

  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  const resolvedAddresses = family
    ? [{ address: hostname, family }]
    : await dnsLookup(hostname, { all: true, verbatim: true });

  if (
    resolvedAddresses.length === 0 ||
    resolvedAddresses.some(({ address }) => !isPublicIp(address))
  ) {
    throw new Error("Sitemap URL resolves to a non-public address");
  }

  const pinnedAddress = resolvedAddresses[0];
  const pinnedHost =
    pinnedAddress.family === 6
      ? `[${pinnedAddress.address}]`
      : pinnedAddress.address;
  const requestProtocol =
    parsedUrl.protocol === "https:" ? "https:" : "http:";
  const requestUrl = new URL(`${requestProtocol}//${pinnedHost}`);
  requestUrl.port = parsedUrl.port;
  requestUrl.pathname = requestPath;
  requestUrl.search = requestSearch;

  return {
    url: requestUrl.href,
    options: {
      timeout,
      maxRedirects: 0,
      proxy: false,
      // Connect to the vetted IP while retaining HTTP and TLS host identity.
      headers: { Host: parsedUrl.host },
      httpAgent: new HttpAgent(),
      httpsAgent: new HttpsAgent({
        ...(family === 0 ? { servername: hostname } : {}),
        checkServerIdentity: (_requestHostname, certificate) =>
          checkServerIdentity(hostname, certificate),
      }),
    },
  };
};

export async function getLinksFromSitemap({
  sitemapUrl,
  allUrls = [],
  allowedOrigin,
}: {
  sitemapUrl: string;
  allUrls?: string[];
  allowedOrigin?: string;
}): Promise<string[]> {
  try {
    const parsedSitemapUrl = new URL(sitemapUrl);
    if (
      (parsedSitemapUrl.protocol !== "http:" &&
        parsedSitemapUrl.protocol !== "https:") ||
      parsedSitemapUrl.username ||
      parsedSitemapUrl.password
    ) {
      return allUrls;
    }

    const sitemapOrigin = allowedOrigin ?? parsedSitemapUrl.origin;
    if (parsedSitemapUrl.origin !== sitemapOrigin) {
      return allUrls;
    }

    const safeSitemapUrl = parsedSitemapUrl.href;
    let content: string;
    try {
      const { url: requestUrl, options: requestOptions } =
        await getSafeSitemapRequestOptions(
          safeSitemapUrl,
          axiosTimeout,
          parsedSitemapUrl.pathname,
          parsedSitemapUrl.search
        );
      const response = await axios.get(requestUrl, requestOptions);
      content = response.data;
    } catch (error) {
      Logger.error(`Request failed for ${safeSitemapUrl}: ${error.message}`);

      return allUrls;
    }

    const parsed = await parseStringPromise(content);
    const root = parsed.urlset || parsed.sitemapindex;

    if (root && root.sitemap) {
      for (const sitemap of root.sitemap) {
        if (sitemap.loc && sitemap.loc.length > 0) {
          await getLinksFromSitemap({
            sitemapUrl: new URL(sitemap.loc[0], safeSitemapUrl).href,
            allUrls,
            allowedOrigin: sitemapOrigin,
          });
        }
      }
    } else if (root && root.url) {
      for (const url of root.url) {
        if (
          url.loc &&
          url.loc.length > 0 &&
          !WebCrawler.prototype.isFile(url.loc[0])
        ) {
          allUrls.push(url.loc[0]);
        }
      }
    }
  } catch (error) {
    Logger.debug(
      `Error processing sitemapUrl: ${sitemapUrl} | Error: ${error.message}`
    );
  }

  return allUrls;
}

export const fetchSitemapData = async (
  url: string,
  timeout?: number
): Promise<SitemapEntry[] | null> => {
  const sitemapUrl = url.endsWith("/sitemap.xml") ? url : `${url}/sitemap.xml`;
  try {
    const { url: requestUrl, options: requestOptions } =
      await getSafeSitemapRequestOptions(
        sitemapUrl,
        timeout || axiosTimeout,
        "/sitemap.xml"
      );
    const response = await axios.get(requestUrl, requestOptions);
    if (response.status === 200) {
      const xml = response.data;
      const parsedXml = await parseStringPromise(xml);

      const sitemapData: SitemapEntry[] = [];
      if (parsedXml.urlset && parsedXml.urlset.url) {
        for (const urlElement of parsedXml.urlset.url) {
          const sitemapEntry: SitemapEntry = { loc: urlElement.loc[0] };
          if (urlElement.lastmod) sitemapEntry.lastmod = urlElement.lastmod[0];
          if (urlElement.changefreq)
            sitemapEntry.changefreq = urlElement.changefreq[0];
          if (urlElement.priority)
            sitemapEntry.priority = Number(urlElement.priority[0]);
          sitemapData.push(sitemapEntry);
        }
      }

      return sitemapData;
    }
    return null;
  } catch (error) {
    // Error handling for failed sitemap fetch
  }
  return [];
};

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}
