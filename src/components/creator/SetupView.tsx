'use client';

import { useId, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseConfig, type CreatorConfig } from '@/lib/config';
import { matchByField, toFieldContext, type Candidate, type PageContext } from '@/lib/fieldContext';
import type { SdkClient } from '@/lib/sdk';
import { buildConfig } from '@/lib/setup';
import { resolveTarget, type Target } from '@/lib/targets';
import * as copy from './copy';

type Form = { targetField: string; folder: string; templates: string; nameFrom: string; required: string };
type Result =
  | { kind: 'checked'; item: Candidate; target: Target }
  | { kind: 'error'; message: string }
  | { kind: 'copied' }
  | { kind: 'copy-failed'; json: string };

const toForm = (c?: CreatorConfig): Form => ({
  targetField: c?.targetField ?? '',
  folder: c?.folder ?? '',
  templates: (c?.templates ?? []).join('\n'),
  nameFrom: c?.nameFrom ?? '',
  required: (c?.required ?? []).join('\n'),
});
// One value per line; buildConfig trims and drops the blank ones.
const toConfig = (f: Form): CreatorConfig => ({ ...f, templates: f.templates.split('\n'), required: f.required.split('\n') });

const TEXTAREA =
  'border-input bg-body-bg text-md focus:border-primary focus:ring-primary w-full rounded-md border px-3 py-2 outline-none focus:ring-1';

/** Builds the companion field's setup JSON from a form, checks it against this page, and copies it. It never writes to Sitecore. */
export function SetupView({ client, page, initial, onBack }: { client: SdkClient; page: PageContext; initial?: CreatorConfig; onBack(): void }) {
  const uid = useId();
  const [form, setForm] = useState(() => toForm(initial));
  const [result, setResult] = useState<Result>();
  const [checking, setChecking] = useState(false);

  const edit = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setResult(undefined); // a result about an earlier form would mislead
  };
  const json = () => buildConfig(toConfig(form));

  const check = async () => {
    const parsed = parseConfig(json());
    if (!parsed.ok) return setResult({ kind: 'error', message: parsed.message });
    const item = matchByField(page.candidates, parsed.config.targetField)[0];
    if (!item) return setResult({ kind: 'error', message: copy.noField(parsed.config.targetField) });
    setChecking(true);
    try {
      setResult({ kind: 'checked', item, target: await resolveTarget(client, toFieldContext(page, item), parsed.config) });
    } catch (e) {
      setResult({ kind: 'error', message: copy.messageOf(e) });
    } finally {
      setChecking(false);
    }
  };

  const copyJson = async () => {
    const parsed = parseConfig(json());
    if (!parsed.ok) return setResult({ kind: 'error', message: parsed.message });
    const text = json();
    try {
      await navigator.clipboard.writeText(text); // throws when the iframe isn't allowed the clipboard (or there is none)
      setResult({ kind: 'copied' });
    } catch {
      setResult({ kind: 'copy-failed', json: text });
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          {copy.BACK}
        </Button>
        <h1 className="text-base font-semibold">{copy.SETUP_TITLE}</h1>
      </div>
      <p className="text-muted-foreground text-sm">{copy.SETUP_INTRO}</p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-target`}>{copy.TARGET_FIELD}</Label>
        <Input id={`${uid}-target`} value={form.targetField} onChange={(e) => edit({ targetField: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-folder`}>{copy.FOLDER}</Label>
        <Input id={`${uid}-folder`} value={form.folder} onChange={(e) => edit({ folder: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-templates`}>{copy.TEMPLATES}</Label>
        <textarea id={`${uid}-templates`} rows={3} className={TEXTAREA} value={form.templates} onChange={(e) => edit({ templates: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-name-from`}>{copy.NAME_FROM}</Label>
        <Input id={`${uid}-name-from`} value={form.nameFrom} onChange={(e) => edit({ nameFrom: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-required`}>{copy.REQUIRED}</Label>
        <textarea id={`${uid}-required`} rows={3} className={TEXTAREA} value={form.required} onChange={(e) => edit({ required: e.target.value })} />
      </div>

      <div className="flex gap-2">
        <Button variant="outline" disabled={checking} onClick={check}>
          {checking ? copy.CHECKING : copy.CHECK}
        </Button>
        <Button onClick={copyJson}>{copy.COPY}</Button>
      </div>

      {result?.kind === 'error' && (
        <Alert variant="danger">
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
      {result?.kind === 'checked' && (
        <Alert variant="success">
          <AlertDescription>
            <p>{copy.checked(result.item.name, result.item.path)}</p>
            <p>{copy.folderLine(result.target.folderPath)}</p>
            <p>{copy.templatesLine(result.target.templates.map((t) => t.name))}</p>
          </AlertDescription>
        </Alert>
      )}
      {(result?.kind === 'copied' || result?.kind === 'copy-failed') && (
        <>
          <Alert variant={result.kind === 'copied' ? 'success' : 'warning'}>
            <AlertDescription>
              <p>{result.kind === 'copied' ? copy.COPIED : copy.COPY_FAILED}</p>
              <p>{copy.PASTE_HINT}</p>
            </AlertDescription>
          </Alert>
          {result.kind === 'copy-failed' && (
            <textarea readOnly aria-label={copy.SETUP_JSON} rows={8} className={`${TEXTAREA} font-mono text-xs`} value={result.json} onFocus={(e) => e.currentTarget.select()} />
          )}
        </>
      )}
    </div>
  );
}
