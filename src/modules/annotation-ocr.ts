import { performOCR, EngineType, ENGINE_MODELS } from "./ocr-engine";
import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";

export function registerAnnotationOCR() {
  if (typeof Zotero.Reader?.registerEventListener !== "function") {
    ztoolkit.log(
      "[AIOCR] Zotero.Reader.registerEventListener not available",
    );
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

async function handleSingleAnnotationOCR(
  annotationJson: { id: string; libraryID: number; image?: string },
  reader: any,
): Promise<void> {
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
    let imageBase64: string | null = null;

    // Try using the image data URI from the annotation JSON directly
    // (params.annotation.image is already populated by Zotero.Annotations.toJSON)
    if (annotationJson.image) {
      imageBase64 = extractBase64FromDataUri(annotationJson.image);
    }

    // Fall back to toJSON if the JSON didn't include image data
    if (!imageBase64) {
      try {
        const annotationData = await Zotero.Annotations.toJSON(annotation);
        if (annotationData.image) {
          imageBase64 = extractBase64FromDataUri(annotationData.image);
        }
      } catch (e: any) {
        ztoolkit.log(
          `[AIOCR] Failed to get annotation image via toJSON: ${e.message}`,
        );
      }
    }

    if (!imageBase64) {
      try {
        const cachePath = Zotero.Annotations.getCacheImagePath({
          libraryID: annotation.libraryID,
          key: annotation.key,
        });
        const exists = await IOUtils.exists(cachePath);
        if (exists) {
          const bytes = await IOUtils.read(cachePath);
          imageBase64 = uint8ArrayToBase64(bytes);
        }
      } catch (e: any) {
        ztoolkit.log(`[AIOCR] Failed to read cache image: ${e.message}`);
      }
    }

    if (!imageBase64) {
      throw new Error(getString("progress-annotation-no-image"));
    }

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

      progressWin.changeLine({
        text: getString("progress-annotation-ocr-item", {
          args: { current: "1", total: "1" },
        }),
        progress: 50,
      });

      const result = await performOCR(tempPath, false);

      const ocrText = result.fullMarkdown.trim();
      if (!ocrText) {
        throw new Error("OCR result is empty");
      }

      const engineLabel = result.engine;
      const commentPrefix = `<strong>OCR (${engineLabel}):</strong><br/>`;
      const existingComment = annotation.annotationComment || "";

      let newComment: string;
      if (existingComment) {
        newComment =
          existingComment +
          "<br/><br/>" +
          commentPrefix +
          markdownToHTML(ocrText);
      } else {
        newComment = commentPrefix + markdownToHTML(ocrText);
      }

      annotation.annotationComment = newComment;
      await annotation.saveTx();

      progressWin.changeLine({
        text: getString("progress-annotation-ocr-done", {
          args: { success: "1", failed: "0" },
        }),
        type: "success",
        progress: 100,
      });
    } finally {
      try {
        await IOUtils.remove(tempPath, { ignoreAbsent: true });
      } catch {
        /* ignore */
      }
    }
  } catch (e: any) {
    progressWin.changeLine({
      text: getString("progress-annotation-ocr-done", {
        args: { success: "0", failed: "1" },
      }),
      type: "fail",
      progress: 100,
    });
    throw e;
  }

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
