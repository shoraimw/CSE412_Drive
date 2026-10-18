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

  final manifest = File('android/app/src/main/AndroidManifest.xml');
  if (!manifest.existsSync()) throw FileSystemException('Missing Android manifest.');
  var xml = manifest.readAsStringSync();
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
  stdout.writeln('Stripe Android FragmentActivity/theme and notification permission configured.');
  stdout.writeln('Enable APNs/Push capability in Xcode for real iOS notifications.');
}
