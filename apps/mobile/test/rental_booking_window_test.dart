import 'package:flutter_test/flutter_test.dart';
import 'package:drive_mobile/features/rentals/domain/rental_booking_window.dart';

void main() {
  final now = DateTime.utc(2026, 10, 18, 10);

  test('rounds a partial rental hour up for price estimation', () {
    final window = RentalBookingWindow(
      startAt: now.add(const Duration(hours: 2)),
      endAt: now.add(const Duration(hours: 3, minutes: 1)),
    );
    expect(window.roundedHours, 2);
    expect(window.totalMinor(15000), 30000);
    expect(window.validationError(now: now), isNull);
  });

  test('rejects rental starts too close to now', () {
    final window = RentalBookingWindow(
      startAt: now.add(const Duration(seconds: 30)),
      endAt: now.add(const Duration(hours: 1)),
    );
    expect(window.validationError(now: now), isNotNull);
  });

  test('rejects end time before or equal to start', () {
    final window = RentalBookingWindow(
      startAt: now.add(const Duration(hours: 3)),
      endAt: now.add(const Duration(hours: 3)),
    );
    expect(window.validationError(now: now), contains('after'));
  });

  test('rejects rentals over 72 hours', () {
    final window = RentalBookingWindow(
      startAt: now.add(const Duration(hours: 2)),
      endAt: now.add(const Duration(hours: 75)),
    );
    expect(window.validationError(now: now), contains('72 hours'));
  });

  test('rejects starts outside the 90-day booking window', () {
    final window = RentalBookingWindow(
      startAt: now.add(const Duration(days: 90)),
      endAt: now.add(const Duration(days: 90, hours: 1)),
    );
    expect(window.validationError(now: now), contains('90 days'));
  });
}
