package com.duapharma.mailroutine.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.duapharma.mailroutine.ai.AiAction

/** One-tap writing helpers (improve, fix grammar, shorter, ...). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AiActionChips(actions: List<AiAction>, enabled: Boolean, onPick: (AiAction) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        actions.forEach { a -> AssistChip(onClick = { onPick(a) }, enabled = enabled, label = { Text(a.label) }) }
    }
}

/**
 * Write or rewrite the text of one field of a single email. The caller owns the state; this only shows it.
 * Nothing changes until the person taps "Use this text".
 */
@Composable
fun FieldAiDialog(
    fieldLabel: String,
    providerLabel: String,
    hasText: Boolean,
    busy: Boolean,
    error: String?,
    proposal: String?,
    onRun: (instruction: String) -> Unit,
    onApply: () -> Unit,
    onClose: () -> Unit,
) {
    var instruction by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Write with AI") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Note(fieldLabel)
                if (hasText) AiActionChips(AiAction.forFields, enabled = !busy) { a -> instruction = a.instruction; onRun(a.instruction) }
                Txt(
                    if (hasText) "Or tell the AI what to change" else "What should it say?", instruction, { instruction = it }, minLines = 2,
                    supporting = if (hasText) "For example: make it more polite, translate to Urdu" else "For example: tell them the shipment is delayed by two days",
                )
                Note("Sent to $providerLabel: your instruction and the text in this one field. Recipients and the other fields are not sent.")
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let { Text(it, color = MrColors.Red) }
                proposal?.let { p ->
                    HorizontalDivider()
                    Text("Suggestion", style = MaterialTheme.typography.titleMedium)
                    Card(Modifier.fillMaxWidth()) { Text(p, Modifier.padding(12.dp)) }
                    Note("Using it only fills the field. Check the preview before you send.")
                }
            }
        },
        confirmButton = {
            if (proposal != null) Button(onClick = onApply) { Text("Use this text") }
            else Button(onClick = { onRun(instruction) }, enabled = !busy && instruction.isNotBlank()) { Text("Generate") }
        },
        dismissButton = {
            Row {
                TextButton(onClick = onClose) { Text("Close") }
                if (proposal != null) TextButton(onClick = { onRun(instruction) }, enabled = !busy) { Text("Try again") }
            }
        },
    )
}
