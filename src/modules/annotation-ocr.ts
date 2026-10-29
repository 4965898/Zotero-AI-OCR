import {
  performOCR,
  EngineType,
  ENGINE_MODELS,
  OcrCancelledError,
  resetOcrCancellation,
  isOcrCancelled,
} from "./ocr-engine";
import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";

export function registerAnnotationOCR() {
  if (typeof Zotero.Reader?.registerEventListener !== "function") {
    ztoolkit.log("[AIOCR] Zotero.Reader.registerEventListener not available");
    return;
  }

  // Register OCR option in the annotation context menu (three-dot "more" menu)
  Zotero.Reader.registerEventListener(
    "createAnnotationContextMenu",
    (event: any) => {
      const { reader, params, append } = event;
      const attachmentItem = reader._item;
      if (!attachmentItem) return;

      // Look up the annotation to check if it's an image annotation
      const annotation = Zotero.Items.getByLibraryAndKey(
        attachmentItem.libraryID,
        params.currentID,
      );

      if (
        !annotation ||
        !annotation.isAnnotation() ||
        annotation.annotationType !== "image"
      ) {
        return;
      }

      // MinerU doesn't support image annotation OCR
      const engine = (getPref("engine") as string) || "PP-OCRv6";
      const modelConfig = ENGINE_MODELS[engine as EngineType] as any;
      if (modelConfig && modelConfig.platform === "mineru") {
        return;
      }

      append({
        label: getString("menuitem-annotation-ocr"),
        onCommand: () => {
          handleSingleAnnotationOCR(
            {
              id: annotation.key,
              libraryID: annotation.libraryID,
            },
            reader,
          ).catch((err: any) => {
            ztoolkit.log(
              `[AIOCR] Annotation OCR failed (context menu): ${err.message}`,
            );
          });
        },
      });
    },
    addon.data.config.addonID,
  );

  // Register OCR button in the annotation sidebar header
  Zotero.Reader.registerEventListener(
    "renderSidebarAnnotationHeader",
    (event: any) => {
      const { reader, doc, params, append } = event;
      if (params.annotation.type !== "image") return;

      const btn = doc.createElement("button");
      btn.className = "aiocr-annotation-btn";
      btn.textContent = "OCR";
      btn.style.cssText =
        "margin-left:4px;padding:0;width:22px;height:22px;font-size:9px;" +
        "border-radius:2px;border:1px solid #bbb;background:#f5f5f5;" +
        "cursor:pointer;color:#555;display:inline-flex;align-items:center;" +
        "justify-content:center;line-height:1;";

      btn.addEventListener("click", async (e: Event) => {
        // Wrap stopPropagation in try/catch for cross-compartment safety
        try {
          e.stopPropagation();
          e.preventDefault();
        } catch {
          // ignore
        }
        btn.disabled = true;
        btn.textContent = "⏳";
        try {
          await handleSingleAnnotationOCR(params.annotation, reader);
          btn.textContent = "✓";
        } catch (err: any) {
          btn.textContent = "✗";
          ztoolkit.log(`[AIOCR] Annotation OCR failed: ${err.message}`);
        }
        setTimeout(() => {
          btn.textContent = "OCR";
          btn.disabled = false;
        }, 2000);
      });

      append(btn);
    },
    addon.data.config.addonID,
  );

  ztoolkit.log(
    "[AIOCR] Annotation OCR registered (context menu + sidebar header)",
  );
}

/**
 * 依次尝试三个来源获取注释图片的 base64：
 * 注释 JSON 自带的 data URI → Zotero.Annotations.toJSON → 缓存图片文件。
 */
async function getAnnotationImageBase64(
  annotation: any,
  annotationJson?: { image?: string },
): Promise<string | null> {
  if (annotationJson?.image) {
    const b64 = extractBase64FromDataUri(annotationJson.image);
    if (b64) return b64;
  }

  try {
    const annotationData = await Zotero.Annotations.toJSON(annotation);
    if (annotationData.image) {
      const b64 = extractBase64FromDataUri(annotationData.image);
      if (b64) return b64;
    }
  } catch (e: any) {
    ztoolkit.log(
      `[AIOCR] Failed to get annotation image via toJSON: ${e.message}`,
    );
  }

  try {
    const cachePath = Zotero.Annotations.getCacheImagePath({
      libraryID: annotation.libraryID,
      key: annotation.key,
    });
    const exists = await IOUtils.exists(cachePath);
    if (exists) {
      const bytes = await IOUtils.read(cachePath);
      return uint8ArrayToBase64(bytes);
    }
  } catch (e: any) {
    ztoolkit.log(`[AIOCR] Failed to read cache image: ${e.message}`);
  }

  return null;
}

/** 把 OCR 结果以统一格式追加到注释评论（保留已有评论） */
function appendOcrComment(
  annotation: any,
  ocrText: string,
  engineLabel: string,
) {
  const commentPrefix = `<strong>OCR (${engineLabel}):</strong><br/>`;
  const existingComment = annotation.annotationComment || "";
  annotation.annotationComment = existingComment
    ? existingComment + "<br/><br/>" + commentPrefix + markdownToHTML(ocrText)
    : commentPrefix + markdownToHTML(ocrText);
}

/** 临时 PNG 写入 + OCR + 清理的公共流程，返回识别文本 */
async function ocrAnnotationImage(
  annotation: any,
  imageBase64: string,
): Promise<string> {
  const tempDir = PathUtils.join(PathUtils.tempDir, "aiocr-annotation");
  await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });
  const tempPath = PathUtils.join(
    tempDir,
    `annotation-${annotation.key}-${Date.now()}.png`,
  );

  try {
    const binaryString = atob(imageBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let j = 0; j < binaryString.length; j++) {
      bytes[j] = binaryString.charCodeAt(j);
    }
    await IOUtils.write(tempPath, bytes);

    const result = await performOCR(tempPath, false);
    const ocrText = result.fullMarkdown.trim();
    if (!ocrText) {
      throw new Error("OCR result is empty");
    }
    return ocrText;
  } finally {
    try {
      await IOUtils.remove(tempPath, { ignoreAbsent: true });
    } catch {
      /* ignore */
    }
  }
}

async function handleSingleAnnotationOCR(
  annotationJson: { id: string; libraryID: number; image?: string },
  reader: any,
): Promise<void> {
  resetOcrCancellation();

  const attachmentItem = reader._item;
  if (!attachmentItem) {
    throw new Error("Cannot find attachment item");
  }

  // annotationJson.id is always the Zotero item key (8-char alphanumeric string)
  // Use getByLibraryAndKey directly — never parseInt (keys starting with digits
  // would cause parseInt to return a wrong numeric item ID)
  const libraryID = annotationJson.libraryID || attachmentItem.libraryID;
  const annotation = Zotero.Items.getByLibraryAndKey(
    libraryID,
    annotationJson.id,
  );

  if (
    !annotation ||
    !annotation.isAnnotation() ||
    annotation.annotationType !== "image"
  ) {
    throw new Error(getString("progress-annotation-no-image"));
  }

  const engine = (getPref("engine") as string) || "PP-OCRv6";
  const modelConfig = ENGINE_MODELS[engine as EngineType] as any;
  const isMinerU = modelConfig && modelConfig.platform === "mineru";

  if (isMinerU) {
    throw new Error(getString("progress-annotation-mineru-unsupported"));
  }

  const progressWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("progress-annotation-ocr-start", {
        args: { total: "1" },
      }),
      type: "default",
      progress: 0,
    })
    .show();

  try {
    progressWin.changeLine({
      text: getString("progress-annotation-ocr-item", {
        args: { current: "1", total: "1" },
      }),
      progress: 50,
    });

    const imageBase64 = await getAnnotationImageBase64(
      annotation,
      annotationJson,
    );
    if (!imageBase64) {
      throw new Error(getString("progress-annotation-no-image"));
    }

    const ocrText = await ocrAnnotationImage(annotation, imageBase64);
    appendOcrComment(annotation, ocrText, engine);
    await annotation.saveTx();

    progressWin.changeLine({
      text: getString("progress-annotation-ocr-done", {
        args: { success: "1", failed: "0" },
      }),
      type: "success",
      progress: 100,
    });
  } catch (e: any) {
    if (e instanceof OcrCancelledError) {
      progressWin.changeLine({
        text: getString("progress-cancelled"),
        type: "default",
        progress: 100,
      });
    } else {
      progressWin.changeLine({
        text: getString("progress-annotation-ocr-done", {
          args: { success: "0", failed: "1" },
        }),
        type: "fail",
        progress: 100,
      });
    }
    throw e;
  }

  progressWin.startCloseTimer(3000);
}

/**
 * 批量识别所选条目（含其子附件）的全部图片注释，结果逐一追加到注释评论。
 * 单条失败不中断，最后汇总成功/失败数。
 */
export async function handleBatchAnnotationsOCR(): Promise<void> {
  resetOcrCancellation();

  const engine = (getPref("engine") as string) || "PP-OCRv6";
  const modelConfig = ENGINE_MODELS[engine as EngineType] as any;
  if (modelConfig && modelConfig.platform === "mineru") {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-annotation-mineru-unsupported"),
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  // 收集所选条目的图片注释，按 key 去重。
  // 注释挂在附件之下：选中常规条目时遍历其子附件；选中附件时直接取自身。
  const pane = Zotero.getActiveZoteroPane();
  const selectedItems = pane ? pane.getSelectedItems() : [];
  const annotations: any[] = [];
  const seen = new Set<string>();
  for (const item of selectedItems) {
    if (!item || item.isNote()) continue;

    const sources: Zotero.Item[] = [];
    if (item.isAttachment()) {
      sources.push(item);
    } else {
      for (const id of item.getAttachments()) {
        const att = Zotero.Items.get(id);
        if (att && att.isAttachment()) {
          sources.push(att);
        }
      }
    }

    for (const source of sources) {
      let itemAnnotations: any[] = [];
      try {
        itemAnnotations = source.getAnnotations(false) || [];
      } catch {
        continue;
      }
      for (const annotation of itemAnnotations) {
        if (
          !annotation ||
          !annotation.isAnnotation() ||
          annotation.annotationType !== "image"
        ) {
          continue;
        }
        const dedupKey = `${annotation.libraryID}/${annotation.key}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        annotations.push(annotation);
      }
    }
  }

  if (annotations.length === 0) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-annotation-none-found"),
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  const total = annotations.length;
  let success = 0;
  let failed = 0;
  const progressWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("progress-annotation-ocr-start", {
        args: { total: String(total) },
      }),
      type: "default",
      progress: 0,
    })
    .show();

  for (let i = 0; i < total; i++) {
    if (isOcrCancelled()) {
      progressWin.changeLine({
        text: getString("progress-cancelled"),
        type: "default",
        progress: 100,
      });
      progressWin.startCloseTimer(3000);
      return;
    }

    const annotation = annotations[i];
    progressWin.changeLine({
      text: getString("progress-annotation-ocr-item", {
        args: { current: String(i + 1), total: String(total) },
      }),
      progress: Math.round((i / total) * 100),
    });

    try {
      const imageBase64 = await getAnnotationImageBase64(annotation);
      if (!imageBase64) {
        throw new Error(getString("progress-annotation-no-image"));
      }

      const ocrText = await ocrAnnotationImage(annotation, imageBase64);
      appendOcrComment(annotation, ocrText, engine);
      await annotation.saveTx();
      success++;
    } catch (e: any) {
      ztoolkit.log(
        `[AIOCR] Batch annotation OCR failed for ${annotation.key}: ${e.message}`,
      );
      failed++;
    }
  }

  progressWin.changeLine({
    text: getString("progress-annotation-ocr-done", {
      args: { success: String(success), failed: String(failed) },
    }),
    type: failed > 0 ? "fail" : "success",
    progress: 100,
  });
  progressWin.startCloseTimer(3000);
}

function extractBase64FromDataUri(dataUri: string): string | null {
  if (!dataUri || !dataUri.startsWith("data:")) return null;
  const commaIndex = dataUri.indexOf(",");
  if (commaIndex !== -1) {
    return dataUri.substring(commaIndex + 1);
  }
  return null;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function markdownToHTML(md: string): string {
  let html = md;
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`(.+?)`/g, "<code>$1</code>");
  html = html.replace(/^---$/gm, "<hr/>");
  html = html.replace(/\n\n/g, "</p><p>");
  html = html.replace(/\n/g, "<br/>");
  html = `<p>${html}</p>`;

  return html;
}
