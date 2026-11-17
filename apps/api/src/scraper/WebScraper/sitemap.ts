import axios from "axios";
import { axiosTimeout } from "../../lib/timeout";
import { parseStringPromise } from "xml2js";
import { WebCrawler } from "./crawler";
import { Logger } from "../../lib/logger";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

const blockedIpv4 = new BlockList();
[
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
].forEach(([address, prefix]) =>
  blockedIpv4.addSubnet(address as string, prefix as number, "ipv4")
);

const blockedIpv6 = new BlockList();
[
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
].forEach(([address, prefix]) =>
  blockedIpv6.addSubnet(address as string, prefix as number, "ipv6")
);

const isPublicAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) {
    return !blockedIpv4.check(address, "ipv4");
  }
  return family === 6 && !blockedIpv6.check(address, "ipv6");
};

const lookupPublicAddresses = async (hostname: string) => {
  const host = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const addresses = family
    ? [{ address: host, family }]
    : await dnsLookup(host, { all: true, verbatim: true });

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new Error("Sitemap URL must resolve to a public address");
  }
  return addresses;
};

const safeLookup = ((
  hostname: string,
  options: any,
  callback: (...args: any[]) => void
) => {
  lookupPublicAddresses(hostname)
    .then((addresses) => {
      if (options?.all) {
        callback(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    })
    .catch((error) => callback(error));
}) as typeof import("node:dns").lookup;

export const fetchSitemap = async (url: string, timeout = axiosTimeout) => {
  const parsedUrl = new URL(url);
  if (
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error("Invalid sitemap URL");
  }

  const [address] = await lookupPublicAddresses(parsedUrl.hostname);
  const requestHost =
    address.family === 6 ? `[${address.address}]` : address.address;
  const requestUrl = `${parsedUrl.protocol}//${requestHost}${
    parsedUrl.port ? `:${parsedUrl.port}` : ""
  }${parsedUrl.pathname}${parsedUrl.search}`;
  const isIpAddress = isIP(parsedUrl.hostname.replace(/^\[|\]$/g, "")) !== 0;

  return axios.get(requestUrl, {
    timeout,
    maxRedirects: 0,
    proxy: false,
    headers: { Host: parsedUrl.host },
    httpAgent: new http.Agent({ lookup: safeLookup }),
    httpsAgent: new https.Agent({
      lookup: safeLookup,
      servername: isIpAddress ? undefined : parsedUrl.hostname,
    }),
  });
};

export async function getLinksFromSitemap({
  sitemapUrl,
  allUrls = [],
}: {
  sitemapUrl: string;
  allUrls?: string[];
}): Promise<string[]> {
  try {
    let content: string;
    try {
      const response = await fetchSitemap(sitemapUrl);
      content = response.data;
    } catch (error) {
      Logger.error(`Request failed for ${sitemapUrl}: ${error.message}`);

      return allUrls;
    }

    const parsed = await parseStringPromise(content);
    const root = parsed.urlset || parsed.sitemapindex;

    if (root && root.sitemap) {
      for (const sitemap of root.sitemap) {
        if (sitemap.loc && sitemap.loc.length > 0) {
          await getLinksFromSitemap({
            sitemapUrl: sitemap.loc[0],
            allUrls,
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
    const response = await fetchSitemap(sitemapUrl, timeout || axiosTimeout);
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
