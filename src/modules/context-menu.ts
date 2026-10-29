import {
  performOCR,
  pdfToImages,
  callAsyncAPI,
  callModelBestAPI,
  extractPagesToTempPdf,
  OCRPageResult,
  ENGINE_ADVANCED_FEATURES,
  ENGINE_MODELS,
  EngineType,
  OcrCancelledError,
  requestOcrCancellation,
  resetOcrCancellation,
  isOcrCancelled,
} from "./ocr-engine";
import { handleBatchAnnotationsOCR } from "./annotation-ocr";
import {
  getPref,
  setPref,
  getAdvancedFeaturesForEngine,
  setAdvancedFeature,
  getCustomEngines,
} from "../utils/prefs";
import { getString } from "../utils/locale";

const ALL_ENGINES: { value: string; label: string }[] = [
  { value: "PP-OCRv6", label: "PP-OCRv6 (基础文字识别)" },
  { value: "PP-StructureV3", label: "PP-StructureV3 (文档结构解析)" },
  { value: "PaddleOCR-VL-1.6", label: "PaddleOCR-VL-1.6 (增强视觉语言模型)" },
  { value: "MinerU-pipeline", label: "MinerU-pipeline (文档解析)" },
  { value: "MinerU-vlm", label: "MinerU-vlm (推荐文档解析)" },
  { value: "MinerU-HTML", label: "MinerU-HTML (HTML解析)" },
  { value: "ModelBest-OCR", label: "面壁智能 MiniCPM-OCR (文档解析)" },
  { value: "AI-OpenAI", label: "OpenAI" },
  { value: "AI-Gemini", label: "Google Gemini" },
  { value: "AI-xAI", label: "xAI Grok" },
  { value: "AI-OpenRouter", label: "OpenRouter" },
  { value: "AI-SiliconFlow", label: "硅基流动" },
  { value: "AI-Doubao", label: "豆包" },
  { value: "AI-Zhipu", label: "智谱AI" },
  { value: "AI-Alibaba", label: "阿里云百炼" },
  { value: "AI-Ollama", label: "Ollama (本地)" },
  { value: "AI-Groq", label: "Groq" },
  { value: "AI-Mistral", label: "Mistral AI" },
  { value: "AI-ModelScope", label: "魔搭" },
  { value: "AI-Intern", label: "浦源书生" },
  { value: "AI-MiMo", label: "小米 MiMo" },
  { value: "AI-NVIDIA", label: "NVIDIA NIM" },
];

function truncateName(name: string, maxLength: number = 40): string {
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + "...";
}

/**
 * 向 Zotero 右键菜单注册菜单项（替代 toolkit 5.2.0 中已移除的 Menu.register）
 */
function registerMenuItem(
  win: _ZoteroTypes.MainWindow,
  id: string,
  label: string,
  icon: string,
  commandListener: (() => void) | null,
  isMenu: boolean = false,
) {
  const doc = win.document;
  const popup = doc.getElementById("zotero-itemmenu");
  if (!popup) {
    ztoolkit.log(`registerMenuItem: zotero-itemmenu not found for ${id}`);
    return;
  }

  // 若已注册则先移除，避免重复
  const existing = doc.getElementById(id);
  if (existing) existing.remove();

  const XUL_NS =
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  const el = doc.createElementNS(
    XUL_NS,
    isMenu ? "menu" : "menuitem",
  ) as XUL.Element;
  el.setAttribute("id", id);
  el.setAttribute("label", label);
  if (icon) {
    el.setAttribute("class", "menuitem-iconic");
    el.style.listStyleImage = `url(${icon})`;
  }
  if (commandListener) {
    el.addEventListener("command", commandListener);
  }
  if (isMenu) {
    const menupopup = doc.createElementNS(XUL_NS, "menupopup");
    el.appendChild(menupopup);
  }
  popup.appendChild(el);
}

export function registerContextMenu(win: _ZoteroTypes.MainWindow) {
  const menuIcon = `chrome://aiocr/content/icons/favicon@0.5x.png`;

  registerMenuItem(
    win,
    "zotero-itemmenu-aiocr-recognize",
    getString("menuitem-ocr"),
    menuIcon,
    () => handleSingleOCR(),
  );
  registerMenuItem(
    win,
    "zotero-itemmenu-aiocr-batch",
    getString("menuitem-batch-ocr"),
    menuIcon,
    () => handleBatchOCR(),
  );
  registerMenuItem(
    win,
    "zotero-itemmenu-aiocr-page-range",
    getString("menuitem-page-range-ocr"),
    menuIcon,
    () => handlePageRangeOCR(),
  );
  registerMenuItem(
    win,
    "zotero-itemmenu-aiocr-cancel",
    getString("menuitem-cancel-ocr"),
    menuIcon,
    () => {
      requestOcrCancellation();
      new ztoolkit.ProgressWindow(addon.data.config.addonName, {
        closeTime: 2500,
      })
        .createLine({
          text: getString("progress-cancel-requested"),
          type: "default",
          progress: 100,
        })
        .show();
    },
  );
  registerMenuItem(
    win,
    "zotero-itemmenu-aiocr-annotation-batch",
    getString("menuitem-annotation-batch-ocr"),
    menuIcon,
    () => {
      handleBatchAnnotationsOCR().catch((err: any) => {
        ztoolkit.log(`[AIOCR] Batch annotation OCR failed: ${err.message}`);
      });
    },
  );
  registerMenuItem(
    win,
    "zotero-itemmenu-aiocr-switch-engine",
    getString("menuitem-switch-engine"),
    menuIcon,
    null,
    true,
  );
  registerMenuItem(
    win,
    "zotero-itemmenu-aiocr-advanced",
    getString("menuitem-advanced-options"),
    menuIcon,
    null,
    true,
  );

  refreshEngineMenu();
  refreshAdvancedMenu();
}

/** 引擎标签：优先取语言文件（engine-<value>），缺失时回退到内置文案。
 * 注意：id 中的点号必须替换（scaffold 构建的 l10n 重写正则不认点号，
 * 引擎名 PaddleOCR-VL-1.6 对应键 engine-PaddleOCR-VL-1-6）；
 * getString 在键缺失时返回 "aiocr-<key>" 形式的占位串，据此判断是否回退 */
function engineLabel(value: string, fallback: string): string {
  const key = `engine-${value.replace(/\./g, "-")}`;
  const localized = getString(key as any);
  return localized === `aiocr-${key}` ? fallback : localized;
}

/** 自定义引擎的菜单标签：括号内显示当前使用的模型（模型缺失时回退为"自定义"） */
function customEngineMenuLabel(engine: {
  name: string;
  model: string;
}): string {
  return engine.model
    ? `${engine.name} (${engine.model})`
    : `${engine.name} (自定义)`;
}

function createGroupHeader(doc: Document, label: string): XUL.MenuItem {
  const headerItem = doc.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    "menuitem",
  ) as XUL.MenuItem;
  headerItem.setAttribute("label", label);
  headerItem.setAttribute("disabled", "true");
  headerItem.style.cssText = "color: #666; font-style: italic;";
  return headerItem;
}

export function refreshEngineMenu() {
  const doc = Zotero.getActiveZoteroPane()?.document;
  if (!doc) return;

  const currentEngine = getPref("engine") as string;

  const menu = doc.getElementById("zotero-itemmenu-aiocr-switch-engine");
  if (!menu) return;

  let menupopup = menu.querySelector("menupopup");
  if (!menupopup) {
    menupopup = doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "menupopup",
    );
    menu.appendChild(menupopup);
  }

  while (menupopup.firstChild) {
    menupopup.removeChild(menupopup.firstChild);
  }

  const groups: {
    headerKey: string;
    match: (value: string) => boolean;
  }[] = [
    {
      headerKey: "menu-group-paddle",
      match: (v) => v.startsWith("PP-") || v.startsWith("PaddleOCR"),
    },
    { headerKey: "menu-group-mineru", match: (v) => v.startsWith("MinerU") },
    { headerKey: "menu-group-modelbest", match: (v) => v === "ModelBest-OCR" },
    { headerKey: "menu-group-ai", match: (v) => v.startsWith("AI-") },
  ];

  let isFirstGroup = true;
  for (const group of groups) {
    const engines = ALL_ENGINES.filter((e) => group.match(e.value));
    if (engines.length === 0) continue;

    if (!isFirstGroup) {
      menupopup.appendChild(
        doc.createElementNS(
          "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
          "menuseparator",
        ),
      );
    }
    isFirstGroup = false;

    menupopup.appendChild(
      createGroupHeader(doc, getString(group.headerKey as any)),
    );

    for (const eng of engines) {
      menupopup.appendChild(
        createEngineMenuItem(
          doc,
          { value: eng.value, label: engineLabel(eng.value, eng.label) },
          currentEngine,
        ),
      );
    }
  }

  const customEngines = getCustomEngines();
  if (customEngines.length > 0) {
    menupopup.appendChild(
      doc.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "menuseparator",
      ),
    );
    menupopup.appendChild(
      createGroupHeader(doc, getString("menu-group-custom")),
    );

    for (const engine of customEngines) {
      menupopup.appendChild(
        createEngineMenuItem(
          doc,
          {
            value: engine.id,
            // 括号内显示当前使用的模型，便于区分同服务的多个自定义引擎
            label: customEngineMenuLabel(engine),
          },
          currentEngine,
        ),
      );
    }
  }
}

function createEngineMenuItem(
  doc: Document,
  eng: { value: string; label: string },
  currentEngine: string,
): XUL.MenuItem {
  const menuItem = doc.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    "menuitem",
  ) as XUL.MenuItem;
  menuItem.setAttribute("label", eng.label);
  menuItem.setAttribute("type", "radio");
  menuItem.setAttribute("name", "aiocr-engine-group");
  if (eng.value === currentEngine) {
    menuItem.setAttribute("checked", "true");
  }
  menuItem.setAttribute("data-engine", eng.value);

  menuItem.addEventListener("command", (e: Event) => {
    const target = e.target as XUL.MenuItem;
    const newEngine = target.getAttribute("data-engine") || "";
    if (newEngine) {
      setPref("engine", newEngine);
      refreshAdvancedMenu();
    }
  });

  return menuItem;
}

export function refreshAdvancedMenu() {
  const doc = Zotero.getActiveZoteroPane()?.document;
  if (!doc) return;

  const engine = getPref("engine") as string;
  const features = ENGINE_ADVANCED_FEATURES[engine] || [];
  const currentFeatures = getAdvancedFeaturesForEngine(engine);

  const menu = doc.getElementById("zotero-itemmenu-aiocr-advanced");
  if (!menu) return;

  let menupopup = menu.querySelector("menupopup");
  if (!menupopup) {
    menupopup = doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "menupopup",
    );
    menu.appendChild(menupopup);
  }

  while (menupopup.firstChild) {
    menupopup.removeChild(menupopup.firstChild);
  }

  const headerItem = doc.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    "menuitem",
  ) as XUL.MenuItem;
  headerItem.setAttribute(
    "label",
    getString("advanced-engine-header", { args: { engine } }),
  );
  headerItem.setAttribute("disabled", "true");
  headerItem.style.cssText = "font-weight: bold; color: #1976d2;";
  menupopup.appendChild(headerItem);

  const modelConfig = ENGINE_MODELS[engine as EngineType];
  if (modelConfig && (modelConfig as any).platform === "mineru") {
    const infoItem = doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "menuitem",
    ) as XUL.MenuItem;
    infoItem.setAttribute("label", getString("menu-mineru-async-only"));
    infoItem.setAttribute("disabled", "true");
    infoItem.style.cssText = "color: #999; font-size: 11px;";
    menupopup.appendChild(infoItem);
  }
  if (modelConfig && (modelConfig as any).asyncOnly === true) {
    const infoItem = doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "menuitem",
    ) as XUL.MenuItem;
    infoItem.setAttribute("label", getString("menu-async-only"));
    infoItem.setAttribute("disabled", "true");
    infoItem.style.cssText = "color: #999; font-size: 11px;";
    menupopup.appendChild(infoItem);
  }

  const separator = doc.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    "menuseparator",
  );
  menupopup.appendChild(separator);

  for (const feature of features) {
    const isChecked = currentFeatures[feature.key] ?? feature.defaultValue;
    const menuItem = doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "menuitem",
    );
    menuItem.setAttribute("label", getString(feature.labelKey as any));
    menuItem.setAttribute("type", "checkbox");
    if (isChecked) {
      menuItem.setAttribute("checked", "true");
    }
    menuItem.setAttribute("data-engine", engine);
    menuItem.setAttribute("data-feature", feature.key);

    menuItem.addEventListener("command", (e: Event) => {
      const target = e.target as XUL.MenuItem;
      const eng = target.getAttribute("data-engine") || "";
      const feat = target.getAttribute("data-feature") || "";
      const newState = target.getAttribute("checked") === "true";
      setAdvancedFeature(eng, feat, newState);
    });

    menupopup.appendChild(menuItem);
  }
}

function getSelectedPdfAttachments(): Zotero.Item[] {
  const pane = Zotero.getActiveZoteroPane();
  const items = pane ? pane.getSelectedItems() : [];
  const attachments: Zotero.Item[] = [];

  for (const item of items) {
    if (!item) continue;
    if (item.isAttachment()) {
      if (item.attachmentContentType === "application/pdf") {
        attachments.push(item);
      }
    } else {
      const itemAttachments = item
        .getAttachments()
        .map((id: number) => Zotero.Items.get(id))
        .filter((att: Zotero.Item | false): att is Zotero.Item => !!att)
        .filter(
          (att: Zotero.Item) =>
            att.isAttachment() &&
            att.attachmentContentType === "application/pdf",
        );
      attachments.push(...itemAttachments);
    }
  }

  return attachments;
}

/** 单名创作者取 name，常规创作者取 lastName（Creator 联合类型的统一取值） */
function creatorDisplayName(creator: any): string {
  return creator.lastName || creator.name || "";
}

async function getPdfPageCount(filePath: string): Promise<number> {
  try {
    const bytes = await IOUtils.read(filePath);
    const text = new TextDecoder().decode(bytes);
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

function generateNoteTitle(
  attachment: Zotero.Item,
  engineName: string,
): string {
  const namingMode = getPref("noteNaming") as string;

  if (namingMode === "default") {
    return `OCR Result (${engineName})`;
  }

  const parentItem = attachment.parentItemID
    ? Zotero.Items.get(attachment.parentItemID)
    : null;

  if (namingMode === "zotero" && parentItem) {
    try {
      const creators = parentItem.getCreators();
      let firstCreator = "";
      if (creators.length === 1) {
        firstCreator = creatorDisplayName(creators[0]);
      } else if (creators.length === 2) {
        firstCreator = `${creatorDisplayName(creators[0])} and ${creatorDisplayName(creators[1])}`;
      } else if (creators.length > 2) {
        firstCreator = `${creatorDisplayName(creators[0])} et al.`;
      }

      const year = parentItem.getField("year") || "";
      const title = (parentItem.getField("title") || "").substring(0, 100);
      const parts = [
        firstCreator,
        year,
        title ? `${title} - OCR` : "OCR Result",
      ].filter(Boolean);
      return parts.join(" - ");
    } catch {
      return `OCR Result (${engineName})`;
    }
  }

  if (namingMode === "custom") {
    const template = getPref("customNamingTemplate") as string;
    if (!template || !parentItem) {
      return `OCR Result (${engineName})`;
    }
    try {
      return resolveNamingTemplate(
        template,
        parentItem,
        attachment,
        engineName,
      );
    } catch {
      return `OCR Result (${engineName})`;
    }
  }

  return `OCR Result (${engineName})`;
}

interface TemplateParams {
  suffix?: string;
  prefix?: string;
  truncate?: number;
  max?: number;
  start?: number;
  case?: string;
}

function parseTemplateVariable(match: string): {
  variable: string;
  params: TemplateParams;
} {
  const params: TemplateParams = {};

  const varMatch = match.match(/^\{\{\s*(\w+)/);
  if (!varMatch) return { variable: "", params };
  const variable = varMatch[1];

  const paramRegex = /(\w+)=(?:"([^"]*)"|'([^']*)')/g;
  let paramMatch;
  while ((paramMatch = paramRegex.exec(match)) !== null) {
    const key = paramMatch[1];
    const val = paramMatch[2] !== undefined ? paramMatch[2] : paramMatch[3];
    if (key === "suffix") params.suffix = val;
    else if (key === "prefix") params.prefix = val;
    else if (key === "truncate") params.truncate = parseInt(val, 10);
    else if (key === "max") params.max = parseInt(val, 10);
    else if (key === "start") params.start = parseInt(val, 10);
    else if (key === "case") params.case = val;
  }

  return { variable, params };
}

function applyTemplateParams(value: string, params: TemplateParams): string {
  if (!value) return "";

  if (params.start && params.start > 0) {
    value = value.substring(params.start);
  }

  if (params.max && params.max > 0) {
    const creators = value.split(", ");
    if (creators.length > params.max) {
      value = creators.slice(0, params.max).join(", ") + " et al.";
    }
  }

  if (params.truncate && params.truncate > 0) {
    value = value.substring(0, params.truncate);
  }

  if (params.case) {
    switch (params.case) {
      case "upper":
        value = value.toUpperCase();
        break;
      case "lower":
        value = value.toLowerCase();
        break;
      case "title":
        value = value.replace(
          /\w\S*/g,
          (t) => t.charAt(0).toUpperCase() + t.substring(1).toLowerCase(),
        );
        break;
      case "snake":
        value = value.replace(/\s+/g, "_").toLowerCase();
        break;
      case "hyphen":
        value = value.replace(/\s+/g, "-").toLowerCase();
        break;
      case "camel":
        value = value
          .replace(/(?:^\w|[A-Z]|\b\w)/g, (t, i) =>
            i === 0 ? t.toLowerCase() : t.toUpperCase(),
          )
          .replace(/\s+/g, "");
        break;
    }
  }

  if (params.prefix) {
    value = params.prefix + value;
  }

  if (params.suffix) {
    value = value + params.suffix;
  }

  return value;
}

function resolveNamingTemplate(
  template: string,
  parentItem: Zotero.Item,
  attachment: Zotero.Item,
  engineName: string,
): string {
  let result = template;

  const variableRegex = /\{\{\s*\w+(?:\s+\w+=(?:"[^"]*"|'[^']*'))*\s*\}\}/g;
  let match;

  while ((match = variableRegex.exec(template)) !== null) {
    const fullMatch = match[0];
    const { variable, params } = parseTemplateVariable(fullMatch);

    if (!variable) {
      result = result.replace(fullMatch, "");
      continue;
    }

    let value = "";

    switch (variable) {
      case "firstCreator": {
        const creators = parentItem.getCreators();
        if (creators.length === 1) {
          value = creatorDisplayName(creators[0]);
        } else if (creators.length === 2) {
          value = `${creatorDisplayName(creators[0])} and ${creatorDisplayName(creators[1])}`;
        } else if (creators.length > 2) {
          value = `${creatorDisplayName(creators[0])} et al.`;
        }
        break;
      }
      case "authors": {
        const creators = parentItem.getCreators();
        value = creators
          .filter(
            (c: any) => c.creatorTypeID === Zotero.CreatorTypes.getID("author"),
          )
          .map((c: any) => c.lastName || c.name || "")
          .join(", ");
        break;
      }
      case "authorsCount": {
        const creators = parentItem.getCreators();
        value = String(
          creators.filter(
            (c: any) => c.creatorTypeID === Zotero.CreatorTypes.getID("author"),
          ).length,
        );
        break;
      }
      case "editors": {
        const creators = parentItem.getCreators();
        value = creators
          .filter(
            (c: any) => c.creatorTypeID === Zotero.CreatorTypes.getID("editor"),
          )
          .map((c: any) => c.lastName || c.name || "")
          .join(", ");
        break;
      }
      case "year":
        value = parentItem.getField("year") || "";
        break;
      case "title":
        value = parentItem.getField("title") || "";
        break;
      case "itemType":
        value = parentItem.getField("itemType") || "";
        break;
      case "attachmentTitle":
        value = attachment.getDisplayTitle() || "";
        break;
      default:
        try {
          value = parentItem.getField(variable) || "";
        } catch {
          value = "";
        }
    }

    if (value) {
      value = applyTemplateParams(value, params);
      result = result.replace(fullMatch, value);
    } else {
      result = result.replace(fullMatch, "");
    }
  }

  result = result.replace(/\s{2,}/g, " ").trim();
  result = result.replace(/^[\s\-_]+|[\s\-_]+$/g, "");

  return result || `OCR Result (${engineName})`;
}

async function handleSingleOCR() {
  resetOcrCancellation();
  const attachments = getSelectedPdfAttachments();
  if (attachments.length === 0) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: "No PDF attachment selected",
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  const attachment = attachments[0];
  await processOCRForAttachment(attachment);
}

async function handleBatchOCR() {
  resetOcrCancellation();
  const attachments = getSelectedPdfAttachments();
  if (attachments.length === 0) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: "No PDF attachments selected",
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  const total = attachments.length;
  let success = 0;
  let failed = 0;
  let cancelled = false;

  const progressWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("progress-batch-start", {
        args: { total: String(total) },
      }),
      type: "default",
      progress: 0,
    })
    .show();

  for (let i = 0; i < attachments.length; i++) {
    if (isOcrCancelled()) {
      cancelled = true;
      break;
    }
    const att = attachments[i];
    const name = truncateName(att.getDisplayTitle());

    progressWin.changeLine({
      text: getString("progress-batch-item", {
        args: {
          current: String(i + 1),
          total: String(total),
          name,
        },
      }),
      progress: Math.round(((i + 1) / total) * 100),
    });

    try {
      await processOCRForAttachment(att, true);
      success++;
    } catch (e: any) {
      if (e instanceof OcrCancelledError) {
        cancelled = true;
        break;
      }
      ztoolkit.log(`Batch OCR failed for ${name}:`, e);
      failed++;
    }
  }

  if (cancelled) {
    progressWin.changeLine({
      text: getString("progress-cancelled"),
      type: "default",
      progress: 100,
    });
  } else {
    progressWin.changeLine({
      text: getString("progress-batch-done", {
        args: {
          success: String(success),
          failed: String(failed),
        },
      }),
      type: failed > 0 ? "fail" : "success",
      progress: 100,
    });
  }
  progressWin.startCloseTimer(5000);
}

function parsePageRange(input: string, maxPage: number): number[] {
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

async function handlePageRangeOCR() {
  const attachments = getSelectedPdfAttachments();
  if (attachments.length === 0) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-page-range-no-pdf"),
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  const engine = (getPref("engine") as string) || "PP-OCRv6";
  const modelConfig = ENGINE_MODELS[engine as EngineType];
  const isMinerU = modelConfig && (modelConfig as any).platform === "mineru";

  if (isMinerU) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-page-range-mineru-unsupported"),
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  const attachment = attachments[0];
  const filePath = await attachment.getFilePathAsync();
  if (!filePath) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-page-range-no-pdf"),
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  const pageCount = await getPdfPageCount(filePath);
  const promptMsg =
    pageCount > 0
      ? `该 PDF 共 ${pageCount} 页，请输入要识别的页码范围（如: 1-5, 8, 10-12）：`
      : "请输入要识别的页码范围（如: 1-5, 8, 10-12）：";

  const input = { value: "" };
  const ok = Services.prompt.prompt(
    null as any,
    getString("menuitem-page-range-ocr"),
    promptMsg,
    input,
    null as any,
    {} as any,
  );

  if (!ok || !input.value.trim()) return;

  const maxPage = pageCount > 0 ? pageCount : 9999;
  const pageNumbers = parsePageRange(input.value.trim(), maxPage);

  if (pageNumbers.length === 0) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-page-range-invalid"),
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  await processPageRangeOCR(attachment, pageNumbers);
}

function pagesHaveText(pages: OCRPageResult[]): boolean {
  return pages.some((p) => p.markdown.trim().length > 0);
}

/**
 * 以"直接上传文件"方式调用当前引擎。
 * 面壁智能走其专用接口（单图同步 / PDF 异步任务，服务端逐页解析，天然支持加密 PDF）；
 * PaddleOCR v1.7.0 起仅支持异步 API。
 */
function callPdfUploadEngine(
  engine: EngineType,
  modelConfig: any,
  filePath: string,
  isPdf: boolean,
  onProgress?: (current: number, total: number) => void,
): Promise<OCRPageResult[]> {
  if ((modelConfig as any).platform === "modelbest") {
    return callModelBestAPI(engine, filePath, isPdf, onProgress);
  }
  return callAsyncAPI(engine, filePath, isPdf, onProgress);
}

async function tryOcrPageRangeViaPdfUpload(
  filePath: string,
  engine: EngineType,
  modelConfig: any,
  pageNumbers: number[],
  progressWin: any,
): Promise<OCRPageResult[]> {
  let tempPdfPath: string | null = null;
  try {
    tempPdfPath = await extractPagesToTempPdf(filePath, pageNumbers);
    const onProgress = (current: number, total: number) => {
      progressWin?.changeLine({
        text: getString("progress-page-range-page", {
          args: { current: String(current), total: String(total) },
        }),
        progress: Math.round((current / Math.max(total, 1)) * 90),
      });
    };
    const pages = await callPdfUploadEngine(
      engine,
      modelConfig,
      tempPdfPath,
      true,
      onProgress,
    );
    if (pages.length === 0) {
      throw new Error("OCR result has no pages");
    }
    const remapped = pages.map((p, i) => ({
      ...p,
      pageNumber: pageNumbers[i] ?? i + 1,
    }));
    ztoolkit.log(
      `[AIOCR] page-range: cropped-PDF flow returned ${remapped.length} page(s), hasText=${pagesHaveText(remapped)}`,
    );
    return remapped;
  } catch (e: any) {
    ztoolkit.log(
      `[AIOCR] page-range: cropped-PDF upload failed (${e.message}), will try full-PDF upload`,
    );
    return [];
  } finally {
    if (tempPdfPath) {
      try {
        await IOUtils.remove(tempPdfPath, { ignoreAbsent: true });
      } catch {
        /* ignore */
      }
    }
  }
}

async function ocrPageRangeViaFullPdf(
  filePath: string,
  engine: EngineType,
  modelConfig: any,
  pageNumbers: number[],
  progressWin: any,
): Promise<OCRPageResult[]> {
  const onProgress = (current: number, total: number) => {
    progressWin?.changeLine({
      text: getString("progress-page-range-page", {
        args: { current: String(current), total: String(total) },
      }),
      progress: Math.round((current / Math.max(total, 1)) * 90),
    });
  };
  const allPages = await callPdfUploadEngine(
    engine,
    modelConfig,
    filePath,
    true,
    onProgress,
  );
  const requested = new Set(pageNumbers);
  const filtered = allPages.filter((p) => requested.has(p.pageNumber));
  ztoolkit.log(
    `[AIOCR] page-range: full-PDF flow returned ${allPages.length} page(s), kept ${filtered.length} requested page(s), hasText=${pagesHaveText(filtered)}`,
  );
  return filtered;
}

async function processPageRangeOCR(
  attachment: Zotero.Item,
  pageNumbers: number[],
): Promise<void> {
  resetOcrCancellation();
  const progressWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("progress-page-range-start"),
      type: "default",
      progress: 0,
    })
    .show();

  try {
    const filePath = await attachment.getFilePathAsync();
    if (!filePath) throw new Error("Cannot get file path");

    const engine = (getPref("engine") as string) || "PP-OCRv6";
    const modelConfig = ENGINE_MODELS[engine as EngineType];
    // 支持"直接上传 PDF"链路的引擎：PaddleOCR 与面壁智能
    const isDirectPdfEngine =
      modelConfig &&
      ((modelConfig as any).platform === "paddleocr" ||
        (modelConfig as any).platform === "modelbest");

    const allMarkdownParts: string[] = [];

    if (isDirectPdfEngine) {
      let pages = await tryOcrPageRangeViaPdfUpload(
        filePath,
        engine as EngineType,
        modelConfig,
        pageNumbers,
        progressWin,
      );

      if (!pagesHaveText(pages)) {
        ztoolkit.log(
          "[AIOCR] page-range: cropped-PDF flow produced no text, uploading the original PDF and filtering pages",
        );
        pages = await ocrPageRangeViaFullPdf(
          filePath,
          engine as EngineType,
          modelConfig,
          pageNumbers,
          progressWin,
        );
      }

      for (const p of pages) {
        allMarkdownParts.push(`## Page ${p.pageNumber}\n\n${p.markdown}`);
      }
    }

    if (allMarkdownParts.length === 0) {
      const images = await pdfToImages(
        filePath,
        undefined,
        attachment.id,
        pageNumbers,
      );

      if (images.length === 0) {
        throw new Error("No pages rendered");
      }

      const totalImages = images.length;

      for (let i = 0; i < totalImages; i++) {
        const img = images[i];

        progressWin.changeLine({
          text: getString("progress-page-range-page", {
            args: {
              current: String(i + 1),
              total: String(totalImages),
            },
          }),
          progress: Math.round(((i + 1) / totalImages) * 100),
        });

        const tempDir = PathUtils.join(PathUtils.tempDir, "aiocr-pagerange");
        await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });
        const tempPath = PathUtils.join(
          tempDir,
          `page-${img.pageNumber}-${Date.now()}.png`,
        );

        try {
          const binaryString = atob(img.base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            bytes[j] = binaryString.charCodeAt(j);
          }
          await IOUtils.write(tempPath, bytes);

          let pageMarkdown = "";

          if (isDirectPdfEngine) {
            const pages = await callPdfUploadEngine(
              engine as EngineType,
              modelConfig,
              tempPath,
              false,
            );
            pageMarkdown = pages.map((p) => p.markdown).join("\n");
          } else {
            const result = await performOCR(
              tempPath,
              false,
              undefined,
              undefined,
              attachment.id,
            );
            if (result.pages.length > 0) {
              pageMarkdown = result.pages.map((p) => p.markdown).join("\n");
            } else {
              pageMarkdown = result.fullMarkdown;
            }
          }

          allMarkdownParts.push(`## Page ${img.pageNumber}\n\n${pageMarkdown}`);
        } finally {
          try {
            await IOUtils.remove(tempPath, { ignoreAbsent: true });
          } catch {
            /* ignore */
          }
        }
      }
    }

    const fullMarkdown = allMarkdownParts.join("\n\n---\n\n");

    const parentItem = Zotero.Items.get(
      attachment.parentItemID || attachment.id,
    ) as Zotero.Item;
    const pageRangeStr = pageNumbers.join(", ");
    const noteTitle = generateNoteTitle(
      attachment,
      `${engine} (Pages ${pageRangeStr})`,
    );
    const noteContent = `<h1>${noteTitle}</h1>\n${markdownToHTML(fullMarkdown)}`;

    const note = new Zotero.Item("note");
    note.libraryID = attachment.libraryID;
    note.setNote(noteContent);
    if (attachment.parentItemID) {
      note.parentKey = parentItem.key;
    }
    await note.saveTx();

    progressWin.changeLine({
      text: getString("progress-page-range-done"),
      type: "success",
      progress: 100,
    });
    progressWin.startCloseTimer(3000);
  } catch (e: any) {
    if (e instanceof OcrCancelledError) {
      progressWin.changeLine({
        text: getString("progress-cancelled"),
        type: "default",
        progress: 100,
      });
      progressWin.startCloseTimer(3000);
    } else {
      progressWin.changeLine({
        text: getString("progress-page-range-failed", {
          args: { error: truncateName(e.message || String(e), 60) },
        }),
        type: "fail",
        progress: 100,
      });
      progressWin.startCloseTimer(5000);
    }
  }
}

export async function processOCRForAttachment(
  attachment: Zotero.Item,
  silent: boolean = false,
): Promise<void> {
  const displayName = truncateName(attachment.getDisplayTitle());

  const progressWin = silent
    ? null
    : new ztoolkit.ProgressWindow(addon.data.config.addonName, {
        closeOnClick: true,
        closeTime: -1,
      })
        .createLine({
          text: getString("progress-ocr-start"),
          type: "default",
          progress: 0,
        })
        .show();

  try {
    const filePath = await attachment.getFilePathAsync();
    if (!filePath) throw new Error("Cannot get file path");

    const engine = (getPref("engine") as string) || "PP-OCRv6";
    const modelConfig = ENGINE_MODELS[engine as EngineType];
    const isMinerU = modelConfig && (modelConfig as any).platform === "mineru";
    const isAI = modelConfig && (modelConfig as any).platform === "ai";

    const result = await performOCR(
      filePath,
      true,
      undefined,
      (current, total) => {
        progressWin?.changeLine({
          text: getString("progress-ocr-page", {
            args: { current: String(current), total: String(total) },
          }),
          progress: Math.round((current / total) * 100),
        });
      },
      attachment.id,
    );

    const parentItem = Zotero.Items.get(
      attachment.parentItemID || attachment.id,
    ) as Zotero.Item;
    const noteTitle = generateNoteTitle(attachment, result.engine);
    const noteContent = `<h1>${noteTitle}</h1>\n${markdownToHTML(result.fullMarkdown)}`;

    const note = new Zotero.Item("note");
    note.libraryID = attachment.libraryID;
    note.setNote(noteContent);
    if (attachment.parentItemID) {
      note.parentKey = parentItem.key;
    }
    await note.saveTx();

    progressWin?.changeLine({
      text: getString("progress-ocr-done"),
      type: "success",
      progress: 100,
    });
    progressWin?.startCloseTimer(3000);
  } catch (e: any) {
    if (progressWin) {
      if (e instanceof OcrCancelledError) {
        progressWin.changeLine({
          text: getString("progress-cancelled"),
          type: "default",
          progress: 100,
        });
        progressWin.startCloseTimer(3000);
      } else {
        progressWin.changeLine({
          text: getString("progress-ocr-failed", {
            args: { error: truncateName(e.message || String(e), 60) },
          }),
          type: "fail",
          progress: 100,
        });
        progressWin.startCloseTimer(5000);
      }
    }
    throw e;
  }
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
