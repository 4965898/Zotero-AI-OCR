/**
 * 目录书签生成的纯算法层（移植自 autoContents）：
 * 罗马数字转换、CSV 修复/回填/解析、区间合并、众数采样、
 * 层级归一化、书签树构建。不依赖 Zotero 运行时，便于单元测试。
 */

// ===== 数据结构 =====

/** 提取阶段输出：标题 + 原始页码字符串（可能为阿拉伯或罗马数字） */
export interface TocRawEntry {
  title: string;
  pageStr: string;
}

/** 层级判定后的条目 */
export interface TocEntry {
  title: string;
  number: number; // 印刷页码（阿拉伯或罗马换算后的值）
  level: number;
  isRoman: boolean;
}

/** 偏移计算结果 */
export interface TocOffsets {
  arabic: number | null; // 正文偏移 = 物理页 - 印刷页
  roman: number | null; // 前言偏移 = 物理页 - 罗马页码值
}

/** 写入 PDF 的书签项（physicalPage 为 1 起物理页码） */
export interface BookmarkItem {
  title: string;
  physicalPage: number;
  level: number;
}

/** /Outlines 序列化用的树节点 */
export interface OutlineNode {
  title: string;
  pageIndex: number; // 0 起物理页索引
  children: OutlineNode[];
}

// ===== 通用工具 =====

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 洗牌取样（等价 random.sample） */
export function samplePool(pool: number[], n: number): number[] {
  const copy = pool.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

/** 众数（出现次数最多的值及票数） */
export function modeOf(
  values: number[],
): { value: number; count: number } | null {
  if (!values.length) return null;
  const counter = new Map<number, number>();
  for (const v of values) counter.set(v, (counter.get(v) || 0) + 1);
  let best: { value: number; count: number } | null = null;
  for (const [value, count] of counter) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

/** 罗马数字 → 阿拉伯数字；非罗马字符串返回 null（等价 roman_to_int） */
export function romanToInt(s: string): number | null {
  const romanMap: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };
  const str = (s || "").toLowerCase().trim();
  if (!str) return null;
  for (const ch of str) {
    if (!(ch in romanMap)) return null;
  }
  let result = 0;
  for (let i = 0; i < str.length; i++) {
    const cur = romanMap[str[i]];
    const next = i + 1 < str.length ? romanMap[str[i + 1]] : 0;
    if (cur < next) result -= cur;
    else result += cur;
  }
  return result;
}

// ===== LLM 响应解析 =====

export function stripJsonFences(text: string): string {
  return (text || "")
    .trim()
    .replace(/^```(?:json)?\s*/gm, "")
    .replace(/\s*```$/gm, "")
    .trim();
}

export function stripCsvFences(text: string): string {
  let t = (text || "").trim();
  if (t.startsWith("```csv")) t = t.slice(6);
  else if (t.startsWith("```")) t = t.slice(3);
  if (t.endsWith("```")) t = t.slice(0, -3);
  return t.trim();
}

/** 解析滑窗 JSON：{"toc_start": n, "toc_end": n}；失败返回 null 值 */
export function parseTocJson(raw: string): {
  tocStart: number | null;
  tocEnd: number | null;
} {
  try {
    const t = stripJsonFences(raw);
    const m = t.match(/\{[\s\S]*\}/);
    const data = JSON.parse(m ? m[0] : t);
    const s = Number(data.toc_start);
    const e = Number(data.toc_end);
    const start = Number.isFinite(s) && s >= 1 ? Math.round(s) : null;
    const end = Number.isFinite(e) && e >= 1 ? Math.round(e) : null;
    return { tocStart: start, tocEnd: end };
  } catch {
    return { tocStart: null, tocEnd: null };
  }
}

/** 解析单页仲裁 JSON：{"is_toc": true|false}；失败视为非目录 */
export function parseIsTocJson(raw: string): boolean {
  try {
    const t = stripJsonFences(raw);
    const m = t.match(/\{[\s\S]*\}/);
    const data = JSON.parse(m ? m[0] : t);
    return data.is_toc === true;
  } catch {
    return false;
  }
}

/** 解析偏移响应：严格整数（含负号），否则视为 Error */
export function parseIntResponse(raw: string): number | null {
  const s = (raw || "").trim();
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

// ===== CSV 处理 =====

/** 极简 CSV 行解析（支持双引号转义，等价 python csv.reader 单行） */
export function parseCsvLine(line: string): string[] {
  const row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  row.push(cur);
  return row;
}

/** CSV 行序列化：含逗号/引号/换行的字段用双引号包裹（等价 csv.writer） */
export function serializeCsvRow(fields: string[]): string {
  return fields
    .map((f) => (/["\r\n,]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f))
    .join(",");
}

/**
 * 全角逗号修复 + 列数归一（等价 validate_and_fix_csv_content 的 2 列 / 3 列两个变体）。
 * 返回 fixed 内容与"每行是否都严格为 targetCols 列"的校验结果。
 */
export function validateAndFixCsv(
  content: string,
  targetCols: 2 | 3,
): { valid: boolean; fixed: string } {
  const lines = content.split(/\r?\n/);
  const fixedLines: string[] = [];
  const maxReplace = targetCols - 1;
  for (let line of lines) {
    if (!line.trim()) continue;
    let row = parseCsvLine(line);
    for (let r = 0; r < maxReplace; r++) {
      if (row.length < targetCols) {
        const idx = line.lastIndexOf("，");
        if (idx === -1) break;
        line = line.slice(0, idx) + "," + line.slice(idx + 1);
        row = parseCsvLine(line);
      }
    }
    if (row.length > targetCols) {
      // 超列：前 n-(targetCols-1) 列合并为标题
      const tailCount = targetCols - 1;
      const title = row.slice(0, row.length - tailCount).join(",");
      fixedLines.push(
        serializeCsvRow([title, ...row.slice(row.length - tailCount)]),
      );
    } else if (row.length === targetCols) {
      fixedLines.push(serializeCsvRow(row));
    } else {
      fixedLines.push(line);
    }
  }
  const fixed = fixedLines.join("\n");
  const rows = fixed.split(/\r?\n/).filter((l) => l.trim());
  const valid =
    rows.length > 0 && rows.every((l) => parseCsvLine(l).length === targetCols);
  return { valid, fixed };
}

/** 页码 null 回填：先向下找第一个有效页码，找不到再向上找（等价 fix_null_page_numbers） */
export function fixNullPageNumbers(csv: string): string {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return csv;
  const header = lines[0];
  const rows = lines.slice(1).map((l) => {
    const r = parseCsvLine(l);
    return r.length >= 2
      ? { title: r[0], page: (r[1] || "").trim(), valid: true, raw: l }
      : { title: "", page: "", valid: false, raw: l };
  });
  const isValidPage = (p: string) => {
    const s = (p || "").trim().toLowerCase();
    return s !== "" && s !== "null" && s !== "none";
  };
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].valid || isValidPage(rows[i].page)) continue;
    let found = false;
    for (let j = i + 1; j < rows.length; j++) {
      if (!rows[j].valid) continue;
      if (isValidPage(rows[j].page)) {
        rows[i].page = rows[j].page;
        found = true;
        break;
      }
    }
    if (!found) {
      for (let k = i - 1; k >= 0; k--) {
        if (!rows[k].valid) continue;
        if (isValidPage(rows[k].page)) {
          rows[i].page = rows[k].page;
          break;
        }
      }
    }
  }
  return [
    header,
    ...rows.map((r) => (r.valid ? serializeCsvRow([r.title, r.page]) : r.raw)),
  ].join("\n");
}

/** 解析提取阶段响应（2 列）为条目列表 */
export function parseExtractCsv(csvText: string): TocRawEntry[] {
  const cleaned = stripCsvFences(csvText);
  const { valid, fixed } = validateAndFixCsv(cleaned, 2);
  if (!valid) throw new Error("extract CSV invalid");
  const filled = fixNullPageNumbers(fixed);
  const lines = filled.split(/\r?\n/).filter((l) => l.trim());
  const headerCells = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const hasHeader =
    headerCells.includes("title") && headerCells.includes("page_number");
  const rows: TocRawEntry[] = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 2) continue;
    const title = (cells[0] || "").trim();
    if (!title) continue;
    rows.push({ title, pageStr: (cells[1] || "").trim() });
  }
  return rows;
}

/** 解析层级阶段响应（3 列），失败抛错以触发整体重试 */
export function parseLevelCsvResponse(csvText: string): TocEntry[] {
  const cleaned = stripCsvFences(csvText);
  const { valid, fixed } = validateAndFixCsv(cleaned, 3);
  if (!valid) throw new Error("level CSV invalid");
  const lines = fixed.split(/\r?\n/).filter((l) => l.trim());
  const headerCells = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const ti = headerCells.indexOf("title");
  const pi = headerCells.indexOf("page_number");
  const li = headerCells.indexOf("level");
  if (ti < 0 || pi < 0 || li < 0) throw new Error("level CSV missing columns");
  const entries: TocEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 3) continue;
    const title = (cells[ti] || "").trim();
    if (!title) continue;
    const pageStr = (cells[pi] || "").trim();
    let number: number | null = null;
    let isRoman = false;
    if (pageStr) {
      if (/^\d+$/.test(pageStr)) {
        number = parseInt(pageStr, 10);
      } else {
        const r = romanToInt(pageStr);
        if (r !== null) {
          number = r;
          isRoman = true;
        }
      }
    }
    const levelStr = (cells[li] || "").trim();
    const level = /^\d+$/.test(levelStr) ? parseInt(levelStr, 10) : null;
    if (number === null || level === null) continue;
    entries.push({ title, number, level, isRoman });
  }
  return entries;
}

// ===== 条目后处理 =====

/** 每页排序：罗马条目（前言）在前，阿拉伯按页码升序 */
export function sortByRoman(entries: TocEntry[]): TocEntry[] {
  return entries
    .slice()
    .sort(
      (a, b) =>
        (a.isRoman ? 0 : 1) - (b.isRoman ? 0 : 1) || a.number - b.number,
    );
}

/** 全局层级归一化：最小层级调整为 1（等价 normalize_levels） */
export function normalizeLevels(entries: TocEntry[]): TocEntry[] {
  if (!entries.length) return entries;
  const minLevel = Math.min(...entries.map((e) => e.level));
  if (minLevel !== 1) {
    const offset = minLevel - 1;
    for (const e of entries) e.level -= offset;
  }
  return entries;
}

/** 最长连续区间（相邻页差 ≤ 1 视为连续，等价 merge_continuous_ranges） */
export function mergeContinuousRanges(
  pages: number[],
): [number | null, number | null] {
  if (!pages.length) return [null, null];
  const sorted = Array.from(new Set(pages)).sort((a, b) => a - b);
  if (sorted.length === 1) return [sorted[0], sorted[0]];
  let bestStart = sorted[0];
  let bestEnd = sorted[0];
  let maxLen = 1;
  let currentStart = sorted[0];
  let currentEnd = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] <= 1) {
      currentEnd = sorted[i];
    } else {
      const len = currentEnd - currentStart + 1;
      if (len > maxLen) {
        maxLen = len;
        bestStart = currentStart;
        bestEnd = currentEnd;
      }
      currentStart = sorted[i];
      currentEnd = sorted[i];
    }
  }
  const len = currentEnd - currentStart + 1;
  if (len > maxLen) {
    bestStart = currentStart;
    bestEnd = currentEnd;
  }
  return [bestStart, bestEnd];
}

/** 印刷页码 → 物理页码换算并组装书签列表（等价 pdf_generator 的偏移处理） */
export function buildBookmarkItems(
  entries: TocEntry[],
  offsets: TocOffsets,
  tocStart: number,
  pageCount: number,
): BookmarkItem[] {
  const items: BookmarkItem[] = [
    { title: "目录", physicalPage: tocStart, level: 1 },
  ];
  for (const e of entries) {
    if (e.title === "目录") continue; // 与原版一致：去除提取出的重复"目录"行
    let physical: number;
    if (e.isRoman && offsets.roman !== null) {
      physical = e.number + offsets.roman;
    } else {
      // 原版：number+1 再 +content_start-1，净效果 = 印刷页 + 偏移；偏移缺失时按 0 处理
      physical = e.number + (offsets.arabic ?? 0);
    }
    if (!Number.isFinite(physical) || physical < 1 || physical > pageCount) {
      continue;
    }
    items.push({
      title: e.title,
      physicalPage: Math.round(physical),
      level: e.level,
    });
  }
  return items;
}

/** 层级列表 → 树（等价 create_bookmark_tree 的 l1/l2/l3 指针与降级逻辑） */
export function buildOutlineTree(items: BookmarkItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  let l1: OutlineNode | null = null;
  let l2: OutlineNode | null = null;
  let l3: OutlineNode | null = null;
  for (const item of items) {
    const node: OutlineNode = {
      title: item.title,
      pageIndex: item.physicalPage - 1,
      children: [],
    };
    if (item.level <= 1) {
      roots.push(node);
      l1 = node;
      l2 = null;
      l3 = null;
    } else if (item.level === 2) {
      if (l1) l1.children.push(node);
      else roots.push(node);
      l2 = node;
      l3 = null;
    } else if (item.level === 3) {
      if (l2 && l1) l2.children.push(node);
      else if (l1) l1.children.push(node);
      else roots.push(node);
      l3 = node;
    } else {
      if (l3 && l2 && l1) l3.children.push(node);
      else if (l2 && l1) l2.children.push(node);
      else if (l1) l1.children.push(node);
      else roots.push(node);
    }
  }
  return roots;
}

/**
 * 解析页码范围输入（如 "1-5, 8, 10-12"）为排序去重的页码数组；
 * 超出 maxPage 的页码被钳制/忽略，无有效页码时返回空数组。
 */
export function parsePageRange(input: string, maxPage: number): number[] {
  const pages = new Set<number>();
  const parts = input.split(",");

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start > 0 && end > 0 && start <= end) {
        for (let i = start; i <= Math.min(end, maxPage); i++) {
          pages.add(i);
        }
      }
      continue;
    }

    const singleMatch = trimmed.match(/^(\d+)$/);
    if (singleMatch) {
      const pageNum = parseInt(singleMatch[1], 10);
      if (pageNum > 0 && pageNum <= maxPage) {
        pages.add(pageNum);
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}
