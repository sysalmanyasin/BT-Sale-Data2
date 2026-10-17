# Safe dead-code cleanup audit

Branch: `chore/safe-dead-code-audit`
Base: `main` at the current repository head.

## Findings

- The app is a hand-wired PWA: `index.html` and `sw.js` must stay aligned. The existing `tests/static/file-references.test.js` explicitly checks this.
- A file not mentioned directly in `index.html` is not necessarily unused: JavaScript modules may be imported dynamically, and there are separate Android, inventory-search, tests, and Supabase function entry points.
- `README.md` documents that password/PIN unlock is disabled while legacy markup/helpers remain for compatibility. These need a call-site and behavior audit before removal.
- `README-manager-intelligence.md` says some earlier AI helper modules and tests were already removed; the associated database migration/table history should not be deleted casually.
- No obvious backup/temp/build-output files were identified in the tracked-file inventory. The single filename containing “unused” is a Supabase migration, which is historical schema evidence and must be preserved.

## Cleanup decision

No production source files were deleted in this initial pass because the available evidence does not prove any specific source file is unreachable. Deleting based only on absence from `index.html` could break offline caching, dynamically loaded AI tools, native Android apps, or Supabase functions.

## Verification required before deleting candidates

1. Run the full `npm test` suite and syntax checks in a complete checkout.
2. Trace static and dynamic imports from every app entry point, including `index.html`, `inventory-search/app.js`, Android modules, and Supabase functions.
3. Compare local assets against HTML, CSS `url()`, manifests, service-worker precache lists, Kotlin/XML references, and runtime path construction.
4. Remove only confirmed unreachable files/functions, then rerun tests and build checks.
5. Review the resulting diff before merging into `main`.

This file records the audit state; it does not claim that dead code has been removed.
