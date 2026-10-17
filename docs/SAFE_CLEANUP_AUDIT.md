# Safe dead-code cleanup audit

Branch: `chore/safe-dead-code-audit`
Base: `main` at `0f3d9c28a721d30572f97b238a135de41719723a`.

## Findings

- The repository contains 596 tracked files in the recursive Git tree, including separate web, inventory-search, Android, tests, scripts, and Supabase entry points.
- The app is a hand-wired PWA: `index.html` and `sw.js` must stay aligned. The existing `tests/static/file-references.test.js` explicitly checks local references and offline precache coverage.
- A file not mentioned directly in `index.html` is not necessarily unused: JavaScript modules may be imported dynamically, and there are separate Android, inventory-search, tests, and Supabase function entry points.
- A filename-based scan found no obvious backup, temporary, editor-swap, log, or build-output files. The only name matching an "unused" pattern is a Supabase migration, which is historical schema evidence and must be preserved.
- The tracked production `css/` and `js/` files were all mentioned in either `index.html` or `sw.js` during a first-pass path scan. This is not a proof that every function is used, but it means deleting a whole production asset based only on filename or direct HTML inclusion is not justified.
- `README.md` documents that password/PIN unlock is disabled while legacy markup/helpers remain. These have visible inline-handler and cross-function references; removal should be a separate, behavior-tested change.
- `README-manager-intelligence.md` notes that some earlier AI helper modules/tests were already removed. Associated database migration/table history must not be deleted casually.
- `sw.js` history documents the removal of three AI Center modules and says the repository index was rebuilt; those removed module paths are not present as tracked files.

## Verification

- GitHub Actions workflow `.github/workflows/test.yml` completed successfully for this branch on 2026-10-17: `npm ci` and `npm test` passed.
- The existing static tests verify local HTML script/stylesheet paths, duplicate script tags, service-worker APP_SHELL paths, and HTML-to-precache coverage.

## Cleanup decision

No production source files were deleted in this pass because the repository scan did not prove any specific tracked production file or function is unreachable. Deleting based only on absence from one entry point could break offline caching, dynamically loaded tools, native Android apps, or Supabase functions. No application runtime files were changed; `main` remains unchanged.

## Next safe candidates

1. Audit the disabled password fallback as a focused change: remove its hidden markup, inline handlers, helper functions, and CSS only after verifying Google sign-in and account-switch flows.
2. Add a whole-repository reference report that understands HTML, CSS `url()`, ES module imports, dynamic path construction, Kotlin/XML, manifests, service-worker precache lists, and Supabase functions.
3. Only delete confirmed unreachable files/functions, then rerun the full tests and inspect the diff before merging.
