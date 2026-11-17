// crawler.test.ts
import { WebCrawler } from "../crawler";
import axios from "axios";
import dns from "node:dns/promises";
import tls from "node:tls";
import robotsParser from "robots-parser";

jest.mock("axios");
jest.mock("robots-parser");

describe("WebCrawler", () => {
  let crawler: WebCrawler;
  const mockAxios = axios as jest.Mocked<typeof axios>;
  const mockRobotsParser = robotsParser as jest.MockedFunction<
    typeof robotsParser
  >;

  beforeEach(() => {
    // Setup default mocks
    mockAxios.get.mockImplementation((url) => {
      if (url.includes("robots.txt")) {
        return Promise.resolve({ data: "User-agent: *\nAllow: /" });
      } else if (url.includes("sitemap.xml")) {
        return Promise.resolve({ data: "sitemap content" }); // You would normally parse this to URLs
      }
      return Promise.resolve({ data: "<html></html>" });
    });

    mockRobotsParser.mockReturnValue({
      isAllowed: jest.fn().mockReturnValue(true),
      isDisallowed: jest.fn().mockReturnValue(false),
      getMatchingLineNumber: jest.fn().mockReturnValue(0),
      getCrawlDelay: jest.fn().mockReturnValue(0),
      getSitemaps: jest.fn().mockReturnValue([]),
      getPreferredHost: jest.fn().mockReturnValue("example.com"),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should ignore social media and email links", async () => {
    const urlsWhichShouldGetBlocked = [
      "http://facebook.com",
      "http://www.facebook.com",
      "https://facebook.com",
      "https://test.facebook.com",
      "https://en.wikipedia.com/barman",
      "https://docs.mux.com/guides/player",
      "https://mux.com",
      "https://x.com",
    ];

    crawler = new WebCrawler({
      jobId: "TEST",
      initialUrl: "http://example.com",
      includes: [],
      excludes: [],
      limit: 100,
      maxCrawledDepth: 10,
      crawlId: "TEST",
    });

    const filteredLinks = urlsWhichShouldGetBlocked.filter(
      (url) => !crawler.isSocialMediaOrEmail(url),
    );

    expect(filteredLinks).toContain("https://docs.mux.com/guides/player");
    expect(filteredLinks.length).toBe(2);
  });

  it.each(["http://127.0.0.1", "http://[::1]"])(
    "should not crawl a private IP address: %s",
    async (initialUrl) => {
      crawler = new WebCrawler({
        jobId: "TEST",
        initialUrl,
        crawlId: "TEST",
      });

      await expect(crawler.start()).resolves.toEqual([]);
      expect(mockAxios.get).not.toHaveBeenCalled();
    }
  );

  it("pins the robots request URL to the validated IP and preserves host and TLS identity", async () => {
    jest.spyOn(dns, "lookup").mockImplementation(
      (async () => [{ address: "93.184.216.34", family: 4 }]) as any
    );
    crawler = new WebCrawler({
      jobId: "TEST",
      initialUrl: "https://example.com:8443/some/path",
      crawlId: "TEST",
    });

    await crawler.getRobotsTxt();

    const [requestUrl, requestOptions] = mockAxios.get.mock.calls[0];
    expect(requestUrl).toBe("https://93.184.216.34:8443/robots.txt");
    expect(requestOptions).toMatchObject({
      maxRedirects: 0,
      headers: { Host: "example.com:8443" },
    });
    const httpsAgent = requestOptions.httpsAgent as import("node:https").Agent;
    expect(httpsAgent.options.servername).toBe("example.com");
    expect(httpsAgent.options.checkServerIdentity).toEqual(
      expect.any(Function)
    );

    const certificate = {} as tls.PeerCertificate;
    const verifyCertificate =
      httpsAgent.options.checkServerIdentity as NonNullable<
        typeof httpsAgent.options.checkServerIdentity
      >;
    const identityCheck = jest
      .spyOn(tls, "checkServerIdentity")
      .mockReturnValue(undefined);
    verifyCertificate("93.184.216.34", certificate);
    expect(identityCheck).toHaveBeenCalledWith("example.com", certificate);
  });
});
