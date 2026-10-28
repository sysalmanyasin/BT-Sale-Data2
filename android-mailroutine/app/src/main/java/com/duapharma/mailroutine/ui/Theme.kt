package com.duapharma.mailroutine.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.duapharma.mailroutine.domain.Bucket
import com.duapharma.mailroutine.domain.Explain
import com.duapharma.mailroutine.domain.OccurrenceState
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Palette: ink slate for text, cool paper surface, mail blue as the single brand accent.
// Status colours carry meaning (amber = needs you, red = failed, green = accepted by Gmail).
object MrColors {
    val Ink = Color(0xFF1F2A37)
    val Paper = Color(0xFFF6F7F9)
    val Blue = Color(0xFF2F5DA8)
    val Amber = Color(0xFFB7791F)
    val Red = Color(0xFFB3261E)
    val Green = Color(0xFF2E7D4F)
    val Grey = Color(0xFF6B7683)
}

private val scheme = lightColorScheme(
    primary = MrColors.Blue, onPrimary = Color.White,
    background = MrColors.Paper, onBackground = MrColors.Ink,
    surface = Color.White, onSurface = MrColors.Ink,
    surfaceVariant = Color(0xFFE9EDF3), onSurfaceVariant = Color(0xFF3B4756),
    error = MrColors.Red,
)

private val type = Typography().run {
    copy(
        titleLarge = titleLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp),
        titleMedium = titleMedium.copy(fontWeight = FontWeight.SemiBold),
        bodyMedium = bodyMedium.copy(lineHeight = 21.sp),
    )
}

@Composable
fun MailRoutineTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = scheme, typography = type, content = content)

fun stateColor(s: OccurrenceState): Color = when (s) {
    OccurrenceState.FAILED -> MrColors.Red
    OccurrenceState.UNCERTAIN, OccurrenceState.BLOCKED, OccurrenceState.FAILED_RETRYABLE -> MrColors.Amber
    OccurrenceState.SUBMITTED, OccurrenceState.CONFIRMED_SENT -> MrColors.Green
    OccurrenceState.SENDING -> MrColors.Blue
    else -> MrColors.Grey
}

fun bucketTitle(b: Bucket) = when (b) {
    Bucket.ATTENTION -> "Needs attention"
    Bucket.OVERDUE -> "Overdue"
    Bucket.DUE -> "Due now"
    Bucket.UPCOMING -> "Upcoming"
    Bucket.COMPLETED -> "Completed"
}

@Composable
fun StatusChip(s: OccurrenceState) {
    val c = stateColor(s)
    AssistChip(onClick = {}, label = { Text(Explain.state(s)) }, enabled = true,
        colors = AssistChipDefaults.assistChipColors(labelColor = c), border = AssistChipDefaults.assistChipBorder(enabled = true, borderColor = c))
}

@Composable
fun SectionTitle(text: String) = Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))

@Composable
fun Note(text: String, color: Color = MrColors.Grey) = Text(text, color = color, style = MaterialTheme.typography.bodySmall)

@Composable
fun LabeledColumn(modifier: Modifier = Modifier, content: @Composable () -> Unit) =
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }

private val dayTime = DateTimeFormatter.ofPattern("EEE d MMM, HH:mm")
fun fmt(i: Instant, zone: ZoneId = ZoneId.systemDefault()): String = i.atZone(zone).format(dayTime)
