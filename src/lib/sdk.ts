/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ApplicationContext } from '@sitecore-marketplace-sdk/client';

/** `liveContextId`: the Experience Edge (live) context, when the app was granted one; `contextId` is the preview one. */
export type Env = { id: string; name: string; contextId: string; tenantName?: string; liveContextId?: string };

export interface SdkClient {
  query(key: string, options?: { params?: unknown }): Promise<any>;
  mutate(key: string, options?: { params?: unknown }): Promise<any>;
}

export class SdkError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SdkError';
    this.status = status;
  }
}

const CONTEXT_KIND: 'preview' | 'live' = 'preview';

// The SDK's published .d.ts re-exports from a missing ../src, so ApplicationContext resolves to `any`; type the entries here.
type Resource = {
  resourceId: string;
  tenantId?: string;
  tenantName?: string;
  tenantDisplayName?: string;
  context?: { live?: string; preview?: string };
};

export function toEnvs(ctx: ApplicationContext | undefined): Env[] {
  const entries: Resource[] = ctx?.resourceAccess ?? ctx?.resources ?? [];
  const envs = entries.flatMap((r) => {
    const contextId = r.context?.[CONTEXT_KIND];
    // In XM Cloud every entry shares the product's resourceId, so the tenant identifies the environment.
    const name = r.tenantDisplayName ?? r.tenantName ?? r.resourceId;
    const live = r.context?.live ? { liveContextId: r.context.live } : {};
    return contextId ? [{ id: r.tenantId ?? contextId, name, contextId, tenantName: r.tenantName, ...live, r }] : [];
  });
  // Same display name twice: add the tenant name, tenant id or resource id so the pickers can tell them apart.
  return envs.map(({ r, ...env }) =>
    envs.filter((e) => e.name === env.name).length > 1 ? { ...env, name: `${env.name} (${r.tenantName ?? r.tenantId ?? r.resourceId})` } : env,
  );
}

// Returns '' when there is nothing useful to say (undefined, empty string or `{}`).
const errorText = (e: any): string => {
  const t = typeof e === 'string' ? e : (e?.message ?? e?.Message ?? e?.title ?? JSON.stringify(e));
  return typeof t === 'string' && t !== '{}' ? t : '';
};

export async function call<T = any>(
  client: SdkClient,
  env: Env,
  kind: 'query' | 'mutate',
  key: string,
  params: { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown } = {},
): Promise<{ data: T; response?: Response }> {
  const options = { params: { ...params, query: { ...params.query, sitecoreContextId: env.contextId } } };
  let res: any;
  try {
    res = await client[kind](key, options);
  } catch (e) {
    throw new SdkError(errorText(e) || 'SDK call failed');
  }
  // query() catches thrown errors into `error` and wraps the hey-api result in `data`.
  if (kind === 'query' && res?.error !== undefined) throw new SdkError(errorText(res.error) || 'SDK call failed');
  const { data, error, response } = (kind === 'query' ? res?.data : res) ?? {};
  if ((response && !response.ok) || error !== undefined) {
    const status: number | undefined = response?.status;
    if (status === 401 || status === 403) {
      throw new SdkError(`The app can't access ${env.name}. Grant it in Cloud Portal → app → environment access.`, status);
    }
    const text = errorText(error) || response?.statusText;
    throw new SdkError(`HTTP ${status}${text ? `: ${text}` : ''}`, status);
  }
  return { data, response };
}

// `key`: xmc.live.graphql queries Experience Edge instead (with the env's live context as `contextId`).
export async function graphql(
  client: SdkClient,
  env: Env,
  query: string,
  variables: Record<string, unknown>,
  key: 'xmc.authoring.graphql' | 'xmc.live.graphql' = 'xmc.authoring.graphql',
): Promise<any> {
  const { data } = await call(client, env, 'mutate', key, {
    body: { query, variables },
  });
  if (data?.errors?.length) throw new SdkError(data.errors[0].message);
  return data?.data;
}
