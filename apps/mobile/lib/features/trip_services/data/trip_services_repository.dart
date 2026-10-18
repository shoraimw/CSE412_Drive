import 'dart:async';
import 'dart:io' show Platform;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:uuid/uuid.dart';

import '../../../core/config/firebase_bootstrap.dart';

class TripServicesRepository {
  TripServicesRepository({
    required this.firestore,
    required this.functions,
  });

  final FirebaseFirestore firestore;
  final FirebaseFunctions functions;
  String? _registeredInstallationId;

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
      firestore.collection('ratings').doc('${rideId}_$uid').snapshots();

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

  /// Server creates a Stripe TEST Checkout session from the trusted ride fare.
  /// Opening the hosted page is not a payment confirmation: watch the
  /// payment document for the signed webhook's paid_test status.
  Future<void> openStripeTestCheckout(String rideId) async {
    final response = await _call('prepareStripeTestCheckout', {'rideId': rideId});
    final raw = response['checkoutUrl'] as String?;
    final url = raw == null ? null : Uri.tryParse(raw);
    if (url == null || url.scheme != 'https' || url.host.isEmpty ||
        !(url.host == 'checkout.stripe.com' ||
          url.host.endsWith('.checkout.stripe.com'))) {
      throw StateError('Stripe did not return a trusted checkout link.');
    }
    if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
      throw StateError('Unable to open the secure Stripe test checkout.');
    }
  }

  /// Firebase Messaging 17 supplies a Firebase Installation ID (FID).
  /// Server uses firebase-admin 14+ and the FCM fids target; the FID is not a legacy token.
  Future<StreamSubscription<String>?> startPushRegistration() async {
    if (DriveFirebaseConfig.emulator || kIsWeb) return null;
    if (!Platform.isAndroid && !Platform.isIOS) return null;
    final messaging = FirebaseMessaging.instance;
    final listener = messaging.onRegistered.listen((installationId) {
      _registeredInstallationId = installationId;
      unawaited(_registerToken(installationId).catchError((Object _) {
        debugPrint('Unable to register this device for push.');
      }));
    });
    try {
      await messaging.requestPermission(alert: true, badge: true, sound: true);
      await messaging.register();
      return listener;
    } catch (_) {
      await listener.cancel();
      rethrow;
    }
  }

  Future<void> _registerInstallation(String installationId) async {
    await _call('registerPushToken', {
      'installationId': installationId,
      'platform': Platform.isIOS ? 'ios' : 'android',
    });
  }

  Future<void> unregisterDeviceFromPush() async {
    if (DriveFirebaseConfig.emulator || kIsWeb) return;
    final id = _registeredInstallationId;
    if (id != null) {
      await _call('unregisterPushToken', {'installationId': id});
    }
    await FirebaseMessaging.instance.unregister();
    _registeredInstallationId = null;
  }

}
