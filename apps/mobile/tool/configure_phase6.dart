import 'dart:io';

/// Requires Flutter-generated Android source. Never writes API keys.
void main() {
  final root = Directory('android/app/src/main/kotlin');
  final candidates = root.existsSync()
      ? root.listSync(recursive: true).whereType<File>()
          .where((file) => file.path.endsWith('MainActivity.kt')).toList()
      : <File>[];
  if (candidates.length != 1) {
    stderr.writeln('Run flutter create --platforms=android,ios . first.');
    exitCode = 2;
    return;
  }
  final main = candidates.single;
  var kotlin = main.readAsStringSync();
  kotlin = kotlin.replaceAll('import io.flutter.embedding.android.FlutterActivity',
      'import io.flutter.embedding.android.FlutterFragmentActivity')
      .replaceAll('FlutterActivity()', 'FlutterFragmentActivity()');
  if (!kotlin.contains('FlutterFragmentActivity')) {
    throw const FormatException('Android MainActivity could not be configured.');
  }
  main.writeAsStringSync(kotlin);

  for (final folder in ['values', 'values-night']) {
    final file = File('android/app/src/main/res/$folder/styles.xml');
    if (!file.existsSync()) continue;
    var xml = file.readAsStringSync();
    xml = xml.replaceAll('parent="@android:style/Theme.Light.NoTitleBar"',
        'parent="Theme.AppCompat.Light.NoActionBar"');
    xml = xml.replaceAll('parent="@android:style/Theme.Black.NoTitleBar"',
        'parent="Theme.AppCompat.DayNight.NoActionBar"');
    file.writeAsStringSync(xml);
  }

  // file_picker 11.0.1–11.0.3 assumes AGP 9 built-in Kotlin is enabled.
  // Flutter's generated template can keep it disabled, so force Kotlin compilation
  // for this subproject and pin its bytecode target to Java 17.
  const marker = 'DRIVE_FILE_PICKER_AGP9_FIX';
  const groovyFix = '''
// DRIVE_FILE_PICKER_AGP9_FIX
subprojects {
    configurations.configureEach {
        // Stripe's optional issuing push-provisioning SDK pulls Google's private
        // TapAndPay Maven artifact. DRIVE uses PaymentSheet, not issuing provisioning.
        exclude group: "com.stripe", module: "stripe-android-issuing-push-provisioning"
    }
    if (name == "file_picker") {
        apply plugin: "org.jetbrains.kotlin.android"
        tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
            compilerOptions {
                jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
            }
        }
    }
}
''';
  const kotlinFix = '''
// DRIVE_FILE_PICKER_AGP9_FIX
subprojects {
    configurations.configureEach {
        // Stripe issuing push provisioning requires a private Google TapAndPay SDK.
        // This project uses PaymentSheet, not card issuing/provisioning.
        exclude(group = "com.stripe", module = "stripe-android-issuing-push-provisioning")
    }
    if (name == "file_picker") {
        pluginManager.apply("org.jetbrains.kotlin.android")
        tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
            compilerOptions {
                jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
            }
        }
    }
}
''';
  final groovyGradle = File('android/build.gradle');
  final kotlinGradle = File('android/build.gradle.kts');
  if (groovyGradle.existsSync()) {
    final content = groovyGradle.readAsStringSync();
    if (!content.contains(marker)) {
      groovyGradle.writeAsStringSync('$content\n$groovyFix');
    }
  } else if (kotlinGradle.existsSync()) {
    final content = kotlinGradle.readAsStringSync();
    if (!content.contains(marker)) {
      kotlinGradle.writeAsStringSync('$content\n$kotlinFix');
    }
  } else {
    throw FileSystemException('Could not find the generated Android root Gradle file.');
  }

  final manifest = File('android/app/src/main/AndroidManifest.xml');
  if (!manifest.existsSync()) throw FileSystemException('Missing Android manifest.');
  var xml = manifest.readAsStringSync();
  xml = xml.replaceAll('android:label="drive_mobile"', 'android:label="DRIVE"');
  const permission = 'android.permission.POST_NOTIFICATIONS';
  if (!xml.contains(permission)) {
    final pos = xml.indexOf('>');
    if (pos < 0 || !xml.startsWith('<manifest')) {
      throw const FormatException('Invalid Android manifest.');
    }
    xml = xml.replaceRange(pos + 1, pos + 1,
        '\n    <uses-permission android:name="$permission"/>');
  }
  manifest.writeAsStringSync(xml);

  const rules = '''
-dontwarn com.stripe.android.pushProvisioning.**
-dontwarn com.google.android.gms.tapandpay.**
-dontwarn kotlinx.parcelize.Parceler
-dontwarn kotlinx.parcelize.Parcelize
-keep class com.stripe.** { *; }
''';
  final proguard = File('android/app/proguard-rules.pro');
  final existing = proguard.existsSync() ? proguard.readAsStringSync() : '';
  if (!existing.contains('-keep class com.stripe.**')) {
    proguard.writeAsStringSync('$existing\n$rules');
  }
  stdout.writeln('Stripe Android host, file_picker Kotlin target, app label and notification permission configured.');
  stdout.writeln('Enable APNs/Push capability in Xcode for real iOS notifications.');
}
