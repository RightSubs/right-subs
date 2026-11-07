package com.rightsubs.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Starts the addon when the box boots and after an app update, once credentials exist. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Both are protected broadcasts (only the system sends them); anything else is ignored.
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (!SecretStore(context).hasCredentials()) return
        try {
            AddonService.start(context)
        } catch (_: IllegalStateException) {
            // Background start refused by the system: it starts when the app is opened.
        }
    }
}
