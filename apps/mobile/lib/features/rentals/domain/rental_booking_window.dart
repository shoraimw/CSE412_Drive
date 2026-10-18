class RentalBookingWindow {
  const RentalBookingWindow({required this.startAt, required this.endAt});

  final DateTime startAt;
  final DateTime endAt;

  static const maxDuration = Duration(hours: 72);
  static const minLeadTime = Duration(minutes: 1);
  static const maxAdvance = Duration(days: 90);

  int get roundedHours {
    const hourMilliseconds = 3600000;
    final milliseconds = endAt.millisecondsSinceEpoch -
        startAt.millisecondsSinceEpoch;
    if (milliseconds <= 0) return 0;
    return (milliseconds + hourMilliseconds - 1) ~/ hourMilliseconds;
  }

  int totalMinor(int hourlyRateMinor) {
    if (hourlyRateMinor < 100 || hourlyRateMinor > 5000000) {
      throw ArgumentError.value(hourlyRateMinor, 'hourlyRateMinor');
    }
    return hourlyRateMinor * roundedHours;
  }

  String? validationError({required DateTime now}) {
    if (startAt.isBefore(now.add(minLeadTime))) {
      return 'Choose a start time at least one minute in the future.';
    }
    if (!startAt.isBefore(now.add(maxAdvance))) {
      return 'Rental start must be within the next 90 days.';
    }
    if (!endAt.isAfter(startAt)) {
      return 'Rental end must be after its start.';
    }
    if (endAt.difference(startAt) > maxDuration) {
      return 'A rental can last at most 72 hours.';
    }
    return null;
  }
}
