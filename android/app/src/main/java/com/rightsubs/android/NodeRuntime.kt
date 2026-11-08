package com.rightsubs.android

import android.content.Context
import android.os.Build
import android.system.Os
import java.io.File
import java.io.IOException
import java.util.zip.ZipInputStream

/**
 * Lays out what the addon needs in the app's private storage:
 *   files/app/       RightSubs (dist/, node_modules/), unpacked from the APK on install/update
 *   files/bin/       node, ffmpeg, ffprobe → symlinks to the executables in nativeLibraryDir
 *   files/lib/       libssl.so.3 & co. → symlinks to their lib*.so copies in nativeLibraryDir
 *   files/config.yaml, files/.rightsubs/ (cache, logs, tmp)
 * Android only lets an app execute files from nativeLibraryDir, which is read-only and
 * checked against the APK signature; the symlinks just give them their real names.
 */
class NodeRuntime(private val context: Context) {
    private val files: File = context.filesDir
    val appDir = File(files, "app")
    val binDir = File(files, "bin")
    val libDir = File(files, "lib")
    val dataDir = File(files, ".rightsubs")
    val configFile = File(files, "config.yaml")
    val caFile = File(appDir, "cacert.pem")
    // Debug builds only (build.ps1 -DebugLog): a copy in app-specific external storage,
    // readable with adb (/sdcard/Android/data/<package>/files). Lines are already redacted.
    val log = LogFile(
        File(dataDir, "logs/rightsubs.log"),
        mirror = if (BuildConfig.DEBUG_LOG_MIRROR) context.getExternalFilesDir(null)?.let { File(it, "rightsubs.log") } else null,
    )
    private val nativeDir = File(context.applicationInfo.nativeLibraryDir)
    val node = File(nativeDir, "libnode.so")

    val hasFfmpeg: Boolean get() = File(nativeDir, "libffmpeg.so").exists()

    /** Unpacks RightSubs if this APK version was not unpacked yet and refreshes the links. */
    @Synchronized
    fun prepare(credentials: Credentials) {
        if (!node.exists()) throw IOException("Node.js is not in the APK for this device (${Build.SUPPORTED_ABIS.joinToString()})")
        val stamp = installStamp()
        val marker = File(appDir, ".installed")
        if (!marker.exists() || marker.readText() != stamp) {
            unpack()
            marker.writeText(stamp)
        }
        link()
        writeConfig(credentials)
    }

    /** Minimal environment for the Node process: secrets only here, never on disk. */
    fun environment(credentials: Credentials): Map<String, String> = buildMap {
        // Android variables the system libraries expect (time zone, ICU data, …).
        for (name in listOf("ANDROID_ROOT", "ANDROID_DATA", "ANDROID_ART_ROOT", "ANDROID_I18N_ROOT", "ANDROID_TZDATA_ROOT", "BOOTCLASSPATH")) {
            System.getenv(name)?.let { put(name, it) }
        }
        put("PATH", "${binDir.path}:/system/bin")
        put("LD_LIBRARY_PATH", "${libDir.path}:${nativeDir.path}")
        put("HOME", files.path)
        put("TMPDIR", context.cacheDir.path)
        put("RIGHTSUBS_HOME", dataDir.path)
        put("SSL_CERT_FILE", caFile.path)
        put("NODE_ENV", "production")
        putAll(credentials.environment())
    }

    private fun installStamp(): String {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        @Suppress("DEPRECATION")
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()
        return "$code-${info.lastUpdateTime}"
    }

    private fun unpack() {
        val staging = File(files, "app.new")
        staging.deleteRecursively()
        staging.mkdirs()
        val root = staging.canonicalPath + File.separator
        context.assets.open("rightsubs.zip").use { input ->
            ZipInputStream(input.buffered()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    val target = File(staging, entry.name)
                    // Zip slip: nothing may land outside the staging directory.
                    if (!target.canonicalPath.startsWith(root)) throw IOException("invalid entry in the bundle: ${entry.name}")
                    if (entry.isDirectory) {
                        target.mkdirs()
                    } else {
                        target.parentFile?.mkdirs()
                        target.outputStream().use { zip.copyTo(it) }
                    }
                }
            }
        }
        context.assets.open("cacert.pem").use { input -> File(staging, "cacert.pem").outputStream().use { input.copyTo(it) } }
        appDir.deleteRecursively()
        if (!staging.renameTo(appDir)) throw IOException("could not install RightSubs in ${appDir.path}")
    }

    private fun link() {
        val links = mutableMapOf(
            File(binDir, "node") to "libnode.so",
            File(binDir, "ffmpeg") to "libffmpeg.so",
            File(binDir, "ffprobe") to "libffprobe.so",
        )
        context.assets.open("libmap.txt").bufferedReader().useLines { lines ->
            lines.map { it.trim().split(' ') }.filter { it.size == 2 }.forEach { (soname, apkName) ->
                links[File(libDir, soname)] = apkName
            }
        }
        // Rebuilt every start: nativeLibraryDir changes path on each app update.
        binDir.deleteRecursively()
        libDir.deleteRecursively()
        binDir.mkdirs()
        libDir.mkdirs()
        for ((link, apkName) in links) {
            val target = File(nativeDir, apkName)
            if (target.exists()) Os.symlink(target.path, link.path)
        }
    }

    private fun writeConfig(credentials: Credentials) {
        val template = File(appDir, "config.template.yaml").readText()
        val config = ConfigWriter.render(
            template,
            realDebrid = credentials.realDebridToken.isNotEmpty(),
            deepL = credentials.deepLApiKey.isNotEmpty(),
            languages = Languages.load(context),
        )
        val tmp = File(files, "config.yaml.tmp")
        tmp.writeText(config)
        if (!tmp.renameTo(configFile)) throw IOException("could not write ${configFile.path}")
    }
}
