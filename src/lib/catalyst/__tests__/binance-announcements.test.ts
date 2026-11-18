import {
  _resetBinanceAnnouncementCache,
  BINANCE_CATALOGS,
  parseBinanceAnnouncementPayload,
} from "@/lib/catalyst/binance-announcements";

// Fixture lấy từ response thật ngày 2026-11-18 (đã rút gọn).
const listingPayload = {
  code: "000000",
  message: null,
  data: {
    catalogs: [
      {
        catalogId: 48,
        catalogName: "New Cryptocurrency Listing",
        articles: [
          {
            id: 290432,
            code: "a3ffb6df9de942a9bb40e19f904041e6",
            title: "Binance Exchange Adds New bStocks Trading Pairs on Binance Spot/Convert - 2026-11-18",
            type: 1,
            releaseDate: 1794972627391,
          },
          {
            id: 289715,
            code: "2d89a5966b174a2689ab2c2a15db1757",
            title: "Binance Futures Will Launch USDⓈ-Margined HYPEUSDC and TRXUSDC Perpetual Contracts (2026-11-16)",
            type: 1,
            releaseDate: 1794390318328,
          },
        ],
      },
    ],
  },
};

const delistingPayload = {
  code: "000000",
  data: {
    catalogs: [
      {
        catalogId: 161,
        articles: [
          {
            id: 290001,
            code: "290a660c0b2e4e888c582cd29ecf9ecc",
            title: "Binance Will Delist EPIC, QUICK on 2026-10-28",
            type: 1,
            releaseDate: 1791957608049,
          },
          {
            id: 290002,
            code: "c30e6891afa54651ba950f8af144f861",
            title: "Binance Futures Will Delist PTBUSDT and MITOUSDT USDⓈ-M Perpetual Contracts (2026-10-23)",
            type: 1,
            releaseDate: 1792575001882,
          },
        ],
      },
    ],
  },
};

describe("parseBinanceAnnouncementPayload", () => {
  afterEach(() => _resetBinanceAnnouncementCache());

  it("phân loại listing/futures launch và tạo link nguồn", () => {
    const facts = parseBinanceAnnouncementPayload(listingPayload, BINANCE_CATALOGS.listing);
    expect(facts).toHaveLength(2);

    expect(facts[0].type).toBe("LISTING");
    expect(facts[0].sourceUrl).toBe(
      "https://www.binance.com/en/support/announcement/a3ffb6df9de942a9bb40e19f904041e6"
    );
    expect(facts[0].externalId).toBe("binance:a3ffb6df9de942a9bb40e19f904041e6");
    expect(facts[0].publishedAt).toBe(new Date(1794972627391).toISOString());

    expect(facts[1].type).toBe("FUTURES_LAUNCH");
    expect(facts[1].symbols).toEqual(expect.arrayContaining(["HYPE", "TRX"]));
  });

  it("phân loại delisting và bỏ token không phải ticker", () => {
    const facts = parseBinanceAnnouncementPayload(delistingPayload, BINANCE_CATALOGS.delisting);
    expect(facts.map((f) => f.type)).toEqual(["DELISTING", "DELISTING"]);
    expect(facts[0].symbols).toEqual(expect.arrayContaining(["EPIC", "QUICK"]));
    expect(facts[0].symbols).not.toContain("WILL");
    expect(facts[1].symbols).toEqual(expect.arrayContaining(["PTB", "MITO"]));
  });

  it("payload lỗi/rỗng trả mảng rỗng, không throw", () => {
    expect(parseBinanceAnnouncementPayload(null, 48)).toEqual([]);
    expect(parseBinanceAnnouncementPayload({ code: "100001" }, 48)).toEqual([]);
    expect(parseBinanceAnnouncementPayload({ code: "000000", data: null }, 48)).toEqual([]);
  });
});
