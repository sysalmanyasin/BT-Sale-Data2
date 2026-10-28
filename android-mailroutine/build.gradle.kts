// Plugin versions are pinned to a combination that is mutually compatible:
//   AGP 8.5.2 requires Gradle >= 8.7 (the workflow pins 8.7); Kotlin 2.0.21 pairs with KSP 2.0.21-1.0.28
//   and the bundled Compose compiler plugin. Do not bump one without the others.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("com.google.devtools.ksp") version "2.0.21-1.0.28" apply false
}
