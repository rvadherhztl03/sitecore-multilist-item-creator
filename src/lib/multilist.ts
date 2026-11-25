import { normalizeId } from '@/lib/config';
import type { FieldContext } from '@/lib/fieldContext';
import { graphql, SdkError, type SdkClient } from '@/lib/sdk';

const READ = `query ReadField($itemId: ID!, $language: String!, $version: Int) {
  item(where: { database: "master", itemId: $itemId, language: $language, version: $version }) {
    fields(ownFields: false, excludeStandardFields: true) { nodes { name value } }
  }
}`;

const UPDATE = `mutation UpdateField($itemId: ID!, $language: String!, $version: Int, $field: String!, $value: String!) {
  updateItem(input: { itemId: $itemId, language: $language, version: $version, fields: [{ name: $field, value: $value }] }) {
    item { itemId name path version }
  }
}`;

// An entry normalizeId rejects never matches.
const same = (entry: string, id: string) => {
  try {
    return normalizeId(entry) === id;
  } catch {
    return false;
  }
};

/** Adds `id` (written as `{UPPER-DASHED}`) to a multilist value; existing entries stay as stored. `added` is false when it was already there. */
export function appendId(value: string | null | undefined, id: string): { value: string; added: boolean } {
  const wanted = normalizeId(id);
  if (!value?.trim()) return { value: wanted, added: true };
  if (value.split('|').some((entry) => same(entry, wanted))) return { value, added: false };
  return { value: `${value}|${wanted}`, added: true };
}

/** Re-reads the field, appends `id` and writes it back; writes nothing when the ID is already there. */
export async function addToMultilist(client: SdkClient, ctx: FieldContext, fieldName: string, id: string): Promise<{ added: boolean }> {
  const where = { itemId: ctx.itemId, language: ctx.language, ...(ctx.version !== undefined && { version: ctx.version }) };
  const data = await graphql(client, ctx.env, READ, where);
  const wanted = fieldName.toLowerCase();
  const field = (data?.item?.fields?.nodes ?? []).find((f: { name: string }) => f.name.toLowerCase() === wanted);
  if (!field) throw new SdkError(`Field "${fieldName}" isn't on this item.`);
  const { value, added } = appendId(field.value, id);
  if (added) await graphql(client, ctx.env, UPDATE, { ...where, field: field.name, value });
  return { added };
}
