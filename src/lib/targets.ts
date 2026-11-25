import { normalizeId, type CreatorConfig } from './config';
import type { FieldContext } from './fieldContext';
import { SdkError, graphql, type SdkClient } from './sdk';

export type Target = { folderId: string; folderPath: string; templates: { id: string; name: string }[] };

type Fields = { nodes?: { name: string; value: string }[] };

const NO_FOLDER = "Set a folder in Setup: the field's Source doesn't point to one.";
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const fieldValue = (fields: Fields | undefined, name: string) => fields?.nodes?.find((f) => sameName(f.name, name))?.value;

/** The folder a multilist Source points to, as a normalized ID or a /sitecore/ path; undefined for anything else (queries, empty). */
function sourceFolder(source: string | undefined): string | undefined {
  const asRef = (v: string) => {
    try {
      return normalizeId(v);
    } catch {
      return /^\/sitecore\//i.test(v.trim()) ? v.trim().replace(/\/+$/, '') : undefined;
    }
  };
  const s = source?.trim() ?? '';
  const direct = asRef(s);
  if (direct) return direct;
  // Parameter string: Key=Value&Key2=Value2. ponytail: values aren't URL-decoded; add decodeURIComponent if a real Source needs it.
  const params = new Map(s.split('&').map((p) => [p.slice(0, Math.max(p.indexOf('='), 0)).trim().toLowerCase(), p.slice(p.indexOf('=') + 1)] as const));
  for (const key of ['startsearchlocation', 'datasource']) {
    const ref = asRef(params.get(key) ?? '');
    if (ref) return ref;
  }
  return undefined;
}

/** Round trip 1: the Source of the template field named `targetField` (sections → field items; base templates aren't searched). */
async function templateFieldSource(client: SdkClient, ctx: FieldContext, targetField: string): Promise<string | undefined> {
  const data = await graphql(
    client,
    ctx.env,
    `query TemplateFields($templateId: ID!, $language: String!) {
  item(where: { database: "master", itemId: $templateId, language: $language }) {
    children(first: 1000) { nodes { children(first: 1000) { nodes { name fields(ownFields: false, excludeStandardFields: true) { nodes { name value } } } } } }
  }
}`,
    { templateId: ctx.templateId, language: ctx.language },
  );
  const sections: { children?: { nodes?: { name: string; fields?: Fields }[] } }[] = data?.item?.children?.nodes ?? [];
  const field = sections.flatMap((s) => s.children?.nodes ?? []).find((f) => sameName(f.name, targetField));
  if (!field) throw new SdkError(`Field "${targetField}" isn't on this item's template. Check targetField in Setup.`);
  return fieldValue(field.fields, 'Source');
}

/** Round trip 2: the folder's normalized ID and path, and its Insert Options; null when it doesn't exist. `ref` is a normalized ID or a path. */
async function readFolder(client: SdkClient, ctx: FieldContext, ref: string) {
  const byId = ref.startsWith('{');
  const data = await graphql(
    client,
    ctx.env,
    `query ReadFolder(${byId ? '$itemId: ID!' : '$path: String!'}, $language: String!) {
  item(where: { database: "master", ${byId ? 'itemId: $itemId' : 'path: $path'}, language: $language }) {
    itemId path
    fields(ownFields: false, excludeStandardFields: false) { nodes { name value } }
  }
}`,
    { [byId ? 'itemId' : 'path']: ref, language: ctx.language },
  );
  const item = data?.item;
  if (!item) return null;
  return { id: normalizeId(item.itemId), path: item.path as string, masters: fieldValue(item.fields, '__Masters') ?? '' };
}

/** Round trip 3: the names of the templates, in the order given. */
async function templateNames(client: SdkClient, ctx: FieldContext, ids: string[]) {
  const vars = ids.map((_, i) => `t${i}`);
  const data = await graphql(
    client,
    ctx.env,
    `query TemplateNames(${vars.map((v) => `$${v}: ID!`).join(', ')}, $language: String!) {
  ${vars.map((v) => `${v}: item(where: { database: "master", itemId: $${v}, language: $language }) { name }`).join('\n  ')}
}`,
    { ...Object.fromEntries(vars.map((v, i) => [v, ids[i]])), language: ctx.language },
  );
  return ids.map((id, i) => {
    const name = data?.[vars[i]]?.name;
    if (typeof name !== 'string') throw new SdkError(`Template ${id} wasn't found. Check templates in Setup.`);
    return { id, name };
  });
}

/** Works out where new items go and which templates they may use: config first, then the multilist's Source and the folder's Insert Options. At most three GraphQL round trips. */
export async function resolveTarget(client: SdkClient, ctx: FieldContext, config: CreatorConfig): Promise<Target> {
  const ref = config.folder ? normalizeId(config.folder) : sourceFolder(await templateFieldSource(client, ctx, config.targetField));
  if (!ref) throw new SdkError(NO_FOLDER);

  const folder = await readFolder(client, ctx, ref);
  if (!folder) throw new SdkError(config.folder ? `Folder ${ref} wasn't found. Check folder in Setup.` : NO_FOLDER);

  const listed = config.templates?.length ? config.templates : folder.masters.split('|').filter((s) => s.trim());
  const ids = [...new Set(listed.map(normalizeId))];
  if (!ids.length) throw new SdkError('Set templates in Setup: the folder has no Insert Options.');

  return { folderId: folder.id, folderPath: folder.path, templates: await templateNames(client, ctx, ids) };
}
