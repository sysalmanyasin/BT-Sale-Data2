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
import android.view.Gravity
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
 * Manager mode (Prefs.isManagerMode) skips straight from step 0 to
 * step 3 — no location permissions requested — and step 6 starts
 * ManagerNotifyService instead of AttendanceForegroundService/
 * GeofenceHelper. See showStaffSetupDialog's manager checkbox.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var root: LinearLayout

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
            text = if (isManager) "Manager phone — $name" else "Signed in as $name ($number)"
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
            text = if (isManager) "Re-check permissions / restart notifications"
                   else "Re-check permissions / re-register geofence"
            setOnClickListener {
                beginPermissionFlowIfNeeded(forceReRegister = true)
            }
        }

        root.addView(title)
        root.addView(subtitle)
        root.addView(statusText)
        // QR check-in/out only makes sense on a staff phone — a manager
        // phone doesn't punch in or out itself, it just listens.
        if (!isManager) {
            val qrButton = Button(this).apply {
                text = "Scan QR to check in / out"
                setOnClickListener { launchQrScanner() }
            }
            root.addView(qrButton)
        }
        root.addView(reRegisterButton)
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
            text = "This is the manager's phone — notify me of every check-in"
        }
        container.addView(idInput)
        container.addView(nameInput)
        container.addView(managerCheckbox)

        AlertDialog.Builder(this)
            .setTitle("Set up this phone")
            .setMessage("Enter the staff number and name your manager gave you, " +
                "or tick the box below if this is the manager's own phone. " +
                "This only needs to be done once per phone.")
            .setView(container)
            .setCancelable(false)
            .setPositiveButton("Save") { _, _ ->
                val isManager = managerCheckbox.isChecked
                var staffNumber = idInput.text.toString().trim()
                val staffName = nameInput.text.toString().trim()
                if (isManager && staffNumber.isEmpty()) staffNumber = "MANAGER"
                if (staffNumber.isEmpty() || staffName.isEmpty()) {
                    Toast.makeText(this, "Both fields are required", Toast.LENGTH_SHORT).show()
                    showStaffSetupDialog()
                    return@setPositiveButton
                }
                // staff_id here mirrors staffNumber rather than STAFF[i]'s
                // internal 'emp_...' id, since this device has no way to
                // read the main app's local STAFF array — the manager
                // reconciles by staff_number on the Manager > Attendance
                // page. If you'd rather key strictly by the internal id,
                // hand staff their emp_... id instead of the EMP-### one.
                Prefs.saveStaff(this, staffId = staffNumber, staffNumber = staffNumber, staffName = staffName)
                Prefs.setManagerMode(this, isManager)
                if (isManager) {
                    // Cursor starts at "now" so the first poll doesn't fire
                    // a notification for every check-in that already
                    // happened before this phone was set up.
                    Prefs.setLastNotifiedIso(this, java.time.Instant.now().toString())
                } else {
                    Thread { AttendanceApi.upsertDevice(staffNumber, staffNumber, Build.MODEL) }.start()
                }
                renderStatusScreen()
                beginPermissionFlowIfNeeded()
            }
            .show()
    }

    // ── Steps 1–5: ordered permission flow ──────────────────────────
    private fun beginPermissionFlowIfNeeded(forceReRegister: Boolean = false) {
        if (Prefs.isManagerMode(this)) {
            // A manager phone doesn't geofence anything — it only needs
            // to be able to show notifications and stay alive in the
            // background, so location permissions are skipped entirely.
            requestNotificationsIfNeeded(forceReRegister)
        } else {
            requestForegroundLocationIfNeeded(forceReRegister)
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
            statusText.text = if (Prefs.isManagerMode(this))
                "Step 1/2 — requesting notification permission…"
            else
                "Step 3/4 — requesting notification permission " +
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
        statusText.text = if (isManager) "Step 2/2 — battery optimization exemption needed"
                           else "Step 4/4 — battery optimization exemption needed"
        AlertDialog.Builder(this)
            .setTitle("One more setting")
            .setMessage("Android will try to stop this app in the background to save " +
                "battery, which breaks " +
                (if (isManager) "check-in notifications." else "automatic check-in/out.") +
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
        if (Prefs.isManagerMode(this)) {
            statusText.text = "Starting check-in notifications…"
            ManagerNotifyService.start(this)
            statusText.text = "✓ You'll be notified when staff check in."
            return
        }
        statusText.text = "Registering geofence…"
        AttendanceForegroundService.start(this)
        GeofenceHelper.registerFromServer(this) { success ->
            runOnUiThread {
                statusText.text = if (success) {
                    "✓ Automatic check-in/out is active."
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
        // Expected QR payload: a fixed string agreed with the printed
        // code, e.g. "BT-ATTENDANCE-ENTRANCE" — content itself doesn't
        // encode in/out; scanning toggles based on this device's last
        // recorded transition (no time-window restriction here, unlike
        // the geofence debounce — a human tapped "scan" on purpose, so
        // never silently ignore it).
        val staffId = Prefs.staffId(this) ?: return
        val eventType = if (Prefs.lastTransitionType(this) == "check_in") "check_out" else "check_in"

        statusText.text = "Submitting…"
        Thread {
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
                } else {
                    Toast.makeText(this, "✗ Failed — check your connection and try again", Toast.LENGTH_LONG).show()
                }
                statusText.text = "✓ Automatic check-in/out is active."
            }
        }.start()
    }
}
