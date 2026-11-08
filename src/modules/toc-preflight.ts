/**
 * 「AI 识别目录」生成前弹窗（参照 sumatrapdf-plus 的交互）：
 * 用户可输入目录页的 PDF 物理页码（如 3-4, 7），或直接点选页面缩略图（双向同步）；
 * 留空则沿用 AI 自动定位。
 *
 * 基于 zotero-plugin-toolkit 的 DialogHelper。交互控件（输入框/缩略图容器/提示行）
 * 在 loadCallback 中亲手创建并直接持有引用——不依赖对 toolkit 注入元素的二次查询，
 * 也不依赖 data-bind 回写（确认时直接读输入框并显式写入 dialogData）。
 */

import { downscaleBase64Image, renderPagesToJpegs } from "./ocr-engine";
import { parsePageRange } from "../utils/toc-algorithms";
import { getString } from "../utils/locale";

const PREFLIGHT_THUMB_PAGES = 40; // 弹窗缩略图展示的页数（目录靠后的书也能点选）
const PREFLIGHT_THUMB_LONG_EDGE = 360; // 缩略图长边像素
const PREFLIGHT_THUMB_RENDER_SCALE = 0.6; // 缩略图渲染倍率（低于 OCR 的 2 倍，提速约 10 倍）
const PREFLIGHT_RENDER_CHUNK = 4; // 缩略图渲染分块（每块刷新一次界面）
const PREFLIGHT_MOUNT_ID = "aiocr-preflight-mount";
const PREFLIGHT_MOUNT_RETRY = 20; // 挂载点查找重试次数
const PREFLIGHT_MOUNT_RETRY_DELAY = 150;

export interface TocPreflightResult {
  /** 手动指定的目录页（排序去重）；空数组 = 交给 AI 自动定位 */
  pages: number[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failToast(msg: string) {
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeTime: 6000,
  })
    .createLine({ text: msg, type: "fail", progress: 100 })
    .show();
}

/** 条目是否已有打开的阅读器实例 */
function isReaderOpenForAttachment(itemId: number): boolean {
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

/** 排序去重并把连续页合并为 3-4 段 */
function pagesToRangeText(pages: number[]): string {
  const sorted = Array.from(new Set(pages)).sort((a, b) => a - b);
  const parts: string[] = [];
  let runStart = sorted[0];
  let runEnd = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === runEnd + 1) {
      runEnd = cur;
      continue;
    }
    parts.push(runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`);
    runStart = cur;
    runEnd = cur;
  }
  return parts.join(", ");
}

/**
 * 生成前弹窗。返回 null 表示用户取消/关闭弹窗（流程终止）；
 * pages 为空数组表示用户确认后选择 AI 自动定位。
 */
export async function promptTocPages(
  attachment: Zotero.Item,
  pageCount: number,
  engineName: string,
): Promise<TocPreflightResult | null> {
  const DialogCtor = (ztoolkit as any).Dialog;
  if (typeof DialogCtor !== "function") {
    // toolkit 无 Dialog 时静默回退 AI 自动定位（不应发生，仅兜底）
    ztoolkit.log("[AIOCR] preflight: toolkit Dialog unavailable, auto-detect");
    return { pages: [] };
  }

  // 弹窗关闭/确认后立即中止缩略图渲染——流水线必须等渲染彻底收尾才能启动
  let aborted = false;
  const dialogData: any = {
    tocPages: "",
    confirmed: false,
    // 弹窗以任意方式关闭（取消 / 右上角 X / Esc）时都要中止缩略图渲染
    beforeUnloadCallback: () => {
      aborted = true;
    },
  };
  // 单格栅格：DialogHelper 的行/列是 XUL box 且 flex=1 均分窗口高度，
  // 多行会把内容挤压缩水；布局全部由挂载点内的自建 HTML 接管
  const helper = new DialogCtor(1, 1);
  helper.setDialogData(dialogData);

  const defaultHint = getString("toc-preflight-hint-auto", {
    args: { engine: engineName },
  });

  // 自建控件引用（loadCallback 中创建后直接持有，零查询依赖）
  let ui: { doc: any; input: any; grid: any; hint: any } | null = null;
  let hintState: "rendering" | "default" | "invalid" = "default";
  const selected = new Set<number>();
  let renderThumbsPromise: Promise<void> = Promise.resolve();

  const showHint = (text: string, color: string, state: any) => {
    hintState = state;
    if (ui?.hint) {
      ui.hint.textContent = text;
      ui.hint.style.color = color;
    }
  };

  const syncInputFromSelection = () => {
    if (ui?.input) ui.input.value = pagesToRangeText(Array.from(selected));
    if (hintState === "invalid") {
      showHint(defaultHint, "#666", "default");
    }
  };

  const buildThumb = (page: number, jpegBase64: string) => {
    if (!ui?.grid || !ui.doc) return;
    const doc = ui.doc;
    const wrap = doc.createElement("div");
    wrap.className =
      "aiocr-thumb" + (selected.has(page) ? " aiocr-thumb-selected" : "");
    wrap.dataset.page = String(page);
    const img = doc.createElement("img");
    img.src = `data:image/jpeg;base64,${jpegBase64}`;
    img.draggable = false;
    const badge = doc.createElement("span");
    badge.className = "aiocr-page-num";
    badge.textContent = String(page);
    wrap.appendChild(img);
    wrap.appendChild(badge);
    wrap.addEventListener("click", () => {
      if (selected.has(page)) selected.delete(page);
      else selected.add(page);
      wrap.classList.toggle("aiocr-thumb-selected", selected.has(page));
      syncInputFromSelection();
    });
    ui.grid.appendChild(wrap);
  };

  const renderThumbs = async () => {
    // 预打开的后台阅读器（本函数负责关闭）；已打开则全程复用
    let openedReader: any = null;
    try {
      if (aborted) return;
      const filePath = await attachment.getFilePathAsync();
      if (!filePath) throw new Error(getString("error-toc-no-pdf"));
      const thumbPages: number[] = [];
      for (let p = 1; p <= Math.min(PREFLIGHT_THUMB_PAGES, pageCount); p++) {
        thumbPages.push(p);
      }
      const total = thumbPages.length;
      showHint(
        getString("toc-preflight-rendering", { args: { current: 0, total } }),
        "#666",
        "rendering",
      );
      ztoolkit.log(`[AIOCR] preflight: rendering ${total} thumbnails`);

      // 后台预开阅读器：所有分块渲染复用同一实例，避免每块重复开关
      try {
        if (!isReaderOpenForAttachment(attachment.id)) {
          openedReader = await Zotero.Reader.open(attachment.id, undefined, {
            openInBackground: true,
          } as any);
          if (openedReader?._initPromise) {
            await openedReader._initPromise;
          }
        }
      } catch (e: any) {
        ztoolkit.log(
          `[AIOCR] preflight: background reader open failed (${e.message}), rendering will self-manage`,
        );
        openedReader = null;
      }

      let done = 0;
      for (let i = 0; i < thumbPages.length; i += PREFLIGHT_RENDER_CHUNK) {
        if (aborted) return;
        const chunk = thumbPages.slice(i, i + PREFLIGHT_RENDER_CHUNK);
        // 缩略图用低分辨率渲染（渲染量约为 OCR 全稿的 1/10），不影响 OCR 链路
        const rendered = await renderPagesToJpegs(
          filePath,
          attachment.id,
          chunk,
          PREFLIGHT_THUMB_LONG_EDGE,
          PREFLIGHT_THUMB_RENDER_SCALE,
        );
        if (aborted) return;
        for (const [page, b64] of rendered) {
          buildThumb(page, b64);
        }
        done += chunk.length;
        if (hintState === "rendering") {
          showHint(
            getString("toc-preflight-rendering", {
              args: { current: Math.min(done, total), total },
            }),
            "#666",
            "rendering",
          );
        }
      }
      if (!ui?.grid || ui.grid.childElementCount === 0) {
        throw new Error("no thumbnail rendered");
      }
      if (hintState === "rendering") {
        showHint(defaultHint, "#666", "default");
      }
      ztoolkit.log("[AIOCR] preflight: thumbnails done");
    } catch (e: any) {
      if (!aborted) {
        showHint(`缩略图渲染失败：${e.message}`, "#d9534f", "invalid");
      }
      ztoolkit.log(
        `[AIOCR] preflight thumbnails failed: ${e.message}\n${e.stack || ""}`,
      );
    } finally {
      try {
        openedReader?.close?.();
      } catch {
        /* ignore */
      }
    }
  };

  const onOk = () => {
    // 直接读取输入框当前值并显式写入 dialogData（不依赖 data-bind 回写）
    const text = String(ui?.input?.value ?? dialogData.tocPages ?? "").trim();
    if (text) dialogData.tocPages = text;
    if (text && parsePageRange(text, pageCount).length === 0) {
      hintState = "invalid";
      if (ui?.hint) {
        ui.hint.textContent = getString("toc-preflight-invalid");
        ui.hint.style.color = "#d9534f";
      }
      return; // 校验失败不关窗
    }
    aborted = true;
    dialogData.confirmed = true;
    ztoolkit.log(
      `[AIOCR] preflight: confirmed, pages text = "${text || "(empty -> auto)"}"`,
    );
    try {
      helper.window.close();
    } catch (e: any) {
      ztoolkit.log(`[AIOCR] preflight: close failed: ${e.message}`);
    }
  };

  // loadCallback 由 DialogHelper 在 elementProps 注入完成后调用。
  // 交互控件全部在此亲手创建并持有引用——即使 toolkit 注入元素的
  // id/属性因版本差异不可查询，也不影响本弹窗工作。
  dialogData.loadCallback = () => {
    (async () => {
      try {
        const win = helper.window as any;
        const doc = win?.document;
        if (!doc) {
          ztoolkit.log("[AIOCR] preflight: loadCallback without document");
          return;
        }
        // 挂载点查找带重试，防御各 Zotero 版本的注入时序差异
        let mount: any = null;
        for (let i = 0; i < PREFLIGHT_MOUNT_RETRY; i++) {
          mount = doc.getElementById(PREFLIGHT_MOUNT_ID);
          if (mount) break;
          await sleep(PREFLIGHT_MOUNT_RETRY_DELAY);
        }
        const diag = `doc.title="${doc.title}", body.children=${doc.body?.children?.length ?? "?"}, mount=${!!mount}`;
        if (!mount) {
          ztoolkit.log(
            `[AIOCR] preflight: mount not found after retries: ${diag}`,
          );
          failToast(
            `目录选择弹窗初始化失败（挂载点未找到）。将以 AI 自动定位继续。`,
          );
          return;
        }
        ztoolkit.log(`[AIOCR] preflight: mount found: ${diag}`);

        // 亲手创建控件并持有引用（sumatra-pdf-plus 式竖排布局：
        // 标题 → 输入框 → 提示行 → 平铺网格填满剩余高度，仅网格内部纵向滚动）
        const labelEl = doc.createElement("div");
        labelEl.textContent = getString("toc-preflight-desc");
        labelEl.style.cssText = "font-weight:bold;margin-bottom:8px;";
        const inputEl = doc.createElement("input");
        inputEl.type = "text";
        inputEl.placeholder = getString("toc-preflight-placeholder");
        inputEl.style.cssText =
          "width:100%;box-sizing:border-box;padding:4px 8px;margin-bottom:8px;";
        const hintEl = doc.createElement("div");
        hintEl.textContent = defaultHint;
        hintEl.style.cssText =
          "color:#666;font-size:12px;white-space:pre-wrap;margin-bottom:8px;";
        const gridEl = doc.createElement("div");
        gridEl.style.cssText =
          "display:flex;flex-wrap:wrap;gap:10px;align-content:flex-start;" +
          "width:100%;overflow-y:auto;overflow-x:hidden;" +
          "border:1px solid #ccc;border-radius:4px;padding:8px;background:#fff;box-sizing:border-box;";

        const style = doc.createElement("style");
        style.textContent = `
#aiocr-preflight-mount { display:flex; flex-direction:column; width:100%; height:100%; box-sizing:border-box; }
#aiocr-preflight-mount #aiocr-thumb-grid { flex: 1 1 auto; min-height: 220px; }
#aiocr-preflight-mount .aiocr-thumb {
  position: relative;
  width: 200px;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  background: #fff;
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.25);
  box-sizing: border-box;
  flex: 0 0 auto;
}
#aiocr-preflight-mount .aiocr-thumb:hover { border-color: #9dbeda; }
#aiocr-preflight-mount .aiocr-thumb.aiocr-thumb-selected { border-color: #2264ab; }
#aiocr-preflight-mount .aiocr-thumb img { display: block; width: 100%; }
#aiocr-preflight-mount .aiocr-thumb .aiocr-page-num {
  position: absolute;
  left: 50%;
  bottom: 4px;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.9);
  border-radius: 3px;
  padding: 0 5px;
  font-size: 11px;
  pointer-events: none;
}
`;
        doc.head.appendChild(style);

        mount.appendChild(labelEl);
        mount.appendChild(inputEl);
        mount.appendChild(hintEl);
        mount.appendChild(gridEl);

        // 网格高度动态填满剩余空间（DialogHelper 的 XUL 栅格下百分比高度不可靠，
        // 直接按按钮栏顶边实测计算，窗口拉伸时跟随）
        const layoutGrid = () => {
          try {
            if (win.closed || !gridEl) return;
            const btnBar = doc.querySelector('hbox[pack="end"]');
            const gridTop = gridEl.getBoundingClientRect().top;
            const btnTop = btnBar
              ? btnBar.getBoundingClientRect().top
              : win.innerHeight - 60;
            const h = Math.max(220, Math.round(btnTop - gridTop - 12));
            gridEl.style.height = `${h}px`;
          } catch {
            /* ignore */
          }
        };
        layoutGrid();
        win.addEventListener("resize", layoutGrid);

        ui = { doc, input: inputEl, grid: gridEl, hint: hintEl };
        ztoolkit.log("[AIOCR] preflight: controls created");

        // 输入框 → 缩略图选中态（每键入一次同步一次）
        inputEl.addEventListener("input", () => {
          dialogData.tocPages = String(inputEl.value);
          const pages = new Set(
            parsePageRange(String(inputEl.value), pageCount),
          );
          selected.clear();
          for (const p of pages) selected.add(p);
          const thumbEls = Array.from(
            gridEl.querySelectorAll(".aiocr-thumb"),
          ) as HTMLElement[];
          for (const el of thumbEls) {
            const page = Number(el.dataset.page);
            el.classList.toggle("aiocr-thumb-selected", selected.has(page));
          }
          if (hintState === "invalid") {
            showHint(defaultHint, "#666", "default");
          }
        });

        renderThumbsPromise = renderThumbs();
      } catch (e: any) {
        ztoolkit.log(
          `[AIOCR] preflight loadCallback failed: ${e.message}\n${e.stack || ""}`,
        );
        failToast(`目录选择弹窗初始化失败：${e.message}`);
      }
    })();
  };

  // 「AI 定位目录页」：清空手选页码，直接进入 AI 自动定位流程
  const onAutoDetect = () => {
    aborted = true;
    dialogData.tocPages = "";
    dialogData.confirmed = true;
    ztoolkit.log("[AIOCR] preflight: auto-detect requested by user");
    try {
      helper.window.close();
    } catch (e: any) {
      ztoolkit.log(`[AIOCR] preflight: close failed: ${e.message}`);
    }
  };

  helper.addButton(getString("toc-preflight-auto"), "auto", {
    noClose: true,
    callback: () => onAutoDetect(),
  });
  helper.addButton(getString("toc-preflight-cancel"), "cancel");
  helper.addButton(getString("toc-preflight-start"), "ok", {
    noClose: true,
    callback: () => onOk(),
  });

  // 唯一栅格 = 挂载点；标题/输入框/提示/网格全部由 loadCallback 在挂载点内自建
  helper.addCell(
    0,
    0,
    {
      tag: "div",
      attributes: { id: PREFLIGHT_MOUNT_ID },
      styles: { width: "100%", height: "100%" },
    },
    true,
  );

  helper.open(getString("toc-preflight-title"), {
    width: 780,
    height: 660,
    centerscreen: true,
    resizable: true,
    noDialogMode: true,
  });
  ztoolkit.log("[AIOCR] preflight: dialog opened");

  await dialogData.unloadLock.promise;
  // 串行化：等缩略图渲染（含其阅读器）彻底收尾后，再把页码交给流水线，
  // 避免两条 pdf.js 渲染链路共用/争抢同一阅读器实例导致渲染悬挂
  await Promise.race([
    renderThumbsPromise.catch(() => {}),
    sleep(90000), // 渲染内部各环节均有超时上限，此处仅作兜底
  ]);
  if (!dialogData.confirmed) {
    ztoolkit.log("[AIOCR] preflight: cancelled by user");
    return null;
  }
  // 输入框值在每次键入与确认时都已显式写入 dialogData.tocPages
  const pages = parsePageRange(String(dialogData.tocPages || ""), pageCount);
  ztoolkit.log(
    `[AIOCR] preflight: returning pages = [${pages.join(", ")}]${pages.length ? "" : " (auto-detect)"}`,
  );
  return { pages };
}
