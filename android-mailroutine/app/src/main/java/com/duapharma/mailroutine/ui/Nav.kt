package com.duapharma.mailroutine.ui

import androidx.compose.runtime.mutableStateListOf

sealed interface Screen {
    data object Dashboard : Screen
    data class Editor(val routineId: String?, val token: Long = System.nanoTime()) : Screen
    data class Occurrence(val id: String, val token: Long = System.nanoTime()) : Screen
    data object History : Screen
    data object Settings : Screen
}

/** Tiny back stack; enough for five screens and keeps navigation free of extra dependencies. */
class NavState {
    val stack = mutableStateListOf<Screen>(Screen.Dashboard)
    val current: Screen get() = stack.last()
    fun push(s: Screen) { if (current != s) stack.add(s) }
    fun pop(): Boolean = if (stack.size > 1) { stack.removeAt(stack.lastIndex); true } else false
    fun openOccurrence(id: String) { while (stack.size > 1) stack.removeAt(stack.lastIndex); stack.add(Screen.Occurrence(id)) }
}
