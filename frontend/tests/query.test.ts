import { describe, expect, it } from "vitest";
import {
  defaultQuery,
  normalizeSearch,
  parseCatalogQuery,
  serializeCatalogQuery,
  type CatalogQuery,
} from "../src/catalog/query";

function parse(queryString: string) {
  return parseCatalogQuery(new URLSearchParams(queryString));
}

function expectInvalid(queryString: string, field: string) {
  const result = parse(queryString);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected invalid catalog query");
  expect(result.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field, message: expect.any(String) }),
    ]),
  );
}

describe("catalog URL defaults and canonicalization", () => {
  it("uses catalog defaults when there are no query parameters", () => {
    expect(parse("")).toMatchObject({ ok: true, query: defaultQuery });
    expect(serializeCatalogQuery(defaultQuery).toString()).toBe("");
  });

  it("omits explicit defaults and whitespace-only search from a canonical URL", () => {
    const result = parse("q=++%09&sort=featured&page=01&page_size=012");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid default query");
    expect(serializeCatalogQuery(result.query).toString()).toBe("");
  });

  it("keeps repeated facets, removes duplicates, and orders values deterministically", () => {
    const result = parse(
      "material=wood&category=table&material=metal&category=chair&category=table&material=wood",
    );
    expect(result).toMatchObject({
      ok: true,
      query: { category: ["chair", "table"], material: ["metal", "wood"] },
    });
    if (!result.ok) throw new Error("Expected valid facets");
    expect(serializeCatalogQuery(result.query).toString()).toBe(
      "category=chair&category=table&material=metal&material=wood",
    );
  });

  it("canonicalizes leading zeros without dropping a zero minimum price", () => {
    const result = parse(
      "min_price=000&max_price=0000100&max_width=001&page=00002&page_size=00048&sort=price_desc",
    );
    expect(result).toMatchObject({
      ok: true,
      query: {
        min_price: 0,
        max_price: 100,
        max_width: 1,
        page: 2,
        page_size: 48,
        sort: "price_desc",
      },
    });
    if (!result.ok) throw new Error("Expected valid numeric query");
    expect(serializeCatalogQuery(result.query).toString()).toBe(
      "min_price=0&max_price=100&max_width=1&sort=price_desc&page=2&page_size=48",
    );
  });

  it("round-trips a shared URL containing all supported query fields", () => {
    const query: CatalogQuery = {
      q: "wood & glass",
      category: ["chair", "table"],
      material: ["glass", "wood"],
      min_price: 10000,
      max_price: 60000,
      max_width: 90,
      sort: "title_asc",
      page: 3,
      page_size: 24,
    };
    expect(parseCatalogQuery(serializeCatalogQuery(query))).toEqual({
      ok: true,
      query,
    });
  });
});

describe("catalog numeric validation", () => {
  it("accepts inclusive lower and upper boundaries and equal price bounds", () => {
    expect(
      parse(
        "min_price=0&max_price=2147483647&max_width=1000&page=10000&page_size=48",
      ),
    ).toMatchObject({
      ok: true,
      query: {
        min_price: 0,
        max_price: 2147483647,
        max_width: 1000,
        page: 10000,
        page_size: 48,
      },
    });
    expect(
      parse("min_price=0&max_price=0&max_width=1&page=1&page_size=1"),
    ).toMatchObject({
      ok: true,
      query: {
        min_price: 0,
        max_price: 0,
        max_width: 1,
        page: 1,
        page_size: 1,
      },
    });
  });

  it("rejects a maximum price lower than the minimum", () => {
    expectInvalid("min_price=101&max_price=100", "max_price");
  });

  it.each([
    ["min_price=-1", "min_price"],
    ["min_price=2147483648", "min_price"],
    ["max_price=2147483648", "max_price"],
    ["max_width=0", "max_width"],
    ["max_width=1001", "max_width"],
    ["page=0", "page"],
    ["page=10001", "page"],
    ["page_size=0", "page_size"],
    ["page_size=49", "page_size"],
  ])("rejects an out-of-range value: %s", (queryString, field) => {
    expectInvalid(queryString, field);
  });

  it.each([
    "",
    "+1",
    "-1",
    "1.0",
    "1e2",
    " 1",
    "1 ",
    "NaN",
    "Infinity",
    "１２",
    "999999999999999999999999999999",
  ])("rejects the non-integer or overflowing numeric shape %j", (value) => {
    const params = new URLSearchParams({ page: value });
    expectInvalid(params.toString(), "page");
  });
});

describe("catalog query vocabulary and parameter shape", () => {
  it.each(["featured", "price_asc", "price_desc", "title_asc"])(
    "accepts the documented sort %s",
    (sort) => {
      expect(parse(`sort=${sort}`)).toMatchObject({
        ok: true,
        query: { sort },
      });
    },
  );

  it.each([
    ["sort=relevance", "sort"],
    ["sort=", "sort"],
    ["category=lamp", "category"],
    ["category=Chair", "category"],
    ["category=chair&category=", "category"],
    ["material=plastic", "material"],
    ["material=wood&material=WOOD", "material"],
    ["availability=in_stock", "availability"],
  ])(
    "rejects an unknown parameter or controlled value: %s",
    (queryString, field) => {
      expectInvalid(queryString, field);
    },
  );

  it.each([
    ["q", "chair"],
    ["min_price", "10"],
    ["max_price", "100"],
    ["max_width", "90"],
    ["sort", "featured"],
    ["page", "1"],
    ["page_size", "12"],
  ])(
    "rejects repeated scalar parameter %s even when values match",
    (key, value) => {
      const params = new URLSearchParams();
      params.append(key, value);
      params.append(key, value);
      expectInvalid(params.toString(), key);
    },
  );

  it("reports independent invalid fields together", () => {
    const result = parse("unknown=true&page=0&page_size=49&material=plastic");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invalid query");
    expect(result.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["unknown", "page", "page_size", "material"]),
    );
  });
});

describe("catalog search normalization and limits", () => {
  it("normalizes compatibility characters and whitespace while preserving entered case", () => {
    expect(normalizeSearch(" \tＣｈａｉｒ\u3000  and\nTABLE  ")).toBe(
      "Chair and TABLE",
    );
    const params = new URLSearchParams({
      q: " \tＣｈａｉｒ\u3000  and\nTABLE  ",
    });
    expect(parseCatalogQuery(params)).toMatchObject({
      ok: true,
      query: { q: "Chair and TABLE" },
    });
  });

  it("preserves punctuation literally when serializing search", () => {
    const query = { ...defaultQuery, q: "50% _ oak\\wood & glass" };
    const result = parseCatalogQuery(serializeCatalogQuery(query));
    expect(result).toMatchObject({ ok: true, query: { q: query.q } });
  });

  it("allows eight terms and rejects nine after whitespace normalization", () => {
    const eight = new URLSearchParams({
      q: "one\ttwo three\nfour five six seven eight",
    });
    expect(parseCatalogQuery(eight)).toMatchObject({
      ok: true,
      query: { q: "one two three four five six seven eight" },
    });
    expectInvalid(
      new URLSearchParams({
        q: "one two three four five six seven eight nine",
      }).toString(),
      "q",
    );
  });

  it("uses normalized Unicode character count for the 100-character boundary", () => {
    const accepted = new URLSearchParams({ q: `  ${"🪑".repeat(100)}  ` });
    expect(parseCatalogQuery(accepted)).toMatchObject({
      ok: true,
      query: { q: "🪑".repeat(100) },
    });
    expectInvalid(new URLSearchParams({ q: "🪑".repeat(101) }).toString(), "q");
  });

  it("checks character length after NFKC expansion", () => {
    expectInvalid(new URLSearchParams({ q: "ﬃ".repeat(34) }).toString(), "q");
  });
});
