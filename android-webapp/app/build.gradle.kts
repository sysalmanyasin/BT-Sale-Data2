plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.duapharma.btsales"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.duapharma.btsales"
        minSdk = 26
        targetSdk = 34
        versionCode = (project.findProperty("appVersionCode") as String?)?.toIntOrNull() ?: 1
        versionName = "1.0.$versionCode"

        // The site this app wraps. Same PWA served at the CNAME in the
        // repo root — this app is a thin native shell around it, not a
        // second copy of the front end, so the web app stays the single
        // source of truth and updates without a store release.
        buildConfigField("String", "APP_URL", "\"https://bt.duapharma.com/\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // Same shared debug keystore convention as android-attendance /
    // android-widget: a stable signing key across CI runs so repeat
    // installs upgrade in place instead of colliding as a "different app".
    // Debug-only sideload key, not a Play Store key.
    signingConfigs {
        create("shared") {
            storeFile = file("../shared-debug.keystore")
            storePassword = "duapharma-shared-debug"
            keyAlias = "shareddebugkey"
            keyPassword = "duapharma-shared-debug"
        }

        // A real, dedicated release key — never committed to git. CI
        // decodes it from the RELEASE_KEYSTORE_BASE64 secret into
        // release.keystore before the build; locally, set the four
        // RELEASE_* env vars yourself. Until those are present, release
        // builds keep using the "shared" debug key above (see
        // buildTypes.release below) so nothing breaks for anyone who
        // hasn't set this up yet.
        create("release") {
            val ksFile = file("release.keystore")
            if (ksFile.exists()) {
                storeFile = ksFile
                storePassword = System.getenv("RELEASE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("RELEASE_KEY_ALIAS")
                keyPassword = System.getenv("RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = if (file("release.keystore").exists()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("shared")
            }
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
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    // Custom Tabs — required for Google Sign-In (see MainActivity):
    // Google's OAuth endpoints reject the plain WebView user agent
    // ("disallowed_useragent"), and this is the flow Google itself
    // recommends instead, not a workaround.
    implementation("androidx.browser:browser:1.8.0")
}
