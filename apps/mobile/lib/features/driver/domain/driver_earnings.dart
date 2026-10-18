/// Displays completed trip *gross quoted amounts*, not settled payouts.
/// A real earnings ledger with commissions/refunds arrives in Phase 6.
class CompletedRideAmount {
  const CompletedRideAmount({required this.completedAt, required this.amountMinor});
  final DateTime completedAt;
  final int amountMinor;
}

class DriverGrossSummary {
  const DriverGrossSummary({
    required this.todayMinor, required this.lastSevenDaysMinor,
    required this.tripCount,
  });

  final int todayMinor;
  final int lastSevenDaysMinor;
  final int tripCount;

  String get todayBdt => (todayMinor / 100).toStringAsFixed(2);
  String get sevenDaysBdt => (lastSevenDaysMinor / 100).toStringAsFixed(2);
}

DriverGrossSummary summarizeGross(
  Iterable<CompletedRideAmount> rides, DateTime now,
) {
  final local = now.toLocal();
  final today = DateTime(local.year, local.month, local.day);
  final startOfWindow = today.subtract(const Duration(days: 6));
  var todayMinor = 0;
  var sevenDaysMinor = 0;
  var count = 0;
  for (final item in rides) {
    final date = item.completedAt.toLocal();
    if (item.amountMinor < 0 || date.isAfter(local)) continue;
    count++;
    if (!date.isBefore(today)) todayMinor += item.amountMinor;
    if (!date.isBefore(startOfWindow)) sevenDaysMinor += item.amountMinor;
  }
  return DriverGrossSummary(
    todayMinor: todayMinor,
    lastSevenDaysMinor: sevenDaysMinor,
    tripCount: count,
  );
}
