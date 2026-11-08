/**
 * AI 生成目录书签 —— 移植自本地工具 autoContents（Python）的目录识别与书签生成流水线：
 * 1. 滑窗定位目录页（4 页窗口、步长 2，窗口投票 + 冲突页单页仲裁 + 最长连续区间合并）
 * 2. 视觉 LLM 逐页提取目录条目（CSV title,page_number，含全角逗号修复与 null 页码回填）
 * 3. 视觉 LLM 判定层级（首页 few-shot，CSV title,page_number,level，跨页层级对齐 + 全局归一化）
 * 4. 采样计算印刷页码偏移（阿拉伯偏移 + 罗马数字前言偏移，众数取值）
 * 5. pdf-lib 低层对象构建 /Outlines 书签树并写回 PDF；加密 PDF 回退为光栅化副本
 * 所有提示词逐字取自 autoContents（mainprogress/pdf_metadata_extractor.py、
 * qwen_vl_extract.py、determine_toc_levels.py）。
 */

import {
  pdfToImages,
  callVisionChat,
  getVisionChatConfigForEngine,
  getPdfPageCount,
  readPdfFileBytes,
  resetOcrCancellation,
  isOcrCancelled,
  throwIfCancelled,
  decodeImage,
  downscaleBase64Image,
  renderPagesToJpegs,
  VisionChatConfig,
  VisionChatPart,
} from "./ocr-engine";
import { promptTocPages } from "./toc-preflight";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFRef,
} from "pdf-lib";
import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import {
  BookmarkItem,
  buildBookmarkItems,
  buildOutlineTree,
  chunkArray,
  fixNullPageNumbers,
  mergeContinuousRanges,
  modeOf,
  normalizeLevels,
  OutlineNode,
  parseExtractCsv,
  parseIsTocJson,
  parseLevelCsvResponse,
  parseIntResponse,
  parseTocJson,
  samplePool,
  sortByRoman,
  stripCsvFences,
  TocEntry,
  TocOffsets,
  TocRawEntry,
  validateAndFixCsv,
} from "../utils/toc-algorithms";

// ===== 流程常量（与 autoContents 保持一致） =====

const TOC_WINDOW = 4; // 滑窗页数
const TOC_WINDOW_STEP = 2; // 滑窗步长
const TOC_INITIAL_SCAN = 20; // 初始扫描前 20 页
const TOC_SCAN_HARD_CAP = 100; // 扫描硬上限
const TOC_MAX_EXPANSIONS = 5; // 未找到目录时的最大扩窗次数
const TOC_END_FUSE = 120; // 目录结束页熔断阈值
const JPEG_QUALITY = 0.85; // 拼图/光栅化副本的 JPEG 质量
const TOC_CALL_CONCURRENCY = 4; // LLM 调用并发
const EXTRACT_RETRIES = 3; // 提取阶段整体重试（1 + 后处理重试 2）
const LEVEL_RETRIES = 5; // 层级判定重试
const OFFSET_FIRST_ROUND = 5; // 偏移计算第一轮采样
const OFFSET_SECOND_ROUND = 5; // 偏移计算第二轮采样
const OFFSET_MODE_MIN_VOTES = 4; // 众数最少票数（不足则第二轮）
const ROMAN_SAMPLE_CAP = 15; // 罗马偏移采样上限（前 20% 页）
const RASTER_CHUNK = 20; // 光栅化副本每批渲染页数
const RASTER_MAX_LONG_EDGE = 2400; // 光栅化副本页长边上限

// ===== 提示词（逐字移植 autoContents） =====

const TOC_WINDOW_PROMPT = `这是一张由几个连续的 PDF 页面横向拼接而成的图片。每张图片下方标注了它的物理页码（例如 PDFNumber {start_p}）。
请找出这几页中，属于目录的起始页码和结束页码。

【目录的严格定义】：一页中必须存在多个“标题 - 页码”对。如果某一页没有这个特征（例如纯文本正文、封面、版权页、序言），则它绝对不是目录。只要不存在页码，那这页绝对不是目录。相对应地，如果一页有这个特征，那么它必然是目录。

【注意】
1. 应以下方的 PDFNumber 作为页码。例如 PDFNumber 为 2-3 的图片是目录，那么起始页码就是 2，结束页码就是 3。
2. 注意空白页不可以算作目录的一部分，空白页一定不是目录！
3. 例如 PDFNumber 为 16 的图片是空白，为 17-18 的图片是目录，那么起始页码就是 17（切记，不是 16！），结束页码就是 18。请切记不要把空白页面识别为目录的一部分，这会导致后续程序出现严重错误！！！

【输出要求】：
1. 仅输出 JSON 格式，不要包含任何 markdown 标记（如 \`\`\`json ）、解释或额外文本。
2. 如果这几页中存在目录，输出格式为：{"toc_start": 起始页码，"toc_end": 结束页码}
3. 如果这几页中没有任何一页是目录，输出格式为：{"toc_start": null, "toc_end": null}`;

const TOC_CONFLICT_PROMPT = `这是一张 PDF 页面的图片，物理页码为 {p}。
请判断这一页是否是目录。目录的严格定义为：这张图中是否能提取出多个标题 - 页码对。
【输出要求】：
1. 仅输出 JSON 格式，不要包含任何 markdown 标记。
2. 如果是目录，输出：{"is_toc": true}
3. 如果不是目录，输出：{"is_toc": false}`;

const EXTRACT_PROMPT_TEXT = `# 任务目标
分析提供的图片并提取目录信息。提取目标为每个目录项的标题和页码。

# 输出格式要求
1. 数据格式：仅输出CSV格式数据，禁止包含任何其他文本、代码解释或说明。
2. 表头设置：必须包含表头 title,page_number。第一列为标题，第二列为页码。
3. 分隔符：严格使用半角逗号 \`,\` 作为列分隔符，禁止使用全角逗号 \`，\`。

# 内容提取规则
1. 完整性与筛选：提取所有目录项目，不遗漏任何带有页码的条目。
2. 无页码条目判定：针对无页码条目需依据语义判断。若为篇、章级别的大标题，需推算并填补实际页码；若存在大量无页码的节、子节等次级标题，则直接忽略。
3. 所见即所得：提取页面真实存在的信息，禁止自行推测或补充未显示的层级标题。例如页面以 4.5.1 开头，绝对禁止自行补充第四章及4.5节的标题，仅提取当前可见的内容。
4. 忠于原文：严格保留原始标题的文字、数字形式及前缀，禁止增添、删减或修改。
   * 示例：图上为 \`第7章 总结\`，则提取为 \`第7章 总结\`。
   * 示例：图上为 \`7章 不良案例\`，则提取为 \`7章 不良案例\`，禁止修改为 \`第7章 不良案例\` 或 \`7 不良案例\`。
   * 示例：图上为 \`01 花草篇\`，则提取为 \`01 花草篇\`，禁止修改为 \`花草篇\`。

5. 语言保留：严格保留原始文字（包括繁体中文、英文等），禁止进行翻译。
6. 符号替换：将带圈数字替换为常规阿拉伯数字。例如将 ① 替换为 1。
7. 标题页码分割：准确区分紧跟在标题后的页码，避免将页码提取为标题的一部分。
   * 示例：\`1 绪论\` 和 \`第一章 绪论\` 为合理标题。若出现 \`第一章 绪论 / 1\` 或 \`第一章 绪论 1\`，末尾的 \`1\` 应当作为页码提取，标题仅为 \`第一章 绪论\`。
8. 标点符号规范：包含中文的标题统一使用全角标点符号（如 \`：\` 和 \`，\`）。纯英文标题使用半角标点。
9. 剔除连接符：去除标题与页码之间或标题内部用于排版的引导点 \`·\` 或类似连接符。仅保留语义上确实作为省略号存在的符号。
   * 正确示例：\`Part25 写给想成为动画作者的人,122\`
   * 错误示例：\`Part 25……写给想成为动画作者的人,122\`
10. 标题完整性：保持章节编号与标题内容的完整关联，禁止因排版结构将其拆分为独立的两行。
    * 正确示例：\`第1章 基本知识,1\`
    * 错误示例：\`第1章,null\` 换行 \`基本知识,1\`
11. 排除页眉页脚：忽略分布在页面边缘的书籍名称、页眉或章节导航等非目录主体内容。
12. 页面上出现xx篇、xx章时，尽管它们没有页码，但仍然应提取，它们必然是目录的一部分。

# 页码处理规则
1. 缺失页码推算：若篇、章等高级别条目缺失页码，需根据其下级首个条目的页码或相邻条目进行合理推算并填补。禁止出现null的结果。
   * 示例：第1篇的页码丢失，但第1篇第1章的页码为2，则推测第1篇的页码为2。

# 空格与排版规则
1. 纯中文目录：章节编号与具体标题之间仅保留1个半角空格。禁止在中文词组内部、数字与中文字符之间添加多余空格。
   * 正确示例：\`第1章 自动控制概述\`；\`第2章 超前滞后校正与PID校正\`
   * 错误示例：\`第 1章 自动控制概述\`；\`第1 章自动控制概述\`；\`第2章 超前滞后校正与 PID校正\`；\`第2章 超前滞后校正与PID 校正\`；\`第 1 章 自动控制概述\`
2. 纯英文目录：遵循标准英语语法，单词、数字与符号之间保留常规空格。
3. 混合目录：中文部分执行中文空格规则，英文部分执行英文空格规则。`;

const EXTRACT_IMPORTANT_NOTE = `
1. 忠于原文。图上为 \`01 花草篇\`，则提取为 \`01 花草篇\`，禁止修改为 \`花草篇\`。
2. 页面上出现xx篇、xx章时，尽管它们没有页码，但仍然应提取，它们必然是目录的一部分。
`;

const LEVEL_PROMPT_TEXT = `# 任务目标
请分析提供的图片以及对应的目录数据（标题和页码），判断每个目录项所属的层级（level）。

# 输出格式要求
1. **必须且仅输出 CSV 格式数据**，包含表头 \`title,page_number,level\`。
2. 严禁输出 Markdown 代码块标记（如 \`\`\`csv），严禁输出任何解释性文字。
3. CSV 内容示例：
title,page_number,level
第一章 函数极限连续,1,1
第一节 函数,1,2
一、函数的概念,1,3

# 层级判定规则
1. 视觉特征优先：应优先根据图片呈现的视觉特征（如颜色、字体、字号、缩进等）判定目录层级，也需要结合语义进行推断。
2. 除非是第一页目录，否则第一行的标题未必是第一层级的，它可能隶属于上一页的其他章节。
3. 规避层级判定错误：
   - 规避误区：对于形式不同（例如字号不同、字体不同、缩进不同、颜色不同等）的标题，层级一定是不同的。
   - 尊重常识：\`篇\`和\`部分\`一般是最高级；其次为\`章\`；然后是\`节\`等。
   - 节与子节的层级关系：例如 2.4（节）与 2.4.1（子节）绝对不可处于同一目录层级，子节的层级必须比节低一级。
4. 思考题、练习题等，应该是作为\`章\`的下一级，而不应该与\`章\`处于在同一层级。但切记不要直接删掉这些页码为null的标题，这违背了第一条注意事项的要求。

# 注意事项：
- 输出的 CSV 行数应与输入的 CSV 数据的标题数量严格一致，严禁省略。切记不要直接删掉这些页码为null的标题，你应该推断它们，而不是删除它们。
- level 列必须是整数。
- 部分情况下，识别的标题末尾会附带一个页码，如果遇到这种情况，请去掉那个页码。
- 部分情况下页码会出现null，此时请进行简要推断，例如将其与它附近的页码设置为一致。
- 一般来说，前言、推荐序、致谢、参考文献等，应该是第一层级。
`;

const OFFSET_PROMPT_TEMPLATE = `你是一个专业的文档页码识别专家。你的任务是识别图片中页面底部或顶部标注的实际印刷页码，并计算正文偏移量。
计算公式：正文偏移量 = PDF 物理页码 - 印刷页码。

当前图片的 PDF 物理页码是：{page_num}

【示例 1】
物理页码：25
图片中底部写着："10"
计算：25 - 10 = 15
输出：15

【示例 2】
物理页码：12
图片中顶部写着："- 2 -"
计算：12 - 2 = 10
输出：10

【示例 3】
物理页码：100
图片中没有明确的阿拉伯数字页码
输出：Error

【错误示例】
物理页码：25
图片中顶部写着："20"
计算：25 - 20 = -5
输出：-5

请仔细观察图片，找到印刷页码，并严格按照上述格式，仅输出计算后的正文偏移量数字。不要输出任何解释。`;

const ROMAN_OFFSET_PROMPT_TEMPLATE = `你是一个专业的文档页码识别专家。你的任务是识别图片中页面底部或顶部标注的罗马数字页码，并计算前言偏移量。
计算公式：前言偏移量 = PDF 物理页码 - 罗马数字页码对应的阿拉伯数字值。

当前图片的 PDF 物理页码是：{page_num}

【示例 1】
物理页码：5
图片中底部写着："iii"
罗马数字 iii = 3
计算：5 - 3 = 2
输出：2

【示例 2】
物理页码：10
图片中底部写着："xv"
罗马数字 xv = 15
计算：10 - 15 = -5
输出：-5

【示例 3】
物理页码：3
图片中没有罗马数字页码（可能是阿拉伯数字或无页码）
输出：Error

请仔细观察图片，找到罗马数字页码，并严格按照上述格式，仅输出计算后的前言偏移量数字。不要输出任何解释。`;

// ===== 数据结构 =====

type ProgressCb = (text: string, percent?: number) => void;

// ===== 通用工具 =====

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateMessage(msg: string, maxLength: number = 60): string {
  if (msg.length <= maxLength) return msg;
  return msg.substring(0, maxLength - 3) + "...";
}

/**
 * 限流并发执行任务（每个任务内部自行重试/取消检查）。
 * 收集所有任务错误，全部跑完后抛出首个错误（与 autoContents 的 gather 语义一致）。
 */
async function runLimited(
  tasks: (() => Promise<void>)[],
  limit: number,
  onTaskDone?: (done: number, total: number) => void,
): Promise<void> {
  let nextIdx = 0;
  let doneCount = 0;
  const errors: any[] = [];
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, tasks.length)) },
    async () => {
      while (nextIdx < tasks.length) {
        const my = nextIdx++;
        try {
          await tasks[my]();
        } catch (e: any) {
          errors.push(e);
        }
        doneCount++;
        if (onTaskDone) onTaskDone(doneCount, tasks.length);
      }
    },
  );
  await Promise.all(workers);
  if (errors.length) throw errors[0];
}

// ===== 图片处理（主窗口 canvas；dataURL 字符串可跨 compartment 传递） =====

/** 多页横向拼接为一张图，并在每页下方标注 "PDFNumber N"（等价 create_concat_image_b64） */
async function concatWindowImage(
  win: Window,
  pages: { page: number; base64: string }[],
): Promise<string> {
  const imgs: any[] = [];
  for (const p of pages) {
    imgs.push(await decodeImage(win, p.base64, "image/jpeg"));
  }
  if (!imgs.length) throw new Error("拼图失败：无有效页面");
  const maxH = Math.max(...imgs.map((i) => i.naturalHeight));
  const totalW = imgs.reduce((sum: number, i: any) => sum + i.naturalWidth, 0);
  const newH = Math.round(maxH * 1.2);

  const canvas: any = win.document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = newH;
  const ctx: any = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalW, newH);

  const fontSize = Math.max(40, Math.round(maxH * 0.05));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let currentX = 0;
  imgs.forEach((img: any, idx: number) => {
    ctx.drawImage(img, currentX, 0);
    const text = `PDFNumber ${pages[idx].page}`;
    ctx.fillText(
      text,
      currentX + img.naturalWidth / 2,
      maxH + (newH - maxH) / 2,
    );
    currentX += img.naturalWidth;
  });

  return canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
}

// ===== LLM 调用与解析 =====

/** 目录专用调用：temperature=0（与 autoContents 一致），放宽 max_tokens 给长 CSV 留空间 */
async function tocCall(
  config: VisionChatConfig,
  parts: VisionChatPart[],
): Promise<string> {
  throwIfCancelled();
  return callVisionChat(config, parts, { maxTokens: 8192, temperature: 0 });
}

// ===== 阶段 1：定位目录页 =====

function addVote(
  votes: Map<number, { isToc: number; notToc: number }>,
  page: number,
  isToc: boolean,
) {
  const v = votes.get(page) || { isToc: 0, notToc: 0 };
  if (isToc) v.isToc++;
  else v.notToc++;
  votes.set(page, v);
}

function hasTocInRange(
  votes: Map<number, { isToc: number; notToc: number }>,
  from: number,
  to: number,
): boolean {
  for (let p = from; p <= to; p++) {
    if ((votes.get(p)?.isToc || 0) > 0) return true;
  }
  return false;
}
async function detectTocPages(
  filePath: string,
  itemId: number,
  pageCount: number,
  config: VisionChatConfig,
  cb: ProgressCb,
): Promise<{ tocStart: number | null; tocEnd: number | null }> {
  const imageCache = new Map<number, string>();
  const votes = new Map<number, { isToc: number; notToc: number }>();

  const ensureRange = async (from: number, to: number) => {
    const missing: number[] = [];
    for (let p = from; p <= Math.min(to, pageCount); p++) {
      if (!imageCache.has(p)) missing.push(p);
    }
    if (!missing.length) return;
    const rendered = await renderPagesToJpegs(filePath, itemId, missing);
    for (const [p, img] of rendered) imageCache.set(p, img);
  };

  const scanWindows = async (windows: [number, number][]) => {
    if (!windows.length) return;
    let done = 0;
    const total = windows.length;
    await runLimited(
      windows.map(([s, e]) => async () => {
        const pageImages: { page: number; base64: string }[] = [];
        for (let p = s; p <= e; p++) {
          const img = imageCache.get(p);
          if (img) pageImages.push({ page: p, base64: img });
        }
        if (!pageImages.length) return;
        const windowImage = await concatWindowImage(
          Zotero.getMainWindow()!,
          pageImages,
        );
        const prompt = TOC_WINDOW_PROMPT.replace("{start_p}", String(s));
        const raw = await tocCall(config, [
          { text: prompt },
          { imageBase64: windowImage, mimeType: "image/jpeg" },
          { text: prompt },
        ]);
        const { tocStart: t1, tocEnd: t2 } = parseTocJson(raw);
        if (t1 === null || t2 === null) return; // 解析失败/无目录：该窗口不投票（与原版一致）
        for (let p = s; p <= e; p++) addVote(votes, p, t1 <= p && p <= t2);
      }),
      TOC_CALL_CONCURRENCY,
      (doneCount, totalCount) => {
        done = doneCount;
        cb(
          getString("progress-toc-detect", {
            args: { current: done, total: totalCount },
          }),
          Math.round((done / Math.max(total, 1)) * 30),
        );
      },
    );
  };

  // 动态扫描与扩窗（等价 extract_toc_info 的 while 循环；修正了原版对 ≤20 页文档跳过扫描的问题）
  let currentLimit = Math.min(TOC_INITIAL_SCAN, pageCount);
  let lastScanned = 0;
  let retries = 0;
  let tocFound = false;
  while (true) {
    const windows: [number, number][] = [];
    for (let i = lastScanned + 1; i <= currentLimit; i += TOC_WINDOW_STEP) {
      if (i > pageCount) break;
      windows.push([i, Math.min(i + TOC_WINDOW - 1, pageCount)]);
    }
    // 窗口可越出本批上限 TOC_WINDOW-1 页（与原版一致，需一并渲染）
    await ensureRange(
      lastScanned + 1,
      Math.min(currentLimit + TOC_WINDOW - 1, pageCount),
    );
    await scanWindows(windows);
    lastScanned = currentLimit;

    if (!tocFound) {
      if (hasTocInRange(votes, 1, currentLimit)) {
        tocFound = true;
      } else if (
        retries < TOC_MAX_EXPANSIONS &&
        currentLimit < TOC_SCAN_HARD_CAP &&
        currentLimit < pageCount
      ) {
        retries++;
        currentLimit = Math.min(currentLimit + 10, TOC_SCAN_HARD_CAP);
        continue;
      } else {
        break;
      }
    }
    if (tocFound) {
      const boundary = votes.get(currentLimit);
      if ((boundary?.isToc || 0) > 0) {
        const next = Math.min(currentLimit + 10, TOC_SCAN_HARD_CAP);
        if (next <= currentLimit || currentLimit >= pageCount) break;
        currentLimit = next;
        continue;
      }
      break;
    }
  }

  // 冲突页单页仲裁
  const finalTocPages: number[] = [];
  const conflictPages: number[] = [];
  for (const [p, v] of votes) {
    if (v.isToc > 0 && v.notToc > 0) conflictPages.push(p);
    else if (v.isToc > 0) finalTocPages.push(p);
  }
  if (conflictPages.length) {
    await ensureRange(Math.min(...conflictPages), Math.max(...conflictPages));
    await runLimited(
      conflictPages.map((p) => async () => {
        const img = imageCache.get(p);
        if (!img) return;
        const prompt = TOC_CONFLICT_PROMPT.replace("{p}", String(p));
        const raw = await tocCall(config, [
          { text: prompt },
          { imageBase64: img, mimeType: "image/jpeg" },
        ]);
        if (parseIsTocJson(raw)) finalTocPages.push(p);
      }),
      TOC_CALL_CONCURRENCY,
    );
  }

  if (!finalTocPages.length) return { tocStart: null, tocEnd: null };
  const [globalStart, globalEnd] = mergeContinuousRanges(finalTocPages);
  if (globalStart === null) return { tocStart: null, tocEnd: null };
  if (globalEnd !== null && globalEnd >= TOC_END_FUSE) {
    ztoolkit.log(
      "[AIOCR] TOC detect: end page fuse triggered, fallback to 1-2",
    );
    return { tocStart: 1, tocEnd: 2 };
  }
  ztoolkit.log(
    `[AIOCR] TOC detect: pages ${globalStart}-${globalEnd} (${finalTocPages.length} voted pages)`,
  );
  return { tocStart: globalStart, tocEnd: globalEnd };
}

// ===== 阶段 2+3：提取条目与层级判定 =====

interface TocPageData {
  pageNum: number;
  image: string;
  csv: string; // 修复后的 2 列 CSV（含 null 回填），作为层级判定输入
  rawEntries: TocRawEntry[];
  entriesLevels?: TocEntry[]; // 层级判定结果（排序后）
}

async function extractTocEntries(
  filePath: string,
  itemId: number,
  tocPages: number[],
  config: VisionChatConfig,
  cb: ProgressCb,
): Promise<TocPageData[]> {
  const pageNumbers: number[] = tocPages;
  // 页面渲染（后台开阅读器 + pdf.js）可能耗时较久，先给出可见提示
  cb(
    getString("progress-ocr-preparing", {
      args: { pages: pageNumbers.length },
    }),
    30,
  );
  const rendered = await renderPagesToJpegs(filePath, itemId, pageNumbers);

  const pages: TocPageData[] = pageNumbers
    .filter((p) => rendered.has(p))
    .map((p) => ({
      pageNum: p,
      image: rendered.get(p)!,
      csv: "",
      rawEntries: [],
    }));

  let done = 0;
  const total = pages.length;
  await runLimited(
    pages.map((page) => async () => {
      for (let attempt = 0; attempt < EXTRACT_RETRIES; attempt++) {
        throwIfCancelled();
        try {
          const raw = await tocCall(config, [
            { text: "当前页图片（需处理）：" },
            { text: EXTRACT_PROMPT_TEXT },
            { imageBase64: page.image, mimeType: "image/jpeg" },
            { text: EXTRACT_PROMPT_TEXT },
            { text: EXTRACT_IMPORTANT_NOTE },
          ]);
          const entries = parseExtractCsv(raw);
          page.rawEntries = entries;
          // 回填 null 后的 2 列 CSV，作为层级判定的输入
          const { valid, fixed } = validateAndFixCsv(stripCsvFences(raw), 2);
          page.csv = valid ? fixNullPageNumbers(fixed) : fixed;
          if (!entries.length && attempt < EXTRACT_RETRIES - 1) {
            continue; // 空结果重试
          }
          break;
        } catch (e: any) {
          if (isOcrCancelled()) throw e;
          if (attempt >= EXTRACT_RETRIES - 1) {
            throw new Error(
              `目录条目提取失败（第 ${page.pageNum} 页）：${e.message}`,
            );
          }
          await sleep(Math.min(2000 * Math.pow(2, attempt), 8000));
        }
      }
    }),
    TOC_CALL_CONCURRENCY,
    (doneCount, totalCount) => {
      done = doneCount;
      cb(
        getString("progress-toc-extract", {
          args: { current: done, total: totalCount },
        }),
        30 + Math.round((done / Math.max(totalCount, 1)) * 25),
      );
    },
  );

  return pages.filter((p) => p.rawEntries.length > 0);
}

async function assignLevels(
  pages: TocPageData[],
  config: VisionChatConfig,
  cb: ProgressCb,
): Promise<TocEntry[]> {
  const first = pages[0];
  let firstEntries: TocEntry[] | null = null;
  let firstCsvExample: string | null = null;

  // 第一页：串行处理并缓存为 few-shot 示例（等价 process_first_page）
  for (let attempt = 0; attempt < LEVEL_RETRIES; attempt++) {
    throwIfCancelled();
    try {
      const raw = await tocCall(config, [
        { text: "当前页图片（需处理，作为后续页面的参考示例）：" },
        { imageBase64: first.image, mimeType: "image/jpeg" },
        {
          text: `${LEVEL_PROMPT_TEXT}\n\n当前页提取的原始 CSV 数据如下：\n${first.csv}`,
        },
      ]);
      firstEntries = parseLevelCsvResponse(raw);
      firstCsvExample = raw.trim();
      break;
    } catch (e: any) {
      if (isOcrCancelled()) throw e;
      ztoolkit.log(
        `[AIOCR] TOC level first page attempt ${attempt + 1} failed: ${e.message}`,
      );
      if (attempt >= LEVEL_RETRIES - 1) {
        throw new Error(`目录层级判定失败（第一页）：${e.message}`);
      }
      await sleep(Math.min(2000 * Math.pow(2, attempt), 8000));
    }
  }

  if (!firstEntries || !firstEntries.length) {
    throw new Error(getString("error-toc-level-empty"));
  }
  const sortedFirst = sortByRoman(firstEntries);
  const all: TocEntry[] = [...sortedFirst];
  const firstMaxLevel = Math.max(...sortedFirst.map((e) => e.level));

  // 其余页：以首页为 few-shot 参考，限流并发（等价 process_level_async）
  const rest = pages.slice(1);
  if (rest.length) {
    let done = 0;
    await runLimited(
      rest.map((page) => async () => {
        let pageEntries: TocEntry[] | null = null;
        for (let attempt = 0; attempt < LEVEL_RETRIES; attempt++) {
          throwIfCancelled();
          try {
            const parts: VisionChatPart[] = [];
            if (firstCsvExample) {
              parts.push({
                text: "参考示例（第一页图片及其正确的 CSV 格式层级分析结果）：",
              });
              parts.push({ imageBase64: first.image, mimeType: "image/jpeg" });
              parts.push({ text: `参考结果 (CSV 格式):\n${firstCsvExample}` });
              parts.push({
                text: "---\n请严格参照上述示例的 CSV 格式和层级判断标准，分析以下当前页图片：",
              });
            }
            parts.push({ imageBase64: page.image, mimeType: "image/jpeg" });
            parts.push({
              text: `${LEVEL_PROMPT_TEXT}\n\n当前页提取的原始 CSV 数据如下：\n${page.csv}`,
            });
            const raw = await tocCall(config, parts);
            pageEntries = parseLevelCsvResponse(raw);
            if (!pageEntries.length) throw new Error("level parse empty");
            break;
          } catch (e: any) {
            if (isOcrCancelled()) throw e;
            if (attempt >= LEVEL_RETRIES - 1) {
              throw new Error(
                `目录层级判定失败（第 ${page.pageNum} 页）：${e.message}`,
              );
            }
            await sleep(Math.min(2000 * Math.pow(2, attempt), 8000));
          }
        }
        page.entriesLevels = sortByRoman(pageEntries || []);
        const doneCount = ++done;
        cb(
          getString("progress-toc-level", {
            args: { current: doneCount, total: rest.length },
          }),
          55 + Math.round((doneCount / rest.length) * 20),
        );
      }),
      TOC_CALL_CONCURRENCY,
    );
  }

  // 跨页层级对齐（等价 post_process_levels）+ 汇总
  for (const page of rest) {
    const pageLevels = page.entriesLevels;
    if (!pageLevels || !pageLevels.length) continue;
    const currentMax = Math.max(...pageLevels.map((e) => e.level));
    if (currentMax < firstMaxLevel) {
      const diff = firstMaxLevel - currentMax;
      for (const e of pageLevels) e.level += diff;
    }
    all.push(...pageLevels);
  }

  return normalizeLevels(all);
}

// ===== 阶段 4：页码偏移 =====

async function calcArabicOffset(
  filePath: string,
  itemId: number,
  pageCount: number,
  config: VisionChatConfig,
  cb: ProgressCb,
): Promise<number | null> {
  let startIdx = Math.floor(pageCount * 0.2);
  let endIdx = Math.floor(pageCount * 0.8);
  if (endIdx <= startIdx) {
    startIdx = 0;
    endIdx = pageCount - 1;
  }
  const pool: number[] = [];
  for (let i = startIdx; i <= endIdx; i++) pool.push(i + 1);
  if (pool.length < OFFSET_FIRST_ROUND) return null;

  const results: number[] = [];
  const sampleCall = async (pages: number[]) => {
    cb(getString("progress-ocr-preparing", { args: { pages: pages.length } }));
    const images = await renderPagesToJpegs(filePath, itemId, pages);
    await runLimited(
      pages.map((p) => async () => {
        const img = images.get(p);
        if (!img) return;
        const prompt = OFFSET_PROMPT_TEMPLATE.replace("{page_num}", String(p));
        const raw = await tocCall(config, [
          { text: prompt },
          { imageBase64: img, mimeType: "image/jpeg" },
        ]);
        const v = parseIntResponse(raw);
        if (v !== null) results.push(v);
      }),
      TOC_CALL_CONCURRENCY,
    );
  };

  const firstRound = samplePool(pool, OFFSET_FIRST_ROUND);
  await sampleCall(firstRound);
  const used = new Set(firstRound);
  let mode = modeOf(results);
  if (
    (!mode || mode.count < OFFSET_MODE_MIN_VOTES) &&
    pool.length - used.size >= OFFSET_SECOND_ROUND
  ) {
    const remaining = pool.filter((p) => !used.has(p));
    await sampleCall(samplePool(remaining, OFFSET_SECOND_ROUND));
  }
  mode = modeOf(results);
  ztoolkit.log(
    `[AIOCR] TOC arabic offset: ${mode ? mode.value : "null"} (from ${results.length} valid samples)`,
  );
  return mode ? mode.value : null;
}

async function calcRomanOffset(
  filePath: string,
  itemId: number,
  pageCount: number,
  config: VisionChatConfig,
): Promise<number | null> {
  const endIdx = Math.min(Math.floor(pageCount * 0.2), ROMAN_SAMPLE_CAP);
  if (endIdx < 2) return null;
  const pages: number[] = [];
  for (let p = 1; p <= endIdx; p++) pages.push(p);
  const images = await renderPagesToJpegs(filePath, itemId, pages);
  const results: number[] = [];
  await runLimited(
    pages.map((p) => async () => {
      const img = images.get(p);
      if (!img) return;
      const prompt = ROMAN_OFFSET_PROMPT_TEMPLATE.replace(
        "{page_num}",
        String(p),
      );
      const raw = await tocCall(config, [
        { text: prompt },
        { imageBase64: img, mimeType: "image/jpeg" },
      ]);
      const v = parseIntResponse(raw);
      if (v !== null) results.push(v);
    }),
    TOC_CALL_CONCURRENCY,
  );
  const mode = modeOf(results);
  ztoolkit.log(
    `[AIOCR] TOC roman offset: ${mode ? mode.value : "null"} (from ${results.length} valid samples)`,
  );
  return mode ? mode.value : null;
}

async function computeOffsets(
  filePath: string,
  itemId: number,
  pageCount: number,
  entries: TocEntry[],
  config: VisionChatConfig,
  cb: ProgressCb,
): Promise<TocOffsets> {
  let arabic: number | null = null;
  let roman: number | null = null;
  try {
    cb(getString("progress-toc-offset"), 76);
    arabic = await calcArabicOffset(filePath, itemId, pageCount, config, cb);
  } catch (e: any) {
    if (isOcrCancelled()) throw e;
    ztoolkit.log(`[AIOCR] TOC arabic offset calculation failed: ${e.message}`);
  }
  // 仅当目录中存在罗马数字条目时才计算前言偏移
  if (entries.some((e) => e.isRoman)) {
    try {
      cb(getString("progress-toc-offset-roman"), 85);
      roman = await calcRomanOffset(filePath, itemId, pageCount, config);
    } catch (e: any) {
      if (isOcrCancelled()) throw e;
      ztoolkit.log(`[AIOCR] TOC roman offset calculation failed: ${e.message}`);
    }
  }
  return { arabic, roman };
}

// ===== 阶段 5：构建书签并写入 =====

function pageDestArray(doc: PDFDocument, pageIndex: number): PDFArray {
  const arr = PDFArray.withContext(doc.context);
  arr.push(doc.getPage(pageIndex).ref);
  arr.push(PDFName.of("Fit"));
  return arr;
}

/** 序列化同级节点链（Title/Parent/Dest/Prev/Next/First/Last/Count），返回首尾引用与展开计数 */
function serializeSiblings(
  doc: PDFDocument,
  nodes: OutlineNode[],
  parentRef: PDFRef,
): { firstRef: PDFRef | null; lastRef: PDFRef | null; count: number } {
  const ctx = doc.context;
  const serialized: { ref: PDFRef; dict: PDFDict }[] = [];
  let count = 0;
  for (const node of nodes) {
    const ref = ctx.nextRef();
    const dict = ctx.obj({
      Title: PDFHexString.fromText(node.title),
      Parent: parentRef,
      Dest: pageDestArray(doc, node.pageIndex),
    }) as PDFDict;
    ctx.assign(ref, dict);
    serialized.push({ ref, dict });
    count += 1;
    if (node.children.length) {
      const sub = serializeSiblings(doc, node.children, ref);
      if (sub.firstRef) {
        dict.set(PDFName.of("First"), sub.firstRef);
        dict.set(PDFName.of("Last"), sub.lastRef!);
        dict.set(PDFName.of("Count"), PDFNumber.of(sub.count));
        count += sub.count;
      }
    }
  }
  for (let i = 0; i < serialized.length; i++) {
    if (i > 0)
      serialized[i].dict.set(PDFName.of("Prev"), serialized[i - 1].ref);
    if (i < serialized.length - 1) {
      serialized[i].dict.set(PDFName.of("Next"), serialized[i + 1].ref);
    }
  }
  return {
    firstRef: serialized.length ? serialized[0].ref : null,
    lastRef: serialized.length ? serialized[serialized.length - 1].ref : null,
    count,
  };
}

/** 构建 /Outlines 根对象并挂到目录 */
function writeOutline(doc: PDFDocument, roots: OutlineNode[]): PDFRef {
  const ctx = doc.context;
  const outlinesRef = ctx.nextRef();
  const rootDict = ctx.obj({ Type: "Outlines" }) as PDFDict;
  const { firstRef, lastRef, count } = serializeSiblings(
    doc,
    roots,
    outlinesRef,
  );
  if (firstRef && lastRef) {
    rootDict.set(PDFName.of("First"), firstRef);
    rootDict.set(PDFName.of("Last"), lastRef);
    rootDict.set(PDFName.of("Count"), PDFNumber.of(count));
  }
  ctx.assign(outlinesRef, rootDict);
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  return outlinesRef;
}

function isReaderOpenForItem(itemId: number): boolean {
  try {
    const readers = (Zotero.Reader as any)._readers;
    if (Array.isArray(readers)) {
      return readers.some((r: any) => (r._item?.id || r.itemID) === itemId);
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * 将书签写入原 PDF 文件（pdf-lib 低层构建 /Outlines，覆盖旧目录）。
 * 写临时文件校验后原子替换，替换失败（如阅读器占用）抛出友好错误。
 */
async function writeOutlineToPdfFile(
  filePath: string,
  items: BookmarkItem[],
): Promise<void> {
  const bytes = await readPdfFileBytes(filePath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (doc.isEncrypted) {
    throw new Error("PDF is encrypted; pdf-lib cannot write outline");
  }
  writeOutline(doc, buildOutlineTree(items));
  // 关闭对象流以最大化与其他工具的兼容性
  const outBytes = await doc.save({ useObjectStreams: false });

  const tempDir = PathUtils.join(PathUtils.tempDir, "aiocr-toc");
  await IOUtils.makeDirectory(tempDir, { ignoreExisting: true } as any);
  const tempPath = PathUtils.join(tempDir, `toc-${Date.now()}.pdf`);
  await IOUtils.write(tempPath, outBytes);

  // 写入结果自检：页数一致且书签树已挂载
  const checkBytes = await readPdfFileBytes(tempPath);
  const checkDoc = await PDFDocument.load(checkBytes, {
    ignoreEncryption: true,
  });
  if (checkDoc.getPageCount() !== doc.getPageCount()) {
    throw new Error("outline write verification failed");
  }

  try {
    await (IOUtils as any).move(tempPath, { to: filePath, overwrite: true });
  } catch (e1: any) {
    // 兼容不支持 overwrite 的签名：先移除再移动
    try {
      await IOUtils.remove(filePath);
      await IOUtils.move(tempPath, filePath);
    } catch (e2: any) {
      throw new Error(
        `${getString("error-toc-write")}: ${e2.message || e1.message}`,
      );
    }
  }
}

/** 加密 PDF 回退：光栅化副本（每页 JPEG 重组成新 PDF）+ 书签，作为新附件导入 */
async function createRasterizedBookmarkedCopy(
  attachment: Zotero.Item,
  parentItem: Zotero.Item,
  filePath: string,
  items: BookmarkItem[],
  pageCount: number,
  cb: ProgressCb,
): Promise<Zotero.Item> {
  const outDoc = await PDFDocument.create();
  let processed = 0;
  for (const chunk of chunkArray(
    Array.from({ length: pageCount }, (_, i) => i + 1),
    RASTER_CHUNK,
  )) {
    throwIfCancelled();
    const imgs = await pdfToImages(filePath, undefined, attachment.id, chunk);
    for (const img of imgs) {
      const win = Zotero.getMainWindow()!;
      const jpegBase64 = await downscaleBase64Image(
        win,
        img.base64,
        "image/png",
        RASTER_MAX_LONG_EDGE,
        JPEG_QUALITY,
      );
      const jpg = await outDoc.embedJpg(jpegBase64);
      const page = outDoc.addPage([jpg.width, jpg.height]);
      page.drawImage(jpg, {
        x: 0,
        y: 0,
        width: jpg.width,
        height: jpg.height,
      });
      processed++;
      cb(
        getString("progress-toc-raster", {
          args: { current: processed, total: pageCount },
        }),
        Math.round((processed / pageCount) * 90),
      );
    }
  }
  writeOutline(outDoc, buildOutlineTree(items));
  const outBytes = await outDoc.save({ useObjectStreams: false });

  const tempDir = PathUtils.join(PathUtils.tempDir, "aiocr-toc");
  await IOUtils.makeDirectory(tempDir, { ignoreExisting: true } as any);
  const tempPath = PathUtils.join(tempDir, `toc-copy-${Date.now()}.pdf`);
  await IOUtils.write(tempPath, outBytes);

  const displayTitle = (attachment.getField?.("title") as string) || "PDF";
  const newAttachment = await (Zotero.Attachments as any).importFromFile({
    file: tempPath,
    libraryID: parentItem.libraryID,
    parentItemID: parentItem.id,
    title: `${displayTitle}（目录书签）`,
    contentType: "application/pdf",
  });
  return newAttachment as Zotero.Item;
}

// ===== 入口 =====

function findFirstPdfTarget(
  items: Zotero.Item[],
): { attachment: Zotero.Item; parentItem: Zotero.Item } | null {
  for (const item of items) {
    if (!item) continue;
    if (item.isAttachment()) {
      if (item.attachmentContentType === "application/pdf") {
        return {
          attachment: item,
          parentItem: item.parentItemID
            ? (Zotero.Items.get(item.parentItemID) as Zotero.Item)
            : item,
        };
      }
      continue;
    }
    const pdfAtt = (item.getAttachments() as number[])
      .map((id) => Zotero.Items.get(id))
      .find((a: any) => a?.attachmentContentType === "application/pdf");
    if (pdfAtt) return { attachment: pdfAtt, parentItem: item };
  }
  return null;
}

/**
 * 右键菜单入口：AI 识别目录并生成 PDF 书签。
 */
export async function handleTocGeneration(): Promise<void> {
  resetOcrCancellation();
  const progressWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: false,
    closeTime: -1,
  });
  // 首行立即显示：后续所有阶段（含最前置的校验失败）都能在同一行上给出结果
  progressWin
    .createLine({
      text: getString("progress-toc-starting"),
      type: "default",
      progress: 0,
    })
    .show();
  const fail = (msg: string) => {
    progressWin.changeLine({
      text: truncateMessage(msg),
      type: "fail",
      progress: 100,
    });
    progressWin.startCloseTimer(10000);
    // 失败同时弹模态提示，确保用户看到结果
    try {
      Services.prompt.alert(
        null as any,
        getString("toc-failed-title"),
        truncateMessage(msg, 300),
      );
    } catch {
      /* ignore */
    }
  };
  const cb: ProgressCb = (text, percent) => {
    progressWin.changeLine({
      text,
      ...(percent !== undefined ? { progress: percent } : {}),
    } as any);
  };

  try {
    const pane = Zotero.getActiveZoteroPane();
    const items = (pane?.getSelectedItems?.() as Zotero.Item[]) || [];
    const target = findFirstPdfTarget(items);
    if (!target) {
      fail(getString("error-toc-no-pdf"));
      return;
    }
    const { attachment, parentItem } = target;

    const engine = (getPref("engine") as string) || "PP-OCRv6";
    let config: VisionChatConfig | null = null;
    try {
      config = getVisionChatConfigForEngine(engine);
    } catch (e: any) {
      fail(e.message);
      return;
    }
    if (!config) {
      fail(getString("error-toc-need-ai-engine"));
      return;
    }

    progressWin.changeLine({
      text: getString("progress-toc-start", {
        args: { engine: config.name },
      }),
      type: "default",
      progress: 0,
    });

    const filePath = await attachment.getFilePathAsync();
    if (!filePath) {
      fail(getString("error-toc-no-pdf"));
      return;
    }
    const pageCount = await getPdfPageCount(filePath);
    if (pageCount < 1) {
      fail(getString("error-toc-page-count"));
      return;
    }

    // 0. 弹窗：手动指定目录页（输入页码或点选缩略图），留空则 AI 自动定位
    const preflight = await promptTocPages(attachment, pageCount, config.name);
    if (preflight === null) {
      progressWin.startCloseTimer(500);
      return;
    }
    const manualPages = preflight.pages;

    // 1. 定位目录页（手动指定时跳过 AI 定位）
    let tocStart: number;
    let tocPageList: number[];
    if (manualPages.length > 0) {
      tocStart = manualPages[0];
      tocPageList = manualPages;
      ztoolkit.log(
        `[AIOCR] TOC pages manually specified: ${manualPages.join(", ")}`,
      );
    } else {
      const detected = await detectTocPages(
        filePath,
        attachment.id,
        pageCount,
        config,
        cb,
      );
      const { tocStart: s, tocEnd: e } = detected;
      if (s === null || e === null) {
        fail(
          getString("error-toc-not-found", {
            args: { max: TOC_SCAN_HARD_CAP },
          }),
        );
        return;
      }
      tocStart = s;
      tocPageList = [];
      for (let p = s; p <= e; p++) tocPageList.push(p);
    }

    // 2. 提取条目
    const pages = await extractTocEntries(
      filePath,
      attachment.id,
      tocPageList,
      config,
      cb,
    );
    if (!pages.length) {
      fail(getString("error-toc-empty"));
      return;
    }

    // 3. 层级判定
    const entries = await assignLevels(pages, config, cb);
    if (!entries.length) {
      fail(getString("error-toc-empty"));
      return;
    }

    // 4. 页码偏移
    const offsets = await computeOffsets(
      filePath,
      attachment.id,
      pageCount,
      entries,
      config,
      cb,
    );

    // 5. 组装书签
    const bookmarkItems = buildBookmarkItems(
      entries,
      offsets,
      tocStart,
      pageCount,
    );
    if (bookmarkItems.length <= 1) {
      fail(getString("error-toc-empty"));
      return;
    }

    // 6. 写入（加密 PDF 走光栅化副本确认）
    const bytes = await readPdfFileBytes(filePath);
    const probe = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (probe.isEncrypted) {
      const confirmed = Services.prompt.confirm(
        null as any,
        getString("toc-confirm-raster-title"),
        getString("toc-confirm-raster-text"),
      );
      if (!confirmed) {
        fail(getString("error-toc-encrypted-declined"));
        return;
      }
      const newAttachment = await createRasterizedBookmarkedCopy(
        attachment,
        parentItem,
        filePath,
        bookmarkItems,
        pageCount,
        cb,
      );
      progressWin.changeLine({
        text: getString("progress-toc-done-copy", {
          args: {
            count: bookmarkItems.length,
            title: newAttachment.getField?.("title") || "",
          },
        }),
        type: "success",
        progress: 100,
      });
      progressWin.startCloseTimer(8000);
      try {
        await Zotero.getActiveZoteroPane()?.selectItem(newAttachment.id);
      } catch {
        /* ignore */
      }
      return;
    }

    cb(getString("progress-toc-write"), 95);
    await writeOutlineToPdfFile(filePath, bookmarkItems);
    const readerOpen = isReaderOpenForItem(attachment.id);
    progressWin.changeLine({
      text: getString(
        readerOpen ? "progress-toc-done-reader" : "progress-toc-done",
        { args: { count: bookmarkItems.length } },
      ),
      type: "success",
      progress: 100,
    });
    progressWin.startCloseTimer(8000);
  } catch (e: any) {
    ztoolkit.log(
      `[AIOCR] TOC generation failed: ${e.message}\n${e.stack || ""}`,
    );
    if (isOcrCancelled()) {
      progressWin.changeLine({
        text: getString("progress-cancelled"),
        type: "default",
        progress: 100,
      });
      progressWin.startCloseTimer(3000);
    } else {
      fail(e.message || String(e));
    }
  }
}
