import axios from "axios";
import * as dns from "node:dns/promises";
import { fetchSitemapData, getLinksFromSitemap } from "../sitemap";

jest.mock("axios");
jest.mock("node:dns/promises", () => ({
  lookup: jest.fn(),
}));

const mockAxios = axios as jest.Mocked<typeof axios>;
const mockDnsLookup = dns.lookup as jest.Mock;

describe("getLinksFromSitemap", () => {
  beforeEach(() => {
    mockAxios.get.mockReset();
    mockDnsLookup.mockReset();
    mockDnsLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("does not fetch an initial sitemap on a private literal address", async () => {
    await getLinksFromSitemap({
      sitemapUrl: "http://127.0.0.1/sitemap.xml",
    });

    expect(mockDnsLookup).not.toHaveBeenCalled();
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it("does not fetch an initial sitemap whose hostname resolves privately", async () => {
    mockDnsLookup.mockResolvedValue([
      { address: "10.0.0.5", family: 4 },
    ]);

    await getLinksFromSitemap({
      sitemapUrl: "https://private.example/sitemap.xml",
    });

    expect(mockDnsLookup).toHaveBeenCalledWith("private.example", {
      all: true,
      verbatim: true,
    });
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it("rejects initial sitemap DNS results in IPv6 documentation space", async () => {
    mockDnsLookup.mockResolvedValue([
      { address: "2001:db8::1", family: 6 },
    ]);

    await getLinksFromSitemap({
      sitemapUrl: "https://docs.example/sitemap.xml",
    });

    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it("does not fetch sitemap-index locations from a different origin", async () => {
    mockAxios.get.mockResolvedValue({
      data: `
        <sitemapindex>
          <sitemap><loc>http://127.0.0.1/admin</loc></sitemap>
        </sitemapindex>
      `,
    } as any);

    await getLinksFromSitemap({
      sitemapUrl: "https://example.com/sitemap.xml",
    });

    expect(mockAxios.get).toHaveBeenCalledTimes(1);
    expect(mockAxios.get).toHaveBeenCalledWith(
      "https://93.184.216.34/sitemap.xml",
      expect.objectContaining({
        maxRedirects: 0,
        headers: { Host: "example.com" },
      })
    );
  });

  it("does not fetch a nested sitemap whose hostname resolves privately", async () => {
    mockDnsLookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "192.168.1.10", family: 4 }]);
    mockAxios.get.mockResolvedValue({
      data: `
        <sitemapindex>
          <sitemap><loc>/nested.xml</loc></sitemap>
        </sitemapindex>
      `,
    } as any);

    await getLinksFromSitemap({
      sitemapUrl: "https://example.com/sitemap.xml",
    });

    expect(mockAxios.get).toHaveBeenCalledTimes(1);
    expect(mockDnsLookup).toHaveBeenCalledTimes(2);
  });

  it("follows sitemap-index locations on the same origin", async () => {
    mockAxios.get.mockImplementation(async (url) => {
      if (url === "https://93.184.216.34/sitemap.xml") {
        return {
          data: `
            <sitemapindex>
              <sitemap><loc>/nested.xml</loc></sitemap>
            </sitemapindex>
          `,
        } as any;
      }

      return {
        data: `
          <urlset>
            <url><loc>https://example.com/page</loc></url>
          </urlset>
        `,
      } as any;
    });

    const links = await getLinksFromSitemap({
      sitemapUrl: "https://example.com/sitemap.xml",
    });

    expect(links).toEqual(["https://example.com/page"]);
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
    expect(mockAxios.get).toHaveBeenLastCalledWith(
      "https://93.184.216.34/nested.xml",
      expect.objectContaining({
        maxRedirects: 0,
        headers: { Host: "example.com" },
      })
    );
  });

  it("preserves custom path and query while using the pinned IP and TLS identity", async () => {
    mockAxios.get.mockResolvedValue({ data: "<urlset />" } as any);

    await getLinksFromSitemap({
      sitemapUrl: "https://example.com:8443/custom-sitemap.xml?section=1",
    });

    expect(mockAxios.get).toHaveBeenCalledWith(
      "https://93.184.216.34:8443/custom-sitemap.xml?section=1",
      expect.objectContaining({
        headers: { Host: "example.com:8443" },
      })
    );
    const requestOptions = mockAxios.get.mock.calls[0][1] as any;
    expect(requestOptions.maxRedirects).toBe(0);
    expect(requestOptions.proxy).toBe(false);
    expect(requestOptions.httpsAgent.options.servername).toBe("example.com");
    expect(requestOptions.httpsAgent.options.checkServerIdentity).toEqual(
      expect.any(Function)
    );
    expect(requestOptions.httpsAgent.options.lookup).toBeUndefined();
    expect(mockDnsLookup).toHaveBeenCalledTimes(1);
  });
});

describe("fetchSitemapData", () => {
  beforeEach(() => {
    mockAxios.get.mockReset();
    mockDnsLookup.mockReset();
    mockDnsLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("rejects a private initial sitemap URL", async () => {
    await fetchSitemapData("http://[::1]");

    expect(mockDnsLookup).not.toHaveBeenCalled();
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it("rejects a sitemap URL whose hostname resolves privately", async () => {
    mockDnsLookup.mockResolvedValue([
      { address: "169.254.169.254", family: 4 },
    ]);

    await fetchSitemapData("https://metadata.example");

    expect(mockDnsLookup).toHaveBeenCalledTimes(1);
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it("uses the same pinned, redirect-free request options", async () => {
    mockAxios.get.mockResolvedValue({
      status: 200,
      data: "<urlset />",
    } as any);

    await fetchSitemapData("https://example.com");

    expect(mockAxios.get).toHaveBeenCalledWith(
      "https://93.184.216.34/sitemap.xml",
      expect.objectContaining({
        maxRedirects: 0,
        proxy: false,
        headers: { Host: "example.com" },
        httpsAgent: expect.any(Object),
      })
    );
  });
});
