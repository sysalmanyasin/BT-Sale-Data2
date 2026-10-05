// supabase/functions/set-staff-login/index.ts
//
// Creates or resets a staff member's Closing App login (phone + 4-digit
// PIN). Called from BT Sale Data's Staff Registry ("Set/Reset PIN").
//
// Why this has to be a server-side function, not client code: creating
// or resetting *someone else's* account requires Supabase's service-role
// key, which must never be shipped in the app. This function holds that
// key privately and is the only place it's used.
//
// SECURITY (added 2026-10-05): this function used to have verify_jwt off AND no check
// inside, so anyone who knew a staff id could set that person's PIN and then log in to
// the Closing App as them. It now requires a signed-in Supabase session (the Staff
// Registry already sends one via supabase-js functions.invoke) whose email is an ACTIVE
// row in bt_authorized_users. Staff accounts (phone@staff.internal) are NOT in that
// table, so a staff member cannot reset anyone's PIN.
//
// No extra secrets to set: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided
// automatically to every Edge Function.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function normalizePhone(p: string): string {
  return String(p || '').replace(/\D/g, '');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  // Browsers send an OPTIONS preflight before the real POST for any cross-origin call.
  // Without this the preflight fails and supabase-js reports a generic
  // "Failed to send a request to the Edge Function" even though the function is healthy.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // ── Authenticate: signed-in AND an active authorised BT user ──────────
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not signed in' }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const email = userData?.user?.email;
  if (userErr || !email) return json({ error: 'Invalid session' }, 401);
  const { data: allowed } = await admin
    .from('bt_authorized_users')
    .select('email')
    .ilike('email', email)
    .eq('active', true)
    .limit(1);
  if (!allowed || !allowed.length) return json({ error: 'Not authorised' }, 403);

  let body: { staffId?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const staffId = String(body.staffId || '').trim();
  const pin = String(body.pin || '').trim();

  if (!staffId) return json({ error: 'staffId is required' }, 400);
  if (!/^\d{4}$/.test(pin)) return json({ error: 'pin must be exactly 4 digits' }, 400);

  // Phone comes from bt_staff (already saved via BT's own Staff Card + Save Staff List),
  // never accepted as a raw parameter here, so there is no way for this call to set a
  // login against a phone number that doesn't match the actual staff record.
  const { data: staffRow, error: staffErr } = await admin
    .from('bt_staff')
    .select('id, data')
    .eq('id', staffId)
    .maybeSingle();

  if (staffErr) return json({ error: staffErr.message }, 500);
  if (!staffRow) {
    return json(
      { error: `No bt_staff record for "${staffId}" — save the Staff List in BT Sale Data first.` },
      404,
    );
  }

  const phone = normalizePhone((staffRow.data as any)?.phone);
  if (!phone) {
    return json(
      { error: 'This employee has no phone number on file — add one on the Staff Card and Save Staff List first.' },
      400,
    );
  }

  const staffEmail = `${phone}@staff.internal`;
  const password = `${pin}_${staffId}`; // deterministic; Closing App's login derives the same value from {phone, pin}

  const { data: existingLink } = await admin
    .from('staff_auth_link')
    .select('auth_user_id')
    .eq('staff_id', staffId)
    .maybeSingle();

  let userId: string;
  if (existingLink) {
    const { data, error } = await admin.auth.admin.updateUserById(existingLink.auth_user_id, {
      email: staffEmail,
      password,
      email_confirm: true,
    });
    if (error) return json({ error: error.message }, 500);
    userId = data.user.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: staffEmail,
      password,
      email_confirm: true,
    });
    if (error) return json({ error: error.message }, 500);
    userId = data.user.id;

    const { error: linkErr } = await admin
      .from('staff_auth_link')
      .upsert({ staff_id: staffId, auth_user_id: userId });
    if (linkErr) return json({ error: linkErr.message }, 500);
  }

  return json({ ok: true, staffId, phone });
});
