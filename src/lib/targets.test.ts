// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CreatorConfig } from '@/lib/config';
import type { FieldContext } from '@/lib/fieldContext';
import { SdkError } from '@/lib/sdk';
import { resolveTarget } from '@/lib/targets';
import { fakeClient } from '@/test/fakeClient';

const ENV = { id: 'e1', name: 'Dev', contextId: 'p1' };
// The Authoring API returns compact IDs; the app works with {UPPER-DASHED}.
const compact = (n: number) => n.toString(16).padStart(32, '0');
const braced = (n: number) => compact(n).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '{$1-$2-$3-$4-$5}').toUpperCase();

const TEMPLATE = braced(1);
const FOLDER = 10;
const T_A = 20;
const T_B = 21;
const CTX: FieldContext = { env: ENV, itemId: braced(2), itemName: 'Hero', itemPath: '/sitecore/content/Hero', templateId: TEMPLATE, language: 'en', rawConfig: '' };
const CONFIG: CreatorConfig = { targetField: 'items' };

type World = {
  source?: string; // Source of the "items" field definition; undefined = no such field on the template
  fieldName?: string;
  folders?: Record<string, { id: number; path: string; masters?: string }>; // by braced ID or path
  names?: Record<number, string>; // template item names by id
};

// One fake Authoring endpoint; the operation name says which round trip it is.
function world(w: World) {
  const { client, calls } = fakeClient({
    'xmc.authoring.graphql': ({ body: { query, variables } }) => {
      const op = /query (\w+)/.exec(query)![1];
      if (op === 'TemplateFields') {
        const fields = w.source === undefined ? [] : [{ name: w.fieldName ?? 'items', fields: { nodes: [{ name: 'Type', value: 'Multilist' }, { name: 'Source', value: w.source }] } }];
        const other = { name: 'title', fields: { nodes: [{ name: 'Source', value: 'ignore me' }] } };
        return { data: { data: { item: { children: { nodes: [{ name: 'Content', children: { nodes: [other, ...fields] } }, { name: '__Standard Values', children: { nodes: [] } }] } } } } };
      }
      if (op === 'ReadFolder') {
        const f = w.folders?.[variables.itemId ?? variables.path];
        const item = f && {
          itemId: compact(f.id),
          path: f.path,
          fields: { nodes: [{ name: '__Created', value: '20260101T000000Z' }, ...(f.masters === undefined ? [] : [{ name: '__Masters', value: f.masters }])] },
        };
        return { data: { data: { item: item ?? null } } };
      }
      if (op === 'TemplateNames') {
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(variables)) {
          if (k === 'language') continue;
          const n = [...Array(100).keys()].find((i) => braced(i) === v)!;
          data[k] = w.names?.[n] === undefined ? null : { itemId: compact(n), name: w.names[n] };
        }
        return { data: { data } };
      }
      throw new Error(`unexpected operation ${op}`);
    },
  });
  const ops = () => calls.map((c) => /query (\w+)/.exec(c.params.body.query)![1]);
  return { client, calls, ops };
}

const NAMES = { [T_A]: 'Article', [T_B]: 'Teaser' };
const FOLDERS = { [braced(FOLDER)]: { id: FOLDER, path: '/sitecore/content/Shared/Items', masters: `${braced(T_A)}|${braced(T_B)}` } };

describe('resolveTarget', () => {
  it('uses the configured folder and templates as-is, and only looks up the folder and the template names', async () => {
    const { client, calls, ops } = world({ folders: FOLDERS, names: NAMES });
    const config = { ...CONFIG, folder: braced(FOLDER), templates: [braced(T_B), braced(T_A)] };

    const target = await resolveTarget(client, CTX, config);

    expect(target).toEqual({
      folderId: braced(FOLDER),
      folderPath: '/sitecore/content/Shared/Items',
      templates: [{ id: braced(T_B), name: 'Teaser' }, { id: braced(T_A), name: 'Article' }],
    });
    expect(ops()).toEqual(['ReadFolder', 'TemplateNames']);
    expect(calls.every((c) => c.key === 'xmc.authoring.graphql' && c.params.query.sitecoreContextId === 'p1')).toBe(true);
    expect(calls[0].params.body.variables).toEqual({ itemId: braced(FOLDER), language: 'en' });
    // __Masters is a standard field: the folder read has to ask for them.
    expect(calls[0].params.body.query).toContain('excludeStandardFields: false');
  });

  it('reads the Source of the field on the template when there is no configured folder (three round trips)', async () => {
    const { client, ops, calls } = world({ source: braced(FOLDER), folders: FOLDERS, names: NAMES });

    const target = await resolveTarget(client, CTX, CONFIG);

    expect(target.folderId).toBe(braced(FOLDER));
    expect(target.templates.map((t) => t.id)).toEqual([braced(T_A), braced(T_B)]);
    expect(ops()).toEqual(['TemplateFields', 'ReadFolder', 'TemplateNames']);
    expect(calls[0].params.body.variables).toEqual({ templateId: TEMPLATE, language: 'en' });
  });

  it.each([
    ['a braced GUID', braced(FOLDER)],
    ['a bare dashed GUID', braced(FOLDER).slice(1, -1).toLowerCase()],
    ['a compact GUID', compact(FOLDER)],
    ['a GUID with spaces around it', `  ${braced(FOLDER).toLowerCase()} `],
    ['StartSearchLocation with other parameters', `StartSearchLocation=${braced(FOLDER)}&TemplateFilter=Article,Teaser&DatabaseName=master`],
    ['StartSearchLocation among other parameters in any case', `TemplateFilter=Article&startsearchlocation=${compact(FOLDER)}`],
    ['DataSource', `DataSource=${braced(FOLDER)}&IncludeItemsForDisplay=x`],
  ])('takes the folder from Source given as %s', async (_label, source) => {
    const { client } = world({ source, folders: FOLDERS, names: NAMES });
    expect((await resolveTarget(client, CTX, CONFIG)).folderId).toBe(braced(FOLDER));
  });

  it('prefers StartSearchLocation over DataSource', async () => {
    const other = 99;
    const folders = { ...FOLDERS, [braced(other)]: { id: other, path: '/sitecore/content/Other', masters: braced(T_A) } };
    const { client } = world({ source: `DataSource=${braced(other)}&StartSearchLocation=${braced(FOLDER)}`, folders, names: NAMES });
    expect((await resolveTarget(client, CTX, CONFIG)).folderId).toBe(braced(FOLDER));
  });

  it('resolves a Source path to the folder ID, reading the folder by path', async () => {
    const path = '/sitecore/content/Shared/Items';
    const { client, calls } = world({ source: path, folders: { [path]: FOLDERS[braced(FOLDER)] }, names: NAMES });

    const target = await resolveTarget(client, CTX, CONFIG);

    expect(target).toMatchObject({ folderId: braced(FOLDER), folderPath: path });
    expect(calls[1].params.body.variables).toEqual({ path, language: 'en' });
  });

  it.each([
    ['one trailing slash', '/sitecore/content/Shared/Items/'],
    ['several trailing slashes', '/sitecore/content/Shared/Items//'],
    ['a trailing slash and spaces', '  /sitecore/content/Shared/Items/ '],
    ['a trailing slash in StartSearchLocation', 'StartSearchLocation=/sitecore/content/Shared/Items/&IncludeTemplatesForSelection=Article'],
    ['a trailing slash in DataSource', 'DataSource=/sitecore/content/Shared/Items/'],
  ])('reads the folder by its path without the trailing slash: %s', async (_label, source) => {
    const path = '/sitecore/content/Shared/Items';
    const { client, calls } = world({ source, folders: { [path]: FOLDERS[braced(FOLDER)] }, names: NAMES });

    const target = await resolveTarget(client, CTX, CONFIG);

    expect(target).toMatchObject({ folderId: braced(FOLDER), folderPath: path });
    expect(calls[1].params.body.variables).toEqual({ path, language: 'en' });
  });

  it('resolves a path inside a StartSearchLocation parameter string', async () => {
    const path = '/sitecore/content/Shared/Items';
    const { client } = world({ source: `StartSearchLocation=${path}&IncludeTemplatesForSelection=Article`, folders: { [path]: FOLDERS[braced(FOLDER)] }, names: NAMES });
    expect((await resolveTarget(client, CTX, CONFIG)).folderId).toBe(braced(FOLDER));
  });

  it('matches the target field name regardless of case', async () => {
    const { client } = world({ source: braced(FOLDER), fieldName: 'Items', folders: FOLDERS, names: NAMES });
    expect((await resolveTarget(client, CTX, { targetField: 'ITEMS' })).folderId).toBe(braced(FOLDER));
  });

  it('splits the folder\'s Insert Options on "|", skipping blanks, in the given order', async () => {
    const folders = { [braced(FOLDER)]: { ...FOLDERS[braced(FOLDER)], masters: `${braced(T_B)}||${compact(T_A).toLowerCase()}|` } };
    const { client } = world({ folders, names: NAMES });

    const { templates } = await resolveTarget(client, CTX, { ...CONFIG, folder: braced(FOLDER) });

    expect(templates).toEqual([{ id: braced(T_B), name: 'Teaser' }, { id: braced(T_A), name: 'Article' }]);
  });

  it('lists a template once when Insert Options repeat it', async () => {
    const folders = { [braced(FOLDER)]: { ...FOLDERS[braced(FOLDER)], masters: `${braced(T_A)}|${compact(T_A)}` } };
    const { client } = world({ folders, names: NAMES });
    const { templates } = await resolveTarget(client, CTX, { ...CONFIG, folder: braced(FOLDER) });
    expect(templates).toEqual([{ id: braced(T_A), name: 'Article' }]);
  });

  it('prefers configured templates over Insert Options', async () => {
    const { client } = world({ folders: FOLDERS, names: NAMES });
    const { templates } = await resolveTarget(client, CTX, { ...CONFIG, folder: braced(FOLDER), templates: [braced(T_B)] });
    expect(templates).toEqual([{ id: braced(T_B), name: 'Teaser' }]);
  });

  describe('errors', () => {
    const reject = async (w: World, config: CreatorConfig = CONFIG) => {
      const { client } = world(w);
      const err = await resolveTarget(client, CTX, config).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(SdkError);
      return (err as SdkError).message;
    };
    const NO_FOLDER = "Set a folder in Setup: the field's Source doesn't point to one.";

    it("says when the field isn't on the template", async () => {
      expect(await reject({ folders: FOLDERS, names: NAMES })).toBe(`Field "items" isn't on this item's template. Check targetField in Setup.`);
    });

    it.each([
      ['empty', ''],
      ['a query', 'query:./ancestor-or-self::*[@@templatename="Folder"]'],
      ['a parameter string without a folder', 'TemplateFilter=Article&DatabaseName=master'],
      ['a path outside /sitecore/', '/content/Shared'],
    ])('asks for a folder when Source is %s', async (_label, source) => {
      expect(await reject({ source, folders: FOLDERS, names: NAMES })).toBe(NO_FOLDER);
    });

    it("asks for a folder when the Source folder doesn't exist", async () => {
      expect(await reject({ source: braced(77), folders: FOLDERS, names: NAMES })).toBe(NO_FOLDER);
    });

    it("names the configured folder when it doesn't exist", async () => {
      expect(await reject({ folders: FOLDERS, names: NAMES }, { ...CONFIG, folder: braced(77) })).toBe(`Folder ${braced(77)} wasn't found. Check folder in Setup.`);
    });

    it('asks for templates when the folder has no Insert Options', async () => {
      const noMasters = { [braced(FOLDER)]: { id: FOLDER, path: '/sitecore/content/Shared/Items' } };
      const blank = { [braced(FOLDER)]: { id: FOLDER, path: '/sitecore/content/Shared/Items', masters: ' | ' } };
      const config = { ...CONFIG, folder: braced(FOLDER) };
      const want = "Set templates in Setup: the folder has no Insert Options.";
      expect(await reject({ folders: noMasters, names: NAMES }, config)).toBe(want);
      expect(await reject({ folders: blank, names: NAMES }, config)).toBe(want);
    });

    it("names a template that doesn't exist", async () => {
      const config = { ...CONFIG, folder: braced(FOLDER), templates: [braced(T_A), braced(78)] };
      expect(await reject({ folders: FOLDERS, names: NAMES }, config)).toBe(`Template ${braced(78)} wasn't found. Check templates in Setup.`);
    });

    it('passes on a GraphQL error from the Authoring API', async () => {
      const { client } = fakeClient({ 'xmc.authoring.graphql': () => ({ data: { errors: [{ message: 'Boom' }] } }) });
      await expect(resolveTarget(client, CTX, CONFIG)).rejects.toThrow('Boom');
    });
  });
});
