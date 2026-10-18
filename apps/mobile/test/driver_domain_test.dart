import 'package:flutter_test/flutter_test.dart';
import 'package:drive_mobile/features/driver/domain/geohash.dart';
import 'package:drive_mobile/features/driver/domain/driver_earnings.dart';

void main() {
  test('Geohash matches standard coordinates', () {
    expect(encodeGeoHash(42.6, -5.6, precision: 5), 'ezs42');
    expect(encodeGeoHash(23.7806, 90.4074).length, 9);
    expect(() => encodeGeoHash(95, 0), throwsFormatException);
    expect(() => encodeGeoHash(double.nan, 0), throwsFormatException);
  });

  test('Gross earnings are separated into today and past 7 calendar days', () {
    final now = DateTime(2026, 10, 18, 12);
    final results = summarizeGross([
      CompletedRideAmount(
        completedAt: DateTime(2026, 10, 18, 10), amountMinor: 13250),
      CompletedRideAmount(
        completedAt: DateTime(2026, 10, 15, 13), amountMinor: 9000),
      CompletedRideAmount(
        completedAt: DateTime(2026, 10, 1, 10), amountMinor: 25000),
      CompletedRideAmount(
        completedAt: DateTime(2026, 10, 20), amountMinor: 8000),
    ], now);
    expect(results.tripCount, 3);
    expect(results.todayMinor, 13250);
    expect(results.lastSevenDaysMinor, 22250);
    expect(results.todayBdt, '132.50');
  });
}
