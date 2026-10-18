import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_database/firebase_database.dart';

import '../domain/route_models.dart';

class RiderRepository {
  RiderRepository({
    required FirebaseFunctions functions,
    required FirebaseFirestore firestore,
    required FirebaseDatabase database,
  }) : _functions = functions, _firestore = firestore, _database = database;

  final FirebaseFunctions _functions;
  final FirebaseFirestore _firestore;
  final FirebaseDatabase _database;

  Future<Map<String, dynamic>> _call(
      String name, Map<String, dynamic> input) async {
    final result = await _functions.httpsCallable(name).call(input);
    return Map<String, dynamic>.from(result.data as Map);
  }

  Future<List<PlaceSuggestion>> findPlaces(
      String query, String token) async {
    final value = await _call('autocompletePlaces', {
      'query': query, 'sessionToken': token,
    });
    return (value['predictions'] as List<dynamic>? ?? [])
        .map((item) => PlaceSuggestion.fromJson(
              Map<String, dynamic>.from(item as Map),
            ))
        .toList();
  }

  Future<RidePoint> resolvePlace(
      PlaceSuggestion suggestion, String token) async {
    final value = await _call('resolvePlace', {
      'placeId': suggestion.placeId, 'sessionToken': token,
    });
    return RidePoint(
      lat: (value['lat'] as num).toDouble(),
      lng: (value['lng'] as num).toDouble(),
      label: value['label'] as String,
    );
  }

  Future<RideQuote> getFareQuote(
      RidePoint pickup, RidePoint destination, String vehicleType) async {
    final value = await _call('getFareQuote', {
      'pickup': pickup.toJson(),
      'destination': destination.toJson(),
      'vehicleType': vehicleType,
    });
    return RideQuote.fromJson(value, vehicleType);
  }

  Future<String> requestRide(RideQuote quote, String idempotencyKey) async {
    if (quote.isExpired) throw StateError('Your fare quote has expired.');
    final result = await _call('requestRide', {
      'quoteId': quote.id, 'idempotencyKey': idempotencyKey,
    });
    return result['rideId'] as String;
  }

  Future<Map<String, dynamic>> dispatch(String rideId) =>
      _call('dispatchNearbyDrivers', {'rideId': rideId});

  Future<void> cancel(String rideId) async {
    await _call('cancelRide', {'rideId': rideId});
  }

  Future<void> finalizeUnmatched(String rideId) async {
    await _call('finalizeUnmatchedRide', {'rideId': rideId});
  }

  Stream<List<QueryDocumentSnapshot<Map<String, dynamic>>>> ridesFor(String uid) =>
      _firestore.collection('rides')
          .where('riderId', isEqualTo: uid)
          .orderBy('createdAt', descending: true)
          .limit(12)
          .snapshots()
          .map((snap) => snap.docs);

  Stream<Map<String, dynamic>?> watchTrip(String rideId) =>
      _firestore.collection('rides').doc(rideId).snapshots()
          .map((snap) => snap.data());

  Stream<Map<String, dynamic>?> watchTripLocation(String rideId) =>
      _database.ref('tripLocations/$rideId').onValue.map((event) {
        final value = event.snapshot.value;
        return value is Map
            ? Map<String, dynamic>.from(value)
            : null;
      });
}
