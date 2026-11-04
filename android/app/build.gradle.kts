import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Filled by scripts/container-build.sh: Node, ffmpeg and the RightSubs bundle.
val generatedDir = (findProperty("generatedDir") as String?) ?: "${rootDir}/../build/generated"
val signingProps = (findProperty("signingProps") as String?)?.let { path ->
    Properties().apply { file(path).inputStream().use { load(it) } }
}

android {
    namespace = "com.rightsubs.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.rightsubs.android"
        minSdk = 26
        targetSdk = 35
        versionCode = (findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = (findProperty("versionName") as String?) ?: "dev" // VERSION file, via scripts/container-build.sh
        // Debug builds (-PdebugLog=true, set by build.ps1 -DebugLog): log copy readable with adb.
        buildConfigField("boolean", "DEBUG_LOG_MIRROR", ((findProperty("debugLog") as String?) == "true").toString())
    }

    signingConfigs {
        if (signingProps != null) {
            create("release") {
                storeFile = file(signingProps.getProperty("storeFile"))
                storePassword = signingProps.getProperty("storePassword")
                keyAlias = signingProps.getProperty("keyAlias")
                keyPassword = signingProps.getProperty("keyPassword")
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    splits {
        abi {
            isEnable = true
            reset()
            include(*File("$generatedDir/jniLibs").list().orEmpty().sorted().toTypedArray())
            isUniversalApk = true
        }
    }

    sourceSets["main"].assets.srcDir("$generatedDir/assets")
    sourceSets["main"].jniLibs.srcDir("$generatedDir/jniLibs")

    packaging {
        jniLibs {
            // Node and ffmpeg are executables: they must be extracted to nativeLibraryDir,
            // the only app directory Android lets an app execute files from.
            useLegacyPackaging = true
            keepDebugSymbols += "**/*.so"
        }
    }

    androidResources {
        noCompress += "zip"
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests.all {
            it.systemProperty("rightsubs.template", "$generatedDir/config.template.yaml")
            it.systemProperty("rightsubs.languages", "$generatedDir/languages.ts")
            // QrCodeTest writes a sample here, checked afterwards with a real decoder (zbarimg).
            it.systemProperty("rightsubs.qrSample", "$generatedDir/qr-sample.pbm")
        }
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        disable += setOf("GradleDependency", "OldTargetApi", "ExpiredTargetSdkVersion")
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
