plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.duapharma.inventorywidget"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.duapharma.inventorywidget"
        // 26 (Android 8.0) for PendingIntent.FLAG_IMMUTABLE and modern
        // widget behavior. Lower it if you need to support older
        // devices, but then piImmutableFlag()'s SDK check in the
        // provider needs the corresponding fallback path exercised.
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    // Deliberately minimal — org.json and HttpURLConnection are both
    // built into Android, no networking/JSON library needed for this
    // starter. Only real dependency is Kotlin coroutines, for the
    // background fetch in onUpdate().
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
