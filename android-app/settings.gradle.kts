pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // Android Browser Helper (the TWA library this app is built on) is
        // published on Google's Maven, not Maven Central.
        google()
        mavenCentral()
    }
}

rootProject.name = "BTSaleData"
include(":app")
