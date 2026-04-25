/**
 * Maps variable / collection (datasource) names to their UUIDs.
 *
 * The SDUI runtime keys variables and collections by UUID — `variables['a1b2…']`,
 * `collections['c3d4…']`. JavaScript bindings ({ "js": "..." }) and the new
 * runJavaScript workflow action address them by **name** instead — `variables.cartCount`,
 * `collections.products` — to match WeWeb's developer-friendly DX.
 *
 * Both the builder (when loading a page) and the SDUI engine (when bootstrapping
 * a live page) call `registerVariableNames()` / `registerCollectionNames()` so the
 * JS evaluator's name-keyed Proxies can resolve correctly.
 */

let _varNameToUuid: Record<string, string> = {};
let _varUuidToName: Record<string, string> = {};
let _colNameToUuid: Record<string, string> = {};
let _colUuidToName: Record<string, string> = {};

/** Replace the variable name → UUID map. */
export function registerVariableNames(map: Record<string, string>): void {
  _varNameToUuid = { ...map };
  _varUuidToName = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  if (typeof window !== 'undefined') {
    (globalThis as Record<string, unknown>).__debugVarNameRegistry = _varNameToUuid;
  }
}

export function getVariableUuidByName(name: string): string | undefined {
  return _varNameToUuid[name];
}

export function getVariableNameByUuid(uuid: string): string | undefined {
  return _varUuidToName[uuid];
}

export function getAllVariableNames(): string[] {
  return Object.keys(_varNameToUuid);
}

/** Replace the collection name → UUID map. */
export function registerCollectionNames(map: Record<string, string>): void {
  _colNameToUuid = { ...map };
  _colUuidToName = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  if (typeof window !== 'undefined') {
    (globalThis as Record<string, unknown>).__debugColNameRegistry = _colNameToUuid;
  }
}

export function getCollectionUuidByName(name: string): string | undefined {
  return _colNameToUuid[name];
}

export function getCollectionNameByUuid(uuid: string): string | undefined {
  return _colUuidToName[uuid];
}

export function getAllCollectionNames(): string[] {
  return Object.keys(_colNameToUuid);
}
