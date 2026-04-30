import { config } from "../../package.json";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

const PREFS_PREFIX = config.prefsPrefix;

export function getPref<K extends keyof PluginPrefsMap>(key: K) {
  return Zotero.Prefs.get(`${PREFS_PREFIX}.${key}`, true) as PluginPrefsMap[K];
}

export function setPref<K extends keyof PluginPrefsMap>(
  key: K,
  value: PluginPrefsMap[K],
) {
  return Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

export function clearPref(key: string) {
  return Zotero.Prefs.clear(`${PREFS_PREFIX}.${key}`, true);
}

export interface EndpointConfig {
  id: string;
  name: string;
  url: string;
  token: string;
  active: boolean;
}

export type EndpointsMap = {
  [engine: string]: EndpointConfig[];
};

export function getEndpoints(): EndpointsMap {
  try {
    const raw = getPref("endpoints");
    return JSON.parse(raw as string) as EndpointsMap;
  } catch {
    return {};
  }
}

export function setEndpoints(map: EndpointsMap) {
  setPref("endpoints", JSON.stringify(map));
}

export function getEndpointsForEngine(engine: string): EndpointConfig[] {
  const map = getEndpoints();
  return map[engine] || [];
}

export function getActiveEndpoint(engine: string): EndpointConfig | null {
  const endpoints = getEndpointsForEngine(engine);
  return endpoints.find((e) => e.active) || endpoints[0] || null;
}

export function addEndpoint(engine: string, endpoint: EndpointConfig) {
  const map = getEndpoints();
  if (!map[engine]) map[engine] = [];
  if (endpoint.active) {
    map[engine].forEach((e) => (e.active = false));
  }
  map[engine].push(endpoint);
  setEndpoints(map);
}

export function updateEndpoint(engine: string, endpoint: EndpointConfig) {
  const map = getEndpoints();
  if (!map[engine]) return;
  if (endpoint.active) {
    map[engine].forEach((e) => (e.active = false));
  }
  const idx = map[engine].findIndex((e) => e.id === endpoint.id);
  if (idx >= 0) {
    map[engine][idx] = endpoint;
  }
  setEndpoints(map);
}

export function deleteEndpoint(engine: string, endpointId: string) {
  const map = getEndpoints();
  if (!map[engine]) return;
  map[engine] = map[engine].filter((e) => e.id !== endpointId);
  setEndpoints(map);
}

export function setActiveEndpoint(engine: string, endpointId: string) {
  const map = getEndpoints();
  if (!map[engine]) return;
  map[engine].forEach((e) => (e.active = e.id === endpointId));
  setEndpoints(map);
}

export interface AdvancedFeaturesMap {
  [engine: string]: { [feature: string]: boolean };
}

export function getAdvancedFeatures(): AdvancedFeaturesMap {
  try {
    const raw = getPref("advancedFeatures");
    return JSON.parse(raw as string) as AdvancedFeaturesMap;
  } catch {
    return {};
  }
}

export function setAdvancedFeatures(map: AdvancedFeaturesMap) {
  setPref("advancedFeatures", JSON.stringify(map));
}

export function getAdvancedFeaturesForEngine(
  engine: string,
): { [feature: string]: boolean } {
  const map = getAdvancedFeatures();
  return map[engine] || {};
}

export function setAdvancedFeature(
  engine: string,
  feature: string,
  value: boolean,
) {
  const map = getAdvancedFeatures();
  if (!map[engine]) map[engine] = {};
  map[engine][feature] = value;
  setAdvancedFeatures(map);
}

export function getEnabledAdvancedFeatures(
  engine: string,
): { [feature: string]: boolean } {
  const features = getAdvancedFeaturesForEngine(engine);
  const result: { [feature: string]: boolean } = {};
  for (const [key, val] of Object.entries(features)) {
    if (val) result[key] = val;
  }
  return result;
}
