import {
  getPref,
  getActiveEndpoint,
  getAdvancedFeaturesForEngine,
  getCustomEngineById,
  CustomEngineConfig,
} from "../utils/prefs";
import { getString } from "../utils/locale";
import { PDFDocument } from "pdf-lib";

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
    defaultModel: "qwen/qwen3-vl-235b-a22b-instruct:free",
    apiFormat: "openai",
  },
  siliconflow: {
    name: "硅基流动",
    apiBase: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen3-VL-235B-A22B-Instruct",
    apiFormat: "openai",
    modelHint:
      "请使用支持视觉的模型（名称中含 VL），如 Qwen/Qwen3-VL-235B-A22B-Instruct，纯文本模型无法识别图片",
  },
  doubao: {
    name: "豆包",
    apiBase: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-seed-2-0-pro",
    apiFormat: "openai",
    modelHint:
      "请填入火山引擎方舟平台的接入点ID（如 ep-20250101xxxxx-xxxxx）或模型名称（如 doubao-seed-2-0-pro）",
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
    defaultModel: "qwen-vl-max",
    apiFormat: "openai",
  },
  ollama: {
    name: "Ollama (本地)",
    apiBase: "http://localhost:11434/api",
    defaultModel: "qwen2.5vl:7b",
    apiFormat: "openai",
  },
  groq: {
    name: "Groq",
    apiBase: "https://api.groq.com/openai/v1",
    defaultModel: "meta-llama/llama-4-maverick-17b-128e-instruct",
    apiFormat: "openai",
    tokenParam: "max_completion_tokens",
    maxTokens: 5000,
    temperature: 0.2,
  },
  mistral: {
    name: "Mistral AI",
    apiBase: "https://api.mistral.ai/v1",
    defaultModel: "mistral-ocr-latest",
    apiFormat: "openai",
    maxTokens: 6000,
    streamParam: false,
  },
  modelscope: {
    name: "魔搭",
    apiBase: "https://api-inference.modelscope.cn/v1",
    defaultModel: "Qwen/Qwen3-VL-235B-A22B-Instruct",
    apiFormat: "openai",
  },
  intern: {
    name: "浦源书生",
    apiBase: "https://discovery-api.intern-ai.org.cn/v1",
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

/**
 * 各平台"关闭模型思考"的请求参数。
 * 思考型模型（豆包/智谱/Qwen3 等）会把推理过程混入 OCR 结果且浪费 token，
 * 对支持该参数的平台直接关闭；不支持的平台由 stripThinkingContent 兜底剥离。
 */
const THINKING_DISABLED_PARAMS: { [provider: string]: Record<string, any> } = {
  doubao: { thinking: { type: "disabled" } },
  zhipu: { thinking: { type: "disabled" } },
  alibaba: { enable_thinking: false },
  siliconflow: { enable_thinking: false },
  openrouter: { reasoning: { enabled: false, exclude: true } },
};

/**
 * 剥离模型输出中混入的思考内容：
 * 1. 完整的 think 思考块（可能多块）
 * 2. 未闭合的思考块（开标签到结尾整体丢弃）
 * 3. 解开 answer 标签包裹（部分思考型模型的正文格式）
 * 注：正则中的标签字符用 \u003C 转义书写，避免被工具链误解析
 */
function stripThinkingContent(text: string): string {
  if (!text) return text;
  const thinkBlockRe = new RegExp(
    "\\u003Cthink\\u003E[\\s\\S]*?\\u003C/think\\u003E",
    "gi",
  );
  const thinkUnclosedRe = new RegExp("\\u003Cthink\\u003E[\\s\\S]*$", "i");
  const answerRe = new RegExp(
    "\\u003Canswer\\u003E([\\s\\S]*?)\\u003C/answer\\u003E",
    "gi",
  );
  let result = text.replace(thinkBlockRe, "");
  result = result.replace(thinkUnclosedRe, "");
  result = result.replace(answerRe, "$1");
  return result.trim();
}

/* ============================== 任务取消 ============================== */

/** OCR 任务被用户取消时抛出的错误，顶层处理器据此显示"已取消"而非"失败" */
export class OcrCancelledError extends Error {
  constructor() {
    super("OCR cancelled");
    this.name = "OcrCancelledError";
  }
}

let ocrCancelRequested = false;

export function requestOcrCancellation() {
  ocrCancelRequested = true;
}

export function isOcrCancelled() {
  return ocrCancelRequested;
}

/** 顶层任务处理器在开始新一轮识别时调用，避免上一轮的取消请求影响新一轮 */
export function resetOcrCancellation() {
  ocrCancelRequested = false;
}

function throwIfCancelled() {
  if (ocrCancelRequested) throw new OcrCancelledError();
}

/* ============================ HTTP 重试与错误提示 ============================ */

/** 可自动重试的 HTTP 状态码：限流与瞬时服务端错误 */
const RETRYABLE_STATUS_RE = /status code (429|500|502|503|504)\b/;
/** 可自动重试的网络层错误 */
const NETWORK_ERROR_RE = /NetworkError|NS_ERROR|Failed to fetch/i;

function isRetryableHttpError(e: any): boolean {
  const msg = (e && e.message) || String(e);
  return RETRYABLE_STATUS_RE.test(msg) || NETWORK_ERROR_RE.test(msg);
}

/**
 * 带自动重试的 HTTP 请求：429/5xx/网络错误自动退避重试。
 * GET 默认重试 2 次；POST 默认 1 次（服务端可能已建任务，不宜多次重复提交）。
 */
async function httpRequestWithRetry(
  method: "GET" | "POST",
  url: string,
  options: any,
  maxRetries?: number,
): Promise<any> {
  const retries = maxRetries ?? (method === "GET" ? 2 : 1);
  let attempt = 0;
  for (;;) {
    throwIfCancelled();
    try {
      return await Zotero.HTTP.request(method, url, options);
    } catch (e: any) {
      attempt++;
      if (!isRetryableHttpError(e) || attempt > retries) throw e;
      const delayMs = attempt === 1 ? 2000 : 5000;
      ztoolkit.log(
        `[AIOCR] HTTP ${method} ${url} failed (${e.message}), retrying in ${delayMs}ms (${attempt}/${retries})`,
      );
      await Zotero.Promise.delay(delayMs);
    }
  }
}

/**
 * 把 HTTP 状态码异常转换为面向用户的可操作提示。
 * Zotero.HTTP.request 对非 2xx 响应直接抛 "HTTP POST ... failed with status code N"，
 * 响应体里的 error.message 拿不到，只能按状态码映射常见原因。
 */
function describeHttpError(e: any, service: string): Error {
  if (e instanceof OcrCancelledError) return e;
  const msg = (e && e.message) || String(e);
  const statusMatch = msg.match(/status code (\d+)/);
  if (statusMatch) {
    const status = statusMatch[1];
    if (status === "401" || status === "403") {
      return new Error(
        `${service} API 认证失败（HTTP ${status}）：请检查 API Key / Token 是否正确。`,
      );
    }
    if (status === "402") {
      return new Error(
        `${service} API 返回 402：账号余额或额度不足，请登录平台确认计费状态。`,
      );
    }
    if (status === "404") {
      return new Error(
        `${service} API 返回 404：API 地址或模型不存在，请检查 API 地址与模型名称。`,
      );
    }
    if (status === "413") {
      return new Error(`${service} API 返回 413：文件过大，请压缩后重试。`);
    }
    if (status === "429") {
      return new Error(
        `${service} API 返回 429：请求过于频繁（触发限流），请稍后重试或调低批量并发数。`,
      );
    }
    if (status.startsWith("5")) {
      return new Error(
        `${service} 服务暂时不可用（HTTP ${status}），已自动重试仍失败，请稍后再试。`,
      );
    }
  }
  return e instanceof Error ? e : new Error(msg);
}

/**
 * 读取引擎高级功能的完整配置：以 ENGINE_ADVANCED_FEATURES 默认值为底，
 * 叠加用户显式保存的值（含 false）。必须显式传布尔值——服务端默认 true 的
 * 开关（如 MinerU enable_formula、面壁 upright）若省略字段则永远关不掉。
 */
function getResolvedAdvancedFeatures(engine: EngineType): {
  [feature: string]: boolean;
} {
  const result: { [feature: string]: boolean } = {};
  for (const f of ENGINE_ADVANCED_FEATURES[engine] || []) {
    result[f.key] = f.defaultValue;
  }
  const saved = getAdvancedFeaturesForEngine(engine);
  for (const [key, val] of Object.entries(saved)) {
    if (key in result) result[key] = val;
  }
  return result;
}

export const ENGINE_MODELS = {
  "PP-OCRv6": {
    name: "PP-OCRv6",
    description: "基础文字识别",
    platform: "paddleocr" as const,
    asyncModelName: "PP-OCRv6",
    responseType: "ocrResults",
    asyncOnly: true,
    defaultEndpoint: "https://paddleocr.aistudio-app.com",
  },
  "PP-StructureV3": {
    name: "PP-StructureV3",
    description: "文档结构解析",
    platform: "paddleocr" as const,
    asyncModelName: "PP-StructureV3",
    responseType: "layoutParsingResults",
    asyncOnly: true,
    defaultEndpoint: "https://paddleocr.aistudio-app.com",
  },
  "PaddleOCR-VL-1.6": {
    name: "PaddleOCR-VL-1.6",
    description: "增强视觉语言模型",
    platform: "paddleocr" as const,
    asyncModelName: "PaddleOCR-VL-1.6",
    responseType: "layoutParsingResults",
    asyncOnly: true,
    defaultEndpoint: "https://paddleocr.aistudio-app.com",
  },
  "MinerU-pipeline": {
    name: "MinerU-pipeline",
    description: "MinerU 文档解析 (pipeline)",
    platform: "mineru" as const,
    modelVersion: "pipeline",
    defaultEndpoint: "https://mineru.net",
  },
  "MinerU-vlm": {
    name: "MinerU-vlm",
    description: "MinerU 文档解析 (vlm推荐)",
    platform: "mineru" as const,
    modelVersion: "vlm",
    defaultEndpoint: "https://mineru.net",
  },
  "MinerU-HTML": {
    name: "MinerU-HTML",
    description: "MinerU HTML 解析",
    platform: "mineru" as const,
    modelVersion: "MinerU-HTML",
    defaultEndpoint: "https://mineru.net",
  },
  "ModelBest-OCR": {
    name: "面壁智能 OCR",
    description: "MiniCPM-OCR 文档解析（免费）",
    platform: "modelbest" as const,
    asyncModelName: "MiniCPM-OCR-1.0",
    asyncOnly: true,
    defaultEndpoint: "https://api.modelbest.ai",
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

/** 支持端点管理的引擎的官方 API 地址；用于「API 端点管理」的自动预填 */
export function getDefaultEndpointForEngine(engine: string): string | null {
  const modelConfig = ENGINE_MODELS[engine as EngineType] as any;
  return (modelConfig && modelConfig.defaultEndpoint) || null;
}

export const ENGINE_ADVANCED_FEATURES: {
  [engine: string]: {
    key: string;
    labelKey: string;
    defaultValue: boolean;
  }[];
} = {
  "PP-OCRv6": [
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
  "PaddleOCR-VL-1.6": [
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
  "ModelBest-OCR": [
    {
      key: "upright",
      labelKey: "advanced-modelbest-upright",
      defaultValue: true,
    },
    {
      key: "recognize_seal",
      labelKey: "advanced-modelbest-recognizeSeal",
      defaultValue: true,
    },
  ],
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

export async function extractPagesToTempPdf(
  filePath: string,
  pageNumbers: number[],
): Promise<string> {
  const bytes = await IOUtils.read(filePath);
  const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (srcDoc.isEncrypted) {
    throw new Error(
      "source PDF is encrypted; pdf-lib cannot decrypt content streams, cropped pages would be blank",
    );
  }
  const outDoc = await PDFDocument.create();
  const copiedPages = await outDoc.copyPages(
    srcDoc,
    pageNumbers.map((p) => p - 1),
  );
  for (const page of copiedPages) {
    outDoc.addPage(page);
  }
  const outBytes = await outDoc.save();
  const tempDir = PathUtils.join(PathUtils.tempDir, "aiocr-pagerange");
  await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });
  const tempPath = PathUtils.join(
    tempDir,
    `pages-${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}-${Date.now()}.pdf`,
  );
  await IOUtils.write(tempPath, outBytes);
  return tempPath;
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
  if (Array.isArray(prunedResult.rec_texts)) {
    return prunedResult.rec_texts.join("\n");
  }
  return JSON.stringify(prunedResult, null, 2);
}

const ASYNC_JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";

function buildMultipartBody(
  fileBytes: Uint8Array,
  fileName: string,
  fileContentType: string,
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
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${fileContentType}\r\n\r\n`,
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

export async function callAsyncAPI(
  engine: EngineType,
  filePath: string,
  isPdf: boolean,
  onProgress?: (current: number, total: number) => void,
): Promise<OCRPageResult[]> {
  try {
    const endpoint = getActiveEndpoint(engine);
    if (!endpoint) {
      throw new Error(
        `No API endpoint configured for ${engine}. Please configure one in the preferences.`,
      );
    }

    const modelConfig = ENGINE_MODELS[engine] as any;
    const advancedFeatures = getResolvedAdvancedFeatures(engine);

    const fileBytes = await IOUtils.read(filePath);
    const fileName = isPdf ? "document.pdf" : "image.png";
    const fileContentType = isPdf ? "application/pdf" : "image/png";

    const { body: submitBody, contentType } = buildMultipartBody(
      fileBytes,
      fileName,
      fileContentType,
      {
        model: modelConfig.asyncModelName,
        optionalPayload: JSON.stringify(advancedFeatures),
      },
    );

    const submitResponse = await httpRequestWithRetry("POST", ASYNC_JOB_URL, {
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
      throwIfCancelled();
      await Zotero.Promise.delay(3000);

      const pollResponse = await httpRequestWithRetry(
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

        const jsonlResponse = await httpRequestWithRetry("GET", jsonUrl, {
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
  } catch (e: any) {
    throw describeHttpError(e, "PaddleOCR");
  }
}

async function extractMarkdownFromZip(zipBuffer: Uint8Array): Promise<string> {
  const tempDir = PathUtils.join(PathUtils.tempDir, "aiocr-mineru");
  await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });
  const tempZipPath = PathUtils.join(tempDir, `mineru-${Date.now()}.zip`);

  await IOUtils.write(tempZipPath, zipBuffer);

  try {
    // Components.classes 的_contractID 索引签名未在类型中声明，按 any 访问
    const Cc = Components.classes as any;
    const Ci = Components.interfaces as any;
    const zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
      Ci.nsIZipReader,
    );

    const zipFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
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
    const mdFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
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
  try {
    const endpoint = getActiveEndpoint(engine);
    if (!endpoint) {
      throw new Error(
        `No API endpoint configured for ${engine}. Please configure one in the preferences.`,
      );
    }

    const modelConfig = ENGINE_MODELS[engine] as any;
    const advancedFeatures = getResolvedAdvancedFeatures(engine);
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

    const submitResponse = await httpRequestWithRetry(
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
      throwIfCancelled();
      await Zotero.Promise.delay(3000);

      const pollResponse = await httpRequestWithRetry(
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
  } catch (e: any) {
    throw describeHttpError(e, "MinerU");
  }
}

function getModelBestBaseUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/**
 * 面壁智能（ModelBest）文档解析引擎。
 * 单图走同步接口 POST /v1/document-parse（JSON 直传 base64 图片）；
 * PDF 走异步任务 POST /v1/document-parse/jobs（multipart 直传文件，服务端逐页渲染），
 * 轮询 GET /v1/document-parse/jobs/{id} 直到 Success/Failed/Cancelled。
 * 高级功能：upright（方向矫正）、recognize_seal（印章识别）——API 默认均为 true，
 * 需显式传布尔值（经 getResolvedAdvancedFeatures 全量解析）。
 */
export async function callModelBestAPI(
  engine: EngineType,
  filePath: string,
  isPdf: boolean,
  onProgress?: (current: number, total: number) => void,
): Promise<OCRPageResult[]> {
  try {
    const endpoint = getActiveEndpoint(engine);
    if (!endpoint) {
      throw new Error(
        `No API endpoint configured for ${engine}. Please configure one in the preferences.`,
      );
    }

    const baseUrl = getModelBestBaseUrl(endpoint.url);
    const modelConfig = ENGINE_MODELS[engine] as any;
    const modelName = modelConfig.asyncModelName;
    const advancedFeatures = getResolvedAdvancedFeatures(engine);

    const authHeaders: Record<string, string> = {
      Authorization: `Bearer ${endpoint.token}`,
    };

    if (!isPdf) {
      // 同步接口：单图识别（仅支持图片，PDF 走异步任务）
      const fileBase64 = await readFileAsBase64(filePath);
      const fileName = filePath.replace(/\\/g, "/").split("/").pop() || "";
      let mimeType = "image/png";
      const ext = fileName.toLowerCase();
      if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) {
        mimeType = "image/jpeg";
      } else if (ext.endsWith(".gif")) {
        mimeType = "image/gif";
      } else if (ext.endsWith(".webp")) {
        mimeType = "image/webp";
      } else if (ext.endsWith(".bmp")) {
        mimeType = "image/bmp";
      }

      const payload = {
        model: modelName,
        image: `data:${mimeType};base64,${fileBase64}`,
        ...advancedFeatures,
      };

      const response = await httpRequestWithRetry(
        "POST",
        `${baseUrl}/v1/document-parse`,
        {
          body: JSON.stringify(payload),
          headers: { "Content-Type": "application/json", ...authHeaders },
          responseType: "text",
          timeout: 300000,
        },
      );

      const data = JSON.parse(response.responseText || "{}");
      if (data.error) {
        throw new Error(data.error.message || "ModelBest OCR API error");
      }
      const markdown =
        data.choices?.[0]?.message?.content || data.markdown || "";
      return [
        {
          pageNumber: 1,
          markdown,
          plainText: markdown,
          blocks: [],
        },
      ];
    }

    // 异步任务：multipart 直传 PDF，服务端按页解析（最多 500 页，144 DPI）
    const fileBytes = await IOUtils.read(filePath);
    const { body: submitBody, contentType } = buildMultipartBody(
      fileBytes,
      "document.pdf",
      "application/pdf",
      {
        model: modelName,
        upright: String(advancedFeatures.upright),
        recognize_seal: String(advancedFeatures.recognize_seal),
      },
    );

    const submitResponse = await httpRequestWithRetry(
      "POST",
      `${baseUrl}/v1/document-parse/jobs`,
      {
        body: submitBody as any,
        headers: { "Content-Type": contentType, ...authHeaders },
        responseType: "text",
        timeout: 120000,
      },
    );

    const submitData = JSON.parse(submitResponse.responseText || "{}");
    if (submitData.error) {
      throw new Error(
        submitData.error.message || "Failed to submit ModelBest OCR job",
      );
    }
    const jobId = submitData.id;
    if (!jobId) {
      throw new Error("No job id returned from ModelBest");
    }

    if (onProgress) onProgress(0, 1);

    // 官方建议轮询 1-2 秒一次，客户端 15 分钟截止
    const deadline = Date.now() + 15 * 60 * 1000;
    while (true) {
      throwIfCancelled();
      await Zotero.Promise.delay(2000);
      if (Date.now() > deadline) {
        throw new Error(
          "ModelBest OCR job timed out after 15 minutes; please retry later",
        );
      }

      const pollResponse = await httpRequestWithRetry(
        "GET",
        `${baseUrl}/v1/document-parse/jobs/${jobId}`,
        {
          headers: { "Content-Type": "application/json", ...authHeaders },
          responseType: "text",
          timeout: 30000,
        },
      );

      const pollData = JSON.parse(pollResponse.responseText || "{}");
      if (pollData.error) {
        throw new Error(
          pollData.error.message || "ModelBest OCR job polling failed",
        );
      }

      const status = pollData.status;
      if (status === "Running" || status === "Queued" || status === "Pending") {
        const done = pollData.pages_done || 0;
        const total = pollData.pages_total || 0;
        if (onProgress && total > 0) {
          onProgress(done, total);
        } else if (onProgress) {
          onProgress(0, 1);
        }
        continue;
      }

      if (status === "Success") {
        const jobPages = pollData.pages || [];
        const results: OCRPageResult[] = [];
        for (const page of jobPages) {
          const pageIndex = (page.metadata && page.metadata.page_index) || 0;
          const md =
            (page.choices &&
              page.choices[0] &&
              page.choices[0].message &&
              page.choices[0].message.content) ||
            "";
          results.push({
            pageNumber: pageIndex + 1,
            markdown: md,
            plainText: md,
            blocks: [],
          });
        }
        if (results.length === 0 && pollData.markdown) {
          // 兜底：任务级合并 markdown
          results.push({
            pageNumber: 1,
            markdown: pollData.markdown,
            plainText: pollData.markdown,
            blocks: [],
          });
        }
        return results;
      }

      if (status === "Failed") {
        const jobError =
          typeof pollData.error === "string"
            ? pollData.error
            : pollData.error?.message;
        throw new Error(jobError || "ModelBest OCR job failed");
      }

      if (status === "Cancelled") {
        throw new Error("ModelBest OCR job was cancelled");
      }
    }
  } catch (e: any) {
    throw describeHttpError(e, "面壁智能");
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
    const internal = reader._internalReader || reader._internal;
    if (internal?._primaryView?._iframeWindow) {
      return internal._primaryView._iframeWindow;
    }
  } catch {
    /* ignore */
  }
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

async function waitForPdfDocument(
  iframeWindow: any,
  timeoutMs = 20000,
): Promise<any> {
  const Cu = (Components as any).utils;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const pva =
        iframeWindow?.PDFViewerApplication ||
        iframeWindow?.wrappedJSObject?.PDFViewerApplication;
      if (pva) {
        let doc = null;
        try {
          doc = pva.pdfDocument;
        } catch {
          /* ignore */
        }
        if (!doc) {
          try {
            doc = Cu.waiveXrays(pva).pdfDocument;
          } catch {
            /* ignore */
          }
        }
        if (doc) return doc;
      }
    } catch {
      /* ignore */
    }
    await Zotero.Promise.delay(500);
  }
  return null;
}

/**
 * 直接复用 Reader 中 pdf.js viewer 已加载的文档对象（PDFViewerApplication.pdfDocument）渲染页面。
 *
 * 这是对加密 PDF（如读秀/超星扫描件，空用户口令加密）唯一可靠的渲染方式：
 * viewer 打开文档时已完成解密，其 pdfDocument 与屏幕上显示的内容完全一致；
 * 而 getDocument({data}) 重新解析加密字节流可能产出空白内容。
 */
async function renderPagesFromLoadedDocument(
  iframeWindow: any,
  pageNumbers?: number[],
  onProgress?: (current: number, total: number) => void,
): Promise<{ base64: string; pageNumber: number }[]> {
  const Cu = (Components as any).utils;
  const doc = await waitForPdfDocument(iframeWindow);
  if (!doc) {
    throw new Error("PDFViewerApplication.pdfDocument not ready");
  }
  const waivedDoc = Cu.waiveXrays(doc);
  const numPages = waivedDoc.numPages;
  if (!numPages || numPages < 1) {
    throw new Error(`invalid numPages: ${numPages}`);
  }
  const pagesToRender =
    pageNumbers && pageNumbers.length > 0
      ? pageNumbers.filter((p) => p >= 1 && p <= numPages)
      : Array.from(
          { length: Math.min(numPages, MAX_AI_PDF_PAGES) },
          (_, i) => i + 1,
        );
  if (pagesToRender.length === 0) {
    throw new Error(`no pages to render (numPages=${numPages})`);
  }
  ztoolkit.log(
    `[AIOCR] renderPagesFromLoadedDocument: doc.numPages=${numPages}, rendering ${pagesToRender.length} pages`,
  );

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
    if (!vpWidth || !vpHeight || isNaN(vpWidth) || isNaN(vpHeight)) {
      throw new Error(
        `Page ${pageNum} viewport is invalid (${vpWidth}x${vpHeight})`,
      );
    }

    const canvas = iframeWindow.document.createElement("canvas");
    canvas.width = vpWidth;
    canvas.height = vpHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const renderOpts = new iframeWindow.Object();
    renderOpts.canvasContext = ctx;
    renderOpts.viewport = waivedViewport;

    await waivedPage.render(renderOpts).promise;

    const dataUrl = canvas.toDataURL("image/png");
    images.push({ base64: dataUrl.split(",")[1], pageNumber: pageNum });

    ztoolkit.log(
      `[AIOCR] renderPagesFromLoadedDocument: page ${pageNum} (${idx + 1}/${pagesToRender.length}) rendered, base64 length=${dataUrl.length}`,
    );
    if (onProgress) onProgress(idx + 1, pagesToRender.length);
  }
  return images;
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
    // 优先尝试从 Reader 获取 pdf.js（在 HTML iframe 中渲染，CMap 字体支持更完善）
    let pdfjsLib: any = null;
    let iframeWindow: any = null;
    // 目标 PDF 所在 Reader 的 iframe 窗口（用于复用已加载的 pdfDocument 渲染）
    let targetIframeWindow: any = null;

    if (itemId) {
      const existingReaders = getReaders();
      for (const reader of existingReaders) {
        try {
          const readerItemId = reader._item?.id || reader.itemID;
          if (readerItemId === itemId) {
            targetIframeWindow = getIframeWindow(reader);
            const lib = extractPdfJsFromReader(reader);
            if (lib) {
              pdfjsLib = lib;
              iframeWindow = targetIframeWindow;
              ztoolkit.log(
                "[AIOCR] pdfToImages: got pdfjsLib from existing reader for this item",
              );
            }
            break;
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (!targetIframeWindow && itemId) {
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
            const win = getIframeWindow(openedReader);
            const extracted = win ? extractPdfJsFromReader(openedReader) : null;
            let docReady = false;
            if (win) {
              try {
                const pva =
                  win.PDFViewerApplication ||
                  win.wrappedJSObject?.PDFViewerApplication;
                docReady = !!pva?.pdfDocument;
              } catch {
                /* ignore */
              }
            }
            // pdfjsLib 或 pdfDocument 任一就绪即可继续（优先级0路径不依赖 pdfjsLib）
            if (extracted || docReady) {
              return { lib: extracted, win };
            }
            await Zotero.Promise.delay(500);
          }
          return null;
        })();

        if (result?.win) {
          pdfjsLib = result.lib;
          iframeWindow = result.win;
          targetIframeWindow = result.win;
          ztoolkit.log(
            `[AIOCR] pdfToImages: reader ready (pdfjsLib=${!!result.lib}), continuing`,
          );
        } else {
          // 兜底：viewer iframe 至少应存在，交给 waitForPdfDocument 轮询
          targetIframeWindow = getIframeWindow(openedReader);
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

    // 优先级0：直接渲染目标 Reader 已加载的 pdfDocument（viewer 已完成解密，
    // 与屏幕显示完全一致，是加密 PDF 唯一可靠的渲染方式）
    if (targetIframeWindow) {
      try {
        ztoolkit.log(
          "[AIOCR] pdfToImages: trying loaded-document rendering (PDFViewerApplication.pdfDocument)...",
        );
        const images = await renderPagesFromLoadedDocument(
          targetIframeWindow,
          pageNumbers,
          onProgress,
        );
        ztoolkit.log(
          `[AIOCR] pdfToImages: loaded-document rendering succeeded, ${images.length} pages`,
        );
        return images;
      } catch (e: any) {
        ztoolkit.log(
          `[AIOCR] pdfToImages: loaded-document rendering failed: ${e.message}, trying getDocument approaches...`,
        );
      }
    }

    // 优先级1：CrossCompartment（HTML iframe canvas，CMap 字体支持完善）
    if (pdfjsLib && iframeWindow) {
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
    }

    // 优先级2：IframeSandbox（HTML iframe sandbox，CMap 字体支持完善）
    if (iframeWindow) {
      try {
        const images = await renderPdfIframeSandbox(
          iframeWindow,
          filePath,
          onProgress,
          pageNumbers,
        );
        ztoolkit.log(
          `[AIOCR] pdfToImages: iframe sandbox rendering succeeded, ${images.length} pages`,
        );
        return images;
      } catch (e: any) {
        ztoolkit.log(
          `[AIOCR] pdfToImages: iframe sandbox rendering failed: ${e.message}, trying chrome compartment...`,
        );
      }
    }

    // 优先级3（最后回退）：Chrome compartment（XUL canvas，CMap 字体支持不完整）
    try {
      const chromePdfjsLib = await loadPdfJsDirect();
      if (chromePdfjsLib) {
        ztoolkit.log(
          "[AIOCR] pdfToImages: trying chrome compartment rendering (fallback)...",
        );
        const images = await renderPdfChrome(
          chromePdfjsLib,
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

    throw new Error(
      "无法获取 PDF 渲染环境。AI 视觉模型识别 PDF 需要 pdf.js 支持。\n请尝试以下方法：\n1. 先在 Zotero 中打开任意 PDF 文件（让 pdf.js 加载），然后重试\n2. 更新 Zotero 到最新版本\n3. 改用 PaddleOCR 或 MinerU 引擎",
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

  const doc = await pdfjsLib.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;
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
    ) as HTMLCanvasElement;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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

  const makeDocOpts = (data: any) => {
    const opts = new iframeWindow.Object();
    opts.data = data;
    opts.disableFontFace = true;
    opts.useSystemFonts = false;
    return opts;
  };

  if (iframeWindow) {
    try {
      const iframeBytes = new iframeWindow.Uint8Array(chromeBytes.length);
      iframeBytes.set(chromeBytes);
      doc = await waivedLib.getDocument(makeDocOpts(iframeBytes)).promise;
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
      doc = await waivedLib.getDocument(makeDocOpts(clonedBytes)).promise;
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
      doc = await waivedLib.getDocument({
        data: chromeBytes,
        disableFontFace: true,
        useSystemFonts: false,
      }).promise;
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

    iframeCtx.fillStyle = "#ffffff";
    iframeCtx.fillRect(0, 0, iframeCanvas.width, iframeCanvas.height);

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
      "    var doc = await pdfjsLib.getDocument({data: bytes, disableFontFace: true, useSystemFonts: false}).promise;",
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
      "      ctx.fillStyle = '#ffffff';",
      "      ctx.fillRect(0, 0, canvas.width, canvas.height);",
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
      "    var doc = await pdfjsLib.getDocument({data: bytes, disableFontFace: true, useSystemFonts: false}).promise;",
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
      "      ctx.fillStyle = '#ffffff';",
      "      ctx.fillRect(0, 0, canvas.width, canvas.height);",
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
  if (!resultJson) {
    throw new Error("renderPdfIframeSandbox: render returned no result");
  }

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
  provider: string,
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
    let response: any;
    try {
      response = await httpRequestWithRetry("POST", url, {
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
        responseType: "json",
        timeout: 300000,
      });
    } catch (e: any) {
      throw describeHttpError(e, providerConfig.name);
    }
    const data = response.response;
    if (data.error) throw new Error(data.error.message || "Gemini API error");
    const candidates = data.candidates || [];
    if (candidates.length > 0 && candidates[0].content?.parts?.length > 0) {
      // 过滤思考 parts（thought: true），再合并正文
      markdown = stripThinkingContent(
        candidates[0].content.parts
          .filter((p: any) => !p.thought)
          .map((p: any) => p.text || "")
          .join("\n"),
      );
    }
  } else {
    const baseUrl = apiBase.replace(/\/+$/, "");
    const url = `${baseUrl}/chat/completions`;
    const thinkingDisabled = THINKING_DISABLED_PARAMS[provider];

    const attempt = async (withThinkingDisabled: boolean): Promise<string> => {
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
      if (withThinkingDisabled && thinkingDisabled) {
        Object.assign(requestBody, thinkingDisabled);
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
      let response: any;
      try {
        response = await httpRequestWithRetry("POST", url, {
          body: JSON.stringify(requestBody),
          headers,
          responseType: "json",
          timeout: 300000,
        });
      } catch (e: any) {
        throw describeHttpError(e, providerConfig.name);
      }
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
        return choices[0].message.content;
      }
      return "";
    };

    try {
      markdown = await attempt(true);
    } catch (e: any) {
      if (thinkingDisabled) {
        // 部分平台/模型不支持关闭思考参数，去掉参数重试一次
        ztoolkit.log(
          `[AIOCR] callAIOneImage: request with thinking-disable params failed (${e.message}), retrying without them`,
        );
        markdown = await attempt(false);
      } else {
        throw e;
      }
    }
    markdown = stripThinkingContent(markdown);
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

/** 明显与视觉/文本生成无关的模型族，从自动获取的模型列表中排除 */
const NON_VISION_MODEL_RE =
  /embed|tts|whisper|dall-e|moderation|rerank|audio|speech|transcrib|image-gen|stable-diffusion|flux|veo|sora|imagen|aqa|guard|classif/i;

function normalizeModelNames(names: string[]): string[] {
  return Array.from(new Set(names))
    .filter((n) => !NON_VISION_MODEL_RE.test(n))
    .sort((a, b) => a.localeCompare(b));
}

/** Gemini listModels：过滤出支持 generateContent 的模型并剥掉 models/ 前缀 */
async function fetchGeminiModelList(
  listUrl: string,
  apiKey: string,
): Promise<string[]> {
  const resp = await httpRequestWithRetry(
    "GET",
    `${listUrl}?key=${encodeURIComponent(apiKey)}`,
    { responseType: "json", timeout: 15000 },
  );
  const models = resp.response?.models || [];
  return models
    .filter(
      (m: any) =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes("generateContent"),
    )
    .map((m: any) => String(m.name || "").replace(/^models\//, ""))
    .filter(Boolean);
}

/** Ollama 本地 /api/tags：列出已安装模型 */
async function fetchOllamaModelList(baseUrl: string): Promise<string[]> {
  let origin = baseUrl;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    /* keep base */
  }
  const resp = await httpRequestWithRetry("GET", `${origin}/api/tags`, {
    responseType: "json",
    timeout: 10000,
  });
  const models = resp.response?.models || [];
  return models.map((m: any) => m.name).filter(Boolean);
}

/** OpenAI 兼容 GET {base}/models（按认证格式带 Bearer 或 api-key 头） */
async function fetchOpenAICompatibleModelList(
  baseUrl: string,
  apiKey: string,
  authHeaderFormat?: "bearer" | "api-key",
): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    if (authHeaderFormat === "api-key") {
      headers["api-key"] = apiKey;
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
  }
  const resp = await httpRequestWithRetry("GET", `${baseUrl}/models`, {
    headers,
    responseType: "json",
    timeout: 15000,
  });
  const data = resp.response;
  const list = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : [];
  return list
    .map((m: any) => (typeof m === "string" ? m : m.id || m.name))
    .filter(Boolean)
    .map(String);
}

/**
 * 自动获取平台可用模型列表，供偏好设置中的模型名称下拉框使用。
 * OpenAI 兼容平台走 GET {base}/models（按平台认证头），
 * Gemini 走 listModels 并过滤出支持 generateContent 的模型，
 * Ollama 走本地 /api/tags。失败时返回空数组，由调用方回退为默认模型。
 */
export async function fetchAIModelList(
  engine: string,
  overrides?: { apiKey?: string; apiBase?: string },
): Promise<string[]> {
  const modelConfig = ENGINE_MODELS[engine as EngineType] as any;
  if (!modelConfig || modelConfig.platform !== "ai") return [];
  const provider = modelConfig.provider;
  const providerConfig = AI_PROVIDER_CONFIGS[provider];
  if (!providerConfig) return [];

  const cfg = getAIProviderConfig(engine);
  const apiKey =
    overrides && overrides.apiKey !== undefined ? overrides.apiKey : cfg.apiKey;
  const apiBase =
    overrides && overrides.apiBase ? overrides.apiBase : cfg.apiBase;
  const base = apiBase.replace(/\/+$/, "");

  try {
    let names: string[] = [];
    if (providerConfig.apiFormat === "gemini") {
      names = await fetchGeminiModelList(`${base}/models`, apiKey);
    } else if (provider === "ollama") {
      names = await fetchOllamaModelList(base);
    } else {
      names = await fetchOpenAICompatibleModelList(
        base,
        apiKey,
        providerConfig.authHeaderFormat,
      );
    }
    return normalizeModelNames(names);
  } catch (e: any) {
    ztoolkit.log(
      `[AIOCR] fetchAIModelList: failed for ${provider}: ${e.message}`,
    );
    return [];
  }
}

/**
 * 从自定义引擎的 API 地址拉取模型列表（自定义引擎无平台预设，按 URL 形态识别）：
 * - 含 generativelanguage → Gemini，从完整 generateContent 端点归位到 models 列表端点
 * - base 以 /api 结尾或含 :11434 → Ollama 本地 /api/tags
 * - 其余按 OpenAI 兼容 GET {base}/models（Bearer），base 支持带 /chat/completions 后缀
 * 失败时返回空数组，下拉框留空、仍可手动输入。
 */
export async function fetchModelListForEndpoint(
  apiUrl: string,
  apiKey: string,
): Promise<string[]> {
  const raw = apiUrl.trim().replace(/\/+$/, "");
  if (!raw) return [];
  try {
    if (isGeminiUrl(raw)) {
      let listUrl = raw.split(":generateContent")[0].replace(/\/+$/, "");
      if (/\/models\/[^/]+$/.test(listUrl)) {
        listUrl = listUrl.replace(/\/models\/[^/]+$/, "/models");
      } else if (!/\/models$/.test(listUrl)) {
        listUrl = `${listUrl}/models`;
      }
      return normalizeModelNames(await fetchGeminiModelList(listUrl, apiKey));
    }
    const base = raw.replace(/\/chat\/completions\/?$/, "");
    if (/\/api$/.test(base) || base.includes(":11434")) {
      return normalizeModelNames(await fetchOllamaModelList(base));
    }
    return normalizeModelNames(
      await fetchOpenAICompatibleModelList(base, apiKey),
    );
  } catch (e: any) {
    ztoolkit.log(
      `[AIOCR] fetchModelListForEndpoint: failed for ${raw}: ${e.message}`,
    );
    return [];
  }
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
      throwIfCancelled();
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
  const raw = customEngine.apiUrl.trim().replace(/\/+$/, "");
  const isGemini = isGeminiUrl(raw);

  if (isGemini) {
    const url = raw;
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
    let response: any;
    try {
      response = await httpRequestWithRetry("POST", fullUrl, {
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
        responseType: "json",
        timeout: 300000,
      });
    } catch (e: any) {
      throw describeHttpError(e, customEngine.name);
    }
    const data = response.response;
    if (data.error) throw new Error(data.error.message || "Gemini API error");
    const candidates = data.candidates || [];
    if (candidates.length > 0 && candidates[0].content?.parts?.length > 0) {
      // 过滤思考 parts（thought: true），再合并正文
      markdown = candidates[0].content.parts
        .filter((p: any) => !p.thought)
        .map((p: any) => p.text || "")
        .join("\n");
    }
  } else {
    // 地址兼容两种填法：裸 base（自动补 /chat/completions，与模型列表获取
    // 的归一化规则一致）或完整端点地址
    const url = /\/chat\/completions(\?.*)?$/.test(raw)
      ? raw
      : `${raw}/chat/completions`;
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
    let response: any;
    try {
      response = await httpRequestWithRetry("POST", url, {
        body: JSON.stringify(requestBody),
        headers,
        responseType: "json",
        timeout: 300000,
      });
    } catch (e: any) {
      throw describeHttpError(e, customEngine.name);
    }
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

  // 自定义引擎同样剥离思考内容
  return stripThinkingContent(markdown);
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
      throwIfCancelled();
      const img = images[i];
      if (onProgress) onProgress(i + 1, images.length);
      const markdown = await callAIOneImage(
        providerConfig,
        provider,
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
    provider,
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
      selectedEngine as EngineType,
      filePath,
      isPdf,
      onProgress,
      itemId,
    );
  } else if (modelConfig.platform === "modelbest") {
    pages = await callModelBestAPI(
      selectedEngine as EngineType,
      filePath,
      isPdf,
      onProgress,
    );
  } else if (modelConfig.platform === "mineru") {
    pages = await callMinerUAPI(
      selectedEngine as EngineType,
      filePath,
      isPdf,
      onProgress,
    );
  } else {
    // PaddleOCR 引擎：v1.7.0 起仅支持异步 API
    pages = await callAsyncAPI(
      selectedEngine as EngineType,
      filePath,
      isPdf,
      onProgress,
    );
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

    if (modelConfig.platform === "modelbest") {
      const modelBestBase = getModelBestBaseUrl(url);
      await Zotero.HTTP.request("GET", `${modelBestBase}/v1/models`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        responseType: "json",
        timeout: 10000,
      });
      return { success: true, message: getString("progress-test-success") };
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

    const testUrl = ASYNC_JOB_URL;

    const response = await Zotero.HTTP.request("POST", testUrl, {
      body: JSON.stringify({
        fileUrl: "https://example.com/test.pdf",
        model: modelConfig.asyncModelName,
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `bearer ${token}`,
      },
      responseType: "json",
      timeout: 10000,
    });

    const data = response.response;
    if (data.code === 0) {
      return { success: true, message: getString("progress-test-success") };
    }
    return {
      success: false,
      message: data.msg || "Unknown error",
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
