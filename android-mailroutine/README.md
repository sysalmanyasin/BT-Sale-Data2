# MailRoutine

A native Android app (Kotlin, Jetpack Compose, MVVM, Room, WorkManager) for **recurring, template-driven work emails** sent through an authorized Google Workspace / Gmail account. It is fully isolated from the other apps in this repository: separate Gradle project, package `com.duapharma.mailroutine`, separate workflow.

> **Build status.** The pure-Kotlin core (domain, MIME, Gmail client, send coordinator, sweeper, backup, AI parsing) has JVM unit tests. The Android layer (Room, Compose UI, WorkManager, Google auth) is only verified by the GitHub Actions build. Check the latest *Build MailRoutine APK* run before relying on any particular commit. Real Google sign-in and a real send have **not** been tested by CI; use [`docs/MANUAL_TEST.md`](docs/MANUAL_TEST.md).

## What it does

- Routines with To/Cc/Bcc, daily or weekly schedules (selected weekdays, per-routine time zone), typed template fields (text, multiline, number, date, yes/no, choice) with required-field validation, `{{placeholders}}` in subject and body, and a rendered preview.
- Dashboard: needs-attention, overdue, due now, upcoming, completed. Pause/resume. Missed work is recovered (bounded look-back).
- Local reminders and failure notifications (routine name and status only; never addresses or content).
- Attachments copied into private app storage, validated (size, blocked types), checked again at send time.
- Per-attempt history with timestamps, outcome and Gmail message ID.
- Versioned, credential-free JSON backup/restore.
- Optional AI writing assistant (Groq or Anthropic), off until an API key is added: draft a template from a sentence, one-tap improve / fix grammar / shorter / expand / formal / friendly / new subject, translate on request, and write or polish the text of any Text or Multiline field when you fill in an email. Suggestions only; you always review before anything is used or sent.

## Home-screen widgets

Two widgets (long-press the home screen, then Widgets, then MailRoutine):

- **Next up**: the next scheduled email, when it goes out, whether it sends automatically, and a red or amber line when something needs you or is due now.
- **Upcoming emails**: the Need you / Due now / Upcoming counters plus the next few emails (more rows appear as you resize it).

Tapping an email opens it in the app; tapping anywhere else opens the dashboard. Widgets refresh whenever the data changes, after every background sweep (about 15 min) and on the system's 30 min tick, so "in 4h 51m" can lag by a few minutes. Logic lives in `domain/WidgetSnapshot.kt` (unit tested) and `platform/Widgets.kt`.

## Delivery safety model

Every send goes through one code path, `send/SendCoordinator`:

1. **Unique occurrence id** `routineId:localDate`, backed by a unique database index, so a slot exists at most once however often the sweeper runs.
2. **Atomic claim**: `UPDATE ... SET state='SENDING' WHERE id=? AND state IN (sendable)`. Only the worker whose update affects one row proceeds, so concurrent workers cannot both send.
3. **Gate** (`domain/SendGate`): refuses when required fields are missing, the account is not connected or needs reauthorization, the routine is invalid (bad recipients), a required attachment is unavailable, or (automatic mode only) consent is missing/stale, the routine is paused, or the due time is older than the routine's late window.
4. A `STARTED` attempt is written **before** the network call; a lease on the row expires after 10 minutes.
5. Outcome handling (`domain/RetryPolicy`):

| Outcome | Result |
|---|---|
| Gmail returned an id | `SUBMITTED` (accepted by Gmail, **not** proof of delivery) |
| Failed before any request left the phone, or HTTP 429/rate limit | `FAILED_RETRYABLE`, backoff 1 / 5 / 15 min, max 4 attempts, then `FAILED` |
| HTTP 400/404/413 and other definitive rejections | `FAILED` |
| HTTP 401/403 (token or admin policy) | `BLOCKED`, needs reauthorization |
| Timeout or I/O error after the request was written, HTTP 5xx, unparseable 2xx, unexpected exception, or process death mid-send (lease expiry) | `UNCERTAIN` |

`UNCERTAIN` has **no transition to `SENDING`**. The user checks Gmail Sent and chooses "it was sent" (`CONFIRMED_SENT`) or explicitly allows a resend. Because the app only holds the send-only permission, it cannot search Sent itself; reconciliation is manual by design.

**Approval fingerprint.** Turning on automatic sending requires an explicit consent dialog. The consent stores a SHA-256 of the template, fields, recipients and attachments. Any change (including text pasted from AI drafting) invalidates it, and automatic sending stays off until the user approves again. AI output only fills the editor; it never saves anything.

## Security

- No Gmail password is ever requested. Authorization uses Google Identity Services with the single scope `https://www.googleapis.com/auth/gmail.send` (send-only; cannot read mail). Access tokens are short-lived and fetched on demand; the app stores **no** tokens or refresh tokens. Only a "connected" flag and the account address are kept.
- The optional AI keys (one per provider) are stored in Keystore-backed `EncryptedSharedPreferences`; if secure storage is unavailable, AI stays disabled. Keys are never in backups, logs, request bodies or error messages. Only the instruction and the text being worked on go to the provider; recipients and other fields never do.
- Auto-backup and device transfer are disabled (`allowBackup=false`). The in-app backup contains routine definitions only: no credentials, no consent, no history, no attachment data or paths. Imports are validated (format, version, size, field rules, addresses, time zone) and arrive **paused with automatic sending off**.
- Attachment ids are validated before touching the filesystem; paths and contents are never logged. Nothing in the app logs message content, addresses or tokens.
- No OAuth client secrets, release keystores or service credentials are in this repository (only a public, debug-only keystore, see OAuth configuration). No Supabase credentials exist in this app.

## Build locally

Requirements: JDK 17, Gradle 8.7 (the repo has no wrapper; CI uses `setup-gradle` 8.7), Android SDK platform 34.

```bash
cd android-mailroutine
gradle testDebugUnitTest      # JVM unit tests
gradle assembleDebug          # app/build/outputs/apk/debug/
```

Plugin versions are pinned as a compatible set (AGP 8.5.2, Kotlin 2.0.21, KSP 2.0.21-1.0.28, Compose BOM 2024.10.01, Room 2.6.1, WorkManager 2.9.1). Change them together. Do not copy versions from `android-attendance`, which currently pins a different AGP/Kotlin combination.

## Google OAuth configuration (one-time)

1. In Google Cloud Console create (or reuse) a project and **enable the Gmail API**.
2. **OAuth consent screen**: for a Workspace organization choose user type **Internal**. Internal apps are available only to your domain's users and avoid public verification. If you choose External, `gmail.send` is a *sensitive* scope: the app needs Google's OAuth verification before general use, and while in "Testing" status only listed test users can authorize and grants expire after 7 days. Add the scope `.../auth/gmail.send`.
3. **Credentials -> Create OAuth client ID -> Android**. Package name `com.duapharma.mailroutine` (use `com.duapharma.mailroutine.debug` for debug builds) and the **SHA-1 of the signing certificate** of the APK you install. Debug APKs (CI and local) are signed with the debug-only keystore committed at `android-mailroutine/keystore/mailroutine-debug.jks` (alias `mailroutine-debug`), so the SHA-1 is stable: `F0:ED:E3:6B:CA:29:43:95:07:09:C6:F9:B8:E3:08:AB:18:E0:AE:F2` for package `com.duapharma.mailroutine.debug`. This key is public because the repo is public: never use it for release builds. For the signed release APK, register the SHA-1 printed by the release job's "Verify signature" step for `com.duapharma.mailroutine`.
4. **Workspace admin**: the app must be allowed under *Admin console -> Security -> Access and data control -> API controls -> Manage Third-Party App Access* (trust the client ID). If the admin blocks it, Connect fails with an "Authorization failed" message and nothing is sent.
5. In the app: Settings -> **Connect Gmail**.

No client ID or secret is compiled into the app; the Android OAuth client is matched by package name and signing certificate.

## Local scheduling: what to expect

Everything runs on the phone. Android defers background work (Doze, battery optimization, OEM task killers), so:

- Automatic sends are **best effort**: usually within minutes of the due time, sometimes later. A 15-minute periodic sweep, one inexact alarm for the next due moment, and receivers for boot / time / time-zone changes all trigger the same idempotent sweeper.
- If the phone is off, offline, or the app is force-stopped, nothing sends. On the next run, overdue slots within the 7-day look-back are created and appear as overdue.
- Automatic sending only covers a window after the due time (default 120 minutes, per routine). After that the item waits for you: send, or skip.
- Exempt the app from battery optimization for best reliability. No exact-alarm or foreground-service permission is used.

## Backup format

```json
{ "format": "mailroutine-backup", "version": 1, "exportedAt": "...", "routines": [ { "name": "...", "recipients": {...}, "subject": "...", "body": "...", "fields": [...], "schedule": {...}, "maxLateMinutes": 120, "reminderLeadMinutes": 15, "attachmentNames": ["..."] } ] }
```

Newer versions are rejected with a clear message. Add a decoder branch (and tests) when bumping `BackupCodec.VERSION`.

## Database migrations

Room schema v1. `AppDatabase.VERSION` and `Migrations.ALL` must move together; `MigrationChainTest` fails if a step is missing, and destructive fallback is deliberately not enabled. The build exports schema JSON to `app/schemas/` (uploaded as a CI artifact); commit it with each schema change and add a case to `androidTest/MigrationInstrumentedTest` (needs an emulator, not run in CI).

## Releasing

1. Create a release keystore **outside the repo** (`keytool -genkeypair -v -keystore mailroutine-release.jks -alias mailroutine -keyalg RSA -keysize 4096 -validity 10000`). Back it up safely; losing it means users must uninstall to update.
2. In GitHub: Settings -> Environments -> **mailroutine-release**. Add required reviewers, restrict deployments to `main`/`mailroutine-v*` tags, and add secrets `MAILROUTINE_KEYSTORE_BASE64` (`base64 -w0 mailroutine-release.jks`), `MAILROUTINE_KEYSTORE_PASSWORD`, `MAILROUTINE_KEY_ALIAS`, `MAILROUTINE_KEY_PASSWORD`.
3. Run **Build MailRoutine APK** manually with *publish_release* checked and a version, or push a tag `mailroutine-v1.0.0`. The release job runs only after tests and the debug build pass, signs with the environment secrets, verifies the signature, and creates a **draft** GitHub release.
4. Register the printed certificate SHA-1 in the Google Cloud Android OAuth client, then install and run the manual test.

## Known limitations

- Gmail "submission accepted" is the strongest signal available with send-only access; there is no delivery or read confirmation.
- Ambiguous sends need a human check (by design).
- Release builds are not minified; enabling R8 needs an on-device test pass first.
- Single device, single Gmail account, plain-text bodies, no cloud sync.
- UI strings are not yet localized.

## Changes in 1.1.0

- **Fix:** a blocked automatic send no longer re-triggers a full sweep (which re-enqueued the same send in a loop). The send worker now notifies for that one item directly.
- **Fix:** attachment total capped at 17 MB (base64 growth plus Gmail's 25 MB message limit). Out-of-memory while preparing a message now fails cleanly as "not sent" instead of leaving an item stuck as SENDING / UNCERTAIN.
- **Approval now also covers the schedule** (kind, days, time, time zone) in addition to template, fields, recipients and attachments. The late window and reminder lead still do not revoke approval.
- **Rich (HTML) templates.** Body format can be Plain text or Rich (HTML). Rich bodies are sanitised to a small whitelist (no scripts, images or forms; links only http/https/mailto), field values are HTML-escaped on insertion, and the message is sent as multipart/alternative with an automatic plain-text version. A rich body is stored with a leading `<!--mr:html-->` marker, so there is no database migration and backups keep working unchanged.
- **Design:** dark theme, bottom navigation, status pills and summary tiles on the dashboard, battery-optimisation shortcut in Settings.
- **Privacy note** for AI drafting added to Settings (instruction and template text go to Anthropic's API with your key).

## AI writing assistant (Groq / Anthropic)

- **Providers.** Settings -> *AI writing assistant*. Groq (default, free tier available; default model `llama-3.3-70b-versatile`, OpenAI-compatible endpoint `https://api.groq.com/openai/v1/chat/completions`) or Anthropic. Each has its own key and model; the selected one is used immediately for every request. Existing installs that only have an Anthropic key stay on Anthropic.
- **In the template editor** *Write with AI…*: describe the email, or tap a one-tap action (Improve, Fix grammar, Shorter, Expand, More formal, Friendlier, New subject) to rework what is there. Output may only use your field placeholders (`{{key}}`, `{{date}}`, ...); unknown placeholders are rejected. Applying a suggestion fills the editor only. It never saves, and it switches automatic sending off if approved content changed (the existing approval fingerprint). A body the AI left unchanged is not rewritten, so rich formatting survives *New subject*.
- **When filling in an email** a Text or Multiline field gets *Write with AI…* / *Improve with AI…*. The result is checked against the field's rules (single line, max length) before it can be used, and the preview updates only after *Use this text*.
- **Privacy.** Requests carry the instruction and the text being edited (the template with placeholders, or one field's text and label). No recipients, no other fields, no key in the body. Prompts and replies are never logged.
- **Design.** `ai/ChatClient` is the only provider-specific code (`GroqChat`, `AnthropicChat`); `ai/AiDrafter` holds prompts and strict parsing; `ProviderDrafter` picks the active provider per call. Adding another OpenAI-compatible provider means one small `ChatClient` and an `AiProvider` entry. If Groq rejects JSON mode for a model (HTTP 400) the request is retried once without it.
