plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.duapharma.attendance"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.duapharma.attendance"
        // minSdk 26, not 24 like android-widget: ACCESS_BACKGROUND_LOCATION
        // as a distinct runtime permission only exists from API 29, and the
        // geofence-survives-Doze foreground-service behavior this app
        // depends on is unreliable below API 26. No widget-style reason
        // here to support older devices.
        minSdk = 26
        targetSdk = 34
        versionCode = (project.findProperty("appVersionCode") as String?)?.toIntOrNull() ?: 1
        versionName = "1.0.$versionCode"

        // Public anon/publishable key — safe to ship in a client app.
        // Same project as the main PWA (js/supabase.js's SB_URL) — NOT
        // android-widget's separate Pharmacy Audit Hub project. Table
        // access is anon-role RLS (USING(true)), same pattern as the rest
        // of this app — see supabase/migrations/*_attendance_rls_fix.sql
        // for why, and its accepted single-user-app tradeoff.
        buildConfigField("String", "SUPABASE_URL", "\"https://wetbugzzchkghpzmowod.supabase.co\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // Same shared debug keystore as android-widget, same reasoning: a
    // fresh random debug keystore per CI run would make every build
    // register as a different app, forcing an uninstall (which drops any
    // pending un-synced geofence registration/local state) before every
    // update. This is a debug-only sideload key, not a Play Store key.
    signingConfigs {
        create("shared") {
            storeFile = file("../shared-debug.keystore")
            storePassword = "duapharma-shared-debug"
            keyAlias = "shareddebugkey"
            keyPassword = "duapharma-shared-debug"
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
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    // Geofencing + location fix at the moment of a transition.
    implementation("com.google.android.gms:play-services-location:21.3.0")

    // QR fallback — a maintained, MIT-licensed wrapper around ZXing.
    // Chosen over ML Kit barcode scanning specifically to avoid a second
    // Google Play Services dependency beyond play-services-location.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
