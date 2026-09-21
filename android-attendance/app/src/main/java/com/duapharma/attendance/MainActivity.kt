package com.duapharma.attendance

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

/**
 * Onboarding is a strict, ordered sequence — asking for background
 * location before foreground location (or notifications before
 * either) is a documented way to get an automatic system rejection on
 * Android 10+/13+. Each step only starts once the previous one has
 * resolved (granted OR denied — a denial doesn't block the rest of
 * the flow, it just means that layer of "auto" won't work and QR
 * fallback becomes this device's primary method).
 *
 * Steps, in order:
 *   0. Staff identity (one-time local setup, not a system permission)
 *   1. ACCESS_FINE_LOCATION + ACCESS_COARSE_LOCATION
 *   2. ACCESS_BACKGROUND_LOCATION (Android 10+ only, separate prompt)
 *   3. POST_NOTIFICATIONS (Android 13+ only)
 *   4. Battery optimization exemption (settings deep-link, not a
 *      runtime permission)
 *   5. Manufacturer-specific instructions (MIUI/ColorOS/Vivo/One UI) —
 *      informational only, nothing to grant here
 *   6. Register geofence + start foreground service
 *
 * Manager mode (Prefs.isManagerMode) skips this entire permission chain
 * (steps 1-5) UNLESS the manager also ticked "I also work here"
 * (Prefs.tracksOwnAttendance) during setup — that phone is dual-role
 * and goes through the full staff flow (geofences its own check-in/
 * out). A notification-only manager phone has nothing left for this
 * app to do at all — check-in notifications come from the separate
 * ntfy app now (see the dashboard's Attendance page), not a poller
 * this app used to run. See beginPermissionFlowIfNeeded(),
 * needsGeofence(), and showStaffSetupDialog's checkboxes.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var root: LinearLayout
    private lateinit var todayText: TextView

    private val foregroundLocationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ -> requestBackgroundLocationIfNeeded() }

    private val backgroundLocationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ -> requestNotificationsIfNeeded() }

    private val notificationsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ -> promptBatteryOptimization() }

    private val qrScanLauncher = registerForActivityResult(ScanContract()) { result ->
        if (result.contents != null) {
            handleQrScan(result.contents)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        if (!Prefs.isSetUp(this)) {
            showStaffSetupDialog()
        } else {
            renderStatusScreen()
            beginPermissionFlowIfNeeded()
        }
    }

    // ── UI shell ─────────────────────────────────────────────────────
    private fun buildUi() {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 48)
        }
        statusText = TextView(this).apply {
            textSize = 16f
            text = "Loading…"
        }
        root.addView(statusText)
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun renderStatusScreen() {
        root.removeAllViews()
        val name = Prefs.staffName(this) ?: "?"
        val number = Prefs.staffNumber(this) ?: "?"
        val isManager = Prefs.isManagerMode(this)

        val title = TextView(this).apply {
            text = "BT Attendance"
            textSize = 22f
            gravity = Gravity.CENTER
        }
        val subtitle = TextView(this).apply {
            text = when {
                isManager && Prefs.tracksOwnAttendance(this@MainActivity) -> "Manager phone — $name ($number) — also tracking own attendance"
                isManager -> "Manager phone — $name"
                else -> "Signed in as $name ($number)"
            }
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 32)
        }
        statusText = TextView(this).apply {
            textSize = 14f
            text = "Checking permissions…"
            setPadding(0, 0, 0, 32)
        }
        val reRegisterButton = Button(this).apply {
            text = when {
                isManager && Prefs.tracksOwnAttendance(this@MainActivity) -> "Re-check permissions / restart notifications + geofence"
                isManager -> "Re-check permissions / restart notifications"
                else -> "Re-check permissions / re-register geofence"
            }
            setOnClickListener {
                beginPermissionFlowIfNeeded(forceReRegister = true)
            }
        }

        root.addView(title)
        root.addView(subtitle)
        root.addView(statusText)
        // QR check-in/out, and the "today so far" list below it, only
        // make sense on a phone that tracks its own attendance — a
        // notification-only manager phone doesn't punch in or out
        // itself, but a dual-role manager does (same condition as the
        // QR button already used).
        if (!isManager || Prefs.tracksOwnAttendance(this)) {
            val qrButton = Button(this).apply {
                text = "Scan QR to check in / out"
                setOnClickListener { launchQrScanner() }
            }
            root.addView(qrButton)

            val todayLabel = TextView(this).apply {
                text = "Today"
                textSize = 16f
                setPadding(0, 32, 0, 8)
            }
            todayText = TextView(this).apply {
                textSize = 14f
                text = "Loading today's check-in/out…"
            }
            root.addView(todayLabel)
            root.addView(todayText)
            loadTodayEvents()
        }
        root.addView(reRegisterButton)
    }

    /** Fetches this staff member's check_in/check_out events since
     *  local midnight and renders them as a simple time-ordered list
     *  in todayText, e.g.:
     *    Checked in   9:02 AM
     *    Checked out  1:14 PM
     *  "Since local midnight" uses the phone's own calendar day/zone
     *  (not UTC) so a staff member's "today" always matches what's on
     *  their own clock. Safe to call repeatedly — used both from
     *  renderStatusScreen and right after a QR check-in/out so the
     *  list reflects the punch that was just made. */
    private fun loadTodayEvents() {
        val staffId = Prefs.staffId(this) ?: return
        Thread {
            val startOfDay = java.time.LocalDate.now(java.time.ZoneId.systemDefault())
                .atStartOfDay(java.time.ZoneId.systemDefault())
                .toInstant()
                .toString()
            val events = AttendanceApi.fetchTodayEvents(staffId, startOfDay)
            runOnUiThread {
                if (!::todayText.isInitialized) return@runOnUiThread
                todayText.text = if (events.isEmpty()) {
                    "No check-in/out yet today."
                } else {
                    val formatter = java.time.format.DateTimeFormatter.ofPattern("h:mm a")
                        .withZone(java.time.ZoneId.systemDefault())
                    events.joinToString("\n") { event ->
                        val label = if (event.eventType == "check_in") "Checked in " else "Checked out"
                        val time = try {
                            formatter.format(java.time.Instant.parse(event.occurredAt))
                        } catch (e: Exception) {
                            event.occurredAt
                        }
                        "$label  $time"
                    }
                }
            }
        }.start()
    }

    // ── Step 0: staff identity ──────────────────────────────────────
    private fun showStaffSetupDialog() {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 0)
        }
        val idInput = EditText(this).apply { hint = "Staff number (e.g. EMP-003)" }
        val nameInput = EditText(this).apply { hint = "Name" }
        val managerCheckbox = CheckBox(this).apply {
            text = "This is the manager's phone (check-in notifications now come via the ntfy app — see the dashboard's Attendance page for setup)"
        }
        // Only meaningful once managerCheckbox is ticked (see both
        // listeners below). Lets the SAME phone also geofence its own
        // check-in/out, for a manager who is also sometimes physically
        // present as staff — previously a manager phone never tracked
        // its own attendance at all, full stop.
        val tracksOwnCheckbox = CheckBox(this).apply {
            text = "I also work here — track my own check-in/out too"
            visibility = View.GONE
        }
        // Only shown once the checkbox above is ticked — see
        // setOnCheckedChangeListener below. Ticking the checkbox alone
        // used to be enough to start receiving every staff member's
        // check-in notifications; this PIN is verified server-side
        // (AttendanceApi.verifyManagerPin) before setup can complete,
        // so a staff member can no longer just tick the box themselves.
        val pinInput = EditText(this).apply {
            hint = "Manager PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            visibility = View.GONE
        }
        managerCheckbox.setOnCheckedChangeListener { _, checked ->
            tracksOwnCheckbox.visibility = if (checked) View.VISIBLE else View.GONE
            pinInput.visibility = if (checked) View.VISIBLE else View.GONE
            if (!checked) tracksOwnCheckbox.isChecked = false
        }
        container.addView(idInput)
        container.addView(nameInput)
        container.addView(managerCheckbox)
        container.addView(tracksOwnCheckbox)
        container.addView(pinInput)

        AlertDialog.Builder(this)
            .setTitle("Set up this phone")
            .setMessage("Enter the staff number and name your manager gave you, " +
                "or tick the box below if this is the manager's own phone (you'll " +
                "need the manager PIN — tick the second box too if you also work " +
                "here yourself). This only needs to be done once per phone.\n\n" +
                "Note: check-in notifications no longer come from this app — " +
                "install the free \"ntfy\" app separately and subscribe to your " +
                "pharmacy's channel (the dashboard's Attendance page has the link).")
            .setView(container)
            .setCancelable(false)
            .setPositiveButton("Save") { _, _ ->
                val isManager = managerCheckbox.isChecked
                val tracksOwn = isManager && tracksOwnCheckbox.isChecked
                var staffNumber = idInput.text.toString().trim()
                val staffName = nameInput.text.toString().trim()
                // A manager who only wants notifications (not tracksOwn)
                // has no real staff number of their own — "MANAGER" is
                // just a placeholder id in that case, never geofenced.
                // A manager who IS tracksOwn needs a real one, same as
                // any staff phone, since it's about to be geofenced too.
                if (isManager && !tracksOwn && staffNumber.isEmpty()) staffNumber = "MANAGER"
                if (staffNumber.isEmpty() || staffName.isEmpty()) {
                    Toast.makeText(
                        this,
                        if (tracksOwn) "Enter your real staff number and name — this phone will geofence too"
                        else "Both fields are required",
                        Toast.LENGTH_SHORT,
                    ).show()
                    showStaffSetupDialog()
                    return@setPositiveButton
                }
                // staff_id here mirrors staffNumber rather than STAFF[i]'s
                // internal 'emp_...' id, since this device has no way to
                // read the main app's local STAFF array — the manager
                // reconciles by staff_number on the Manager > Attendance
                // page. If you'd rather key strictly by the internal id,
                // hand staff their emp_... id instead of the EMP-### one.
                if (isManager) {
                    val pin = pinInput.text.toString().trim()
                    if (pin.isEmpty()) {
                        Toast.makeText(this, "Enter the manager PIN", Toast.LENGTH_SHORT).show()
                        showStaffSetupDialog()
                        return@setPositiveButton
                    }
                    Toast.makeText(this, "Verifying manager PIN…", Toast.LENGTH_SHORT).show()
                    Thread {
                        val correct = AttendanceApi.verifyManagerPin(pin)
                        runOnUiThread {
                            if (correct) {
                                finalizeStaffSetup(staffNumber, staffName, isManager = true, tracksOwn = tracksOwn)
                            } else {
                                Toast.makeText(this, "✗ Wrong manager PIN — ask whoever manages the pharmacy account", Toast.LENGTH_LONG).show()
                                showStaffSetupDialog()
                            }
                        }
                    }.start()
                } else {
                    finalizeStaffSetup(staffNumber, staffName, isManager = false, tracksOwn = false)
                }
            }
            .show()
    }

    private fun finalizeStaffSetup(staffNumber: String, staffName: String, isManager: Boolean, tracksOwn: Boolean) {
        Prefs.saveStaff(this, staffId = staffNumber, staffNumber = staffNumber, staffName = staffName)
        Prefs.setManagerMode(this, isManager)
        Prefs.setTracksOwnAttendance(this, tracksOwn)
        // Device registration (staff_id/number/name) for a phone that
        // geofences (plain staff, or a dual-role manager) now happens
        // inside GeofenceHelper.registerFromServer, reached moments
        // later via beginPermissionFlowIfNeeded() -> finishOnboarding()
        // — see that file's header comment.
        renderStatusScreen()
        beginPermissionFlowIfNeeded()
    }

    // ── Steps 1–5: ordered permission flow ──────────────────────────
    /** True if this phone needs to go through the location-permission
     *  chain at all — every plain staff phone does, and so does a
     *  dual-role manager phone (see Prefs.tracksOwnAttendance), since
     *  it's about to geofence its own check-in/out same as any staff
     *  member. A notification-only manager phone is the only case that
     *  skips straight to requestNotificationsIfNeeded. */
    private fun needsGeofence(): Boolean = !Prefs.isManagerMode(this) || Prefs.tracksOwnAttendance(this)

    private fun beginPermissionFlowIfNeeded(forceReRegister: Boolean = false) {
        if (needsGeofence()) {
            requestForegroundLocationIfNeeded(forceReRegister)
        } else {
            // A notification-only manager phone doesn't geofence
            // anything, and this app no longer runs a background
            // poller either — check-in notifications come from the
            // separate ntfy app now (see the dashboard's Attendance
            // page for the channel to subscribe to). There is nothing
            // left for this app to request permission for or keep
            // running, so setup finishes immediately.
            statusText.text = "✓ Nothing more to set up in this app. Install " +
                "\"ntfy\" separately and subscribe to your pharmacy's channel " +
                "(dashboard → Attendance) to get check-in notifications."
        }
    }

    private fun requestForegroundLocationIfNeeded(forceReRegister: Boolean = false) {
        val fineGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (fineGranted) {
            requestBackgroundLocationIfNeeded(forceReRegister)
        } else {
            statusText.text = "Step 1/4 — requesting location permission…"
            foregroundLocationLauncher.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            )
        }
    }

    private fun requestBackgroundLocationIfNeeded(forceReRegister: Boolean = false) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            requestNotificationsIfNeeded(forceReRegister)
            return
        }
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            requestNotificationsIfNeeded(forceReRegister)
        } else {
            statusText.text = "Step 2/4 — requesting background location " +
                "(pick \"Allow all the time\" on the next screen)…"
            backgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
    }

    private fun requestNotificationsIfNeeded(forceReRegister: Boolean = false) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            promptBatteryOptimization(forceReRegister)
            return
        }
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            promptBatteryOptimization(forceReRegister)
        } else {
            // This function is only ever reached via the geofence chain
            // now (a notification-only manager phone short-circuits
            // before this point — see beginPermissionFlowIfNeeded) —
            // needed for AttendanceForegroundService's own ongoing
            // notification, unrelated to check-in alerts (those come
            // from the separate ntfy app now).
            statusText.text = "Step 3/4 — requesting notification permission " +
                "(needed for the \"tracking active\" status)…"
            notificationsLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun promptBatteryOptimization(forceReRegister: Boolean = false) {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        val alreadyIgnoring = pm.isIgnoringBatteryOptimizations(packageName)
        if (alreadyIgnoring) {
            showManufacturerNoteIfNeeded(forceReRegister)
            return
        }
        val isManager = Prefs.isManagerMode(this)
        statusText.text = "Step 4/4 — battery optimization exemption needed"
        AlertDialog.Builder(this)
            .setTitle("One more setting")
            .setMessage("Android will try to stop this app in the background to save " +
                "battery, which breaks " +
                (if (isManager) "your own automatic check-in/out (this phone is set up " +
                    "as a dual-role manager)." else "automatic check-in/out.") +
                " On the next screen, allow this app to run without battery restrictions.")
            .setPositiveButton("Continue") { _, _ ->
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
                // No reliable onActivityResult here across OEMs — just move
                // on to the manufacturer note and let the user tap
                // "re-check" on the main screen afterward if they want
                // confirmation the geofence registered.
                showManufacturerNoteIfNeeded(forceReRegister)
            }
            .setNegativeButton("Skip") { _, _ -> showManufacturerNoteIfNeeded(forceReRegister) }
            .show()
    }

    private fun showManufacturerNoteIfNeeded(forceReRegister: Boolean) {
        val manufacturer = Build.MANUFACTURER.lowercase()
        val note = when {
            manufacturer.contains("xiaomi") ->
                "On Xiaomi (MIUI): Settings → Apps → BT Attendance → Battery saver → " +
                    "No restrictions, then also lock the app in your Recents screen " +
                    "(swipe down on the app card)."
            manufacturer.contains("oppo") || manufacturer.contains("realme") ->
                "On Oppo/Realme (ColorOS): Settings → Battery → BT Attendance → " +
                    "Allow background activity, and disable \"Sleep standby optimization\" for this app."
            manufacturer.contains("vivo") ->
                "On Vivo (Funtouch/OriginOS): Settings → Battery → Background power " +
                    "consumption management → BT Attendance → Allow, and lock the app in Recents."
            manufacturer.contains("samsung") ->
                "On Samsung: Settings → Apps → BT Attendance → Battery → " +
                    "Unrestricted (not \"Optimized\"), and remove it from \"Sleeping apps\" " +
                    "if it appears there."
            else -> null
        }
        if (note != null) {
            AlertDialog.Builder(this)
                .setTitle("Your phone needs one extra step")
                .setMessage(note)
                .setPositiveButton("Got it") { _, _ -> finishOnboarding(forceReRegister) }
                .show()
        } else {
            finishOnboarding(forceReRegister)
        }
    }

    // ── Step 6: register + start ────────────────────────────────────
    private fun finishOnboarding(forceReRegister: Boolean) {
        // Only ever reached when needsGeofence() is true — a
        // notification-only manager phone short-circuits back in
        // beginPermissionFlowIfNeeded and never starts the location
        // permission chain that leads here at all.
        val isManager = Prefs.isManagerMode(this)
        statusText.text = "Registering geofence…"
        AttendanceForegroundService.start(this)
        GeofenceHelper.registerFromServer(this) { success ->
            runOnUiThread {
                statusText.text = if (success) {
                    if (isManager) "✓ Your own check-in/out is active. Check-in notifications for everyone else come via the ntfy app — see the dashboard."
                    else "✓ Automatic check-in/out is active."
                } else {
                    "⚠ Could not register the geofence yet — check that a pharmacy " +
                        "location has been added in Manager > Attendance, and that " +
                        "location permission was granted, then tap \"re-check\" below. " +
                        "QR scan still works regardless."
                }
            }
        }
    }

    // ── QR fallback ──────────────────────────────────────────────────
    private fun launchQrScanner() {
        val options = ScanOptions().apply {
            setPrompt("Scan the QR code at the entrance")
            setBeepEnabled(true)
            setOrientationLocked(true)
        }
        qrScanLauncher.launch(options)
    }

    private fun handleQrScan(contents: String) {
        // Previously this parameter was never even read -- ANY scanned
        // barcode (even an unrelated product barcode) triggered a
        // check-in/out toggle, no validation at all. Now fetches the
        // real secret from attendance_locations.qr_secret (printed on
        // the entrance QR — see the dashboard's Location tab) and
        // rejects anything that doesn't match exactly. Content itself
        // doesn't encode in/out; scanning toggles based on this
        // device's last recorded transition (no time-window
        // restriction here, unlike the geofence debounce — a human
        // tapped "scan" on purpose, so never silently ignore it).
        val staffId = Prefs.staffId(this) ?: return

        statusText.text = "Verifying code…"
        Thread {
            val expectedSecret = AttendanceApi.fetchQrSecret()
            if (expectedSecret == null) {
                runOnUiThread {
                    Toast.makeText(this, "⚠ No QR code has been set up yet — ask your manager to print one from the dashboard", Toast.LENGTH_LONG).show()
                    statusText.text = "✓ Automatic check-in/out is active."
                }
                return@Thread
            }
            if (contents != expectedSecret) {
                runOnUiThread {
                    Toast.makeText(this, "✗ That's not the pharmacy's check-in code", Toast.LENGTH_LONG).show()
                    statusText.text = "✓ Automatic check-in/out is active."
                }
                return@Thread
            }

            val eventType = if (Prefs.lastTransitionType(this) == "check_in") "check_out" else "check_in"
            runOnUiThread { statusText.text = "Submitting…" }
            val success = AttendanceApi.postEvent(
                staffId = staffId,
                staffNumber = Prefs.staffNumber(this),
                eventType = eventType,
                source = "qr",
            )
            runOnUiThread {
                if (success) {
                    Prefs.recordTransition(this, eventType)
                    Toast.makeText(this, "✓ ${if (eventType == "check_in") "Checked in" else "Checked out"}", Toast.LENGTH_LONG).show()
                    loadTodayEvents()
                } else {
                    Toast.makeText(this, "✗ Failed — check your connection and try again", Toast.LENGTH_LONG).show()
                }
                statusText.text = "✓ Automatic check-in/out is active."
            }
        }.start()
    }
}
