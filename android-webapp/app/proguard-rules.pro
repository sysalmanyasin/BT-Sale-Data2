# This app has no reflection-based libraries (no Gson/Retrofit/Room), no
# @JavascriptInterface bridge, and no custom Parcelable/Serializable data
# classes, so the AndroidX/Kotlin default rules (pulled in automatically
# via each library's own consumer-rules.pro) cover it. Nothing here needs
# an explicit -keep: WebViewClient/WebChromeClient overrides are invoked
# through normal virtual dispatch, not reflection, so R8 won't touch them.
#
# If a NoSuchMethodError/ClassNotFoundException shows up in a release
# build that isn't present in debug, that's what shrinking/obfuscation
# broke — add a -keep rule for the specific class here rather than
# turning isMinifyEnabled back off.
