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

## 11. AI writing assistant (optional, Groq or Anthropic)
Needs a free Groq key from https://console.groq.com/keys (or an Anthropic key). Use a routine with a Text field and a Multiline field.
1. Without a key, the "Write with AI…" button is absent in the editor, there is no AI button on an email's fields, and Settings explains why.
2. Settings -> AI writing assistant -> choose **Groq**, paste the key, Save. Expect "Groq is now used for AI writing". Switching the chip to Anthropic must show "Groq is still the active provider" until you Save, and each provider keeps its own key and model. Saving with the key box empty must **not** remove the stored key.
3. Editor -> Write with AI…: type "weekly sales report for the team, ask for figures by Friday". Expect a subject and body using only your field placeholders; nothing changes until "Use in editor". On an automatically-sending routine, saving the AI text switches automatic sending off.
4. With text in the template, tap **Improve**, **Fix grammar**, **Shorter**, **Expand**, **More formal**, **Friendlier**, **New subject**. Each shows a proposal and changes nothing until "Use in editor". "New subject" must leave the body untouched, including a rich (HTML) body's formatting.
5. Type "translate to Urdu" in the instruction box: the suggestion is in Urdu and uses only your `{{placeholders}}` (anything else is rejected).
6. Open an email from the dashboard. A Text/Multiline field shows "Write with AI…" (empty) or "Improve with AI…" (has text); Number, Date, Yes/No and Choice fields show nothing. Tap it, pick **Fix grammar** on a typo-filled note: the suggestion appears, the field is unchanged until "Use this text", and the preview then shows the new text. "Try again" produces a new suggestion; closing the dialog while it is loading must not show a stale suggestion next time.
7. Ask for something far longer than a single-line field allows: expect a clear "longer than this field allows" error, never a silent cut-off.
8. Wrong key: expect "The AI key was rejected. Check it in Settings." and never the key itself. Airplane mode: expect "Could not reach the AI service". A wrong model name: expect the "doesn't know that model" message.
9. Check at https://console.groq.com that usage appears only when you tapped something, and that no request contains recipients or other fields' values.
