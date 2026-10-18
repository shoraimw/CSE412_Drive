import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/auth/data/auth_repository.dart';

final firebaseAuthProvider = Provider<FirebaseAuth>((ref) => FirebaseAuth.instance);
final firestoreProvider = Provider<FirebaseFirestore>(
  (ref) => FirebaseFirestore.instance,
);
final functionsProvider = Provider<FirebaseFunctions>(
  (ref) => FirebaseFunctions.instanceFor(region: 'asia-south1'),
);
final storageProvider = Provider<FirebaseStorage>(
  (ref) => FirebaseStorage.instance,
);
final databaseProvider = Provider<FirebaseDatabase>(
  (ref) => FirebaseDatabase.instance,
);
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    auth: ref.watch(firebaseAuthProvider),
    functions: ref.watch(functionsProvider),
  );
});
final authChangesProvider = StreamProvider<User?>(
  (ref) => ref.watch(firebaseAuthProvider).authStateChanges(),
);
final userProfileProvider =
    StreamProvider.family<Map<String, dynamic>?, String>((ref, uid) {
  return ref.watch(firestoreProvider).collection('users').doc(uid).snapshots().map(
    (snapshot) => snapshot.data(),
  );
});
final driverProfileProvider =
    StreamProvider.family<Map<String, dynamic>?, String>((ref, uid) {
  return ref.watch(firestoreProvider).collection('driverProfiles')
      .doc(uid).snapshots().map((snapshot) => snapshot.data());
});
final ownerProfileProvider =
    StreamProvider.family<Map<String, dynamic>?, String>((ref, uid) {
  return ref.watch(firestoreProvider).collection('ownerProfiles')
      .doc(uid).snapshots().map((snapshot) => snapshot.data());
});

class AppLocaleController extends Notifier<Locale> {
  @override
  Locale build() => const Locale('en');

  void setLanguage(String language) =>
      state = Locale(language == 'bn' ? 'bn' : 'en');
}
final appLocaleProvider =
    NotifierProvider<AppLocaleController, Locale>(AppLocaleController.new);

class AppThemeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() => ThemeMode.system;
  void setTheme(ThemeMode mode) => state = mode;
}
final appThemeProvider =
    NotifierProvider<AppThemeController, ThemeMode>(AppThemeController.new);
