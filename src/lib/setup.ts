import type { CreatorConfig } from './config';

const text = (v?: string) => v?.trim() ?? '';
const list = (v?: string[]) => (v ?? []).map(text).filter(Boolean);

/** The JSON for the companion field's Standard Values: pretty, trimmed, with every blank setting left out. IDs stay as typed; `parseConfig` checks them. */
export function buildConfig(form: CreatorConfig): string {
  const [folder, nameFrom] = [text(form.folder), text(form.nameFrom)];
  const [templates, required] = [list(form.templates), list(form.required)];
  return JSON.stringify(
    {
      targetField: text(form.targetField),
      ...(folder && { folder }),
      ...(templates.length > 0 && { templates }),
      ...(nameFrom && { nameFrom }),
      ...(required.length > 0 && { required }),
    },
    null,
    2,
  );
}
