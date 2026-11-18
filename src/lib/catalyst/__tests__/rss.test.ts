import { parseRssItems } from "@/lib/catalyst/rss";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[Bitcoin ETF inflows hit $1.2B as $BTC rallies]]></title>
    <link>https://example.com/a</link>
    <guid isPermaLink="false">guid-1</guid>
    <pubDate>Wed, 18 Nov 2026 03:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Solana &amp; $SOL upgrade ships</title>
    <link>https://example.com/b?utm=1&amp;x=2</link>
    <pubDate>Tue, 17 Nov 2026 22:30:00 GMT</pubDate>
  </item>
  <item>
    <link>https://example.com/no-title</link>
  </item>
</channel></rss>`;

describe("parseRssItems", () => {
  it("parse item, giữ link gốc và bỏ HTML/CDATA", () => {
    const facts = parseRssItems(xml, "RSS_COINDESK");
    expect(facts).toHaveLength(2);

    expect(facts[0].title).toBe("Bitcoin ETF inflows hit $1.2B as $BTC rallies");
    expect(facts[0].sourceUrl).toBe("https://example.com/a");
    expect(facts[0].externalId).toBe("rss_coindesk:guid-1");
    expect(facts[0].type).toBe("NEWS");
    expect(facts[0].symbols).toContain("BTC");
    expect(facts[0].publishedAt).toBe("2026-11-18T03:00:00.000Z");

    expect(facts[1].title).toBe("Solana & $SOL upgrade ships");
    expect(facts[1].sourceUrl).toBe("https://example.com/b?utm=1&x=2");
    expect(facts[1].symbols).toContain("SOL");
  });

  it("bỏ item thiếu title/link và xml rỗng trả mảng rỗng", () => {
    expect(parseRssItems("<rss></rss>", "RSS_DECRYPT")).toEqual([]);
  });
});
