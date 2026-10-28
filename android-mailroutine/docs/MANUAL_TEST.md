# Manual test procedure (real Google account)

CI never touches a live mailbox. Run this on a physical device (or emulator with Google Play services) with a **test mailbox you control**, signed with a key whose SHA-1 is registered in your Google Cloud Android OAuth client (see README).

Use two addresses: the sending Workspace account (A) and a recipient you can read (B).

## 1. Authorization
1. Settings -> Connect Gmail. Expect Google's consent screen listing only "Send email on your behalf". Approve. Expect "Connected as A".
2. Deny/cancel once (disconnect first). Expect a "cancelled or blocked" message, still not connected.
3. If your Workspace admin restricts third-party apps, expect the blocked message; ask the admin to trust the client ID.

## 2. Create and fill
1. New routine: To = B, weekly, today's weekday, time 2 minutes from now, add a required Number field `amount`, subject `Report {{date}}`, body `Total: {{amount}}`. Check the editor preview shows `«amount»`.
2. Try saving with an invalid address and with an unknown `{{ghost}}` placeholder. Expect clear errors, nothing saved.
3. Open the occurrence from the dashboard. Leave `amount` empty: **Send now** must be disabled. Enter `abc`: expect a field error. Enter `42`: preview shows `Total: 42`.

## 3. Manual send
1. Tap Send now, confirm. Expect state "Accepted by Gmail", a Gmail message ID, and the note that this is not delivery confirmation. Confirm B received it and A's Sent folder shows it.
2. History screen shows the attempt with timestamp and ID.

## 4. Automatic send
1. Edit the routine, turn on "Send automatically", accept the consent dialog. Fill `amount` for the next occurrence before it is due.
2. Wait for the due time. Expect the email within a few minutes and no reminder notification (it is complete and automatic).
3. Edit the body and save. Expect the warning that automatic sending was switched off; the next occurrence must **not** auto-send until you re-approve.
4. Leave `amount` empty on an automatic routine. At due time expect **no send**, a "Needs attention" notification, and state "Needs attention: required fields are empty".

## 5. Revoked authorization
1. At https://myaccount.google.com/permissions remove MailRoutine's access.
2. Trigger a send (Send now). Expect nothing sent, state needs attention, and the dashboard banner "Gmail needs to be re-authorized". Settings -> Reauthorize restores sending.

## 6. Offline and retry
1. Enable airplane mode, tap Send now. Expect no email; the work waits for a network. Disable airplane mode and expect it to send exactly once.

## 7. Uncertain result (best effort)
This is hard to force on purpose. With a large (~8 MB) attachment, tap Send and switch to airplane mode right after the upload begins; or force-stop the app mid-send. Expect state "Unconfirmed" with the instruction to check Gmail Sent, and **no automatic resend** on later sweeps. Verify "It was sent" -> "Sent (confirmed by you)" and, separately, "It was not sent - allow resending" -> back to Scheduled.

## 8. Attachments
1. Add a PDF, mark required. Send: the attachment arrives intact.
2. Add an `.exe`: rejected on pick. Add a > 10 MB file: rejected.
3. After adding a required attachment, clear the app's storage for attachments is not possible from the UI; instead restore a backup and confirm the routine says attachments must be re-attached.

## 9. Backup and restore
1. Export. Open the JSON: it must contain no tokens, passwords, consent or file paths.
2. Import it on the same or another device: routines arrive **paused** with automatic sending **off**. Corrupt the file (delete a brace, set `"version": 99`): expect rejection with a message.

## 10. Scheduling recovery
1. Power the phone off across a due time; power on. Expect the missed item under Overdue (and an attention/reminder notification), not silently sent if beyond its late window.
2. Change the device time zone: routines keep firing at their own zone's wall-clock time.

## 11. AI drafting (optional)
1. Without a key, the Draft button is absent and Settings explains why.
2. Add a key, draft a template: the proposal appears in a dialog and does nothing until "Use in editor". On an automatically-sending routine, saving the AI text switches automatic sending off.
