import {
  getPref,
  getActiveEndpoint,
  getEnabledAdvancedFeatures,
  getCustomEngineById,
  CustomEngineConfig,
} from "../utils/prefs";
import { getString } from "../utils/locale";

export const AI_PROVIDER_CONFIGS: {
  [provider: string]: {
    name: string;
    apiBase: string;
    defaultModel: string;
    apiFormat: "openai" | "gemini";
    modelHint?: string;
    authHeaderFormat?: "bearer" | "api-key";
    tokenParam?: "max_tokens" | "max_completion_tokens";
    maxTokens?: number;
    temperature?: number;
    streamParam?: boolean;
  };
} = {
  openai: {
    name: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    apiFormat: "openai",
  },
  gemini: {
    name: "Google Gemini",
    apiBase: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
    apiFormat: "gemini",
  },
  xai: {
    name: "xAI Grok",
    apiBase: "https://api.x.ai/v1",
    defaultModel: "grok-4",
    apiFormat: "openai",
  },
  openrouter: {
    name: "OpenRouter",
    apiBase: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-3.5-sonnet",
    apiFormat: "openai",
  },
  siliconflow: {
    name: "硅基流动",
    apiBase: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-VL-32B-Instruct",
    apiFormat: "openai",
    modelHint:
      "请使用支持视觉的模型（名称中含 VL），如 Qwen/Qwen2.5-VL-32B-Instruct，纯文本模型无法识别图片",
  },
  doubao: {
    name: "豆包",
    apiBase: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "ep-xxxxxxxxxxxx-xxxxx",
    apiFormat: "openai",
    modelHint:
      "请填入火山引擎方舟平台的接入点ID（如 ep-20250101xxxxx-xxxxx），而非模型名称",
  },
  zhipu: {
    name: "智谱AI",
    apiBase: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4v-flash",
    apiFormat: "openai",
  },
  alibaba: {
    name: "阿里云百炼",
    apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-vl-plus-2025-08-15",
    apiFormat: "openai",
  },
  ollama: {
    name: "Ollama (本地)",
    apiBase: "http://localhost:11434/api",
    defaultModel: "llava:latest",
    apiFormat: "openai",
  },
  groq: {
    name: "Groq",
    apiBase: "https://api.groq.com/openai/v1",
    defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    apiFormat: "openai",
    tokenParam: "max_completion_tokens",
    maxTokens: 5000,
    temperature: 0.2,
  },
  infinigence: {
    name: "无问芯穹",
    apiBase: "https://cloud.infini-ai.com/maas/v1",
    defaultModel: "MiniCPM-V-2.6",
    apiFormat: "openai",
  },
  mistral: {
    name: "Mistral AI",
    apiBase: "https://api.mistral.ai/v1",
    defaultModel: "pixtral-12b-2409",
    apiFormat: "openai",
    maxTokens: 6000,
    streamParam: false,
  },
  modelscope: {
    name: "魔搭",
    apiBase: "https://api-inference.modelscope.cn/v1",
    defaultModel: "Qwen/Qwen-VL-Plus",
    apiFormat: "openai",
  },
  intern: {
    name: "浦源书生",
    apiBase: "https://chat.intern-ai.org.cn/api/v1",
    defaultModel: "internvl3.5-241b-a28b",
    apiFormat: "openai",
  },
  mimo: {
    name: "小米 MiMo",
    apiBase: "https://api.xiaomimimo.com/v1",
    defaultModel: "mimo-v2.5",
    apiFormat: "openai",
    authHeaderFormat: "api-key",
    tokenParam: "max_completion_tokens",
    maxTokens: 4000,
  },
  nvidia: {
    name: "NVIDIA NIM",
    apiBase: "https://integrate.api.nvidia.com/v1",
    defaultModel: "moonshotai/kimi-k2.6",
    apiFormat: "openai",
    maxTokens: 16384,
  },
};

const OCR_PROMPT =
  "Please perform OCR on this image. Extract all text content exactly as it appears, preserving the original layout and structure. Output the result in Markdown format. For tables, use Markdown table syntax. For formulas, use LaTeX notation. Do not add any commentary, only output the recognized content.";

const PDF_PAGE_PROMPT =
  "Please perform OCR on this document page image. Extract all text content exactly as it appears, preserving the original layout and structure. Output the result in Markdown format. For tables, use Markdown table syntax. For formulas, use LaTeX notation. Do not add any commentary, only output the recognized content.";

function getEffectivePrompt(defaultPrompt: string): string {
  try {
    const custom = (getPref("aiCustomPrompt" as any) as string) || "";
    return custom.trim() || defaultPrompt;
  } catch {
    return defaultPrompt;
  }
}

const MAX_AI_PDF_PAGES = 50;

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
  "AI-OpenAI": {
    name: "OpenAI",
    description: "GPT-4o 等视觉模型",
    platform: "ai" as const,
    provider: "openai",
  },
  "AI-Gemini": {
    name: "Google Gemini",
    description: "Gemini 视觉模型",
    platform: "ai" as const,
    provider: "gemini",
  },
  "AI-xAI": {
    name: "xAI Grok",
    description: "Grok 视觉模型",
    platform: "ai" as const,
    provider: "xai",
  },
  "AI-OpenRouter": {
    name: "OpenRouter",
    description: "多模型聚合平台",
    platform: "ai" as const,
    provider: "openrouter",
  },
  "AI-SiliconFlow": {
    name: "硅基流动",
    description: "国内视觉模型平台",
    platform: "ai" as const,
    provider: "siliconflow",
  },
  "AI-Doubao": {
    name: "豆包",
    description: "字节跳动视觉模型",
    platform: "ai" as const,
    provider: "doubao",
  },
  "AI-Zhipu": {
    name: "智谱AI",
    description: "GLM-4V 视觉模型",
    platform: "ai" as const,
    provider: "zhipu",
  },
  "AI-Alibaba": {
    name: "阿里云百炼",
    description: "Qwen-VL 视觉模型",
    platform: "ai" as const,
    provider: "alibaba",
  },
  "AI-Ollama": {
    name: "Ollama (本地)",
    description: "本地视觉模型",
    platform: "ai" as const,
    provider: "ollama",
  },
  "AI-Groq": {
    name: "Groq",
    description: "Groq 视觉模型",
    platform: "ai" as const,
    provider: "groq",
  },
  "AI-Infinigence": {
    name: "无问芯穹",
    description: "Infinigence 视觉模型",
    platform: "ai" as const,
    provider: "infinigence",
  },
  "AI-Mistral": {
    name: "Mistral AI",
    description: "Pixtral 视觉模型",
    platform: "ai" as const,
    provider: "mistral",
  },
  "AI-ModelScope": {
    name: "魔搭",
    description: "ModelScope 视觉模型",
    platform: "ai" as const,
    provider: "modelscope",
  },
  "AI-Intern": {
    name: "浦源书生",
    description: "InternVL 视觉模型",
    platform: "ai" as const,
    provider: "intern",
  },
  "AI-MiMo": {
    name: "小米 MiMo",
    description: "MiMo 视觉模型",
    platform: "ai" as const,
    provider: "mimo",
  },
  "AI-NVIDIA": {
    name: "NVIDIA NIM",
    description: "NVIDIA 视觉模型",
    platform: "ai" as const,
    provider: "nvidia",
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

export async function callSyncAPI(
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

async function extractMarkdownFromZip(zipBuffer: Uint8Array): Promise<string> {
  const tempDir = PathUtils.join(PathUtils.tempDir, "aiocr-mineru");
  await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });
  const tempZipPath = PathUtils.join(tempDir, `mineru-${Date.now()}.zip`);

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

    const mdFilePath = PathUtils.join(tempDir, `full-${Date.now()}.md`);
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
    } catch {
      /* ignore */
    }

    return markdown;
  } finally {
    try {
      await IOUtils.remove(tempZipPath, { ignoreAbsent: true });
    } catch {
      /* ignore */
    }
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
      throw new Error(fileResult.err_msg || "MinerU extraction task failed");
    }
  }
}

function getReaders(): any[] {
  try {
    if (typeof (Zotero.Reader as any).getReaders === "function") {
      return (Zotero.Reader as any).getReaders();
    }
  } catch {
    /* ignore */
  }
  try {
    const readers = (Zotero.Reader as any)._readers;
    if (Array.isArray(readers)) return readers;
  } catch {
    /* ignore */
  }
  return [];
}

function extractPdfJsFromReader(reader: any): any {
  ztoolkit.log(
    `[AIOCR] extractPdfJsFromReader: reader keys=${Object.keys(reader || {})
      .slice(0, 20)
      .join(",")}`,
  );

  try {
    const iframeWindow = reader._iframeWindow;
    if (iframeWindow) {
      const lib =
        iframeWindow.pdfjsLib || iframeWindow.wrappedJSObject?.pdfjsLib;
      if (lib && (lib.getDocument || lib.GlobalWorkerOptions)) {
        ztoolkit.log(
          "[AIOCR] extractPdfJsFromReader: found via reader._iframeWindow.pdfjsLib",
        );
        return lib;
      }
      const pva =
        iframeWindow.PDFViewerApplication ||
        iframeWindow.wrappedJSObject?.PDFViewerApplication;
      if (pva?.pdfjsLib) {
        ztoolkit.log(
          "[AIOCR] extractPdfJsFromReader: found via reader._iframeWindow.PDFViewerApplication.pdfjsLib",
        );
        return pva.pdfjsLib;
      }
    }
  } catch (e: any) {
    ztoolkit.log(
      `[AIOCR] extractPdfJsFromReader: _iframeWindow path failed: ${e.message}`,
    );
  }

  try {
    const iframe = reader._iframe;
    if (iframe?.contentWindow) {
      const lib =
        iframe.contentWindow.pdfjsLib ||
        iframe.contentWindow.wrappedJSObject?.pdfjsLib;
      if (lib && (lib.getDocument || lib.GlobalWorkerOptions)) {
        ztoolkit.log(
          "[AIOCR] extractPdfJsFromReader: found via reader._iframe.contentWindow.pdfjsLib",
        );
        return lib;
      }
      const pva =
        iframe.contentWindow.PDFViewerApplication ||
        iframe.contentWindow.wrappedJSObject?.PDFViewerApplication;
      if (pva?.pdfjsLib) {
        ztoolkit.log(
          "[AIOCR] extractPdfJsFromReader: found via reader._iframe.contentWindow.PDFViewerApplication.pdfjsLib",
        );
        return pva.pdfjsLib;
      }
    }
  } catch (e: any) {
    ztoolkit.log(
      `[AIOCR] extractPdfJsFromReader: _iframe path failed: ${e.message}`,
    );
  }

  try {
    const internal = reader._internalReader || reader._internal;
    if (internal) {
      if (internal._pdfjsLib) {
        ztoolkit.log(
          "[AIOCR] extractPdfJsFromReader: found via internal._pdfjsLib",
        );
        return internal._pdfjsLib;
      }
      if (internal._pdfjsViewer?.pdfjsLib) {
        ztoolkit.log(
          "[AIOCR] extractPdfJsFromReader: found via internal._pdfjsViewer.pdfjsLib",
        );
        return internal._pdfjsViewer.pdfjsLib;
      }
      if (internal._primaryView?._iframeWindow) {
        const iw = internal._primaryView._iframeWindow;
        const lib = iw.pdfjsLib || iw.wrappedJSObject?.pdfjsLib;
        if (lib && (lib.getDocument || lib.GlobalWorkerOptions)) {
          ztoolkit.log(
            "[AIOCR] extractPdfJsFromReader: found via internal._primaryView._iframeWindow.pdfjsLib",
          );
          return lib;
        }
        const pva =
          iw.PDFViewerApplication || iw.wrappedJSObject?.PDFViewerApplication;
        if (pva?.pdfjsLib) {
          ztoolkit.log(
            "[AIOCR] extractPdfJsFromReader: found via internal._primaryView._iframeWindow.PDFViewerApplication.pdfjsLib",
          );
          return pva.pdfjsLib;
        }
      }
    }
  } catch (e: any) {
    ztoolkit.log(
      `[AIOCR] extractPdfJsFromReader: internal path failed: ${e.message}`,
    );
  }

  ztoolkit.log("[AIOCR] extractPdfJsFromReader: no pdfjsLib found");
  return null;
}

function getIframeWindow(reader: any): any {
  try {
    const iw = reader._iframeWindow;
    if (iw) return iw;
  } catch {
    /* ignore */
  }
  try {
    const iframe = reader._iframe;
    if (iframe?.contentWindow) return iframe.contentWindow;
  } catch {
    /* ignore */
  }
  try {
    const internal = reader._internalReader || reader._internal;
    if (internal?._primaryView?._iframeWindow) {
      return internal._primaryView._iframeWindow;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function loadPdfJsDirect(): Promise<any> {
  ztoolkit.log("[AIOCR] loadPdfJsDirect: attempting to load pdf.js...");

  const win = Zotero.getMainWindow();
  if (!win) {
    ztoolkit.log("[AIOCR] loadPdfJsDirect: no main window");
    return null;
  }

  const Cu = (Components as any).utils;

  try {
    const sandbox = Cu.Sandbox(win, {
      sandboxPrototype: win,
      wantXrays: false,
    });

    const importUrls = [
      "resource://zotero/pdf.js/build/pdf.mjs",
      "resource://zotero/pdf.js/pdf.mjs",
      "chrome://zotero/content/pdfjs/build/pdf.mjs",
      "chrome://zotero/content/pdfjs/pdf.mjs",
    ];

    for (const url of importUrls) {
      try {
        const result = Cu.evalInSandbox(`import('${url}')`, sandbox);
        const mod = await result;
        const lib = mod.pdfjsLib || mod.default || mod;
        if (lib && (lib.getDocument || lib.GlobalWorkerOptions)) {
          ztoolkit.log(
            `[AIOCR] loadPdfJsDirect: success via sandbox import(${url})`,
          );
          return lib;
        }
      } catch (e: any) {
        ztoolkit.log(
          `[AIOCR] loadPdfJsDirect: sandbox import(${url}) failed: ${e.message}`,
        );
      }
    }
  } catch (e: any) {
    ztoolkit.log(
      `[AIOCR] loadPdfJsDirect: sandbox approach failed: ${e.message}`,
    );
  }

  const esmPaths = [
    "resource://zotero/pdf.js/build/pdf.mjs",
    "resource://zotero/pdf.js/pdf.mjs",
  ];
  for (const path of esmPaths) {
    try {
      const mod = (ChromeUtils as any).importESModule(path);
      const lib = mod.pdfjsLib || mod.default || mod;
      if (lib && (lib.getDocument || lib.GlobalWorkerOptions)) {
        ztoolkit.log(
          `[AIOCR] loadPdfJsDirect: success via ChromeUtils.importESModule(${path})`,
        );
        return lib;
      }
    } catch (e: any) {
      ztoolkit.log(
        `[AIOCR] loadPdfJsDirect: ChromeUtils.importESModule(${path}) failed: ${e.message}`,
      );
    }
  }

  try {
    const win = Zotero.getMainWindow();
    if (win) {
      const lib = (win as any).pdfjsLib;
      if (lib && (lib.getDocument || lib.GlobalWorkerOptions)) {
        ztoolkit.log("[AIOCR] loadPdfJsDirect: success from main window");
        return lib;
      }
    }
  } catch {
    /* ignore */
  }

  ztoolkit.log("[AIOCR] loadPdfJsDirect: all methods failed");
  return null;
}

export async function pdfToImages(
  filePath: string,
  onProgress?: (current: number, total: number) => void,
  itemId?: number,
  pageNumbers?: number[],
): Promise<{ base64: string; pageNumber: number }[]> {
  let openedReader: any = null;
  let shouldCloseReader = false;

  try {
    try {
      const pdfjsLib = await loadPdfJsDirect();
      if (pdfjsLib) {
        ztoolkit.log(
          "[AIOCR] pdfToImages: trying chrome compartment rendering...",
        );
        const images = await renderPdfChrome(
          pdfjsLib,
          filePath,
          onProgress,
          pageNumbers,
        );
        ztoolkit.log(
          `[AIOCR] pdfToImages: chrome compartment rendering succeeded, ${images.length} pages`,
        );
        return images;
      }
    } catch (e: any) {
      ztoolkit.log(
        `[AIOCR] pdfToImages: chrome compartment rendering failed: ${e.message}`,
      );
    }

    let pdfjsLib: any = null;
    let iframeWindow: any = null;

    if (itemId) {
      const existingReaders = getReaders();
      for (const reader of existingReaders) {
        try {
          const readerItemId = reader._item?.id || reader.itemID;
          if (readerItemId === itemId) {
            const lib = extractPdfJsFromReader(reader);
            if (lib) {
              pdfjsLib = lib;
              iframeWindow = getIframeWindow(reader);
              ztoolkit.log(
                "[AIOCR] pdfToImages: got pdfjsLib from existing reader for this item",
              );
              break;
            }
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (!pdfjsLib && itemId) {
      ztoolkit.log(
        "[AIOCR] pdfToImages: opening background reader for pdfjsLib...",
      );
      try {
        openedReader = await Zotero.Reader.open(itemId, undefined, {
          openInBackground: true,
        } as any);
        shouldCloseReader = true;

        if (openedReader._initPromise) {
          await openedReader._initPromise;
        }

        const result = await (async () => {
          for (let i = 0; i < 40; i++) {
            const extracted = extractPdfJsFromReader(openedReader);
            if (extracted) {
              return {
                lib: extracted,
                win: getIframeWindow(openedReader),
              };
            }
            await Zotero.Promise.delay(500);
          }
          return null;
        })();

        if (result) {
          pdfjsLib = result.lib;
          iframeWindow = result.win;
          ztoolkit.log(
            "[AIOCR] pdfToImages: got pdfjsLib from background reader",
          );
        }
      } catch (e: any) {
        ztoolkit.log(
          `[AIOCR] pdfToImages: background reader failed: ${e.message}`,
        );
      }
    }

    if (!pdfjsLib) {
      const existingReaders = getReaders();
      for (const reader of existingReaders) {
        try {
          const lib = extractPdfJsFromReader(reader);
          if (lib) {
            pdfjsLib = lib;
            iframeWindow = getIframeWindow(reader);
            ztoolkit.log(
              "[AIOCR] pdfToImages: got pdfjsLib from other open reader (may render wrong PDF!)",
            );
            break;
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (!pdfjsLib) {
      throw new Error(
        "无法获取 PDF 渲染环境。AI 视觉模型识别 PDF 需要 pdf.js 支持。\n请尝试以下方法：\n1. 先在 Zotero 中打开任意 PDF 文件（让 pdf.js 加载），然后重试\n2. 更新 Zotero 到最新版本\n3. 改用 PaddleOCR 或 MinerU 引擎",
      );
    }

    try {
      ztoolkit.log(
        "[AIOCR] pdfToImages: trying cross-compartment rendering with Cu.waiveXrays...",
      );
      const images = await renderPdfCrossCompartment(
        pdfjsLib,
        iframeWindow,
        filePath,
        onProgress,
        pageNumbers,
      );
      ztoolkit.log(
        `[AIOCR] pdfToImages: cross-compartment rendering succeeded, ${images.length} pages`,
      );
      return images;
    } catch (e: any) {
      ztoolkit.log(
        `[AIOCR] pdfToImages: cross-compartment rendering failed: ${e.message}, trying iframe sandbox...`,
      );
    }

    if (!iframeWindow) {
      throw new Error(
        `PDF 渲染失败：无法获取 iframe 窗口。错误：跨 compartment 渲染失败且无 iframe 可用`,
      );
    }

    return await renderPdfIframeSandbox(
      iframeWindow,
      filePath,
      onProgress,
      pageNumbers,
    );
  } finally {
    if (shouldCloseReader && openedReader) {
      try {
        openedReader.close?.();
      } catch {
        /* ignore */
      }
      ztoolkit.log("[AIOCR] pdfToImages: closed background reader");
    }
  }
}

async function renderPdfChrome(
  pdfjsLib: any,
  filePath: string,
  onProgress?: (current: number, total: number) => void,
  pageNumbers?: number[],
): Promise<{ base64: string; pageNumber: number }[]> {
  if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "resource://zotero/pdf.js/build/pdf.worker.mjs";
    ztoolkit.log(
      `[AIOCR] renderPdfChrome: set workerSrc to ${pdfjsLib.GlobalWorkerOptions.workerSrc}`,
    );
  }

  const pdfBytes = await IOUtils.read(filePath);
  const bytes = new Uint8Array(pdfBytes);
  ztoolkit.log(
    `[AIOCR] renderPdfChrome: pdfBytes length=${bytes.length}, getDocument type=${typeof pdfjsLib.getDocument}`,
  );

  const doc = await pdfjsLib.getDocument(bytes).promise;
  const pagesToRender =
    pageNumbers && pageNumbers.length > 0
      ? pageNumbers.filter((p) => p >= 1 && p <= doc.numPages)
      : Array.from(
          { length: Math.min(doc.numPages, MAX_AI_PDF_PAGES) },
          (_, i) => i + 1,
        );
  ztoolkit.log(
    `[AIOCR] renderPdfChrome: doc.numPages=${doc.numPages}, rendering ${pagesToRender.length} pages`,
  );

  if (pagesToRender.length === 0) {
    throw new Error(`PDF has no pages (numPages=${doc.numPages})`);
  }

  const win = Zotero.getMainWindow();
  if (!win) throw new Error("Cannot get main window for canvas rendering");

  const images: { base64: string; pageNumber: number }[] = [];
  for (let idx = 0; idx < pagesToRender.length; idx++) {
    const pageNum = pagesToRender[idx];
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });

    if (
      !viewport.width ||
      !viewport.height ||
      isNaN(viewport.width) ||
      isNaN(viewport.height)
    ) {
      throw new Error(
        `Page ${pageNum} viewport is invalid (${viewport.width}x${viewport.height})`,
      );
    }

    const canvas = win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");

    await page.render({ canvasContext: ctx, viewport }).promise;

    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];
    images.push({ base64, pageNumber: pageNum });

    ztoolkit.log(
      `[AIOCR] renderPdfChrome: page ${pageNum} (${idx + 1}/${pagesToRender.length}) rendered, base64 length=${base64.length}`,
    );
    if (onProgress) onProgress(idx + 1, pagesToRender.length);
  }

  return images;
}

async function renderPdfCrossCompartment(
  pdfjsLib: any,
  iframeWindow: any,
  filePath: string,
  onProgress?: (current: number, total: number) => void,
  pageNumbers?: number[],
): Promise<{ base64: string; pageNumber: number }[]> {
  const Cu = (Components as any).utils;
  const waivedLib = Cu.waiveXrays(pdfjsLib);

  if (
    waivedLib.GlobalWorkerOptions &&
    !waivedLib.GlobalWorkerOptions.workerSrc
  ) {
    waivedLib.GlobalWorkerOptions.workerSrc =
      "resource://zotero/pdf.js/build/pdf.worker.mjs";
  }

  const pdfBytes = await IOUtils.read(filePath);
  const chromeBytes = new Uint8Array(pdfBytes);
  ztoolkit.log(
    `[AIOCR] renderPdfCrossCompartment: pdfBytes length=${chromeBytes.length}, iframeWindow=${!!iframeWindow}`,
  );

  let doc: any = null;

  if (iframeWindow) {
    try {
      const iframeBytes = new iframeWindow.Uint8Array(chromeBytes.length);
      iframeBytes.set(chromeBytes);
      doc = await waivedLib.getDocument(iframeBytes).promise;
      ztoolkit.log(
        "[AIOCR] renderPdfCrossCompartment: getDocument with iframe Uint8Array succeeded",
      );
    } catch (e: any) {
      ztoolkit.log(
        `[AIOCR] renderPdfCrossCompartment: iframe Uint8Array failed: ${e.message}, trying Cu.cloneInto...`,
      );
    }
  }

  if (!doc) {
    try {
      const clonedBytes = Cu.cloneInto(
        chromeBytes,
        iframeWindow || Zotero.getMainWindow(),
      );
      doc = await waivedLib.getDocument(clonedBytes).promise;
      ztoolkit.log(
        "[AIOCR] renderPdfCrossCompartment: getDocument with Cu.cloneInto succeeded",
      );
    } catch (e: any) {
      ztoolkit.log(
        `[AIOCR] renderPdfCrossCompartment: Cu.cloneInto failed: ${e.message}, trying direct pass...`,
      );
    }
  }

  if (!doc) {
    try {
      doc = await waivedLib.getDocument(chromeBytes).promise;
      ztoolkit.log(
        "[AIOCR] renderPdfCrossCompartment: getDocument with direct pass succeeded",
      );
    } catch (e: any) {
      throw new Error(`getDocument failed: ${e.message}`);
    }
  }

  const waivedDoc = Cu.waiveXrays(doc);
  const pagesToRender =
    pageNumbers && pageNumbers.length > 0
      ? pageNumbers.filter((p) => p >= 1 && p <= waivedDoc.numPages)
      : Array.from(
          { length: Math.min(waivedDoc.numPages, MAX_AI_PDF_PAGES) },
          (_, i) => i + 1,
        );
  ztoolkit.log(
    `[AIOCR] renderPdfCrossCompartment: doc.numPages=${waivedDoc.numPages}, rendering ${pagesToRender.length} pages`,
  );

  if (pagesToRender.length === 0) {
    throw new Error(`PDF has no pages (numPages=${waivedDoc.numPages})`);
  }

  if (!iframeWindow) {
    throw new Error("iframeWindow is required for cross-compartment rendering");
  }

  const images: { base64: string; pageNumber: number }[] = [];
  for (let idx = 0; idx < pagesToRender.length; idx++) {
    const pageNum = pagesToRender[idx];
    const page = await waivedDoc.getPage(pageNum);
    const waivedPage = Cu.waiveXrays(page);

    const vpOpts = new iframeWindow.Object();
    vpOpts.scale = 2;
    const viewport = waivedPage.getViewport(vpOpts);
    const waivedViewport = Cu.waiveXrays(viewport);
    const vpWidth = waivedViewport.width;
    const vpHeight = waivedViewport.height;
    ztoolkit.log(
      `[AIOCR] renderPdfCrossCompartment: page ${pageNum} viewport: ${vpWidth}x${vpHeight}`,
    );

    if (!vpWidth || !vpHeight || isNaN(vpWidth) || isNaN(vpHeight)) {
      throw new Error(
        `Page ${pageNum} viewport is invalid (${vpWidth}x${vpHeight})`,
      );
    }

    const iframeCanvas = iframeWindow.document.createElement("canvas");
    iframeCanvas.width = vpWidth;
    iframeCanvas.height = vpHeight;
    const iframeCtx = iframeCanvas.getContext("2d");

    const renderOpts = new iframeWindow.Object();
    renderOpts.canvasContext = iframeCtx;
    renderOpts.viewport = waivedViewport;

    await waivedPage.render(renderOpts).promise;

    const dataUrl = iframeCanvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];
    images.push({ base64, pageNumber: pageNum });

    ztoolkit.log(
      `[AIOCR] renderPdfCrossCompartment: page ${pageNum} (${idx + 1}/${pagesToRender.length}) rendered with iframe canvas, base64 length=${base64.length}`,
    );
    if (onProgress) onProgress(idx + 1, pagesToRender.length);
  }

  return images;
}

async function renderPdfIframeSandbox(
  iframeWindow: any,
  filePath: string,
  onProgress?: (current: number, total: number) => void,
  pageNumbers?: number[],
): Promise<{ base64: string; pageNumber: number }[]> {
  const pdfBytes = await IOUtils.read(filePath);
  const pdfBase64 = uint8ArrayToBase64(new Uint8Array(pdfBytes));
  const Cu = (Components as any).utils;

  ztoolkit.log(
    `[AIOCR] renderPdfIframeSandbox: pdfBase64 length=${pdfBase64.length}`,
  );

  let resolveRender: (value: {
    result: string | null;
    error: string | null;
  }) => void;
  const renderPromise = new Promise<{
    result: string | null;
    error: string | null;
  }>((resolve) => {
    resolveRender = resolve;
  });

  const renderTimeout = setTimeout(() => {
    resolveRender({
      result: null,
      error: "PDF 渲染超时（2分钟），请尝试使用 PaddleOCR 或 MinerU 引擎",
    });
  }, 120000);

  const callback = function (result: string | null, error: string | null) {
    clearTimeout(renderTimeout);
    resolveRender({ result, error });
  };

  try {
    const unwrappedWin = iframeWindow.wrappedJSObject || iframeWindow;
    const sandbox = Cu.Sandbox(iframeWindow, {
      sandboxPrototype: unwrappedWin,
      wantXrays: false,
    });

    sandbox.pdfBase64 = pdfBase64;
    sandbox.maxPages = MAX_AI_PDF_PAGES;
    sandbox.renderScale = 2;
    sandbox.pageNumbersJson =
      pageNumbers && pageNumbers.length > 0
        ? JSON.stringify(pageNumbers)
        : null;
    sandbox.onComplete = Cu.exportFunction(callback, sandbox);

    const renderCode = [
      "(async function() {",
      "  try {",
      "    var pdfjsLib = window.pdfjsLib;",
      "    if (!pdfjsLib && window.PDFViewerApplication) {",
      "      pdfjsLib = window.PDFViewerApplication.pdfjsLib;",
      "    }",
      "    if (!pdfjsLib) {",
      "      onComplete(null, 'pdfjsLib not found in iframe');",
      "      return;",
      "    }",
      "    var binaryString = atob(pdfBase64);",
      "    var bytes = new Uint8Array(binaryString.length);",
      "    for (var i = 0; i < binaryString.length; i++) {",
      "      bytes[i] = binaryString.charCodeAt(i);",
      "    }",
      "    var doc = await pdfjsLib.getDocument(bytes).promise;",
      "    var pagesToRender = pageNumbersJson ? JSON.parse(pageNumbersJson).filter(function(p) { return p >= 1 && p <= doc.numPages; }) : null;",
      "    var numPages = pagesToRender ? pagesToRender.length : Math.min(doc.numPages, maxPages);",
      "    if (numPages <= 0) {",
      "      onComplete(null, 'PDF has no pages: ' + doc.numPages);",
      "      return;",
      "    }",
      "    var results = [];",
      "    var pageNumbers = [];",
      "    for (var idx = 0; idx < numPages; idx++) {",
      "      var pageNum = pagesToRender ? pagesToRender[idx] : (idx + 1);",
      "      var page = await doc.getPage(pageNum);",
      "      var viewport = page.getViewport({ scale: renderScale });",
      "      var canvas = document.createElement('canvas');",
      "      canvas.width = viewport.width;",
      "      canvas.height = viewport.height;",
      "      var ctx = canvas.getContext('2d');",
      "      await page.render({ canvasContext: ctx, viewport: viewport }).promise;",
      "      var dataUrl = canvas.toDataURL('image/png');",
      "      results.push(dataUrl.split(',')[1]);",
      "      pageNumbers.push(pageNum);",
      "    }",
      "    onComplete(JSON.stringify({images: results, pageNumbers: pageNumbers}), null);",
      "  } catch (e) {",
      "    onComplete(null, e.message || String(e));",
      "  }",
      "})();",
    ].join("\n");

    ztoolkit.log("[AIOCR] renderPdfIframeSandbox: executing in sandbox...");
    Cu.evalInSandbox(renderCode, sandbox);
    ztoolkit.log(
      "[AIOCR] renderPdfIframeSandbox: sandbox started, waiting for callback...",
    );
  } catch (e: any) {
    clearTimeout(renderTimeout);
    ztoolkit.log(
      `[AIOCR] renderPdfIframeSandbox: evalInSandbox failed: ${e.message}, trying script injection...`,
    );

    const waivedWin = Cu.waiveXrays(iframeWindow);
    waivedWin._aiocr_onComplete = Cu.exportFunction(callback, waivedWin);
    waivedWin._aiocr_pdfBase64 = pdfBase64;
    waivedWin._aiocr_maxPages = MAX_AI_PDF_PAGES;
    waivedWin._aiocr_renderScale = 2;
    waivedWin._aiocr_pageNumbersJson =
      pageNumbers && pageNumbers.length > 0
        ? JSON.stringify(pageNumbers)
        : null;

    const injectCode = [
      "(async function() {",
      "  try {",
      "    var pdfjsLib = window.pdfjsLib || (window.PDFViewerApplication && window.PDFViewerApplication.pdfjsLib);",
      "    if (!pdfjsLib) {",
      "      window._aiocr_onComplete(null, 'pdfjsLib not found in iframe');",
      "      return;",
      "    }",
      "    var binaryString = atob(window._aiocr_pdfBase64);",
      "    var bytes = new Uint8Array(binaryString.length);",
      "    for (var i = 0; i < binaryString.length; i++) {",
      "      bytes[i] = binaryString.charCodeAt(i);",
      "    }",
      "    var doc = await pdfjsLib.getDocument(bytes).promise;",
      "    var pagesToRender = window._aiocr_pageNumbersJson ? JSON.parse(window._aiocr_pageNumbersJson).filter(function(p) { return p >= 1 && p <= doc.numPages; }) : null;",
      "    var numPages = pagesToRender ? pagesToRender.length : Math.min(doc.numPages, window._aiocr_maxPages);",
      "    if (numPages <= 0) {",
      "      window._aiocr_onComplete(null, 'PDF has no pages: ' + doc.numPages);",
      "      return;",
      "    }",
      "    var results = [];",
      "    var pageNumbers = [];",
      "    for (var idx = 0; idx < numPages; idx++) {",
      "      var pageNum = pagesToRender ? pagesToRender[idx] : (idx + 1);",
      "      var page = await doc.getPage(pageNum);",
      "      var viewport = page.getViewport({ scale: window._aiocr_renderScale });",
      "      var canvas = document.createElement('canvas');",
      "      canvas.width = viewport.width;",
      "      canvas.height = viewport.height;",
      "      var ctx = canvas.getContext('2d');",
      "      await page.render({ canvasContext: ctx, viewport: viewport }).promise;",
      "      var dataUrl = canvas.toDataURL('image/png');",
      "      results.push(dataUrl.split(',')[1]);",
      "      pageNumbers.push(pageNum);",
      "    }",
      "    window._aiocr_onComplete(JSON.stringify({images: results, pageNumbers: pageNumbers}), null);",
      "  } catch (e) {",
      "    window._aiocr_onComplete(null, e.message || String(e));",
      "  } finally {",
      "    delete window._aiocr_onComplete;",
      "    delete window._aiocr_pdfBase64;",
      "    delete window._aiocr_maxPages;",
      "    delete window._aiocr_renderScale;",
      "    delete window._aiocr_pageNumbersJson;",
      "  }",
      "})();",
    ].join("\n");

    const script = iframeWindow.document.createElement("script");
    script.textContent = injectCode;
    (
      iframeWindow.document.head || iframeWindow.document.documentElement
    ).appendChild(script);
    script.remove();
    ztoolkit.log(
      "[AIOCR] renderPdfIframeSandbox: script injected, waiting for callback...",
    );
  }

  const { result, error } = await renderPromise;

  if (error) {
    throw new Error(`PDF 渲染失败: ${error}`);
  }

  const resultJson = result;
  ztoolkit.log(
    `[AIOCR] renderPdfIframeSandbox: render complete, result length=${resultJson?.length ?? "null"}`,
  );

  const parsed = JSON.parse(resultJson);
  if (parsed.images && parsed.pageNumbers) {
    return parsed.images.map((base64: string, i: number) => ({
      base64,
      pageNumber: parsed.pageNumbers[i],
    }));
  }
  const base64List = parsed;
  return base64List.map((base64: string, i: number) => ({
    base64,
    pageNumber: i + 1,
  }));
}

async function callAIOneImage(
  providerConfig: (typeof AI_PROVIDER_CONFIGS)[string],
  apiKey: string,
  model: string,
  apiBase: string,
  imageBase64: string,
  mimeType: string,
  prompt: string,
): Promise<string> {
  let markdown = "";

  if (providerConfig.apiFormat === "gemini") {
    const baseUrl = apiBase.replace(/\/+$/, "");
    const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;
    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    };
    const response = await Zotero.HTTP.request("POST", url, {
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
      responseType: "json",
      timeout: 300000,
    });
    const data = response.response;
    if (data.error) throw new Error(data.error.message || "Gemini API error");
    const candidates = data.candidates || [];
    if (candidates.length > 0 && candidates[0].content?.parts?.length > 0) {
      markdown = candidates[0].content.parts
        .map((p: any) => p.text || "")
        .join("\n");
    }
  } else {
    const baseUrl = apiBase.replace(/\/+$/, "");
    const url = `${baseUrl}/chat/completions`;
    const requestBody: Record<string, any> = {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
    };
    requestBody[providerConfig.tokenParam || "max_tokens"] =
      providerConfig.maxTokens || 4096;
    requestBody.temperature =
      providerConfig.temperature !== undefined
        ? providerConfig.temperature
        : 0.1;
    if (providerConfig.streamParam !== undefined) {
      requestBody.stream = providerConfig.streamParam;
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      if (providerConfig.authHeaderFormat === "api-key") {
        headers["api-key"] = apiKey;
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
    }
    const response = await Zotero.HTTP.request("POST", url, {
      body: JSON.stringify(requestBody),
      headers,
      responseType: "json",
      timeout: 300000,
    });
    const data = response.response;
    if (data.error) {
      const errMsg = data.error.message || "API error";
      const errType = data.error.type || "";
      const errCode = data.error.code || "";
      if (
        errCode === "insufficient_quota" ||
        errMsg.includes("quota") ||
        errMsg.includes("billing")
      ) {
        throw new Error(
          `API 配额不足：${errMsg}\n请检查您的 ${providerConfig.name} 账户余额和计费状态。`,
        );
      }
      if (
        errMsg.includes("model") ||
        errMsg.includes("not found") ||
        errMsg.includes("does not exist")
      ) {
        throw new Error(
          `模型不可用：${errMsg}\n请检查模型名称是否正确。${providerConfig.modelHint ? "\n" + providerConfig.modelHint : ""}`,
        );
      }
      throw new Error(errMsg);
    }
    const choices = data.choices || [];
    if (choices.length > 0 && choices[0].message?.content) {
      markdown = choices[0].message.content;
    }
  }

  return markdown;
}

export function getAIProviderConfig(engine: string): {
  apiKey: string;
  model: string;
  apiBase: string;
  provider: string;
} {
  const modelConfig = ENGINE_MODELS[engine as EngineType] as any;
  if (!modelConfig || modelConfig.platform !== "ai") {
    throw new Error(`Not an AI engine: ${engine}`);
  }
  const provider = modelConfig.provider;
  const providerConfig = AI_PROVIDER_CONFIGS[provider];
  if (!providerConfig) throw new Error(`Unknown AI provider: ${provider}`);

  const configs = JSON.parse((getPref("aiProviderConfigs") as string) || "{}");
  const saved = configs[provider] || {};
  return {
    apiKey: saved.apiKey || "",
    model: saved.model || providerConfig.defaultModel,
    apiBase: saved.apiBase || providerConfig.apiBase,
    provider,
  };
}

async function callCustomVisionAPI(
  engineId: string,
  filePath: string,
  isPdf: boolean,
  onProgress?: (current: number, total: number) => void,
  itemId?: number,
): Promise<OCRPageResult[]> {
  const customEngine = getCustomEngineById(engineId);
  if (!customEngine) {
    throw new Error(`自定义引擎未找到: ${engineId}`);
  }
  if (!customEngine.apiKey && !isGeminiUrl(customEngine.apiUrl)) {
    throw new Error(
      `API Key 未配置。请在偏好设置中为自定义引擎「${customEngine.name}」设置 API Key。`,
    );
  }

  if (isPdf) {
    const images = await pdfToImages(filePath, onProgress, itemId);
    const results: OCRPageResult[] = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (onProgress) onProgress(i + 1, images.length);
      const markdown = await callCustomOneImage(
        customEngine,
        img.base64,
        "image/png",
        getEffectivePrompt(PDF_PAGE_PROMPT),
      );
      results.push({
        pageNumber: img.pageNumber,
        markdown,
        plainText: markdown,
        blocks: [],
      });
    }
    return results;
  }

  const fileBase64 = await readFileAsBase64(filePath);
  if (onProgress) onProgress(0, 1);
  const markdown = await callCustomOneImage(
    customEngine,
    fileBase64,
    "image/png",
    getEffectivePrompt(OCR_PROMPT),
  );
  if (onProgress) onProgress(1, 1);
  return [{ pageNumber: 1, markdown, plainText: markdown, blocks: [] }];
}

async function callCustomOneImage(
  customEngine: CustomEngineConfig,
  imageBase64: string,
  mimeType: string,
  prompt: string,
): Promise<string> {
  let markdown = "";
  const url = customEngine.apiUrl.replace(/\/+$/, "");
  const isGemini = isGeminiUrl(url);

  if (isGemini) {
    const separator = url.includes("?") ? "&" : "?";
    const fullUrl = `${url}${separator}key=${customEngine.apiKey}`;
    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: customEngine.temperature,
        maxOutputTokens: customEngine.maxTokens,
      },
    };
    const response = await Zotero.HTTP.request("POST", fullUrl, {
      body: JSON.stringify(requestBody),
      headers: { "Content-Type": "application/json" },
      responseType: "json",
      timeout: 300000,
    });
    const data = response.response;
    if (data.error) throw new Error(data.error.message || "Gemini API error");
    const candidates = data.candidates || [];
    if (candidates.length > 0 && candidates[0].content?.parts?.length > 0) {
      markdown = candidates[0].content.parts
        .map((p: any) => p.text || "")
        .join("\n");
    }
  } else {
    const requestBody: Record<string, any> = {
      model: customEngine.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: customEngine.maxTokens,
      temperature: customEngine.temperature,
    };
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (customEngine.apiKey) {
      headers["Authorization"] = `Bearer ${customEngine.apiKey}`;
    }
    const response = await Zotero.HTTP.request("POST", url, {
      body: JSON.stringify(requestBody),
      headers,
      responseType: "json",
      timeout: 300000,
    });
    const data = response.response;
    if (data.error) {
      const errMsg = data.error.message || "API error";
      throw new Error(errMsg);
    }
    const choices = data.choices || [];
    if (choices.length > 0 && choices[0].message?.content) {
      markdown = choices[0].message.content;
    }
  }

  return markdown;
}

function isGeminiUrl(url: string): boolean {
  return url.includes("generativelanguage.googleapis.com");
}

async function callAIVisionAPI(
  engine: EngineType,
  filePath: string,
  isPdf: boolean,
  onProgress?: (current: number, total: number) => void,
  itemId?: number,
): Promise<OCRPageResult[]> {
  const modelConfig = ENGINE_MODELS[engine] as any;
  const provider = modelConfig.provider;
  const providerConfig = AI_PROVIDER_CONFIGS[provider];
  if (!providerConfig) throw new Error(`Unknown AI provider: ${provider}`);

  const { apiKey, model, apiBase } = getAIProviderConfig(engine);
  if (!apiKey && provider !== "ollama") {
    throw new Error(
      `API Key not configured for ${providerConfig.name}. Please set it in preferences.`,
    );
  }

  const supportsPdf = provider === "openai" || provider === "openrouter";

  if (isPdf && !supportsPdf) {
    const images = await pdfToImages(filePath, onProgress, itemId);
    const results: OCRPageResult[] = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (onProgress) onProgress(i + 1, images.length);
      const markdown = await callAIOneImage(
        providerConfig,
        apiKey,
        model,
        apiBase,
        img.base64,
        "image/png",
        getEffectivePrompt(PDF_PAGE_PROMPT),
      );
      results.push({
        pageNumber: img.pageNumber,
        markdown,
        plainText: markdown,
        blocks: [],
      });
    }
    return results;
  }

  const fileBase64 = await readFileAsBase64(filePath);
  const fileName = filePath.replace(/\\/g, "/").split("/").pop() || "document";
  let mimeType: string;
  if (isPdf) {
    mimeType = "application/pdf";
  } else {
    const ext = fileName.toLowerCase();
    if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) mimeType = "image/jpeg";
    else if (ext.endsWith(".gif")) mimeType = "image/gif";
    else if (ext.endsWith(".webp")) mimeType = "image/webp";
    else mimeType = "image/png";
  }
  if (onProgress) onProgress(0, 1);
  const markdown = await callAIOneImage(
    providerConfig,
    apiKey,
    model,
    apiBase,
    fileBase64,
    mimeType,
    getEffectivePrompt(OCR_PROMPT),
  );
  if (onProgress) onProgress(1, 1);
  return [
    {
      pageNumber: 1,
      markdown,
      plainText: markdown,
      blocks: [],
    },
  ];
}

export async function performOCR(
  filePath: string,
  isPdf: boolean,
  engine?: string,
  onProgress?: (current: number, total: number) => void,
  itemId?: number,
): Promise<OCRResult> {
  const selectedEngine = engine || (getPref("engine") as string);

  if (selectedEngine.startsWith("custom-")) {
    const pages = await callCustomVisionAPI(
      selectedEngine,
      filePath,
      isPdf,
      onProgress,
      itemId,
    );
    const fullMarkdown = pages.map((p) => p.markdown).join("\n\n---\n\n");
    return { engine: selectedEngine, pages, fullMarkdown };
  }

  const modelConfig = ENGINE_MODELS[selectedEngine as EngineType] as any;

  if (!modelConfig) {
    throw new Error(`Unknown engine: ${selectedEngine}`);
  }

  let pages: OCRPageResult[];

  if (modelConfig.platform === "ai") {
    pages = await callAIVisionAPI(
      selectedEngine,
      filePath,
      isPdf,
      onProgress,
      itemId,
    );
  } else if (modelConfig.platform === "mineru") {
    pages = await callMinerUAPI(selectedEngine, filePath, isPdf, onProgress);
  } else {
    const apiMode = getPref("apiMode") as string;
    if (apiMode === "async") {
      pages = await callAsyncAPI(selectedEngine, filePath, isPdf, onProgress);
    } else {
      pages = await callSyncAPI(selectedEngine, filePath, isPdf, onProgress);
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
    if (engine.startsWith("custom-")) {
      const customEngine = getCustomEngineById(engine);
      if (!customEngine) {
        return { success: false, message: `自定义引擎未找到: ${engine}` };
      }
      const apiUrl = customEngine.apiUrl.replace(/\/+$/, "");
      if (isGeminiUrl(apiUrl)) {
        const testUrl = `${apiUrl.split(":generateContent")[0]}?key=${customEngine.apiKey}`;
        await Zotero.HTTP.request("GET", testUrl, {
          headers: {},
          responseType: "json",
          timeout: 10000,
        });
      } else {
        const baseUrl = apiUrl.replace(/\/chat\/completions\/?$/, "");
        const testUrl = `${baseUrl}/models`;
        const headers: Record<string, string> = {};
        if (customEngine.apiKey) {
          headers["Authorization"] = `Bearer ${customEngine.apiKey}`;
        }
        await Zotero.HTTP.request("GET", testUrl, {
          headers,
          responseType: "json",
          timeout: 10000,
        });
      }
      return { success: true, message: getString("progress-test-success") };
    }

    const modelConfig = ENGINE_MODELS[engine as EngineType] as any;
    if (!modelConfig) {
      return { success: false, message: `Unknown engine: ${engine}` };
    }

    if (modelConfig.platform === "ai") {
      const provider = modelConfig.provider;
      const providerConfig = AI_PROVIDER_CONFIGS[provider];
      if (!providerConfig)
        return {
          success: false,
          message: `Unknown provider: ${provider}`,
        };

      const configs = JSON.parse(
        (getPref("aiProviderConfigs") as string) || "{}",
      );
      const saved = configs[provider] || {};
      const apiKey = saved.apiKey || "";
      let apiBase = saved.apiBase || providerConfig.apiBase;
      apiBase = apiBase.replace(/\/+$/, "");

      if (providerConfig.apiFormat === "gemini") {
        const testUrl = `${apiBase}/models?key=${apiKey}`;
        await Zotero.HTTP.request("GET", testUrl, {
          headers: {},
          responseType: "json",
          timeout: 10000,
        });
        return {
          success: true,
          message: getString("progress-test-success"),
        };
      } else {
        const testUrl = `${apiBase}/models`;
        const headers: Record<string, string> = {};
        if (apiKey) {
          if (providerConfig.authHeaderFormat === "api-key") {
            headers["api-key"] = apiKey;
          } else {
            headers["Authorization"] = `Bearer ${apiKey}`;
          }
        }
        await Zotero.HTTP.request("GET", testUrl, {
          headers,
          responseType: "json",
          timeout: 10000,
        });
        return {
          success: true,
          message: getString("progress-test-success"),
        };
      }
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
