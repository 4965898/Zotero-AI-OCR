import { assert } from "chai";
import {
  romanToInt,
  parseTocJson,
  parseIsTocJson,
  parseIntResponse,
  validateAndFixCsv,
  fixNullPageNumbers,
  parseExtractCsv,
  parseLevelCsvResponse,
  mergeContinuousRanges,
  modeOf,
  normalizeLevels,
  sortByRoman,
  buildBookmarkItems,
  buildOutlineTree,
} from "../src/utils/toc-algorithms";

describe("toc-algorithms", function () {
  describe("romanToInt", function () {
    it("converts standard roman numerals", function () {
      assert.equal(romanToInt("iii"), 3);
      assert.equal(romanToInt("xv"), 15);
      assert.equal(romanToInt("xviii"), 18);
      assert.equal(romanToInt("xiv"), 14);
      assert.equal(romanToInt("mcmxciv"), 1994);
    });

    it("handles uppercase input", function () {
      assert.equal(romanToInt("XV"), 15);
    });

    it("returns null for non-roman strings", function () {
      assert.isNull(romanToInt("12"));
      assert.isNull(romanToInt("12a"));
      assert.isNull(romanToInt("目录"));
      assert.isNull(romanToInt(""));
    });
  });

  describe("parseTocJson", function () {
    it("parses clean json", function () {
      const r = parseTocJson('{"toc_start": 2, "toc_end": 5}');
      assert.equal(r.tocStart, 2);
      assert.equal(r.tocEnd, 5);
    });

    it("parses json wrapped in code fences", function () {
      const r = parseTocJson('```json\n{"toc_start": 3, "toc_end": 4}\n```');
      assert.equal(r.tocStart, 3);
      assert.equal(r.tocEnd, 4);
    });

    it("parses json embedded in extra text", function () {
      const r = parseTocJson('结果：{"toc_start": 17, "toc_end": 18} 以上。');
      assert.equal(r.tocStart, 17);
      assert.equal(r.tocEnd, 18);
    });

    it("returns nulls for explicit null or garbage", function () {
      assert.isNull(
        parseTocJson('{"toc_start": null, "toc_end": null}').tocStart,
      );
      assert.isNull(parseTocJson("不是 JSON").tocStart);
      assert.isNull(parseTocJson("").tocStart);
    });
  });

  describe("parseIsTocJson", function () {
    it("parses true/false", function () {
      assert.isTrue(parseIsTocJson('{"is_toc": true}'));
      assert.isFalse(parseIsTocJson('{"is_toc": false}'));
      assert.isFalse(parseIsTocJson("garbage"));
    });
  });

  describe("parseIntResponse", function () {
    it("accepts signed integers only", function () {
      assert.equal(parseIntResponse("15"), 15);
      assert.equal(parseIntResponse("-5"), -5);
      assert.equal(parseIntResponse(" 10 "), 10);
      assert.isNull(parseIntResponse("Error"));
      assert.isNull(parseIntResponse("12.5"));
      assert.isNull(parseIntResponse(""));
    });
  });

  describe("validateAndFixCsv", function () {
    it("keeps valid 2-column rows", function () {
      const r = validateAndFixCsv("title,page_number\n第1章 绪论,1", 2);
      assert.isTrue(r.valid);
      assert.include(r.fixed, "第1章 绪论,1");
    });

    it("repairs full-width commas in 2-column output", function () {
      const r = validateAndFixCsv("第1章 绪论，1", 2);
      assert.isTrue(r.valid);
      assert.equal(parseExtractCsv(r.fixed)[0].pageStr, "1");
    });

    it("merges extra columns into title for 2-column output", function () {
      const r = validateAndFixCsv("第1章, 绪论,1", 2);
      assert.isTrue(r.valid);
      const rows = parseExtractCsv(r.fixed);
      assert.equal(rows[0].title, "第1章, 绪论");
      assert.equal(rows[0].pageStr, "1");
    });

    it("repairs full-width commas for 3-column output (twice)", function () {
      const r = validateAndFixCsv("第1章 绪论，1，2", 3);
      assert.isTrue(r.valid);
      const rows = parseLevelCsvResponse(`title,page_number,level\n${r.fixed}`);
      assert.equal(rows[0].number, 1);
      assert.equal(rows[0].level, 2);
    });
  });

  describe("fixNullPageNumbers", function () {
    it("fills null page from the next valid entry below", function () {
      const csv = fixNullPageNumbers(
        "title,page_number\n第一章,null\n第二节,5\n第三节,7",
      );
      const rows = parseExtractCsv(csv);
      assert.equal(rows[0].pageStr, "5");
    });

    it("fills null page from the nearest valid entry above when below is empty", function () {
      const csv = fixNullPageNumbers(
        "title,page_number\n第一章,3\n第三节,7\n附录,null",
      );
      const rows = parseExtractCsv(csv);
      assert.equal(rows[2].pageStr, "7");
    });
  });

  describe("parseExtractCsv", function () {
    it("parses fenced csv with header", function () {
      const rows = parseExtractCsv(
        "```csv\ntitle,page_number\n第一章 绪论,1\n第二节,5\n```\n",
      );
      assert.equal(rows.length, 2);
      assert.equal(rows[0].title, "第一章 绪论");
      assert.equal(rows[1].pageStr, "5");
    });

    it("parses roman page numbers as strings", function () {
      const rows = parseExtractCsv("title,page_number\n前言,xv\n第一章,1");
      assert.equal(rows[0].pageStr, "xv");
    });

    it("throws on rows that cannot be repaired to 2 columns", function () {
      assert.throws(() => parseExtractCsv("只有一列"), /invalid/);
    });
  });

  describe("parseLevelCsvResponse", function () {
    it("parses levels and marks roman entries", function () {
      const entries = parseLevelCsvResponse(
        "title,page_number,level\n前言,xv,1\n第一章 绪论,1,1\n第一节,2,2",
      );
      assert.equal(entries.length, 3);
      assert.isTrue(entries[0].isRoman);
      assert.equal(entries[0].number, 15);
      assert.equal(entries[1].level, 1);
      assert.equal(entries[2].level, 2);
    });

    it("skips rows with non-numeric level", function () {
      const entries = parseLevelCsvResponse(
        "title,page_number,level\n第一章,1,1\n第二节,2,abc",
      );
      assert.equal(entries.length, 1);
    });
  });

  describe("mergeContinuousRanges", function () {
    it("returns the longest continuous run", function () {
      const [s, e] = mergeContinuousRanges([1, 2, 3, 10, 11]);
      assert.equal(s, 1);
      assert.equal(e, 3);
    });

    it("treats adjacent pages as continuous", function () {
      const [s, e] = mergeContinuousRanges([17, 19, 18]);
      assert.equal(s, 17);
      assert.equal(e, 19);
    });

    it("handles empty and single values", function () {
      assert.deepEqual(mergeContinuousRanges([]), [null, null]);
      const [s, e] = mergeContinuousRanges([4]);
      assert.equal(s, 4);
      assert.equal(e, 4);
    });
  });

  describe("modeOf", function () {
    it("returns the most common value and count", function () {
      assert.deepEqual(modeOf([2, 2, 3, 3, 3]), { value: 3, count: 3 });
      assert.isNull(modeOf([]));
    });
  });

  describe("sortByRoman + normalizeLevels", function () {
    it("orders roman entries first and normalizes min level to 1", function () {
      const sorted = sortByRoman([
        { title: "第一章", number: 1, level: 3, isRoman: false },
        { title: "前言", number: 3, level: 2, isRoman: true },
        { title: "第二节", number: 2, level: 4, isRoman: false },
      ]);
      assert.equal(sorted[0].title, "前言");
      assert.equal(sorted[1].number, 1);
      const normalized = normalizeLevels(sorted);
      assert.equal(Math.min(...normalized.map((e) => e.level)), 1);
      assert.equal(normalized[0].level, 1);
      assert.equal(normalized[2].level, 3);
    });
  });

  describe("buildBookmarkItems", function () {
    it("applies arabic offset and inserts the TOC root", function () {
      const items = buildBookmarkItems(
        [
          { title: "第一章", number: 3, level: 1, isRoman: false },
          { title: "第二节", number: 10, level: 2, isRoman: false },
        ],
        { arabic: 7, roman: null },
        2,
        300,
      );
      assert.equal(items[0].title, "目录");
      assert.equal(items[0].physicalPage, 2);
      assert.equal(items[1].physicalPage, 10); // 3 + 7
      assert.equal(items[2].physicalPage, 17); // 10 + 7
    });

    it("applies roman offset for front matter and arabic offset for body", function () {
      const items = buildBookmarkItems(
        [
          { title: "前言", number: 3, level: 1, isRoman: true },
          { title: "第一章", number: 1, level: 1, isRoman: false },
        ],
        { arabic: 12, roman: 4 },
        5,
        300,
      );
      assert.equal(items[1].physicalPage, 7); // 3 + 4
      assert.equal(items[2].physicalPage, 13); // 1 + 12
    });

    it("drops entries whose physical page is out of range", function () {
      const items = buildBookmarkItems(
        [{ title: "糟糕条目", number: 5, level: 1, isRoman: false }],
        { arabic: 900, roman: null },
        2,
        300,
      );
      assert.equal(items.length, 1); // 仅剩"目录"根
    });

    it("skips extracted entries titled 目录", function () {
      const items = buildBookmarkItems(
        [
          { title: "目录", number: 2, level: 1, isRoman: false },
          { title: "第一章", number: 1, level: 1, isRoman: false },
        ],
        { arabic: 3, roman: null },
        2,
        300,
      );
      assert.equal(items.length, 2);
      assert.equal(items[1].title, "第一章");
    });
  });

  describe("buildOutlineTree", function () {
    it("nests levels via l1/l2/l3 pointers", function () {
      const tree = buildOutlineTree([
        { title: "目录", physicalPage: 1, level: 1 },
        { title: "第一章", physicalPage: 2, level: 1 },
        { title: "第一节", physicalPage: 3, level: 2 },
        { title: "小节", physicalPage: 4, level: 3 },
        { title: "子小节", physicalPage: 5, level: 4 },
        { title: "第二章", physicalPage: 6, level: 1 },
      ]);
      assert.equal(tree.length, 3); // 目录 / 第一章 / 第二章 均为根级兄弟
      const ch1 = tree[1];
      assert.equal(ch1.children.length, 1);
      assert.equal(ch1.children[0].children.length, 1);
      assert.equal(ch1.children[0].children[0].children.length, 1);
      assert.equal(ch1.children[0].children[0].children[0].title, "子小节");
      assert.equal(tree[2].title, "第二章");
    });

    it("downgrades level 2/3 to root when no parent exists", function () {
      const tree = buildOutlineTree([
        { title: "孤儿二级", physicalPage: 1, level: 2 },
        { title: "孤儿三级", physicalPage: 2, level: 3 },
      ]);
      assert.equal(tree.length, 2);
    });
  });
});
