import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

import '../domain/geohash.dart';

class DriverRepository {
  DriverRepository({
    required this.functions,
    required this.firestore,
    required this.database,
  });

  final FirebaseFunctions functions;
  final FirebaseFirestore firestore;
  final FirebaseDatabase database;

  Future<void> setAvailability(bool online) async {
    await functions.httpsCallable('setDriverAvailability')
        .call({'online': online});
  }

  Stream<List<QueryDocumentSnapshot<Map<String, dynamic>>>> offers(String uid) =>
      firestore.collection('driverOffers')
          .where('driverId', isEqualTo: uid)
          .orderBy('createdAt', descending: true)
          .limit(40)
          .snapshots().map((event) => event.docs);

  Stream<List<QueryDocumentSnapshot<Map<String, dynamic>>>> rides(String uid) =>
      firestore.collection('rides')
          .where('driverId', isEqualTo: uid)
          .orderBy('createdAt', descending: true)
          .limit(100)
          .snapshots().map((event) => event.docs);

  Future<String> respond(String offerId, {required bool accept}) async {
    final result = await functions.httpsCallable('respondToOffer')
        .call({'offerId': offerId, 'accept': accept});
    return Map<String, dynamic>.from(result.data as Map)['status'] as String;
  }

  Future<void> advance(String rideId, String status) async {
    await functions.httpsCallable('advanceRide')
        .call({'rideId': rideId, 'toStatus': status});
  }

  Future<void> cancelRide(String rideId) async {
    await functions.httpsCallable('cancelRide').call({'rideId': rideId});
  }

  Future<void> preparePresence(String uid) async {
    await database.ref('driverLocations/$uid').onDisconnect().remove();
  }

  Future<void> stopPresence(String uid) =>
      database.ref('driverLocations/$uid').remove();

  Future<void> publish(Position position, String uid, String? activeRideId) async {
    if (!position.latitude.isFinite || !position.longitude.isFinite ||
        !position.accuracy.isFinite || position.accuracy < 0 ||
        position.accuracy > 1000) {
      throw StateError('GPS accuracy is outside supported limits.');
    }
    final lat = position.latitude;
    final lng = position.longitude;
    if (lat.abs() > 90 || lng.abs() > 180) {
      throw StateError('GPS coordinate is not valid.');
    }
    final heading = position.heading.isFinite
        ? position.heading.clamp(0.0, 360.0).toDouble() : 0.0;
    final speed = position.speed.isFinite
        ? position.speed.clamp(0.0, 120.0).toDouble() : 0.0;
    final candidate = <String, Object>{
      'lat': lat,
      'lng': lng,
      'geohash': encodeGeoHash(lat, lng),
      'heading': heading,
      'accuracy': position.accuracy,
      'speed': speed,
      'updatedAt': ServerValue.timestamp,
    };
    await database.ref('driverLocations/$uid').set(candidate);
    if (activeRideId != null) {
      await database.ref('tripLocations/$activeRideId').set({
        'lat': lat,
        'lng': lng,
        'heading': heading,
        'updatedAt': ServerValue.timestamp,
      });
    }
  }

  Future<StreamSubscription<Position>> beginTracking({
    required String uid,
    required String? Function() activeRideId,
    required void Function(Object error) onError,
    required void Function(Position position) onPosition,
  }) async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw StateError('Enable device location services to go online.');
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw StateError('Foreground location permission is needed for live trips.');
    }
    await preparePresence(uid);
    final stream = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 20,
      ),
    );
    return stream.listen((position) {
      onPosition(position);
      unawaited(publish(position, uid, activeRideId()).catchError((Object e) {
        onError(e);
      }));
    }, onError: (Object error) => onError(error));
  }

  /// Handoff to Maps navigation. Never reveal another rider's private route.
  Future<void> navigateTo(double lat, double lng) async {
    if (!lat.isFinite || !lng.isFinite || lat.abs() > 90 || lng.abs() > 180) {
      throw const FormatException('Invalid navigation destination.');
    }
    final uri = Uri.https('www.google.com', '/maps/dir/', {
      'api': '1',
      'destination': '$lat,$lng',
      'travelmode': 'driving',
      'dir_action': 'navigate',
    });
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      throw StateError('No navigation application was available.');
    }
  }
}
