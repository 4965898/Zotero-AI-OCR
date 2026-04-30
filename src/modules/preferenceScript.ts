import { config } from "../../package.json";
import { getString } from "../utils/locale";
import {
  getPref,
  setPref,
  getEndpointsForEngine,
  addEndpoint,
  updateEndpoint,
  deleteEndpoint,
  setActiveEndpoint,
  getAdvancedFeaturesForEngine,
  setAdvancedFeature,
  EndpointConfig,
} from "../utils/prefs";
import {
  ENGINE_ADVANCED_FEATURES,
  testConnection,
  ENGINE_MODELS,
  EngineType,
} from "./ocr-engine";

export async function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
      columns: [],
      rows: [],
    };
  } else {
    addon.data.prefs.window = _window;
  }

  initPrefValues(_window);
  initEndpointsTab(_window);
  initAdvancedTab(_window);
  bindPrefEvents(_window);
}

function setMenulistValue(doc: Document, id: string, value: string) {
  const menulist = doc.getElementById(id) as XUL.MenuList;
  if (!menulist) return;
  const menupopup = menulist.querySelector("menupopup");
  if (!menupopup) return;
  const items = menupopup.querySelectorAll("menuitem");
  let selectedIndex = 0;
  items.forEach((item: any, index: number) => {
    if (item.getAttribute("value") === value) {
      selectedIndex = index;
    }
  });
  menulist.selectedIndex = selectedIndex;
}

function initPrefValues(win: Window) {
  const doc = win.document;

  setMenulistValue(doc, "aiocr-engine", getPref("engine") as string);
  setMenulistValue(doc, "aiocr-api-mode", getPref("apiMode") as string);
  setMenulistValue(doc, "aiocr-note-naming", getPref("noteNaming") as string);

  const customNamingRow = doc.getElementById("aiocr-custom-naming-row");
  if (customNamingRow) {
    customNamingRow.setAttribute(
      "hidden",
      getPref("noteNaming") !== "custom" ? "true" : "false",
    );
  }

  const customTemplateInput = doc.getElementById(
    "aiocr-custom-naming-template",
  ) as HTMLInputElement;
  if (customTemplateInput) {
    customTemplateInput.value = getPref("customNamingTemplate") as string;
  }

  const autoOcrCheckbox = doc.getElementById(
    "aiocr-auto-ocr",
  ) as XUL.Checkbox;
  if (autoOcrCheckbox) {
    autoOcrCheckbox.checked = getPref("autoOCR") as boolean;
  }

  const concurrencyInput = doc.getElementById(
    "aiocr-concurrency",
  ) as HTMLInputElement;
  if (concurrencyInput) {
    concurrencyInput.value = String(getPref("concurrency"));
  }

  updateApiModeVisibility(win);
}

function updateApiModeVisibility(win: Window) {
  const doc = win.document;
  const engine = getPref("engine") as string;
  const modelConfig = ENGINE_MODELS[engine as EngineType];
  const isMinerU = modelConfig && (modelConfig as any).platform === "mineru";

  const apiModeLabel = doc.getElementById("aiocr-api-mode-label");
  const apiModeSelect = doc.getElementById("aiocr-api-mode") as XUL.MenuList;
  if (apiModeLabel && apiModeSelect) {
    if (isMinerU) {
      (apiModeLabel as HTMLElement).setAttribute("hidden", "true");
      apiModeSelect.setAttribute("hidden", "true");
    } else {
      (apiModeLabel as HTMLElement).removeAttribute("hidden");
      apiModeSelect.removeAttribute("hidden");
    }
  }
}

function initEndpointsTab(win: Window) {
  const doc = win.document;
  const currentEngine = getPref("engine") as string;
  renderEndpointList(win, currentEngine);

  const addBtn = doc.getElementById("aiocr-endpoint-add");
  addBtn?.addEventListener("command", () => {
    showEndpointForm(win, true);
    clearEndpointForm(win);
  });

  const editBtn = doc.getElementById("aiocr-endpoint-edit");
  editBtn?.addEventListener("command", () => {
    const selectedId = getSelectedEndpointId(win);
    if (!selectedId) {
      win.alert("请先选择一个端点。");
      return;
    }
    const engine = getPref("engine") as string;
    const endpoints = getEndpointsForEngine(engine);
    const endpoint = endpoints.find((e) => e.id === selectedId);
    if (endpoint) {
      showEndpointForm(win, true);
      fillEndpointForm(win, endpoint);
    }
  });

  const deleteBtn = doc.getElementById("aiocr-endpoint-delete");
  deleteBtn?.addEventListener("command", () => {
    const selectedId = getSelectedEndpointId(win);
    if (!selectedId) {
      win.alert("请先选择一个端点。");
      return;
    }
    const engine = getPref("engine") as string;
    deleteEndpoint(engine, selectedId);
    renderEndpointList(win, engine);
    showEndpointForm(win, false);
  });

  const setActiveBtn = doc.getElementById("aiocr-endpoint-set-active");
  setActiveBtn?.addEventListener("command", () => {
    const selectedId = getSelectedEndpointId(win);
    if (!selectedId) {
      win.alert("请先选择一个端点。");
      return;
    }
    const engine = getPref("engine") as string;
    setActiveEndpoint(engine, selectedId);
    renderEndpointList(win, engine);
  });

  const testBtn = doc.getElementById("aiocr-endpoint-test");
  testBtn?.addEventListener("command", async () => {
    const selectedId = getSelectedEndpointId(win);
    if (!selectedId) {
      win.alert("请先选择一个端点。");
      return;
    }
    const engine = getPref("engine") as string;
    const endpoints = getEndpointsForEngine(engine);
    const endpoint = endpoints.find((e) => e.id === selectedId);
    if (!endpoint) return;

    const progressWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: true,
      closeTime: -1,
    })
      .createLine({
        text: getString("progress-test-connection"),
        type: "default",
        progress: 50,
      })
      .show();

    const result = await testConnection(engine, endpoint.url, endpoint.token);

    progressWin.changeLine({
      text: result.success
        ? getString("progress-test-success")
        : getString("progress-test-failed", {
            args: { error: result.message },
          }),
      type: result.success ? "success" : "fail",
      progress: 100,
    });
    progressWin.startCloseTimer(3000);
  });

  const saveBtn = doc.getElementById("aiocr-endpoint-save");
  saveBtn?.addEventListener("command", () => {
    const engine = getPref("engine") as string;
    const formData = getEndpointFormData(win);

    if (!formData.name || !formData.url) {
      win.alert("名称和 URL 为必填项。");
      return;
    }

    const isEdit = (saveBtn as any)._editMode;
    if (isEdit) {
      formData.id = (saveBtn as any)._editId;
      updateEndpoint(engine, formData);
    } else {
      formData.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
      if (getEndpointsForEngine(engine).length === 0) {
        formData.active = true;
      }
      addEndpoint(engine, formData);
    }

    renderEndpointList(win, engine);
    showEndpointForm(win, false);
    clearEndpointForm(win);
  });

  const cancelBtn = doc.getElementById("aiocr-endpoint-cancel");
  cancelBtn?.addEventListener("command", () => {
    showEndpointForm(win, false);
    clearEndpointForm(win);
  });
}

function renderEndpointList(win: Window, engine: string) {
  const doc = win.document;
  const container = doc.getElementById(
    "aiocr-endpoints-container",
  ) as HTMLElement;
  if (!container) return;

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const endpoints = getEndpointsForEngine(engine);

  if (endpoints.length === 0) {
    const emptyDiv = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    emptyDiv.style.cssText = "color: #999; text-align: center; padding: 20px;";
    emptyDiv.textContent = getString("pref-endpoints-no-endpoints");
    container.appendChild(emptyDiv);
    return;
  }

  for (const endpoint of endpoints) {
    const itemDiv = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    itemDiv.setAttribute("data-endpoint-id", endpoint.id);
    itemDiv.style.cssText =
      "padding: 8px; border-bottom: 1px solid #e0e0e0; cursor: pointer;";

    if (endpoint.active) {
      itemDiv.style.backgroundColor = "#e3f2fd";
      itemDiv.style.borderLeft = "3px solid #1976d2";
    }

    itemDiv.addEventListener("click", () => {
      const allItems = container.querySelectorAll("[data-endpoint-id]");
      allItems.forEach((el: Element) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.getAttribute("data-endpoint-id") !== endpoint.id) {
          htmlEl.style.backgroundColor = endpoint.active ? "#e3f2fd" : "";
        }
      });
      itemDiv.style.backgroundColor = "#e8f5e9";
    });

    const nameDiv = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    nameDiv.style.cssText = "font-weight: bold; font-size: 13px;";
    nameDiv.textContent =
      endpoint.name + (endpoint.active ? " (Active)" : "");

    const urlDiv = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    urlDiv.style.cssText = "color: #666; font-size: 11px; word-break: break-all;";
    urlDiv.textContent = endpoint.url;

    const tokenDiv = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    tokenDiv.style.cssText = "color: #999; font-size: 11px;";
    const maskedToken = endpoint.token
      ? endpoint.token.substring(0, 4) + "****"
      : "(not set)";
    tokenDiv.textContent = `Token: ${maskedToken}`;

    itemDiv.appendChild(nameDiv);
    itemDiv.appendChild(urlDiv);
    itemDiv.appendChild(tokenDiv);
    container.appendChild(itemDiv);
  }
}

function getSelectedEndpointId(win: Window): string | null {
  const container = win.document.getElementById(
    "aiocr-endpoints-container",
  );
  if (!container) return null;

  const allItems = container.querySelectorAll("[data-endpoint-id]");
  for (const item of allItems) {
    const el = item as HTMLElement;
    if (
      el.style.backgroundColor === "rgb(232, 245, 233)" ||
      el.style.backgroundColor === "#e8f5e9"
    ) {
      return el.getAttribute("data-endpoint-id");
    }
  }

  return null;
}

function showEndpointForm(win: Window, show: boolean) {
  const doc = win.document;
  const form = doc.getElementById("aiocr-endpoint-form");
  if (form) {
    form.setAttribute("hidden", show ? "false" : "true");
  }
}

function clearEndpointForm(win: Window) {
  const doc = win.document;
  const nameInput = doc.getElementById(
    "aiocr-endpoint-name",
  ) as HTMLInputElement;
  const urlInput = doc.getElementById(
    "aiocr-endpoint-url",
  ) as HTMLInputElement;
  const tokenInput = doc.getElementById(
    "aiocr-endpoint-token",
  ) as HTMLInputElement;
  const saveBtn = doc.getElementById("aiocr-endpoint-save");

  if (nameInput) nameInput.value = "";
  if (urlInput) urlInput.value = "";
  if (tokenInput) tokenInput.value = "";
  if (saveBtn) {
    (saveBtn as any)._editMode = false;
    (saveBtn as any)._editId = "";
  }
}

function fillEndpointForm(win: Window, endpoint: EndpointConfig) {
  const doc = win.document;
  const nameInput = doc.getElementById(
    "aiocr-endpoint-name",
  ) as HTMLInputElement;
  const urlInput = doc.getElementById(
    "aiocr-endpoint-url",
  ) as HTMLInputElement;
  const tokenInput = doc.getElementById(
    "aiocr-endpoint-token",
  ) as HTMLInputElement;
  const saveBtn = doc.getElementById("aiocr-endpoint-save");

  if (nameInput) nameInput.value = endpoint.name;
  if (urlInput) urlInput.value = endpoint.url;
  if (tokenInput) tokenInput.value = endpoint.token;

  if (saveBtn) {
    (saveBtn as any)._editMode = true;
    (saveBtn as any)._editId = endpoint.id;
  }
}

function getEndpointFormData(win: Window): EndpointConfig {
  const doc = win.document;
  const nameInput = doc.getElementById(
    "aiocr-endpoint-name",
  ) as HTMLInputElement;
  const urlInput = doc.getElementById(
    "aiocr-endpoint-url",
  ) as HTMLInputElement;
  const tokenInput = doc.getElementById(
    "aiocr-endpoint-token",
  ) as HTMLInputElement;

  return {
    id: "",
    name: nameInput?.value || "",
    url: urlInput?.value || "",
    token: tokenInput?.value || "",
    active: false,
  };
}

function initAdvancedTab(win: Window) {
  renderAdvancedFeatures(win, getPref("engine") as string);
}

function renderAdvancedFeatures(win: Window, engine: string) {
  const doc = win.document;
  const container = doc.getElementById(
    "aiocr-advanced-features-container",
  ) as HTMLElement;
  if (!container) return;

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const features = ENGINE_ADVANCED_FEATURES[engine] || [];
  const currentFeatures = getAdvancedFeaturesForEngine(engine);

  if (features.length === 0) {
    const emptyDiv = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    emptyDiv.style.cssText = "color: #999; padding: 10px;";
    emptyDiv.textContent = "当前引擎没有可配置的高级功能。";
    container.appendChild(emptyDiv);
    return;
  }

  const engineLabel = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  engineLabel.style.cssText =
    "font-weight: bold; font-size: 13px; margin-bottom: 8px; color: #1976d2;";
  engineLabel.textContent = `当前引擎: ${engine}`;
  container.appendChild(engineLabel);

  for (const feature of features) {
    const isChecked = currentFeatures[feature.key] ?? feature.defaultValue;

    const checkbox = doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "checkbox",
    ) as XUL.Checkbox;
    checkbox.setAttribute("label", getString(feature.labelKey as any));
    if (isChecked) {
      checkbox.setAttribute("checked", "true");
    }
    checkbox.style.cssText = "margin: 4px 0;";

    checkbox.addEventListener("command", () => {
      const newState = checkbox.checked;
      setAdvancedFeature(engine, feature.key, newState);
    });

    container.appendChild(checkbox);
  }
}

function onEngineChanged(win: Window, newEngine: string) {
  setPref("engine", newEngine);
  renderEndpointList(win, newEngine);
  renderAdvancedFeatures(win, newEngine);
  updateApiModeVisibility(win);
}

function bindPrefEvents(win: Window) {
  const doc = win.document;

  const engineSelect = doc.getElementById(
    "aiocr-engine",
  ) as XUL.MenuList;
  if (engineSelect) {
    engineSelect.addEventListener("command", () => {
      onEngineChanged(win, engineSelect.value);
    });
  }

  const apiModeSelect = doc.getElementById(
    "aiocr-api-mode",
  ) as XUL.MenuList;
  if (apiModeSelect) {
    apiModeSelect.addEventListener("command", () => {
      setPref("apiMode", apiModeSelect.value);
    });
  }

  const noteNamingSelect = doc.getElementById(
    "aiocr-note-naming",
  ) as XUL.MenuList;
  if (noteNamingSelect) {
    noteNamingSelect.addEventListener("command", () => {
      setPref("noteNaming", noteNamingSelect.value);
      const customRow = doc.getElementById("aiocr-custom-naming-row");
      if (customRow) {
        customRow.setAttribute(
          "hidden",
          noteNamingSelect.value !== "custom" ? "true" : "false",
        );
      }
    });
  }

  const customTemplateInput = doc.getElementById(
    "aiocr-custom-naming-template",
  ) as HTMLInputElement;
  if (customTemplateInput) {
    customTemplateInput.addEventListener("input", () => {
      setPref("customNamingTemplate", customTemplateInput.value);
    });
  }

  const autoOcrCheckbox = doc.getElementById(
    "aiocr-auto-ocr",
  ) as XUL.Checkbox;
  if (autoOcrCheckbox) {
    autoOcrCheckbox.addEventListener("command", () => {
      setPref("autoOCR", autoOcrCheckbox.checked);
    });
  }

  const concurrencyInput = doc.getElementById(
    "aiocr-concurrency",
  ) as HTMLInputElement;
  if (concurrencyInput) {
    concurrencyInput.addEventListener("change", () => {
      const val = parseInt(concurrencyInput.value, 10);
      if (val >= 1 && val <= 10) {
        setPref("concurrency", val);
      }
    });
  }
}
