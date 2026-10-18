import 'dart:io' show Platform;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
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
    final app = await Firebase.initializeApp(
      options: emulator
          ? const FirebaseOptions(
              apiKey: 'drive-local-api-key',
              appId: '1:1234567890:android:drive-local',
              messagingSenderId: '1234567890',
              projectId: 'demo-drive-local',
              storageBucket: 'demo-drive-local.appspot.com',
              databaseURL:
                  'https://demo-drive-local-default-rtdb.firebaseio.com',
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
