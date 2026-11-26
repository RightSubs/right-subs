package com.rightsubs.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings

/**
 * Keeps the addon alive while Stremio plays: on a phone, asks once for the battery-optimization
 * exemption, through Android's own dialog ("Allow app to always run in the background?").
 * Without it, brands such as Xiaomi, Samsung and OPPO freeze or stop a background service, and
 * Stremio then finds nothing at 127.0.0.1:7000 (the subtitle never shows up). A TV box does
 * not freeze it, so nothing is asked there. The exemption does not survive the phone's
 * "Clear all" in recent apps: the README tells to lock the app there.
 */
object BackgroundRun {
    private const val PREFS = "settings"
    private const val ASKED = "battery.asked"

    /** Ask only on a phone that still restricts the app, and only once: a "no" is respected. */
    fun shouldAsk(isTv: Boolean, ignoringOptimizations: Boolean, alreadyAsked: Boolean): Boolean =
        !isTv && !ignoringOptimizations && !alreadyAsked

    fun askOnce(activity: Activity, isTv: Boolean) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val ignoring = activity.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(activity.packageName)
        if (!shouldAsk(isTv, ignoring, prefs.getBoolean(ASKED, false))) return
        // Marked before the dialog opens, so coming back to the screen never asks again.
        prefs.edit().putBoolean(ASKED, true).apply()
        try {
            activity.startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${activity.packageName}")),
            )
        } catch (_: ActivityNotFoundException) {
            // A device without that dialog: nothing to ask.
        }
    }
}
