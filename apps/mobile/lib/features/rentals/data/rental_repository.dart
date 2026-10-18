import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

class RentalRepository {
  RentalRepository({required this.firestore, required this.functions});

  final FirebaseFirestore firestore;
  final FirebaseFunctions functions;

  Stream<QuerySnapshot<Map<String, dynamic>>> availableVehicles() =>
      firestore.collection('vehicles')
          .where('approvalStatus', isEqualTo: 'approved')
          .where('rentalEnabled', isEqualTo: true)
          .orderBy('rentalRatePerHourMinor')
          .limit(100)
          .snapshots();

  Stream<QuerySnapshot<Map<String, dynamic>>> ownerVehicles(String uid) =>
      firestore.collection('vehicles')
          .where('ownerId', isEqualTo: uid)
          .limit(100)
          .snapshots();

  Stream<QuerySnapshot<Map<String, dynamic>>> renterBookings(String uid) =>
      firestore.collection('rentalBookings')
          .where('renterId', isEqualTo: uid)
          .orderBy('createdAt', descending: true)
          .limit(50)
          .snapshots();

  Stream<QuerySnapshot<Map<String, dynamic>>> ownerBookings(String uid) =>
      firestore.collection('rentalBookings')
          .where('ownerId', isEqualTo: uid)
          .orderBy('createdAt', descending: true)
          .limit(50)
          .snapshots();

  Future<Map<String, dynamic>> _call(
      String name, Map<String, dynamic> data) async {
    final result = await functions.httpsCallable(name).call(data);
    return Map<String, dynamic>.from(result.data as Map);
  }

  Future<Map<String, dynamic>> registerVehicle({
    required String model,
    required String plate,
    required String type,
    required int seatCount,
    required int rentalRatePerHourMinor,
    required String area,
  }) => _call('registerRentalVehicle', {
    'model': model,
    'plate': plate,
    'type': type,
    'seatCount': seatCount,
    'rentalRatePerHourMinor': rentalRatePerHourMinor,
    'area': area,
  });

  Future<Map<String, dynamic>> bookVehicle({
    required String vehicleId,
    required DateTime startAt,
    required DateTime endAt,
  }) => _call('createRentalBooking', {
    'vehicleId': vehicleId,
    'startAtMs': startAt.millisecondsSinceEpoch,
    'endAtMs': endAt.millisecondsSinceEpoch,
  });

  Future<void> cancelBooking(String bookingId) async {
    await _call('cancelRentalBooking', {'bookingId': bookingId});
  }
}
