import 'dart:async';
import 'dart:io' show Platform;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:uuid/uuid.dart';

import '../../../core/config/firebase_bootstrap.dart';

class TripServicesRepository {
  TripServicesRepository({
    required this.firestore,
    required this.functions,
  });

  final FirebaseFirestore firestore;
  final FirebaseFunctions functions;

  Future<Map<String, dynamic>> _call(
      String name, Map<String, dynamic> data) async {
    final result = await functions.httpsCallable(name).call(data);
    return Map<String, dynamic>.from(result.data as Map);
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> messages(String rideId) =>
      firestore.collection('rides').doc(rideId).collection('messages')
          .orderBy('createdAt', descending: false).limit(100).snapshots();

  Stream<DocumentSnapshot<Map<String, dynamic>>> payment(String rideId) =>
      firestore.collection('payments').doc(rideId).snapshots();

  Stream<DocumentSnapshot<Map<String, dynamic>>> myRating(
      String rideId, String uid) =>
      firestore.collection('ratings').doc(rideId + '_' + uid).snapshots();

  Stream<QuerySnapshot<Map<String, dynamic>>> notifications(String uid) =>
      firestore.collection('notifications').where('uid', isEqualTo: uid)
          .orderBy('createdAt', descending: true).limit(60).snapshots();

  Future<void> sendMessage(String rideId, String text) async {
    final cleaned = text.trim();
    if (cleaned.isEmpty || cleaned.length > 1000) {
      throw ArgumentError('Enter a message between 1 and 1000 characters.');
    }
    await _call('sendRideMessage', {
      'rideId': rideId,
      'text': cleaned,
      'clientMessageId': const Uuid().v4(),
    });
  }

  Future<void> rateRide(String rideId, int stars, String comment) async {
    if (stars < 1 || stars > 5 || comment.trim().length > 500) {
      throw ArgumentError('Rating must be 1–5 and comment up to 500 characters.');
    }
    await _call('rateCompletedRide', {
      'rideId': rideId, 'stars': stars, 'comment': comment.trim(),
    });
  }

  Future<void> chooseCash(String rideId) async =>
      _call('chooseCashForRide', {'rideId': rideId});

  Future<void> reportCashReceived(String rideId) async =>
      _call('reportCashReceived', {'rideId': rideId});

  static bool get isStripeConfigured {
    const key = String.fromEnvironment(
      'STRIPE_TEST_PUBLISHABLE_KEY', defaultValue: '',
    );
    return key.startsWith('pk_test_');
  }

  /// PaymentSheet does not set Firestore to paid. Only the signed Stripe
  /// webhook can produce paid_test; the caller must watch the payment doc.
  Future<void> presentStripeTestPayment(String rideId) async {
    if (!isStripeConfigured) {
      throw StateError('Stripe test publishable key is not configured.');
    }
    final response = await _call('prepareStripeTestPayment', {'rideId': rideId});
    final secret = response['clientSecret'] as String?;
    if (secret == null || secret.isEmpty) {
      throw StateError('PaymentIntent client secret not returned.');
    }
    await Stripe.instance.initPaymentSheet(
      paymentSheetParameters: SetupPaymentSheetParameters(
        paymentIntentClientSecret: secret,
        merchantDisplayName: 'DRIVE University Demo',
        style: ThemeMode.system,
      ),
    );
    await Stripe.instance.presentPaymentSheet();
  }

  Future<void> registerDeviceForPush() async {
    if (DriveFirebaseConfig.emulator || kIsWeb) return;
    if (!Platform.isAndroid && !Platform.isIOS) return;
    await FirebaseMessaging.instance.requestPermission(
      alert: true, badge: true, sound: true,
    );
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null) return;
    await _registerToken(token);
  }

  Future<void> _registerToken(String token) async {
    await _call('registerPushToken', {
      'token': token,
      'platform': Platform.isIOS ? 'ios' : 'android',
    });
  }

  StreamSubscription<String>? watchPushTokenRefresh() {
    if (DriveFirebaseConfig.emulator || kIsWeb) return null;
    return FirebaseMessaging.instance.onTokenRefresh.listen((token) {
      unawaited(_registerToken(token).catchError((Object error) {
        debugPrint('Push token refresh registration failed.');
      }));
    });
  }

  Future<void> unregisterDeviceFromPush() async {
    if (DriveFirebaseConfig.emulator || kIsWeb) return;
    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) {
      try {
        await _call('unregisterPushToken', {'token': token});
      } finally {
        await FirebaseMessaging.instance.deleteToken();
      }
    }
  }
}
