import 'package:google_maps_flutter/google_maps_flutter.dart';

class RidePoint {
  const RidePoint({required this.lat, required this.lng, required this.label});
  final double lat;
  final double lng;
  final String label;
  LatLng get latLng => LatLng(lat, lng);
  Map<String, dynamic> toJson() => {'lat': lat, 'lng': lng};
}

class PlaceSuggestion {
  const PlaceSuggestion({required this.placeId, required this.description});
  final String placeId;
  final String description;
  factory PlaceSuggestion.fromJson(Map<String, dynamic> value) =>
      PlaceSuggestion(
        placeId: value['placeId'] as String,
        description: value['description'] as String,
      );
}

class RideQuote {
  const RideQuote({
    required this.id, required this.vehicleType, required this.distanceMeters,
    required this.durationSeconds, required this.totalMinor,
    required this.encodedPolyline, required this.provisional,
    required this.expiresAtMs, required this.warning,
  });
  final String id;
  final String vehicleType;
  final int distanceMeters;
  final int durationSeconds;
  final int totalMinor;
  final String encodedPolyline;
  final bool provisional;
  final int expiresAtMs;
  final String? warning;

  bool get isExpired => DateTime.now().millisecondsSinceEpoch >= expiresAtMs;
  String get fareLabel => '৳${(totalMinor / 100).toStringAsFixed(2)}';
  String get tripLabel =>
      '${(distanceMeters / 1000).toStringAsFixed(1)} km · '
      '${(durationSeconds / 60).ceil()} min';

  factory RideQuote.fromJson(Map<String, dynamic> json, String vehicle) {
    final route = Map<String, dynamic>.from(json['route'] as Map);
    final fare = Map<String, dynamic>.from(json['fare'] as Map);
    return RideQuote(
      id: json['quoteId'] as String,
      vehicleType: vehicle,
      distanceMeters: (route['distanceMeters'] as num).toInt(),
      durationSeconds: (route['durationSeconds'] as num).toInt(),
      encodedPolyline: route['encodedPolyline'] as String? ?? '',
      provisional: route['provisional'] == true,
      totalMinor: (fare['totalMinor'] as num).toInt(),
      expiresAtMs: (json['expiresAtMs'] as num).toInt(),
      warning: json['warning'] as String?,
    );
  }
}

/// Decodes a Google encoded polyline at 1e-5 degree precision.
List<LatLng> decodePolyline(String encoded) {
  if (encoded.isEmpty) return [];
  var index = 0;
  var latitude = 0;
  var longitude = 0;
  final points = <LatLng>[];
  while (index < encoded.length) {
    int decodePart() {
      var result = 0;
      var shift = 0;
      int b;
      do {
        if (index >= encoded.length || shift > 30) {
          throw const FormatException('Malformed route polyline.');
        }
        b = encoded.codeUnitAt(index++) - 63;
        if (b < 0 || b > 63) {
          throw const FormatException('Invalid route character.');
        }
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      return (result & 1) == 1 ? ~(result >> 1) : result >> 1;
    }
    latitude += decodePart();
    longitude += decodePart();
    final lat = latitude / 1e5;
    final lng = longitude / 1e5;
    if (lat.abs() > 90 || lng.abs() > 180) {
      throw const FormatException('Route coordinate out of bounds.');
    }
    points.add(LatLng(lat, lng));
  }
  return points;
}
