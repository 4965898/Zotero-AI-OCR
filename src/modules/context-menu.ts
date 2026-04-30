import { performOCR, ENGINE_ADVANCED_FEATURES, ENGINE_MODELS, EngineType } from "./ocr-engine";
import {
  getPref,
  setPref,
  getAdvancedFeaturesForEngine,
  setAdvancedFeature,
} from "../utils/prefs";
import { getString } from "../utils/locale";

const ALL_ENGINES: { value: string; label: string }[] = [
  { value: "PP-OCRv5", label: "PP-OCRv5 (基础文字识别)" },
  { value: "PP-StructureV3", label: "PP-StructureV3 (文档结构解析)" },
  { value: "PaddleOCR-VL", label: "PaddleOCR-VL (视觉语言模型)" },
  { value: "PaddleOCR-VL-1.5", label: "PaddleOCR-VL-1.5 (增强视觉语言模型)" },
  { value: "MinerU-pipeline", label: "MinerU-pipeline (文档解析)" },
  { value: "MinerU-vlm", label: "MinerU-vlm (推荐文档解析)" },
  { value: "MinerU-HTML", label: "MinerU-HTML (HTML解析)" },
];

function truncateName(name: string, maxLength: number = 40): string {
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + "...";
}

export function registerContextMenu(win: _ZoteroTypes.MainWindow) {
  const menuIcon = `chrome://aiocr/content/icons/favicon@0.5x.png`;

  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-aiocr-recognize",
    label: getString("menuitem-ocr"),
    icon: menuIcon,
    commandListener: () => handleSingleOCR(),
  });

  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-aiocr-batch",
    label: getString("menuitem-batch-ocr"),
    icon: menuIcon,
    commandListener: () => handleBatchOCR(),
  });

  ztoolkit.Menu.register("item", {
    tag: "menu",
    id: "zotero-itemmenu-aiocr-switch-engine",
    label: getString("menuitem-switch-engine"),
    icon: menuIcon,
    children: [],
  });

  ztoolkit.Menu.register("item", {
    tag: "menu",
    id: "zotero-itemmenu-aiocr-advanced",
    label: getString("menuitem-advanced-options"),
    icon: menuIcon,
    children: [],
  });

  refreshEngineMenu();
  refreshAdvancedMenu();
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

  const paddleHeader = doc.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    "menuitem",
  );
  paddleHeader.setAttribute("label", "── PaddleOCR ──");
  paddleHeader.setAttribute("disabled", "true");
  paddleHeader.style.cssText = "color: #666; font-style: italic;";
  menupopup.appendChild(paddleHeader);

  const paddleEngines = ALL_ENGINES.filter((e) => !e.value.startsWith("MinerU"));
  for (const eng of paddleEngines) {
    menupopup.appendChild(createEngineMenuItem(doc, eng, currentEngine));
  }

  const mineruSep = doc.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    "menuseparator",
  );
  menupopup.appendChild(mineruSep);

  const mineruHeader = doc.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    "menuitem",
  );
  mineruHeader.setAttribute("label", "── MinerU ──");
  mineruHeader.setAttribute("disabled", "true");
  mineruHeader.style.cssText = "color: #666; font-style: italic;";
  menupopup.appendChild(mineruHeader);

  const mineruEngines = ALL_ENGINES.filter((e) => e.value.startsWith("MinerU"));
  for (const eng of mineruEngines) {
    menupopup.appendChild(createEngineMenuItem(doc, eng, currentEngine));
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
  );
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
  );
  headerItem.setAttribute("label", `当前引擎: ${engine}`);
  headerItem.setAttribute("disabled", "true");
  headerItem.style.cssText = "font-weight: bold; color: #1976d2;";
  menupopup.appendChild(headerItem);

  const modelConfig = ENGINE_MODELS[engine as EngineType];
  if (modelConfig && (modelConfig as any).platform === "mineru") {
    const infoItem = doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "menuitem",
    );
    infoItem.setAttribute("label", "MinerU 仅支持异步 API");
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
  const items = Zotero.getActiveZoteroPane().getSelectedItems();
  const attachments: Zotero.Item[] = [];

  for (const item of items) {
    if (item.isAttachment()) {
      if (item.attachmentContentType === "application/pdf") {
        attachments.push(item);
      }
    } else {
      const itemAttachments = item
        .getAttachments()
        .map((id: number) => Zotero.Items.get(id))
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
        firstCreator = creators[0].lastName || creators[0].name || "";
      } else if (creators.length === 2) {
        firstCreator = `${creators[0].lastName || creators[0].name || ""} and ${creators[1].lastName || creators[1].name || ""}`;
      } else if (creators.length > 2) {
        firstCreator = `${creators[0].lastName || creators[0].name || ""} et al.`;
      }

      const year = parentItem.getField("year") || "";
      const title = (parentItem.getField("title") || "").substring(0, 100);
      const parts = [firstCreator, year, title ? `${title} - OCR` : "OCR Result"].filter(Boolean);
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
      return resolveNamingTemplate(template, parentItem, attachment, engineName);
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

function parseTemplateVariable(match: string): { variable: string; params: TemplateParams } {
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
        value = value.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.substring(1).toLowerCase());
        break;
      case "snake":
        value = value.replace(/\s+/g, "_").toLowerCase();
        break;
      case "hyphen":
        value = value.replace(/\s+/g, "-").toLowerCase();
        break;
      case "camel":
        value = value.replace(/(?:^\w|[A-Z]|\b\w)/g, (t, i) => i === 0 ? t.toLowerCase() : t.toUpperCase()).replace(/\s+/g, "");
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
          value = creators[0].lastName || creators[0].name || "";
        } else if (creators.length === 2) {
          value = `${creators[0].lastName || creators[0].name || ""} and ${creators[1].lastName || creators[1].name || ""}`;
        } else if (creators.length > 2) {
          value = `${creators[0].lastName || creators[0].name || ""} et al.`;
        }
        break;
      }
      case "authors": {
        const creators = parentItem.getCreators();
        value = creators
          .filter((c: any) => c.creatorTypeID === Zotero.CreatorTypes.getID("author"))
          .map((c: any) => c.lastName || c.name || "")
          .join(", ");
        break;
      }
      case "authorsCount": {
        const creators = parentItem.getCreators();
        value = String(creators.filter((c: any) => c.creatorTypeID === Zotero.CreatorTypes.getID("author")).length);
        break;
      }
      case "editors": {
        const creators = parentItem.getCreators();
        value = creators
          .filter((c: any) => c.creatorTypeID === Zotero.CreatorTypes.getID("editor"))
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
      ztoolkit.log(`Batch OCR failed for ${name}:`, e);
      failed++;
    }
  }

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
  progressWin.startCloseTimer(5000);
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

    const engine = (getPref("engine") as string) || "PP-OCRv5";
    const modelConfig = ENGINE_MODELS[engine as EngineType];
    const isMinerU = modelConfig && (modelConfig as any).platform === "mineru";
    const apiMode = getPref("apiMode") as string;

    if (!isMinerU && apiMode === "sync") {
      const pageCount = await getPdfPageCount(filePath);
      if (pageCount > 0) {
        progressWin?.changeLine({
          text: getString("progress-ocr-preparing", {
            args: { pages: String(pageCount) },
          }),
          progress: 10,
        });
      }
    }

    const result = await performOCR(filePath, true, undefined, (current, total) => {
      progressWin?.changeLine({
        text: getString("progress-ocr-page", {
          args: { current: String(current), total: String(total) },
        }),
        progress: (!isMinerU && apiMode === "sync")
          ? Math.round((current / total) * 80) + 10
          : Math.round((current / total) * 100),
      });
    });

    const parentItem = Zotero.Items.get(attachment.parentItemID || attachment.id);
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
      progressWin.changeLine({
        text: getString("progress-ocr-failed", {
          args: { error: truncateName(e.message || String(e), 60) },
        }),
        type: "fail",
        progress: 100,
      });
      progressWin.startCloseTimer(5000);
    }
    throw e;
  }
}

function markdownToHTML(md: string): string {
  let html = md;
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
