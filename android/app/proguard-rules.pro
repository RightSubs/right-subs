# The app uses no reflection; the default Android rules are enough.
# Drop debug/verbose logging calls from the release build.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
}
