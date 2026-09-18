import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { buildMatchQuery, buildSearchQuery, identifierParts, tokenizeForIndex } from "../src/core/tokenize";

describe("tokenizeForIndex", () => {
  test("CJK runs become overlapping bigrams", () => {
    expect(tokenizeForIndex("例外處理")).toBe("例外 外處 處理");
    expect(tokenizeForIndex("錯")).toBe("錯");
  });

  test("punctuation splits CJK runs", () => {
    expect(tokenizeForIndex("例外，處理")).toBe("例外 處理");
  });

  test("identifiers keep full form plus parts", () => {
    expect(tokenizeForIndex("WAIT_FOR_INSERT_MIDDLE_DB")).toBe("wait_for_insert_middle_db wait for insert middle db");
    expect(tokenizeForIndex("sapStatus")).toBe("sapstatus sap status");
    expect(tokenizeForIndex("plain")).toBe("plain");
  });

  test("mixed Chinese and identifiers", () => {
    expect(tokenizeForIndex("sapStatus維持WAIT_FOR_DB")).toBe("sapstatus sap status 維持 wait_for_db wait for db");
  });
});

describe("identifierParts", () => {
  test("camelCase, PascalCase, acronyms, digits", () => {
    expect(identifierParts("ErpDataRecordType")).toEqual(["erp", "data", "record", "type"]);
    expect(identifierParts("HTTPServerError")).toEqual(["http", "server", "error"]);
    expect(identifierParts("fromValue2Json")).toEqual(["from", "value2", "json"]);
    expect(identifierParts("snake_case_name")).toEqual(["snake", "case", "name"]);
  });
});

describe("buildMatchQuery", () => {
  test("builds phrases and quoted identifiers", () => {
    expect(buildMatchQuery("例外")).toBe('"例外"');
    expect(buildMatchQuery("例外處理 sapStatus")).toBe('"例外 外處 處理" "sapstatus"');
    expect(buildMatchQuery("例")).toBe('"例"*');
    expect(buildMatchQuery("  ，。 ")).toBeNull();
  });
});

describe("buildSearchQuery", () => {
  test("a run contributes the whole phrase and its bigrams, all OR-ed", () => {
    expect(buildSearchQuery("例外處理")).toBe('"例外 外處 處理" OR "例外" OR "外處" OR "處理"');
    expect(buildSearchQuery("retry 策略")).toBe('"retry" OR "策略"');
  });

  test("a lone particle is dropped from a longer question", () => {
    expect(buildSearchQuery("中文 的 斷詞")).toBe('"中文" OR "斷詞"');
    expect(buildSearchQuery("的")).toBe('"的"*'); // unless it is the whole query
  });
});

describe("FTS5 round trip", () => {
  const db = new Database(":memory:");
  db.run(`create virtual table doc using fts5(body, tokenize = "unicode61 tokenchars '_'")`);
  const rows = [
    "ErpDataRecordType 未知 type 改為不中斷",
    "sapStatus 維持 WAIT_FOR_INSERT_MIDDLE_DB",
    "例外處理要彙總 log",
    "處理例外的方式",
    "WAIT_FOR_INSERT 是另一個狀態",
  ];
  for (const r of rows) db.run("insert into doc(body) values (?)", [tokenizeForIndex(r)]);
  const hits = (q: string) =>
    (db.query("select rowid from doc where doc match ? order by rowid").all(buildMatchQuery(q)!) as { rowid: number }[]).map((r) => r.rowid);

  test("Chinese substring semantics", () => {
    expect(hits("例外")).toEqual([3, 4]);
    expect(hits("例外處理")).toEqual([3]);
    expect(hits("外處")).toEqual([3]);
  });

  test("full identifier does not match its prefix", () => {
    expect(hits("WAIT_FOR_INSERT_MIDDLE_DB")).toEqual([2]);
    expect(hits("WAIT_FOR_INSERT")).toEqual([5]);
  });

  test("identifier parts are searchable", () => {
    expect(hits("status")).toEqual([2]);
    expect(hits("record type")).toEqual([1]);
  });
});
