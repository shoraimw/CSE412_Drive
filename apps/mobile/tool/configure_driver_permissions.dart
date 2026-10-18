import 'dart:io';

/// Configure only foreground location permissions for DRIVE driver GPS.
/// Run after flutter create. This tool never adds background tracking rights.
void main() {
  final android = File('android/app/src/main/AndroidManifest.xml');
  if (android.existsSync()) {
    var text = android.readAsStringSync();
    for (final permission in [
      'android.permission.INTERNET',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
    ]) {
      if (!text.contains(permission)) {
        final manifestEnd = text.indexOf('>');
        if (manifestEnd < 0 || !text.startsWith('<manifest')) {
          throw const FormatException('Invalid Android main manifest.');
        }
        text = text.replaceRange(manifestEnd + 1, manifestEnd + 1,
            '\n    <uses-permission android:name="$permission"/>');
      }
    }
    android.writeAsStringSync(text);
    stdout.writeln('Android foreground location permissions configured.');
  }

  final ios = File('ios/Runner/Info.plist');
  if (ios.existsSync()) {
    var text = ios.readAsStringSync();
    if (!text.contains('NSLocationWhenInUseUsageDescription')) {
      if (!text.contains('</dict>')) {
        throw const FormatException('Invalid iOS Info.plist.');
      }
      text = text.replaceFirst('</dict>',
          '    <key>NSLocationWhenInUseUsageDescription</key>\n'
          '    <string>DRIVE uses your position while you are online and '
          'serving a ride so passengers can follow their assigned driver.</string>\n'
          '</dict>');
      ios.writeAsStringSync(text);
    }
    stdout.writeln('iOS foreground location purpose configured.');
  }

  if (!android.existsSync() && !ios.existsSync()) {
    stderr.writeln('Run flutter create --platforms=android,ios . first.');
    exitCode = 2;
  }
}
