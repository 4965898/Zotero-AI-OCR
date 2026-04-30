import {
  getPref,
  getActiveEndpoint,
  getEnabledAdvancedFeatures,
} from "../utils/prefs";
import { getString } from "../utils/locale";

export const ENGINE_MODELS = {
  "PP-OCRv5": {
    name: "PP-OCRv5",
    description: "基础文字识别",
    platform: "paddleocr" as const,
    syncPath: "/ocr",
    asyncModelName: "PP-OCRv5",
    responseType: "ocrResults",
  },
  "PP-StructureV3": {
    name: "PP-StructureV3",
    description: "文档结构解析",
    platform: "paddleocr" as const,
    syncPath: "/layout-parsing",
    asyncModelName: "PP-StructureV3",
    responseType: "layoutParsingResults",
  },
  "PaddleOCR-VL": {
    name: "PaddleOCR-VL",
    description: "视觉语言模型",
    platform: "paddleocr" as const,
    syncPath: "/layout-parsing",
    asyncModelName: "PaddleOCR-VL",
    responseType: "layoutParsingResults",
  },
  "PaddleOCR-VL-1.5": {
    name: "PaddleOCR-VL-1.5",
    description: "增强视觉语言模型",
    platform: "paddleocr" as const,
    syncPath: "/layout-parsing",
    asyncModelName: "PaddleOCR-VL-1.5",
    responseType: "layoutParsingResults",
  },
  "MinerU-pipeline": {
    name: "MinerU-pipeline",
    description: "MinerU 文档解析 (pipeline)",
    platform: "mineru" as const,
    modelVersion: "pipeline",
  },
  "MinerU-vlm": {
    name: "MinerU-vlm",
    description: "MinerU 文档解析 (vlm推荐)",
    platform: "mineru" as const,
    modelVersion: "vlm",
  },
  "MinerU-HTML": {
    name: "MinerU-HTML",
    description: "MinerU HTML 解析",
    platform: "mineru" as const,
    modelVersion: "MinerU-HTML",
  },
} as const;

export type EngineType = keyof typeof ENGINE_MODELS;

export const ENGINE_ADVANCED_FEATURES: {
  [engine: string]: {
    key: string;
    labelKey: string;
    defaultValue: boolean;
  }[];
} = {
  "PP-OCRv5": [
    {
      key: "useDocOrientationClassify",
      labelKey: "advanced-useDocOrientationClassify",
      defaultValue: false,
    },
    {
      key: "useDocUnwarping",
      labelKey: "advanced-useDocUnwarping",
      defaultValue: false,
    },
    {
      key: "useTextlineOrientation",
      labelKey: "advanced-useTextlineOrientation",
      defaultValue: false,
    },
  ],
  "PP-StructureV3": [
    {
      key: "useDocOrientationClassify",
      labelKey: "advanced-useDocOrientationClassify",
      defaultValue: false,
    },
    {
      key: "useDocUnwarping",
      labelKey: "advanced-useDocUnwarping",
      defaultValue: false,
    },
    {
      key: "useTextlineOrientation",
      labelKey: "advanced-useTextlineOrientation",
      defaultValue: false,
    },
    {
      key: "useChartRecognition",
      labelKey: "advanced-useChartRecognition",
      defaultValue: false,
    },
    {
      key: "useSealRecognition",
      labelKey: "advanced-useSealRecognition",
      defaultValue: false,
    },
    {
      key: "useTableRecognition",
      labelKey: "advanced-useTableRecognition",
      defaultValue: true,
    },
    {
      key: "useFormulaRecognition",
      labelKey: "advanced-useFormulaRecognition",
      defaultValue: true,
    },
    {
      key: "useRegionDetection",
      labelKey: "advanced-useRegionDetection",
      defaultValue: true,
    },
  ],
  "PaddleOCR-VL": [
    {
      key: "useDocOrientationClassify",
      labelKey: "advanced-useDocOrientationClassify",
      defaultValue: false,
    },
    {
      key: "useDocUnwarping",
      labelKey: "advanced-useDocUnwarping",
      defaultValue: false,
    },
    {
      key: "useLayoutDetection",
      labelKey: "advanced-useLayoutDetection",
      defaultValue: false,
    },
    {
      key: "useChartRecognition",
      labelKey: "advanced-useChartRecognition",
      defaultValue: false,
    },
  ],
  "PaddleOCR-VL-1.5": [
    {
      key: "useDocOrientationClassify",
      labelKey: "advanced-useDocOrientationClassify",
      defaultValue: false,
    },
    {
      key: "useDocUnwarping",
      labelKey: "advanced-useDocUnwarping",
      defaultValue: false,
    },
    {
      key: "useChartRecognition",
      labelKey: "advanced-useChartRecognition",
      defaultValue: false,
    },
  ],
  "MinerU-pipeline": [
    {
      key: "is_ocr",
      labelKey: "advanced-mineru-isOcr",
      defaultValue: false,
    },
    {
      key: "enable_formula",
      labelKey: "advanced-mineru-enableFormula",
      defaultValue: true,
    },
    {
      key: "enable_table",
      labelKey: "advanced-mineru-enableTable",
      defaultValue: true,
    },
  ],
  "MinerU-vlm": [
    {
      key: "is_ocr",
      labelKey: "advanced-mineru-isOcr",
      defaultValue: false,
    },
    {
      key: "enable_formula",
      labelKey: "advanced-mineru-enableFormula",
      defaultValue: true,
    },
    {
      key: "enable_table",
      labelKey: "advanced-mineru-enableTable",
      defaultValue: true,
    },
  ],
  "MinerU-HTML": [],
};

export interface OCRBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface OCRPageResult {
  pageNumber: number;
  markdown: string;
  plainText: string;
  blocks: OCRBlock[];
}

export interface OCRResult {
  engine: string;
  pages: OCRPageResult[];
  fullMarkdown: string;
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

async function readFileAsBase64(filePath: string): Promise<string> {
  const bytes = await IOUtils.read(filePath);
  return uint8ArrayToBase64(bytes);
}

function buildSyncPayload(
  engine: EngineType,
  fileBase64: string,
  isPdf: boolean,
  advancedFeatures: { [key: string]: boolean },
) {
  const payload: Record<string, any> = {
    file: fileBase64,
    fileType: isPdf ? 0 : 1,
  };
  for (const [key, value] of Object.entries(advancedFeatures)) {
    payload[key] = value;
  }
  return payload;
}

function parseSyncResponse(
  engine: EngineType,
  responseData: any,
): OCRPageResult[] {
  const modelConfig = ENGINE_MODELS[engine];
  const results: OCRPageResult[] = [];

  if (modelConfig.responseType === "ocrResults") {
    const ocrResults = responseData.ocrResults || [];
    for (let i = 0; i < ocrResults.length; i++) {
      const res = ocrResults[i];
      const prunedResult = res.prunedResult || {};
      let plainText = "";
      const blocks: OCRBlock[] = [];

      if (Array.isArray(prunedResult.textDetResults)) {
        for (const det of prunedResult.textDetResults) {
          if (det.text) {
            plainText += det.text + "\n";
            if (det.textRegion && det.textRegion.length >= 4) {
              const pts = det.textRegion;
              const xs = pts.map((p: number[]) => p[0]);
              const ys = pts.map((p: number[]) => p[1]);
              blocks.push({
                text: det.text,
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys),
                confidence: det.score || 0,
              });
            }
          }
        }
      } else if (typeof prunedResult === "object") {
        plainText = extractTextFromPrunedResult(prunedResult);
      }

      results.push({
        pageNumber: i + 1,
        markdown: plainText,
        plainText,
        blocks,
      });
    }
  } else {
    const layoutResults = responseData.layoutParsingResults || [];
    for (let i = 0; i < layoutResults.length; i++) {
      const res = layoutResults[i];
      const md = res.markdown || {};
      const markdownText = md.text || "";
      results.push({
        pageNumber: i + 1,
        markdown: markdownText,
        plainText: markdownText,
        blocks: [],
      });
    }
  }

  return results;
}

function extractTextFromPrunedResult(prunedResult: any): string {
  if (typeof prunedResult === "string") return prunedResult;
  if (Array.isArray(prunedResult)) {
    return prunedResult
      .map((item: any) => {
        if (typeof item === "string") return item;
        if (item.text) return item.text;
        return JSON.stringify(item);
      })
      .join("\n");
  }
  if (prunedResult.text) return prunedResult.text;
  return JSON.stringify(prunedResult, null, 2);
}

async function callSyncAPI(
  engine: EngineType,
  filePath: string,
  isPdf: boolean,
  onProgress?: (current: number, total: number) => void,
): Promise<OCRPageResult[]> {
  const endpoint = getActiveEndpoint(engine);
  if (!endpoint) {
    throw new Error(
      `No API endpoint configured for ${engine}. Please configure one in the preferences.`,
    );
  }

  const modelConfig = ENGINE_MODELS[engine];
  const advancedFeatures = getEnabledAdvancedFeatures(engine);
  const fileBase64 = await readFileAsBase64(filePath);
  const payload = buildSyncPayload(engine, fileBase64, isPdf, advancedFeatures);

  const url = endpoint.url + modelConfig.syncPath;

  const response = await Zotero.HTTP.request("POST", url, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${endpoint.token}`,
    },
    responseType: "json",
    timeout: 300000,
  });

  const responseData = response.response;
  if (responseData.errorCode && responseData.errorCode !== 0) {
    throw new Error(responseData.errorMsg || "API request failed");
  }

  const result = responseData.result || responseData;
  return parseSyncResponse(engine, result);
}

const ASYNC_JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";

function buildMultipartBody(
  fileBytes: Uint8Array,
  fileName: string,
  fields: Record<string, string>,
): { body: Uint8Array; contentType: string } {
  const encoder = new TextEncoder();
  const boundary = "----ZoteroOCR" + Date.now().toString(36);
  const parts: Uint8Array[] = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  parts.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
  );
  parts.push(fileBytes);
  parts.push(encoder.encode("\r\n"));
  parts.push(encoder.encode(`--${boundary}--\r\n`));

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function callAsyncAPI(
  engine: EngineType,
  filePath: string,
  isPdf: boolean,
  onProgress?: (current: number, total: number) => void,
): Promise<OCRPageResult[]> {
  const endpoint = getActiveEndpoint(engine);
  if (!endpoint) {
    throw new Error(
      `No API endpoint configured for ${engine}. Please configure one in the preferences.`,
    );
  }

  const modelConfig = ENGINE_MODELS[engine];
  const advancedFeatures = getEnabledAdvancedFeatures(engine);

  const fileBytes = await IOUtils.read(filePath);
  const fileName = isPdf ? "document.pdf" : "image.jpg";

  const { body: submitBody, contentType } = buildMultipartBody(
    fileBytes,
    fileName,
    {
      model: modelConfig.asyncModelName,
      optionalPayload: JSON.stringify(advancedFeatures),
    },
  );

  const submitResponse = await Zotero.HTTP.request("POST", ASYNC_JOB_URL, {
    body: submitBody as any,
    headers: {
      Authorization: `bearer ${endpoint.token}`,
      "Content-Type": contentType,
    },
    responseType: "text",
    timeout: 60000,
  });

  const submitData = JSON.parse(submitResponse.responseText || "{}");
  if (submitData.code && submitData.code !== 0) {
    throw new Error(submitData.msg || "Failed to submit OCR job");
  }

  const jobId = submitData.data.jobId;

  while (true) {
    await Zotero.Promise.delay(3000);

    const pollResponse = await Zotero.HTTP.request(
      "GET",
      `${ASYNC_JOB_URL}/${jobId}`,
      {
        headers: {
          Authorization: `bearer ${endpoint.token}`,
          "Content-Type": "application/json",
        },
        responseType: "text",
        timeout: 30000,
      },
    );

    const pollData = JSON.parse(pollResponse.responseText || "{}");
    const state = pollData.data.state;

    if (state === "pending") {
      continue;
    } else if (state === "running") {
      const progress = pollData.data.extractProgress;
      if (progress) {
        const totalPages = progress.totalPages || 0;
        const extracted = progress.extractedPages || 0;
        if (onProgress) onProgress(extracted, totalPages);
      }
      continue;
    } else if (state === "done") {
      const jsonUrl = pollData.data.resultUrl?.jsonUrl;
      if (!jsonUrl) {
        throw new Error("No result URL in completed job");
      }

      const jsonlResponse = await Zotero.HTTP.request("GET", jsonUrl, {
        responseType: "text",
        timeout: 120000,
      });
      const responseText = jsonlResponse.responseText || "";
      const lines = responseText.trim().split("\n");
      const results: OCRPageResult[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const lineData = JSON.parse(line);
        const result = lineData.result || lineData;

        if (modelConfig.responseType === "ocrResults") {
          const ocrResults = result.ocrResults || [];
          for (let j = 0; j < ocrResults.length; j++) {
            const res = ocrResults[j];
            const prunedResult = res.prunedResult || {};
            const plainText = extractTextFromPrunedResult(prunedResult);
            results.push({
              pageNumber: results.length + 1,
              markdown: plainText,
              plainText,
              blocks: [],
            });
          }
        } else {
          const layoutResults = result.layoutParsingResults || [];
          for (let j = 0; j < layoutResults.length; j++) {
            const res = layoutResults[j];
            const md = res.markdown || {};
            const markdownText = md.text || "";
            results.push({
              pageNumber: results.length + 1,
              markdown: markdownText,
              plainText: markdownText,
              blocks: [],
            });
          }
        }
      }

      return results;
    } else if (state === "failed") {
      throw new Error(pollData.data.errorMsg || "OCR job failed");
    }
  }
}

async function extractMarkdownFromZip(
  zipBuffer: Uint8Array,
): Promise<string> {
  const tempDir = PathUtils.join(PathUtils.tempDir, "aiocr-mineru");
  await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });
  const tempZipPath = PathUtils.join(
    tempDir,
    `mineru-${Date.now()}.zip`,
  );

  await IOUtils.write(tempZipPath, zipBuffer);

  try {
    const zipReader = Components.classes[
      "@mozilla.org/libjar/zip-reader;1"
    ].createInstance(Components.interfaces.nsIZipReader);

    const zipFile = Components.classes[
      "@mozilla.org/file/local;1"
    ].createInstance(Components.interfaces.nsIFile);
    zipFile.initWithPath(tempZipPath);

    zipReader.open(zipFile);

    let mdEntryName = "";
    const entries = zipReader.findEntries("*");
    while (entries.hasMore()) {
      const entry = entries.getNext();
      if (entry.endsWith("full.md")) {
        mdEntryName = entry;
        break;
      }
    }

    if (!mdEntryName) {
      zipReader.close();
      throw new Error('File "full.md" not found in zip');
    }

    const mdFilePath = PathUtils.join(
      tempDir,
      `full-${Date.now()}.md`,
    );
    const mdFile = Components.classes[
      "@mozilla.org/file/local;1"
    ].createInstance(Components.interfaces.nsIFile);
    mdFile.initWithPath(mdFilePath);

    zipReader.extract(mdEntryName, mdFile);
    zipReader.close();

    const mdBytes = await IOUtils.read(mdFilePath);
    const markdown = new TextDecoder().decode(mdBytes);

    try {
      await IOUtils.remove(mdFilePath, { ignoreAbsent: true });
    } catch {}

    return markdown;
  } finally {
    try {
      await IOUtils.remove(tempZipPath, { ignoreAbsent: true });
    } catch {}
  }
}

async function callMinerUAPI(
  engine: EngineType,
  filePath: string,
  isPdf: boolean,
  onProgress?: (current: number, total: number) => void,
): Promise<OCRPageResult[]> {
  const endpoint = getActiveEndpoint(engine);
  if (!endpoint) {
    throw new Error(
      `No API endpoint configured for ${engine}. Please configure one in the preferences.`,
    );
  }

  const modelConfig = ENGINE_MODELS[engine];
  const advancedFeatures = getEnabledAdvancedFeatures(engine);
  let baseUrl: string;
  try {
    const urlObj = new URL(endpoint.url);
    baseUrl = urlObj.origin;
  } catch {
    baseUrl = endpoint.url.replace(/\/+$/, "");
  }

  const fileBytes = await IOUtils.read(filePath);
  const pathParts = filePath.replace(/\\/g, "/").split("/");
  const fileName = pathParts[pathParts.length - 1] || "document.pdf";

  const requestBody: Record<string, any> = {
    files: [{ name: fileName }],
    model_version: modelConfig.modelVersion,
  };

  if (modelConfig.modelVersion !== "MinerU-HTML") {
    for (const [key, value] of Object.entries(advancedFeatures)) {
      requestBody[key] = value;
    }
    requestBody.language = "ch";
  }

  const submitResponse = await Zotero.HTTP.request(
    "POST",
    `${baseUrl}/api/v4/file-urls/batch`,
    {
      body: JSON.stringify(requestBody),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${endpoint.token}`,
      },
      responseType: "json",
      timeout: 30000,
    },
  );

  const submitData = submitResponse.response;
  if (submitData.code !== 0) {
    throw new Error(submitData.msg || "Failed to submit MinerU task");
  }

  const batchId = submitData.data.batch_id;
  const fileUrls: string[] = submitData.data.file_urls;

  if (fileUrls.length === 0) {
    throw new Error("No upload URL returned from MinerU");
  }

  const uploadResponse = await fetch(fileUrls[0], {
    method: "PUT",
    body: fileBytes,
  });
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(
      `File upload failed: HTTP ${uploadResponse.status} - ${errorText}`,
    );
  }

  if (onProgress) onProgress(0, 1);

  while (true) {
    await Zotero.Promise.delay(3000);

    const pollResponse = await Zotero.HTTP.request(
      "GET",
      `${baseUrl}/api/v4/extract-results/batch/${batchId}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${endpoint.token}`,
        },
        responseType: "json",
        timeout: 30000,
      },
    );

    const pollData = pollResponse.response;
    const extractResults = pollData.data?.extract_result || [];

    if (extractResults.length === 0) continue;

    const fileResult = extractResults[0];
    const state = fileResult.state;

    if (
      state === "pending" ||
      state === "waiting-file" ||
      state === "converting"
    ) {
      continue;
    } else if (state === "running") {
      const progress = fileResult.extract_progress;
      if (progress) {
        const totalPages = progress.total_pages || 0;
        const extracted = progress.extracted_pages || 0;
        if (onProgress) onProgress(extracted, totalPages);
      }
      continue;
    } else if (state === "done") {
      const zipUrl = fileResult.full_zip_url;
      if (!zipUrl) {
        throw new Error("No result zip URL in completed MinerU task");
      }

      const zipResponse = await Zotero.HTTP.request("GET", zipUrl, {
        responseType: "arraybuffer",
        timeout: 120000,
      });

      const zipBuffer = new Uint8Array(zipResponse.response);
      const markdown = await extractMarkdownFromZip(zipBuffer);

      return [
        {
          pageNumber: 1,
          markdown,
          plainText: markdown,
          blocks: [],
        },
      ];
    } else if (state === "failed") {
      throw new Error(
        fileResult.err_msg || "MinerU extraction task failed",
      );
    }
  }
}

export async function performOCR(
  filePath: string,
  isPdf: boolean,
  engine?: string,
  onProgress?: (current: number, total: number) => void,
): Promise<OCRResult> {
  const selectedEngine = (engine || getPref("engine")) as EngineType;
  const modelConfig = ENGINE_MODELS[selectedEngine];

  if (!modelConfig) {
    throw new Error(`Unknown engine: ${selectedEngine}`);
  }

  let pages: OCRPageResult[];

  if (modelConfig.platform === "mineru") {
    pages = await callMinerUAPI(selectedEngine, filePath, isPdf, onProgress);
  } else {
    const apiMode = getPref("apiMode") as string;
    if (apiMode === "async") {
      pages = await callAsyncAPI(
        selectedEngine,
        filePath,
        isPdf,
        onProgress,
      );
    } else {
      pages = await callSyncAPI(
        selectedEngine,
        filePath,
        isPdf,
        onProgress,
      );
    }
  }

  const fullMarkdown = pages.map((p) => p.markdown).join("\n\n---\n\n");

  return {
    engine: selectedEngine,
    pages,
    fullMarkdown,
  };
}

export async function testConnection(
  engine: string,
  url: string,
  token: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const modelConfig = ENGINE_MODELS[engine as EngineType];
    if (!modelConfig) {
      return { success: false, message: `Unknown engine: ${engine}` };
    }

    if (modelConfig.platform === "mineru") {
      let mineruBaseUrl: string;
      try {
        const urlObj = new URL(url);
        mineruBaseUrl = urlObj.origin;
      } catch {
        mineruBaseUrl = url.replace(/\/+$/, "");
      }
      const testResponse = await Zotero.HTTP.request(
        "POST",
        `${mineruBaseUrl}/api/v4/file-urls/batch`,
        {
          body: JSON.stringify({
            files: [],
            model_version: modelConfig.modelVersion,
          }),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          responseType: "json",
          timeout: 10000,
        },
      );

      const data = testResponse.response;
      if (data.code === 0) {
        return {
          success: true,
          message: getString("progress-test-success"),
        };
      }
      return {
        success: false,
        message: data.msg || "Unknown error",
      };
    }

    const testPayload: Record<string, any> = {
      file: "",
      fileType: 1,
    };

    const testUrl = url + modelConfig.syncPath;

    const response = await Zotero.HTTP.request("POST", testUrl, {
      body: JSON.stringify(testPayload),
      headers: {
        "Content-Type": "application/json",
        Authorization: `token ${token}`,
      },
      responseType: "json",
      timeout: 10000,
    });

    const data = response.response;
    if (data.errorCode === 0 || data.errorCode === undefined) {
      return { success: true, message: getString("progress-test-success") };
    }
    return {
      success: false,
      message: data.errorMsg || "Unknown error",
    };
  } catch (e: any) {
    const msg = e.message || String(e);
    if (
      msg.includes("NetworkError") ||
      msg.includes("NS_ERROR") ||
      msg.includes("Failed to fetch")
    ) {
      return {
        success: false,
        message: `Connection failed: ${msg}`,
      };
    }
    if (msg.includes("401") || msg.includes("Unauthorized")) {
      return {
        success: false,
        message: "Authentication failed: Invalid token",
      };
    }
    return {
      success: false,
      message: `Error: ${msg}`,
    };
  }
}
