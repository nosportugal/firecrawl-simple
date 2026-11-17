import axios from "axios";
import { lookup as dnsLookup } from "node:dns/promises";
import { fetchSitemap } from "../sitemap";

jest.mock("axios");
jest.mock("node:dns/promises", () => ({
  lookup: jest.fn(),
}));

const mockAxios = axios as jest.Mocked<typeof axios>;
const mockDnsLookup = dnsLookup as jest.MockedFunction<typeof dnsLookup>;

describe("fetchSitemap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    "http://127.0.0.1/sitemap.xml",
    "http://[::1]/sitemap.xml",
  ])("rejects private IP addresses before making a request: %s", async (url) => {
    mockAxios.get.mockResolvedValue({ data: "<urlset />" } as any);

    await expect(fetchSitemap(url)).rejects.toThrow("public address");
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    mockDnsLookup.mockResolvedValue([
      { address: "10.0.0.1", family: 4 },
    ] as any);

    await expect(
      fetchSitemap("https://example.test/sitemap.xml")
    ).rejects.toThrow("public address");
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it("rejects non-standard ports", async () => {
    await expect(
      fetchSitemap("https://example.test:8080/sitemap.xml")
    ).rejects.toThrow("Invalid sitemap URL");
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it("disables redirects and allows public DNS results", async () => {
    mockDnsLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as any);
    mockAxios.get.mockResolvedValue({ data: "<urlset />" } as any);

    await fetchSitemap("https://example.test/a%20b/sitemap.xml?lang=en");
    const [url, options] = mockAxios.get.mock.calls[0];
    const lookup = options?.httpsAgent?.options.lookup as (
      hostname: string,
      options: any,
      callback: (
        error: Error | null,
        address?: string,
        family?: number
      ) => void
    ) => void;

    expect(url).toBe(
      "https://93.184.216.34/a%20b/sitemap.xml?lang=en"
    );
    expect(options?.maxRedirects).toBe(0);
    expect(options?.proxy).toBe(false);
    expect(options?.headers?.Host).toBe("example.test");
    expect(options?.httpsAgent?.options.servername).toBe("example.test");
    await expect(
      new Promise<string>((resolve, reject) =>
        lookup("93.184.216.34", {}, (error, address) =>
          error ? reject(error) : resolve(address!)
        )
      )
    ).resolves.toBe("93.184.216.34");
  });
});
