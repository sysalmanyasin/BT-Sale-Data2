# BT Attendance (Android)

Companion native app to BT-Sale-Data2's Manager → Attendance tab.
Detects a staff member's phone entering/exiting the pharmacy's
geofence and writes a `check_in`/`check_out` row to
`attendance_events`, with an in-app QR scan as an always-available
fallback. See the root repo's attendance spec and
`ATTENDANCE_INTEGRATION.md` for the full design.

## Before the first build

1. **Add a pharmacy location.** The app registers a geofence around
   whatever row it finds in `attendance_locations` (active = true).
   With none present, onboarding finishes with a "could not register
   the geofence yet" status and the app falls back to QR-only until
   one exists. Insert it via SQL or, once wired, a small "set
   location" control in Manager > Attendance:
   ```sql
   insert into attendance_locations (name, lat, lng, radius_meters)
   values ('Bahria Town Pharmacy', 33.000000, 73.000000, 100);
   ```
2. Nothing else needs a secret/local.properties entry — unlike
   android-widget, this app has no signed-in service account.
   `attendance_events`/`attendance_devices`/`attendance_locations` run
   on anon-role RLS (`USING(true)`), same as most of the main app's
   own tables — see `supabase/migrations/*_attendance_rls_fix.sql` for
   why, and its accepted tradeoff for a single-pharmacy app like this.

## Build

```bash
cd android-attendance
gradle assembleDebug
```
Or push to `main` under `android-attendance/**` and let
`.github/workflows/build-attendance-apk.yml` build it — same pattern
as the widget app's workflow, uploads a debug APK as a workflow
artifact.

Signed with the same `shared-debug.keystore` the widget app uses, so
installing an update never forces an uninstall first.

## Staff device setup (once per phone)

1. Install the APK, open the app.
2. Enter the staff number your manager gave you (matches Staff
   Registry's `staffId`, e.g. `EMP-003`) and name.
3. Walk through the permission prompts in order — location, then
   background location ("Allow all the time"), then notifications,
   then the battery-optimization exemption screen. The app won't ask
   out of order; Android silently rejects background-location prompts
   asked before foreground location is already granted.
4. If your phone's a Xiaomi/Oppo/Realme/Vivo/Samsung, a one-time
   instructions dialog appears — these brands' own battery managers
   kill background tracking regardless of what Android itself grants,
   more often in practice than any Android API limitation. Skipping
   this step is the most common real-world cause of "the geofence
   stopped working."
5. Leave the app in Recents (don't force-close it) for the background
   service to stay alive.

The printed QR code at the entrance always works as a manual
alternative, no permissions required beyond camera.

## Known limitations (scaffold, not yet hardened)

- **No offline queue.** If `postEvent()` fails (no signal at the
  geofence boundary), the event is logged and dropped, not retried.
  A `WorkManager` one-off request with backoff would fix this — noted
  in `GeofenceBroadcastReceiver.kt` where it matters.
- **One geofence only.** Fine for a single pharmacy; multi-location
  needs `GeofenceHelper` to register one geofence per active
  `attendance_locations` row instead of just the first.
- **`staff_id` here is the human-readable staff number** (`EMP-003`),
  not STAFF[i]'s internal `emp_...` id — this device has no way to
  read the main app's local STAFF array. `manager-attendance.js`
  matches staff by the internal id when it can and falls back to
  `staff_number` for display; keep that in mind if you ever rename or
  reassign a staff number.
- **No per-device backend enforcement.** Anything holding the anon
  key (not just this app) can write to these tables directly — an
  accepted tradeoff for this app's security model, not a bug. Real
  per-device auth would mean a PIN-login Edge Function minting a
  Supabase session — see `ATTENDANCE_INTEGRATION.md`.
- **Notification icon is a placeholder** system drawable
  (`android.R.drawable.ic_menu_mylocation`) — swap for a proper
  monochrome icon before a real release.
- **QR payload isn't validated** against a specific expected string
  yet — any QR code toggles check-in/out. Fine while there's exactly
  one printed code taped at the entrance; worth tightening
  (`MainActivity.handleQrScan`) if that stops being true.
