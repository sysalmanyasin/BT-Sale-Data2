// Keep the Android Gradle Plugin and Gradle versions in sync.
// AGP 8.13.x supports compile/target API 36 and requires Gradle 8.13; JDK 17 remains supported.
plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("com.google.devtools.ksp") version "2.0.21-1.0.28" apply false
}
