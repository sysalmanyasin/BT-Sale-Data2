package com.duapharma.mailroutine.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
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
// Status colours carry meaning (amber = needs you, red = failed, green = accepted by Gmail). They are mid-tones
// chosen to stay readable on both the light and the dark surface.
object MrColors {
    val Ink = Color(0xFF1F2A37)
    val Paper = Color(0xFFF6F7F9)
    val Blue = Color(0xFF3566B8)
    val Amber = Color(0xFFC0801A)
    val Red = Color(0xFFD0453B)
    val Green = Color(0xFF2F8F5B)
    val Grey = Color(0xFF7A8594)
}

private val lightScheme = lightColorScheme(
    primary = MrColors.Blue, onPrimary = Color.White,
    primaryContainer = Color(0xFFDCE7F8), onPrimaryContainer = Color(0xFF0F2A52),
    background = MrColors.Paper, onBackground = MrColors.Ink,
    surface = MrColors.Paper, onSurface = MrColors.Ink,
    surfaceVariant = Color(0xFFE9EDF3), onSurfaceVariant = Color(0xFF3B4756),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color.White, surfaceContainer = Color(0xFFF0F2F6),
    surfaceContainerHigh = Color(0xFFE9EDF3), surfaceContainerHighest = Color.White,
    outline = Color(0xFF8A94A2), outlineVariant = Color(0xFFDDE2E9),
    error = MrColors.Red,
)

private val darkScheme = darkColorScheme(
    primary = Color(0xFF8DB1EE), onPrimary = Color(0xFF0B2347),
    primaryContainer = Color(0xFF1F3F72), onPrimaryContainer = Color(0xFFDCE7F8),
    background = Color(0xFF11151B), onBackground = Color(0xFFE6E9EE),
    surface = Color(0xFF11151B), onSurface = Color(0xFFE6E9EE),
    surfaceVariant = Color(0xFF273040), onSurfaceVariant = Color(0xFFC1C9D4),
    surfaceContainerLowest = Color(0xFF0D1015), surfaceContainerLow = Color(0xFF171C24), surfaceContainer = Color(0xFF1B212A),
    surfaceContainerHigh = Color(0xFF222934), surfaceContainerHighest = Color(0xFF1E252F),
    outline = Color(0xFF8A94A2), outlineVariant = Color(0xFF2E3744),
    error = Color(0xFFFF8A80),
)

private val type = Typography().run {
    copy(
        titleLarge = titleLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp),
        titleMedium = titleMedium.copy(fontWeight = FontWeight.SemiBold),
        bodyMedium = bodyMedium.copy(lineHeight = 21.sp),
    )
}

@Composable
fun MailRoutineTheme(content: @Composable () -> Unit) =
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkScheme else lightScheme, typography = type, content = content)

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
    Surface(shape = RoundedCornerShape(50), color = c.copy(alpha = 0.15f)) {
        Text(Explain.state(s), color = c, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
    }
}

/** A small count tile for the dashboard summary strip. */
@Composable
fun StatTile(label: String, count: Int, color: Color, modifier: Modifier = Modifier) {
    Surface(modifier, shape = RoundedCornerShape(14.dp), color = color.copy(alpha = if (count > 0) 0.14f else 0.06f)) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text(count.toString(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = if (count > 0) color else MrColors.Grey)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
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
