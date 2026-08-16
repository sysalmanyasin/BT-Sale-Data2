plugins {
    id("com.android.application")
}

android {
    namespace = "com.duapharma.btsaledata"
    // androidbrowserhelper 2.7.3's transitive androidx.browser/androidx.core
    // require compileSdk 36+ (checked at build time by CheckAarMetadata).
    // targetSdk is deliberately left at 34 — compileSdk and targetSdk can be
    // bumped independently, and 34 avoids opting into API-36 runtime behavior
    // changes this simple TWA wrapper doesn't need.
    compileSdk = 36

    defaultConfig {
        applicationId = "com.duapharma.btsaledata"
        // Android Browser Helper's LauncherActivity requires 21+.
        minSdk = 21
        targetSdk = 34
        // Bumped per CI build via -PappVersionCode=<github.run_number> — same
        // reasoning as android-widget/app/build.gradle.kts: keeps every
        // install a clean update instead of "not installed".
        versionCode = (project.findProperty("appVersionCode") as String?)?.toIntOrNull() ?: 1
        versionName = "1.0.$versionCode"
    }

    // IMPORTANT: this is not just about clean updates (see the widget
    // project's note on that) — for a Trusted Web Activity, the signing
    // certificate's SHA-256 fingerprint is also what Digital Asset Links
    // verification checks against. It MUST match the fingerprint published
    // at https://bt.duapharma.com/.well-known/assetlinks.json (see that
    // file's own comment, and app/src/main/res/values/strings.xml's
    // asset_statements) or the app falls back to showing Chrome's normal
    // URL bar instead of running full-screen/standalone. app-debug.keystore
    // is committed to the repo specifically so that fingerprint never
    // drifts between builds. This is a debug-only, internal-sideload key —
    // not a Play Store release key — so committing it is intentional.
    signingConfigs {
        create("shared") {
            storeFile = file("../app-debug.keystore")
            storePassword = "duapharma-btsaledata-debug"
            keyAlias = "btsaledata"
            keyPassword = "duapharma-btsaledata-debug"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
        debug {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Google's official TWA runtime — LauncherActivity below comes from
    // here. No custom Activity/Kotlin code needed: the whole app is this
    // one library plus manifest configuration.
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.3")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
