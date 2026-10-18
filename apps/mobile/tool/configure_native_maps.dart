import 'dart:io';

/// Generates local, ignored platform key files and wires them to the Flutter
/// native scaffolding. Run only AFTER flutter create. Never commit these keys.
void main() {
  final androidKey = Platform.environment['DRIVE_ANDROID_MAPS_KEY'];
  final iosKey = Platform.environment['DRIVE_IOS_MAPS_KEY'];
  if ((androidKey == null || androidKey.isEmpty) &&
      (iosKey == null || iosKey.isEmpty)) {
    stderr.writeln('Set DRIVE_ANDROID_MAPS_KEY or DRIVE_IOS_MAPS_KEY first.');
    exitCode = 2;
    return;
  }
  if (androidKey != null && androidKey.isNotEmpty) {
    if (!RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(androidKey)) {
      throw FormatException('Unexpected characters in Android API key.');
    }
    final manifest = File('android/app/src/main/AndroidManifest.xml');
    if (!manifest.existsSync()) {
      throw FileSystemException('Run flutter create before configuring Maps.');
    }
    var xml = manifest.readAsStringSync();
    const metadata = '<meta-data android:name="com.google.android.geo.API_KEY" '
        'android:value="@string/drive_google_maps_key" />';
    if (!xml.contains('com.google.android.geo.API_KEY')) {
      if (!xml.contains('</application>')) {
        throw FormatException('Android manifest has no application tag.');
      }
      xml = xml.replaceFirst('</application>', '    $metadata\n    </application>');
    }
    if (!xml.contains('android.permission.ACCESS_FINE_LOCATION')) {
      final end = xml.indexOf('>');
      if (end < 0) throw FormatException('Invalid Android manifest.');
      xml = xml.replaceRange(end + 1, end + 1,
          '\n    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>');
    }
    if (!xml.contains('android.permission.INTERNET')) {
      final end = xml.indexOf('>');
      xml = xml.replaceRange(end + 1, end + 1,
          '\n    <uses-permission android:name="android.permission.INTERNET"/>');
    }
    manifest.writeAsStringSync(xml);
    final resource = File('android/app/src/main/res/values/drive_maps_keys.xml');
    resource.parent.createSync(recursive: true);
    resource.writeAsStringSync('<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        '    <string name="drive_google_maps_key">$androidKey</string>\n'
        '</resources>\n');
    stdout.writeln('Android Maps manifest configured; private resource file generated.');
  }
  if (iosKey != null && iosKey.isNotEmpty) {
    if (!RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(iosKey)) {
      throw FormatException('Unexpected characters in iOS API key.');
    }
    final plist = File('ios/Runner/Info.plist');
    final app = File('ios/Runner/AppDelegate.swift');
    if (!plist.existsSync() || !app.existsSync()) {
      throw FileSystemException('Generate iOS platform files using flutter create.');
    }
    var text = plist.readAsStringSync();
    if (!text.contains('<key>GMSApiKey</key>')) {
      text = text.replaceFirst('</dict>',
          '    <key>GMSApiKey</key>\n'
          '    <string>$(DRIVE_IOS_MAPS_KEY)</string>\n'
          '</dict>');
    }
    if (!text.contains('NSLocationWhenInUseUsageDescription')) {
      text = text.replaceFirst('</dict>',
          '    <key>NSLocationWhenInUseUsageDescription</key>\n'
          '    <string>DRIVE uses your location to choose a pickup point.</string>\n'
          '</dict>');
    }
    plist.writeAsStringSync(text);
    var swift = app.readAsStringSync();
    if (!swift.contains('import GoogleMaps')) {
      swift = 'import GoogleMaps\n$swift';
    }
    const initializer = 'if let key = Bundle.main.object('
        'forInfoDictionaryKey: "GMSApiKey") as? String {\n'
        '      GMSServices.provideAPIKey(key)\n'
        '    }\n    ';
    if (!swift.contains('GMSServices.provideAPIKey')) {
      if (!swift.contains('GeneratedPluginRegistrant.register(with: self)')) {
        throw FormatException('Unable to locate Flutter plugin registration.');
      }
      swift = swift.replaceFirst('GeneratedPluginRegistrant.register(with: self)',
          '${initializer}GeneratedPluginRegistrant.register(with: self)');
    }
    app.writeAsStringSync(swift);
    final xcconfig = File('ios/Flutter/DriveMapsKeys.xcconfig');
    xcconfig.parent.createSync(recursive: true);
    xcconfig.writeAsStringSync('DRIVE_IOS_MAPS_KEY=$iosKey\n');
    for (final name in ['Debug.xcconfig', 'Release.xcconfig']) {
      final file = File('ios/Flutter/$name');
      if (!file.existsSync()) continue;
      var config = file.readAsStringSync();
      if (!config.contains('DriveMapsKeys.xcconfig')) {
        config += '\n#include "DriveMapsKeys.xcconfig"\n';
        file.writeAsStringSync(config);
      }
    }
    stdout.writeln('iOS Maps initialized with private Xcode config file.');
  }
}
