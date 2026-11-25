import { describe, expect, it } from 'vitest';
import { addToMultilist, appendId } from '@/lib/multilist';
import { SdkError } from '@/lib/sdk';
import type { FieldContext } from '@/lib/fieldContext';
import { fakeClient } from '@/test/fakeClient';

const A = '{F2A114C9-A2BB-4A2A-BAA8-48E1EA20EE81}';
const A_COMPACT = 'f2a114c9a2bb4a2abaa848e1ea20ee81';
const A_BARE = 'f2a114c9-a2bb-4a2a-baa8-48e1ea20ee81';
const B = '{1C0685BF-FBF9-447B-8FC9-6758ECAE42CD}';
const B_COMPACT = '1c0685bffbf9447b8fc96758ecae42cd';
const C = '{5D3C1E7A-0B64-4F0E-9A57-2E8F6B1D9C40}';

describe('appendId', () => {
  it.each([[''], ['  '], [null], [undefined]])('starts the list from %j', (value) => {
    expect(appendId(value, A)).toEqual({ value: A, added: true });
  });

  it('appends after existing entries', () => {
    expect(appendId(B, A)).toEqual({ value: `${B}|${A}`, added: true });
    expect(appendId(`${B}|${C}`, A)).toEqual({ value: `${B}|${C}|${A}`, added: true });
  });

  it('writes a compact new ID normalized', () => {
    expect(appendId(B, A_COMPACT)).toEqual({ value: `${B}|${A}`, added: true });
    expect(appendId('', A_COMPACT)).toEqual({ value: A, added: true });
  });

  it('keeps existing entries exactly as stored', () => {
    const stored = `${B_COMPACT}|${C.toLowerCase()}`;
    expect(appendId(stored, A)).toEqual({ value: `${stored}|${A}`, added: true });
  });

  it.each([[A], [A.toLowerCase()], [A_BARE], [A_COMPACT]])('leaves the value alone when %s is already in it', (stored) => {
    const value = `${B}|${stored}`;
    expect(appendId(value, A)).toEqual({ value, added: false });
    expect(appendId(value, A_COMPACT)).toEqual({ value, added: false });
  });

  it('does not match or throw on an entry that is not an item ID', () => {
    expect(appendId(`nope|${B}`, A)).toEqual({ value: `nope|${B}|${A}`, added: true });
    expect(appendId(`nope|${A}`, A)).toEqual({ value: `nope|${A}`, added: false });
  });

  it('rejects a new ID that is not an item ID', () => {
    expect(() => appendId(B, 'nope')).toThrow(SdkError);
  });
});

describe('addToMultilist', () => {
  const ctx: FieldContext = {
    env: { id: 'env-1', name: 'Env', contextId: 'ctx-1' },
    itemId: B,
    itemName: 'Hero',
    itemPath: '/sitecore/content/Hero',
    templateId: C,
    language: 'en',
    version: 3,
    rawConfig: '{"targetField":"Items"}',
  };

  /** Replies to the read with `fields` and to the update with an item; `items` lists the replies' bodies. */
  const setup = (fields: { name: string; value: string | null }[]) =>
    fakeClient({
      'xmc.authoring.graphql': (params) =>
        params.body.query.includes('mutation')
          ? { data: { data: { updateItem: { item: { itemId: B_COMPACT, name: 'Hero', path: '/x', version: 3 } } } } }
          : { data: { data: { item: { fields: { nodes: fields } } } } },
    });

  const bodies = (calls: { params: any }[]) => calls.map((c) => c.params.body); // eslint-disable-line @typescript-eslint/no-explicit-any

  it('reads the field, then writes the appended value', async () => {
    const { client, calls } = setup([{ name: 'Items', value: B }]);
    await expect(addToMultilist(client, ctx, 'Items', A_COMPACT)).resolves.toEqual({ added: true });
    const [read, write] = bodies(calls);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.key === 'xmc.authoring.graphql' && c.params.query.sitecoreContextId === 'ctx-1')).toBe(true);
    expect(read.query).not.toContain('mutation');
    expect(read.query).toContain('excludeStandardFields: true');
    expect(read.variables).toEqual({ itemId: B, language: 'en', version: 3 });
    expect(write.query).toContain('mutation');
    expect(write.variables).toEqual({ itemId: B, language: 'en', version: 3, field: 'Items', value: `${B}|${A}` });
  });

  it('does not write when the item is already in the field', async () => {
    const { client, calls } = setup([{ name: 'Items', value: `${B}|${A_BARE}` }]);
    await expect(addToMultilist(client, ctx, 'Items', A)).resolves.toEqual({ added: false });
    expect(calls).toHaveLength(1);
    expect(bodies(calls)[0].query).not.toContain('mutation');
  });

  it('starts an empty or null field with the new ID', async () => {
    for (const value of ['', null]) {
      const { client, calls } = setup([{ name: 'Items', value }]);
      await addToMultilist(client, ctx, 'Items', A);
      expect(bodies(calls)[1].variables.value).toBe(A);
    }
  });

  it('matches the field name in any case and writes it as Sitecore named it', async () => {
    const { client, calls } = setup([{ name: 'Title', value: 'x' }, { name: 'Related Items', value: B }]);
    await addToMultilist(client, ctx, 'related ITEMS', A);
    expect(bodies(calls)[1].variables).toMatchObject({ field: 'Related Items', value: `${B}|${A}` });
  });

  it('uses the version it was given, and none when there is none', async () => {
    const { client, calls } = setup([{ name: 'Items', value: '' }]);
    await addToMultilist(client, { ...ctx, language: 'da', version: undefined }, 'Items', A);
    const [read, write] = bodies(calls);
    expect(read.variables).toEqual({ itemId: B, language: 'da' });
    expect(write.variables).toEqual({ itemId: B, language: 'da', field: 'Items', value: A });
    expect(read.variables).not.toHaveProperty('version');
    expect(write.variables).not.toHaveProperty('version');
  });

  it('reads again on every call, so it appends to what is stored now', async () => {
    let stored = B;
    const { client, calls } = fakeClient({
      'xmc.authoring.graphql': (params) => {
        if (!params.body.query.includes('mutation')) return { data: { data: { item: { fields: { nodes: [{ name: 'Items', value: stored }] } } } } };
        stored = params.body.variables.value;
        return { data: { data: { updateItem: { item: { itemId: B_COMPACT } } } } };
      },
    });
    await addToMultilist(client, ctx, 'Items', A);
    await addToMultilist(client, ctx, 'Items', C);
    expect(stored).toBe(`${B}|${A}|${C}`);
    expect(calls).toHaveLength(4);
  });

  it('says so when the field is not on the item, and writes nothing', async () => {
    const { client, calls } = setup([{ name: 'Title', value: 'x' }]);
    await expect(addToMultilist(client, ctx, 'Items', A)).rejects.toThrow(new SdkError(`Field "Items" isn't on this item.`));
    expect(calls).toHaveLength(1);
  });

  it('says so when the item has no fields at all', async () => {
    const { client } = fakeClient({ 'xmc.authoring.graphql': () => ({ data: { data: { item: null } } }) });
    await expect(addToMultilist(client, ctx, 'Items', A)).rejects.toThrow(`Field "Items" isn't on this item.`);
  });

  it('passes on a GraphQL error from the write', async () => {
    const { client } = fakeClient({
      'xmc.authoring.graphql': (params) =>
        params.body.query.includes('mutation')
          ? { data: { errors: [{ message: 'Access denied' }] } }
          : { data: { data: { item: { fields: { nodes: [{ name: 'Items', value: '' }] } } } } },
    });
    await expect(addToMultilist(client, ctx, 'Items', A)).rejects.toThrow('Access denied');
  });
});
