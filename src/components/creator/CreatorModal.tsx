'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { parseConfig, type CreatorConfig } from '@/lib/config';
import { createItem, validateItemName } from '@/lib/create';
import { matchByValue, readPage, toFieldContext, type Candidate, type FieldContext, type PageContext } from '@/lib/fieldContext';
import { addToMultilist } from '@/lib/multilist';
import type { SdkClient } from '@/lib/sdk';
import { resolveTarget, type Target } from '@/lib/targets';
import * as copy from './copy';
import { SetupView } from './SetupView';

/** What the modal needs from the SDK client: the real ClientSDK has all of it, and so do the test fakes. */
export type CreatorClient = SdkClient & { getValue(): Promise<unknown>; closeApp(): Promise<void> };

type Setup = { page: PageContext; initial?: CreatorConfig };
type Step =
  | { name: 'loading' }
  | { name: 'not-set-up'; page: PageContext; message: string }
  | { name: 'error'; message: string; setup?: Setup }
  | { name: 'pick'; page: PageContext; config: CreatorConfig; matches: Candidate[] }
  | { name: 'form'; config: CreatorConfig; ctx: FieldContext; target: Target }
  | { name: 'end'; tone: 'success' | 'warning'; text: string; detail?: string };

const LOADING: Step = { name: 'loading' };
const messageOf = (e: unknown) => (e instanceof Error && e.message) || copy.UNKNOWN_ERROR;

/** Works out where the new item goes for the chosen item; the next step is the form, or the error. */
async function resolve(client: CreatorClient, page: PageContext, config: CreatorConfig, c: Candidate): Promise<Step> {
  try {
    const ctx = toFieldContext(page, c);
    return { name: 'form', config, ctx, target: await resolveTarget(client, ctx, config) };
  } catch (e) {
    return { name: 'error', message: messageOf(e), setup: { page, initial: config } };
  }
}

const Panel = ({ children }: { children: ReactNode }) => <div className="flex flex-col gap-4 p-4">{children}</div>;

function CloseButton({ client }: { client: CreatorClient }) {
  // Nothing to do if the host refuses to close.
  const close = async () => {
    try {
      await client.closeApp();
    } catch {}
  };
  return (
    <Button variant="outline" className="self-start" onClick={close}>
      {copy.CLOSE}
    </Button>
  );
}

function CreateForm({ client, config, ctx, target, onEnd }: { client: CreatorClient; config: CreatorConfig; ctx: FieldContext; target: Target; onEnd(end: Extract<Step, { name: 'end' }>): void }) {
  const uid = useId();
  const [templateId, setTemplateId] = useState(target.templates.length === 1 ? target.templates[0].id : '');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  const nameError = validateItemName(name);
  const canCreate = !working && !nameError && !!templateId;

  const setField = (field: string, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    // Until the editor types their own name, the nameFrom field names the item.
    if (!nameEdited && field.toLowerCase() === config.nameFrom?.toLowerCase()) setName(value.trim());
  };

  const submit = async () => {
    if (!canCreate) return;
    setWorking(true);
    setError(undefined);
    const fields = Object.fromEntries((config.required ?? []).filter((f) => values[f]?.trim()).map((f) => [f, values[f]]));
    let made: { id: string; path: string };
    try {
      made = await createItem(client, ctx, { name, templateId, folderId: target.folderId, fields });
    } catch (e) {
      setError(messageOf(e));
      setWorking(false);
      return;
    }
    try {
      await addToMultilist(client, ctx, config.targetField, made.id);
    } catch (e) {
      // The item exists; creating again would duplicate it.
      onEnd({ name: 'end', tone: 'warning', text: copy.partialFailure(made.path, config.targetField), detail: messageOf(e) });
      return;
    }
    let hint = '';
    try {
      await client.mutate('pages.reloadCanvas');
    } catch {
      hint = copy.RELOAD_HINT;
    }
    onEnd({ name: 'end', tone: 'success', text: copy.added(name, config.targetField) + hint });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-muted-foreground text-sm">{copy.creatingIn(target.folderPath)}</p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-template`}>{copy.TEMPLATE}</Label>
        <Select value={templateId} onValueChange={setTemplateId} disabled={working}>
          <SelectTrigger id={`${uid}-template`} className="w-full">
            <SelectValue placeholder={copy.CHOOSE_TEMPLATE} />
          </SelectTrigger>
          <SelectContent>
            {target.templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-name`}>{copy.NAME}</Label>
        <Input
          id={`${uid}-name`}
          value={name}
          disabled={working}
          aria-invalid={!!nameError && name !== ''}
          aria-describedby={nameError ? `${uid}-name-message` : undefined}
          onChange={(e) => {
            setNameEdited(true);
            setName(e.target.value);
          }}
        />
        {nameError && (
          <p id={`${uid}-name-message`} className={name === '' ? 'text-muted-foreground text-xs' : 'text-danger-fg text-xs'}>
            {nameError}
          </p>
        )}
      </div>

      {(config.required ?? []).map((field, i) => (
        <div key={field} className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-field-${i}`}>{field}</Label>
          <Input id={`${uid}-field-${i}`} value={values[field] ?? ''} disabled={working} onChange={(e) => setField(field, e.target.value)} />
        </div>
      ))}

      {error && (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="self-start" disabled={!canCreate}>
        {working ? copy.CREATING : copy.CREATE}
      </Button>
    </form>
  );
}

function Editor({ client, onOpenSetup }: { client: CreatorClient; onOpenSetup(setup: Setup): void }) {
  const [step, setStep] = useState<Step>(LOADING);

  useEffect(() => {
    (async () => {
      try {
        const page = await readPage(client);
        const parsed = parseConfig(page.rawConfig);
        if (!parsed.ok) return setStep({ name: 'not-set-up', page, message: parsed.message });
        const matches = matchByValue(page.candidates, page.rawConfig);
        if (matches.length === 0) return setStep({ name: 'error', message: copy.NOT_FOUND });
        if (matches.length > 1) return setStep({ name: 'pick', page, config: parsed.config, matches });
        setStep(await resolve(client, page, parsed.config, matches[0]));
      } catch (e) {
        setStep({ name: 'error', message: messageOf(e) });
      }
    })();
  }, [client]);

  switch (step.name) {
    case 'loading':
      return (
        <div className="flex justify-center p-6">
          <Spinner className="size-6" />
        </div>
      );
    case 'not-set-up':
      return (
        <Panel>
          <Alert variant="warning">
            <AlertTitle>{copy.NOT_SET_UP}</AlertTitle>
            <AlertDescription>{step.message}</AlertDescription>
          </Alert>
          <Button className="self-start" onClick={() => onOpenSetup({ page: step.page })}>
            {copy.OPEN_SETUP}
          </Button>
        </Panel>
      );
    case 'error':
      return (
        <Panel>
          <Alert variant="danger">
            <AlertDescription>{step.message}</AlertDescription>
          </Alert>
          <div className="flex gap-2">
            {step.setup && <Button onClick={() => onOpenSetup(step.setup!)}>{copy.OPEN_SETUP}</Button>}
            <CloseButton client={client} />
          </div>
        </Panel>
      );
    case 'pick':
      return (
        <Panel>
          <p className="text-sm font-medium">{copy.PICK}</p>
          <div className="flex flex-col gap-2">
            {step.matches.map((c) => (
              <Button
                key={c.itemId}
                variant="outline"
                className="h-auto flex-col items-start gap-0 py-2 text-left whitespace-normal"
                onClick={async () => {
                  setStep(LOADING);
                  setStep(await resolve(client, step.page, step.config, c));
                }}
              >
                <span>{c.name}</span>
                <span className="text-muted-foreground text-xs font-normal [overflow-wrap:anywhere]">{c.path}</span>
              </Button>
            ))}
          </div>
        </Panel>
      );
    case 'form':
      return (
        <Panel>
          <CreateForm client={client} config={step.config} ctx={step.ctx} target={step.target} onEnd={setStep} />
        </Panel>
      );
    case 'end':
      return (
        <Panel>
          <Alert variant={step.tone}>
            <AlertDescription>{step.text}</AlertDescription>
          </Alert>
          {step.detail && <p className="text-muted-foreground text-sm">{step.detail}</p>}
          <CloseButton client={client} />
        </Panel>
      );
  }
}

/** The editor flow: find this field's item, then create an item and add it to the multilist. "Open setup" switches to the Setup view. */
export function CreatorModal({ client }: { client: CreatorClient }) {
  const [setup, setSetup] = useState<Setup>();
  if (setup) return <SetupView client={client} page={setup.page} initial={setup.initial} onBack={() => setSetup(undefined)} />;
  return <Editor client={client} onOpenSetup={setSetup} />;
}
