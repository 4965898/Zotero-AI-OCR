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
  getCustomEngines,
  addCustomEngine,
  updateCustomEngine,
  deleteCustomEngine,
  getCustomEngineById,
  CustomEngineConfig,
} from "../utils/prefs";
import {
  ENGINE_ADVANCED_FEATURES,
  testConnection,
  ENGINE_MODELS,
  AI_PROVIDER_CONFIGS,
  EngineType,
  getAIProviderConfig,
} from "./ocr-engine";
import { refreshEngineMenu } from "./context-menu";

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
  initAIProviderTab(_window);
  initAdvancedTab(_window);
  initCustomEnginesTab(_window);
  bindPrefEvents(_window);
  registerPrefObserver(_window);
}

function registerPrefObserver(win: Window) {
  const prefObserver = {
    observe: (_pref: string, _oldVal: any, _newVal: any) => {
      const newEngine = getPref("engine") as string;
      const doc = win.document;
      setMenulistValue(doc, "aiocr-engine", newEngine);
      onEngineChanged(win, newEngine);
    },
  };

  try {
    Zotero.Prefs.registerObserver(
      "extensions.zotero.aiocr.engine",
      prefObserver,
    );
  } catch {
    /* ignore */
  }

  win.addEventListener("unload", () => {
    try {
      Zotero.Prefs.unregisterObserver(prefObserver);
    } catch {
      /* ignore */
    }
  });
}

function setMenulistValue(doc: Document, id: string, value: string) {
  const menulist = doc.getElementById(id) as XUL.MenuList;
  if (!menulist) return;
  menulist.value = value;
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

  const autoOcrCheckbox = doc.getElementById("aiocr-auto-ocr") as XUL.Checkbox;
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
  const isCustom = engine.startsWith("custom-");
  const modelConfig = ENGINE_MODELS[engine as EngineType];
  const isMinerU = modelConfig && (modelConfig as any).platform === "mineru";
  const isAI = modelConfig && (modelConfig as any).platform === "ai";
  const isAsyncOnly = modelConfig && (modelConfig as any).asyncOnly === true;

  const apiModeLabel = doc.getElementById("aiocr-api-mode-label");
  const apiModeSelect = doc.getElementById("aiocr-api-mode") as XUL.MenuList;
  if (apiModeLabel && apiModeSelect) {
    if (isMinerU || isAI || isCustom || isAsyncOnly) {
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

    const progressWin = new ztoolkit.ProgressWindow(
      addon.data.config.addonName,
      {
        closeOnClick: true,
        closeTime: -1,
      },
    )
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
      formData.id =
        Date.now().toString(36) + Math.random().toString(36).substr(2);
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
    nameDiv.textContent = endpoint.name + (endpoint.active ? " (Active)" : "");

    const urlDiv = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    urlDiv.style.cssText =
      "color: #666; font-size: 11px; word-break: break-all;";
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
  const container = win.document.getElementById("aiocr-endpoints-container");
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
  const urlInput = doc.getElementById("aiocr-endpoint-url") as HTMLInputElement;
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
  const urlInput = doc.getElementById("aiocr-endpoint-url") as HTMLInputElement;
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
  const urlInput = doc.getElementById("aiocr-endpoint-url") as HTMLInputElement;
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
  updateAIProviderTab(win);
  try {
    refreshEngineMenu();
  } catch {
    /* ignore */
  }
}

function bindPrefEvents(win: Window) {
  const doc = win.document;

  const engineSelect = doc.getElementById("aiocr-engine") as XUL.MenuList;
  if (engineSelect) {
    engineSelect.addEventListener("command", () => {
      onEngineChanged(win, engineSelect.value);
    });
  }

  const apiModeSelect = doc.getElementById("aiocr-api-mode") as XUL.MenuList;
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

  const autoOcrCheckbox = doc.getElementById("aiocr-auto-ocr") as XUL.Checkbox;
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

function initAIProviderTab(win: Window) {
  updateAIProviderTab(win);

  const saveBtn = doc(win).getElementById("aiocr-ai-provider-save");
  saveBtn?.addEventListener("command", () => {
    saveAIProviderConfig(win);
  });

  const testBtn = doc(win).getElementById("aiocr-ai-provider-test");
  testBtn?.addEventListener("command", async () => {
    const engine = getPref("engine") as string;
    const modelConfig = ENGINE_MODELS[engine as EngineType] as any;
    if (!modelConfig || modelConfig.platform !== "ai") {
      win.alert("请先选择一个 AI 视觉模型引擎。");
      return;
    }

    saveAIProviderConfig(win);

    const progressWin = new ztoolkit.ProgressWindow(
      addon.data.config.addonName,
      {
        closeOnClick: true,
        closeTime: -1,
      },
    )
      .createLine({
        text: getString("progress-test-connection"),
        type: "default",
        progress: 50,
      })
      .show();

    const result = await testConnection(engine, "", "");

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
}

function doc(win: Window): Document {
  return win.document;
}

function updateAIProviderTab(win: Window) {
  const d = doc(win);
  const engine = getPref("engine") as string;
  const modelConfig = ENGINE_MODELS[engine as EngineType] as any;
  const isAI = modelConfig && modelConfig.platform === "ai";

  const providerNameLabel = d.getElementById("aiocr-ai-provider-name");
  const apiKeyInput = d.getElementById("aiocr-ai-api-key") as HTMLInputElement;
  const modelInput = d.getElementById("aiocr-ai-model") as HTMLInputElement;
  const apiBaseInput = d.getElementById(
    "aiocr-ai-api-base",
  ) as HTMLInputElement;
  const customPromptInput = d.getElementById(
    "aiocr-ai-custom-prompt",
  ) as HTMLTextAreaElement;
  const hintEl = d.getElementById("aiocr-ai-provider-hint");

  if (!isAI) {
    if (providerNameLabel)
      providerNameLabel.setAttribute("value", "(未选择 AI 引擎)");
    if (apiKeyInput) apiKeyInput.value = "";
    if (modelInput) modelInput.value = "";
    if (apiBaseInput) apiBaseInput.value = "";
    if (customPromptInput) customPromptInput.value = "";
    if (apiKeyInput) apiKeyInput.setAttribute("disabled", "true");
    if (modelInput) modelInput.setAttribute("disabled", "true");
    if (apiBaseInput) apiBaseInput.setAttribute("disabled", "true");
    if (customPromptInput) customPromptInput.setAttribute("disabled", "true");
    return;
  }

  if (apiKeyInput) apiKeyInput.removeAttribute("disabled");
  if (modelInput) modelInput.removeAttribute("disabled");
  if (apiBaseInput) apiBaseInput.removeAttribute("disabled");
  if (customPromptInput) customPromptInput.removeAttribute("disabled");

  const provider = modelConfig.provider;
  const providerConfig = AI_PROVIDER_CONFIGS[provider];
  if (!providerConfig) return;

  if (providerNameLabel) {
    providerNameLabel.setAttribute("value", providerConfig.name);
  }

  try {
    const configs = JSON.parse(
      (getPref("aiProviderConfigs") as string) || "{}",
    );
    const saved = configs[provider] || {};

    if (apiKeyInput) apiKeyInput.value = saved.apiKey || "";
    if (modelInput)
      modelInput.value = saved.model || providerConfig.defaultModel;
    if (apiBaseInput) apiBaseInput.value = saved.apiBase || "";

    if (customPromptInput) {
      try {
        customPromptInput.value = (getPref("aiCustomPrompt") as string) || "";
      } catch {
        customPromptInput.value = "";
      }
    }

    if (hintEl) {
      const supportsPdf = provider === "openai" || provider === "openrouter";
      let hintText = supportsPdf
        ? `提示：${providerConfig.name} 原生支持 PDF 输入，可直接发送 PDF 文件进行识别。也支持图片输入。`
        : `提示：${providerConfig.name} 不原生支持 PDF，插件会先将 PDF 逐页渲染为图片后发送给模型识别。`;
      if (providerConfig.modelHint) {
        hintText += `\n⚠️ ${providerConfig.modelHint}`;
      }
      hintEl.textContent = hintText;
    }
  } catch {
    if (apiKeyInput) apiKeyInput.value = "";
    if (modelInput) modelInput.value = providerConfig.defaultModel;
    if (apiBaseInput) apiBaseInput.value = "";
    if (customPromptInput) customPromptInput.value = "";
  }
}

function saveAIProviderConfig(win: Window) {
  const d = doc(win);
  const engine = getPref("engine") as string;
  const modelConfig = ENGINE_MODELS[engine as EngineType] as any;
  if (!modelConfig || modelConfig.platform !== "ai") return;

  const provider = modelConfig.provider;
  const apiKeyInput = d.getElementById("aiocr-ai-api-key") as HTMLInputElement;
  const modelInput = d.getElementById("aiocr-ai-model") as HTMLInputElement;
  const apiBaseInput = d.getElementById(
    "aiocr-ai-api-base",
  ) as HTMLInputElement;
  const customPromptInput = d.getElementById(
    "aiocr-ai-custom-prompt",
  ) as HTMLTextAreaElement;

  const configs = JSON.parse((getPref("aiProviderConfigs") as string) || "{}");
  configs[provider] = {
    apiKey: apiKeyInput?.value || "",
    model: modelInput?.value || "",
    apiBase: apiBaseInput?.value || "",
  };
  setPref("aiProviderConfigs", JSON.stringify(configs));

  if (customPromptInput) {
    setPref("aiCustomPrompt", customPromptInput.value);
  }

  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: 2000,
  })
    .createLine({
      text: "AI 服务商配置已保存",
      type: "success",
      progress: 100,
    })
    .show();
}

function initCustomEnginesTab(win: Window) {
  renderCustomEngineList(win);

  const d = doc(win);

  const addBtn = d.getElementById("aiocr-custom-engine-add");
  addBtn?.addEventListener("command", () => {
    showCustomEngineForm(win, true);
    clearCustomEngineForm(win);
  });

  const editBtn = d.getElementById("aiocr-custom-engine-edit");
  editBtn?.addEventListener("command", () => {
    const selectedId = getSelectedCustomEngineId(win);
    if (!selectedId) {
      win.alert("请先选择一个自定义引擎。");
      return;
    }
    const engine = getCustomEngineById(selectedId);
    if (engine) {
      showCustomEngineForm(win, true);
      fillCustomEngineForm(win, engine);
    }
  });

  const deleteBtn = d.getElementById("aiocr-custom-engine-delete");
  deleteBtn?.addEventListener("command", () => {
    const selectedId = getSelectedCustomEngineId(win);
    if (!selectedId) {
      win.alert("请先选择一个自定义引擎。");
      return;
    }
    deleteCustomEngine(selectedId);
    renderCustomEngineList(win);
    showCustomEngineForm(win, false);
    refreshEngineDropdownAndMenu(win);
  });

  const testBtn = d.getElementById("aiocr-custom-engine-test");
  testBtn?.addEventListener("command", async () => {
    const selectedId = getSelectedCustomEngineId(win);
    if (!selectedId) {
      win.alert("请先选择一个自定义引擎。");
      return;
    }
    const progressWin = new ztoolkit.ProgressWindow(
      addon.data.config.addonName,
      { closeOnClick: true, closeTime: -1 },
    )
      .createLine({
        text: getString("progress-test-connection"),
        type: "default",
        progress: 50,
      })
      .show();

    const result = await testConnection(selectedId, "", "");
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

  const saveBtn = d.getElementById("aiocr-custom-engine-save");
  saveBtn?.addEventListener("command", () => {
    const formData = getCustomEngineFormData(win);
    if (!formData.name || !formData.apiUrl || !formData.model) {
      win.alert("引擎名称、API 完整地址和模型名称为必填项。");
      return;
    }

    const isEdit = (saveBtn as any)._editMode;
    if (isEdit) {
      formData.id = (saveBtn as any)._editId;
      updateCustomEngine(formData);
    } else {
      formData.id =
        "custom-" +
        Date.now().toString(36) +
        Math.random().toString(36).substr(2);
      addCustomEngine(formData);
    }

    renderCustomEngineList(win);
    showCustomEngineForm(win, false);
    clearCustomEngineForm(win);
    refreshEngineDropdownAndMenu(win);
  });

  const cancelBtn = d.getElementById("aiocr-custom-engine-cancel");
  cancelBtn?.addEventListener("command", () => {
    showCustomEngineForm(win, false);
    clearCustomEngineForm(win);
  });
}

function renderCustomEngineList(win: Window) {
  const d = doc(win);
  const container = d.getElementById(
    "aiocr-custom-engines-container",
  ) as HTMLElement;
  if (!container) return;

  while (container.firstChild) container.removeChild(container.firstChild);

  const engines = getCustomEngines();

  if (engines.length === 0) {
    const emptyDiv = d.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    emptyDiv.style.cssText = "color: #999; text-align: center; padding: 20px;";
    emptyDiv.textContent = "暂无自定义引擎，点击「添加引擎」创建。";
    container.appendChild(emptyDiv);
    return;
  }

  for (const engine of engines) {
    const itemDiv = d.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    itemDiv.setAttribute("data-custom-engine-id", engine.id);
    itemDiv.style.cssText =
      "padding: 8px; border-bottom: 1px solid #e0e0e0; cursor: pointer;";

    itemDiv.addEventListener("click", () => {
      const allItems = container.querySelectorAll("[data-custom-engine-id]");
      allItems.forEach((el: Element) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.getAttribute("data-custom-engine-id") !== engine.id) {
          htmlEl.style.backgroundColor = "";
        }
      });
      itemDiv.style.backgroundColor = "#e8f5e9";
    });

    const nameDiv = d.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    nameDiv.style.cssText = "font-weight: bold; font-size: 13px;";
    nameDiv.textContent = engine.name;

    const urlDiv = d.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    urlDiv.style.cssText =
      "color: #666; font-size: 11px; word-break: break-all;";
    urlDiv.textContent = engine.apiUrl;

    const modelDiv = d.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    modelDiv.style.cssText = "color: #999; font-size: 11px;";
    modelDiv.textContent = `模型: ${engine.model}`;

    itemDiv.appendChild(nameDiv);
    itemDiv.appendChild(urlDiv);
    itemDiv.appendChild(modelDiv);
    container.appendChild(itemDiv);
  }
}

function getSelectedCustomEngineId(win: Window): string | null {
  const container = win.document.getElementById(
    "aiocr-custom-engines-container",
  );
  if (!container) return null;

  const allItems = container.querySelectorAll("[data-custom-engine-id]");
  for (const item of allItems) {
    const el = item as HTMLElement;
    if (
      el.style.backgroundColor === "rgb(232, 245, 233)" ||
      el.style.backgroundColor === "#e8f5e9"
    ) {
      return el.getAttribute("data-custom-engine-id");
    }
  }
  return null;
}

function showCustomEngineForm(win: Window, show: boolean) {
  const form = doc(win).getElementById("aiocr-custom-engine-form");
  if (form) form.setAttribute("hidden", show ? "false" : "true");
}

function clearCustomEngineForm(win: Window) {
  const d = doc(win);
  const fields = [
    "aiocr-custom-engine-name",
    "aiocr-custom-engine-apiurl",
    "aiocr-custom-engine-apikey",
    "aiocr-custom-engine-model",
  ];
  for (const id of fields) {
    const input = d.getElementById(id) as HTMLInputElement;
    if (input) input.value = "";
  }
  const maxTokensInput = d.getElementById(
    "aiocr-custom-engine-maxtokens",
  ) as HTMLInputElement;
  if (maxTokensInput) maxTokensInput.value = "4096";
  const tempInput = d.getElementById(
    "aiocr-custom-engine-temperature",
  ) as HTMLInputElement;
  if (tempInput) tempInput.value = "0.1";

  const saveBtn = d.getElementById("aiocr-custom-engine-save");
  if (saveBtn) {
    (saveBtn as any)._editMode = false;
    (saveBtn as any)._editId = "";
  }
}

function fillCustomEngineForm(win: Window, engine: CustomEngineConfig) {
  const d = doc(win);
  const nameInput = d.getElementById(
    "aiocr-custom-engine-name",
  ) as HTMLInputElement;
  const apiUrlInput = d.getElementById(
    "aiocr-custom-engine-apiurl",
  ) as HTMLInputElement;
  const apiKeyInput = d.getElementById(
    "aiocr-custom-engine-apikey",
  ) as HTMLInputElement;
  const modelInput = d.getElementById(
    "aiocr-custom-engine-model",
  ) as HTMLInputElement;
  const maxTokensInput = d.getElementById(
    "aiocr-custom-engine-maxtokens",
  ) as HTMLInputElement;
  const tempInput = d.getElementById(
    "aiocr-custom-engine-temperature",
  ) as HTMLInputElement;

  if (nameInput) nameInput.value = engine.name;
  if (apiUrlInput) apiUrlInput.value = engine.apiUrl;
  if (apiKeyInput) apiKeyInput.value = engine.apiKey;
  if (modelInput) modelInput.value = engine.model;
  if (maxTokensInput) maxTokensInput.value = String(engine.maxTokens);
  if (tempInput) tempInput.value = String(engine.temperature);

  const saveBtn = d.getElementById("aiocr-custom-engine-save");
  if (saveBtn) {
    (saveBtn as any)._editMode = true;
    (saveBtn as any)._editId = engine.id;
  }
}

function getCustomEngineFormData(win: Window): CustomEngineConfig {
  const d = doc(win);
  const nameInput = d.getElementById(
    "aiocr-custom-engine-name",
  ) as HTMLInputElement;
  const apiUrlInput = d.getElementById(
    "aiocr-custom-engine-apiurl",
  ) as HTMLInputElement;
  const apiKeyInput = d.getElementById(
    "aiocr-custom-engine-apikey",
  ) as HTMLInputElement;
  const modelInput = d.getElementById(
    "aiocr-custom-engine-model",
  ) as HTMLInputElement;
  const maxTokensInput = d.getElementById(
    "aiocr-custom-engine-maxtokens",
  ) as HTMLInputElement;
  const tempInput = d.getElementById(
    "aiocr-custom-engine-temperature",
  ) as HTMLInputElement;

  return {
    id: "",
    name: nameInput?.value || "",
    apiUrl: apiUrlInput?.value || "",
    apiKey: apiKeyInput?.value || "",
    model: modelInput?.value || "",
    maxTokens: parseInt(maxTokensInput?.value || "4096", 10) || 4096,
    temperature: parseFloat(tempInput?.value || "0.1") || 0.1,
  };
}

function refreshEngineDropdownAndMenu(win: Window) {
  const d = doc(win);
  const engineMenulist = d.getElementById("aiocr-engine") as XUL.MenuList;
  if (engineMenulist) {
    const menupopup = engineMenulist.querySelector("menupopup");
    if (menupopup) {
      menupopup
        .querySelectorAll("[value^='custom-']")
        .forEach((el) => el.remove());

      const existingCustomSep = menupopup.querySelector(
        ".aiocr-custom-separator",
      );
      const engines = getCustomEngines();

      if (engines.length > 0) {
        let sep: Element;
        if (existingCustomSep) {
          sep = existingCustomSep;
        } else {
          sep = d.createElementNS(
            "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
            "menuseparator",
          );
          sep.classList.add("aiocr-custom-separator");
          menupopup.appendChild(sep);
        }
        for (const engine of engines) {
          const menuItem = d.createElementNS(
            "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
            "menuitem",
          );
          menuItem.setAttribute("value", engine.id);
          menuItem.setAttribute("label", `${engine.name} (自定义)`);
          menupopup.appendChild(menuItem);
        }
      } else if (existingCustomSep) {
        existingCustomSep.remove();
      }
    }
  }

  try {
    refreshEngineMenu();
  } catch {
    /* ignore */
  }
}
