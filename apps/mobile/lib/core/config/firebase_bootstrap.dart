import 'dart:io' show Platform;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/foundation.dart';

/// Actual production Firebase application credentials are supplied using
/// --dart-define-from-file. They are not committed to public GitHub.
class DriveFirebaseConfig {
  static const emulator = bool.fromEnvironment(
    'DRIVE_EMULATOR', defaultValue: false,
  );
  static const emulatorHostOverride = String.fromEnvironment(
    'DRIVE_EMULATOR_HOST', defaultValue: '',
  );
  static const projectId = String.fromEnvironment(
    'FIREBASE_PROJECT_ID', defaultValue: '',
  );
  static const apiKey = String.fromEnvironment(
    'FIREBASE_API_KEY', defaultValue: '',
  );
  static const appId = String.fromEnvironment(
    'FIREBASE_APP_ID', defaultValue: '',
  );
  static const senderId = String.fromEnvironment(
    'FIREBASE_MESSAGING_SENDER_ID', defaultValue: '',
  );
  static const databaseUrl = String.fromEnvironment(
    'FIREBASE_DATABASE_URL', defaultValue: '',
  );
  static const storageBucket = String.fromEnvironment(
    'FIREBASE_STORAGE_BUCKET', defaultValue: '',
  );

  static String get emulatorHost {
    if (emulatorHostOverride.isNotEmpty) return emulatorHostOverride;
    if (!kIsWeb && Platform.isAndroid) return '10.0.2.2';
    return '127.0.0.1';
  }

  static Future<void> initialize() async {
    if (!emulator &&
        [projectId, apiKey, appId, senderId, storageBucket].any((value) => value.isEmpty)) {
      throw StateError(
        'Firebase config missing. See docs/PHASE_3_FLUTTER.md. '
        'Use DRIVE_EMULATOR=true locally, or pass Firebase settings '
        'with --dart-define-from-file.',
      );
    }
    // The app's project ID must match the project passed to
    // `firebase emulators:start --project ...`. If a local config file is
    // supplied, keep its API key/app ID so Firebase SDK token plumbing works;
    // the Firebase service clients below are still redirected to emulators.
    final emulatorProjectId = projectId.isEmpty ? 'demo-drive-local' : projectId;
    final app = await Firebase.initializeApp(
      options: emulator
          ? FirebaseOptions(
              apiKey: apiKey.isEmpty ? 'drive-local-api-key' : apiKey,
              appId: appId.isEmpty
                  ? '1:1234567890:android:drive-local'
                  : appId,
              messagingSenderId: senderId.isEmpty ? '1234567890' : senderId,
              projectId: emulatorProjectId,
              storageBucket: storageBucket.isEmpty
                  ? '$emulatorProjectId.appspot.com'
                  : storageBucket,
              databaseURL: databaseUrl.isEmpty
                  ? 'https://$emulatorProjectId-default-rtdb.firebaseio.com'
                  : databaseUrl,
            )
          : FirebaseOptions(
              apiKey: apiKey,
              appId: appId,
              messagingSenderId: senderId,
              projectId: projectId,
              storageBucket: storageBucket.isEmpty ? null : storageBucket,
              databaseURL: databaseUrl.isEmpty ? null : databaseUrl,
            ),
    );
    // App Check is activated for real Android/iOS Firebase apps only.
    // Register their signing fingerprints and providers in Firebase first.
    // Backend enforcement must be rolled out AFTER observing token health.
    if (!emulator && !kIsWeb && (Platform.isAndroid || Platform.isIOS)) {
      await FirebaseAppCheck.instance.activate(
        providerAndroid: const AndroidPlayIntegrityProvider(),
        providerApple: const AppleAppAttestWithDeviceCheckFallbackProvider(),
      );
    }
    if (emulator) {
      final host = emulatorHost;
      await FirebaseAuth.instanceFor(app: app).useAuthEmulator(host, 9099);
      FirebaseFirestore.instanceFor(app: app).useFirestoreEmulator(host, 8080);
      FirebaseFunctions.instanceFor(app: app, region: 'asia-south1')
          .useFunctionsEmulator(host, 5001);
      await FirebaseStorage.instanceFor(app: app).useStorageEmulator(
        host, 9199,
      );
      FirebaseDatabase.instanceFor(app: app).useDatabaseEmulator(host, 9000);
    }
  }
}
