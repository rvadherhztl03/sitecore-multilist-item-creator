import { SdkError } from './sdk';

export type CreatorConfig = { targetField: string; folder?: string; templates?: string[]; nameFrom?: string; required?: string[] };

export type ConfigResult =
  | { ok: true; config: CreatorConfig }
  | { ok: false; reason: 'empty' | 'invalid-json' | 'missing-target' | 'bad-guid'; message: string };

const DASHED = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
// {dashed} (braces optional) or the Authoring API's compact 32 hex digits.
const ID = new RegExp(`^(?:\\{(${DASHED})\\}|(${DASHED})|([0-9a-f]{32}))$`, 'i');

/** Returns the ID as `{UPPERCASE-DASHED}`; accepts braced or bare dashed GUIDs and the compact 32-hex form, throws SdkError otherwise. */
export function normalizeId(id: string): string {
  const m = ID.exec(id.trim());
  if (!m) throw new SdkError(`"${id}" is not an item ID.`);
  const guid = m[1] ?? m[2] ?? m[3].replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  return `{${guid.toUpperCase()}}`;
}

const fail = (reason: Extract<ConfigResult, { ok: false }>['reason'], message: string): ConfigResult => ({ ok: false, reason, message });

const isBlank = (v: unknown) => v === undefined || v === null || v === '';
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Reads the companion field's value (the Standard Values JSON) into a config; never throws. Empty lists and blank settings are left out. */
export function parseConfig(raw: string | null | undefined): ConfigResult {
  if (!raw?.trim()) return fail('empty', 'This field has no setup yet. Open Setup to create one.');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail('invalid-json', "The setup isn't valid JSON. Open Setup to fix it.");
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return fail('invalid-json', 'The setup must be a JSON object. Open Setup to fix it.');
  }
  const { targetField, folder, templates, nameFrom, required } = json as Record<string, unknown>;
  if (typeof targetField !== 'string' || !targetField.trim()) {
    return fail('missing-target', 'The setup does not name the multilist to add to. Set "targetField".');
  }
  if (!isBlank(nameFrom) && typeof nameFrom !== 'string') return fail('invalid-json', 'The "nameFrom" setting must be a field name.');
  if (!isBlank(required) && !isStrings(required)) return fail('invalid-json', 'The "required" setting must be a list of field names.');
  if (!isBlank(templates) && !Array.isArray(templates)) return fail('invalid-json', 'The "templates" setting must be a list of item IDs.');

  const id = (setting: string, value: unknown) => {
    try {
      return normalizeId(value as string);
    } catch {
      throw new SdkError(`The "${setting}" setting has something that is not an item ID: ${JSON.stringify(value)}.`);
    }
  };
  const config: CreatorConfig = { targetField: targetField.trim() };
  try {
    if (!isBlank(folder)) config.folder = id('folder', folder);
    if (Array.isArray(templates) && templates.length) config.templates = templates.map((t) => id('templates', t));
  } catch (e) {
    return fail('bad-guid', (e as SdkError).message);
  }
  if (typeof nameFrom === 'string' && nameFrom.trim()) config.nameFrom = nameFrom.trim();
  const names = isStrings(required) ? required.map((s) => s.trim()).filter(Boolean) : [];
  if (names.length) config.required = names;
  return { ok: true, config };
}
