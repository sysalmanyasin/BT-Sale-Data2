// ══════════════════════════════════════════════════════════════════════
// BACKEND CONFIG — the ONE place the Supabase project URL + public anon key live.
//
// The anon key is a PUBLIC client key (safe to ship; RLS is the security
// boundary). It used to be copy-pasted into 8 files, which made rotation or
// a project move a risky multi-file edit. Import from here instead:
//
//   import { SUPABASE_URL, SUPABASE_ANON_KEY } from './shared/backend-config.js';
//
// This is a leaf module (no imports) so it can never take part in an import cycle.
// NEVER put a service-role / secret key here.
// ══════════════════════════════════════════════════════════════════════
export const SUPABASE_URL      = 'https://wetbugzzchkghpzmowod.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';

// Second project: the shared Pharmacy Audit Hub (read-only bridges: inventory, STR, audit,
// sale-payments, stock ledger). Public publishable key, same rules as above.
export const AUDIT_HUB_URL             = 'https://vtcrdkqhuvxatclobsby.supabase.co';
export const AUDIT_HUB_PUBLISHABLE_KEY = 'sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy';

/** Edge Function endpoint on the main project, e.g. functionUrl('bt-agent'). */
export const functionUrl = (name) => `${SUPABASE_URL}/functions/v1/${name}`;
