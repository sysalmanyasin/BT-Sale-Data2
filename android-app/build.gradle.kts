plugins {
    // androidbrowserhelper 2.7.3 pulls in androidx.browser 1.10.0 / androidx.core
    // 1.17.0, which require AGP 8.9.1+ (compileSdk 36) — see app/build.gradle.kts.
    id("com.android.application") version "8.9.2" apply false
}
