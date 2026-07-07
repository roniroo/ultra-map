// Minimal Supabase REST (PostgREST) client for short share links.
// Uses plain fetch instead of @supabase/supabase-js — we only need one
// insert and one select, no need for a 30 KB dependency.
//
// The publishable (anon) key is safe to ship to browsers; row-level
// security on the table is what protects the data.

const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const supabaseConfigured = SUPABASE_URL.startsWith('https://') && SUPABASE_KEY.length > 0;

const TABLE_URL = `${SUPABASE_URL}/rest/v1/shared_plans`;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** Store a plan payload; returns the short id for a #t= link. */
export async function createSharedPlan(plan: unknown): Promise<string> {
  const res = await fetch(`${TABLE_URL}?select=id`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify({ plan }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`share upload failed (${res.status})`);
  const rows = (await res.json()) as { id: string }[];
  const id = rows[0]?.id;
  if (!id) throw new Error('share upload returned no id');
  return id;
}

/** Fetch a plan payload previously stored by createSharedPlan. */
export async function fetchSharedPlan(id: string): Promise<unknown> {
  const res = await fetch(
    `${TABLE_URL}?id=eq.${encodeURIComponent(id)}&select=plan`,
    { headers: headers(), signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`share lookup failed (${res.status})`);
  const rows = (await res.json()) as { plan: unknown }[];
  if (!rows.length) throw new Error('shared plan not found');
  return rows[0].plan;
}
