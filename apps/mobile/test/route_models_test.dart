import 'package:flutter_test/flutter_test.dart';
import 'package:drive_mobile/features/rider/domain/route_models.dart';

void main() {
  group('Google polyline route decoding', () {
    test('decodes standard 3-point example in order', () {
      final points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
      expect(points.length, 3);
      expect(points[0].latitude, closeTo(38.5, 0.00001));
      expect(points[0].longitude, closeTo(-120.2, 0.00001));
      expect(points[2].latitude, closeTo(43.252, 0.00001));
      expect(points[2].longitude, closeTo(-126.453, 0.00001));
    });
    test('rejects malformed input and empty routes', () {
      expect(decodePolyline(''), isEmpty);
      expect(() => decodePolyline('?'), throwsFormatException);
    });
  });
  group('Fare quote type conversion and validation', () {
    const payload = {
      'quoteId': 'quote-123456',
      'expiresAtMs': 1800000000000,
      'warning': 'Demo quote only.',
      'route': {
        'distanceMeters': 7540,
        'durationSeconds': 950,
        'encodedPolyline': '',
        'provisional': true,
      },
      'fare': {'totalMinor': 24500},
    };
    test('converts BDT minor units to labelled fare', () {
      final quote = RideQuote.fromJson(payload, 'car');
      expect(quote.fareLabel, '৳245.00');
      expect(quote.tripLabel, '7.5 km · 16 min');
      expect(quote.provisional, true);
      expect(quote.vehicleType, 'car');
    });
    test('does not treat an expired quote as payable', () {
      final quote = RideQuote.fromJson({
        ...payload,
        'expiresAtMs': 1,
      }, 'bike');
      expect(quote.isExpired, true);
    });
  });
}
