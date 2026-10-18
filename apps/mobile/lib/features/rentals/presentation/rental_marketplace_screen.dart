import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/rental_booking_window.dart';

class RentalMarketplaceScreen extends ConsumerStatefulWidget {
  const RentalMarketplaceScreen({super.key, required this.uid});
  final String uid;

  @override
  ConsumerState<RentalMarketplaceScreen> createState() =>
      _RentalMarketplaceScreenState();
}

class _RentalMarketplaceScreenState
    extends ConsumerState<RentalMarketplaceScreen> {
  final areaController = TextEditingController();
  final maxRateController = TextEditingController();
  String vehicleType = 'all';
  DateTime? startAt;
  DateTime? endAt;
  String? busyVehicleId;
  String? busyBookingId;
  late final Stream<QuerySnapshot<Map<String, dynamic>>> vehicles;
  late final Stream<QuerySnapshot<Map<String, dynamic>>> bookings;

  @override
  void initState() {
    super.initState();
    final repository = ref.read(rentalRepositoryProvider);
    vehicles = repository.availableVehicles();
    bookings = repository.renterBookings(widget.uid);
  }

  @override
  void dispose() {
    areaController.dispose();
    maxRateController.dispose();
    super.dispose();
  }

  RentalBookingWindow? get window =>
      startAt != null && endAt != null
          ? RentalBookingWindow(startAt: startAt!, endAt: endAt!)
          : null;

  String formatDate(DateTime? value) => value == null
      ? '—' : value.toLocal().toString().substring(0, 16);

  Future<void> chooseWindow() async {
    final now = DateTime.now();
    final firstDate = DateTime(now.year, now.month, now.day);
    final lastDate = firstDate.add(const Duration(days: 90));
    final previousStart = startAt ?? now.add(const Duration(days: 1));
    final suggestedStart = DateTime(previousStart.year,
        previousStart.month, previousStart.day);
    final safeStartDate = suggestedStart.isBefore(firstDate)
        ? firstDate : (suggestedStart.isAfter(lastDate) ? lastDate : suggestedStart);
    final startDate = await showDatePicker(
      context: context,
      initialDate: safeStartDate,
      firstDate: firstDate,
      lastDate: lastDate,
      helpText: 'Select rental start date',
    );
    if (startDate == null || !mounted) return;
    final startTime = await showTimePicker(
      context: context,
      initialTime: startAt == null
          ? const TimeOfDay(hour: 10, minute: 0)
          : TimeOfDay.fromDateTime(startAt!),
      helpText: 'Select rental start time',
    );
    if (startTime == null || !mounted) return;
    final start = DateTime(startDate.year, startDate.month, startDate.day,
        startTime.hour, startTime.minute);
    final previousEnd = endAt ?? start.add(const Duration(hours: 2));
    final proposedEndDate = DateTime(previousEnd.year,
        previousEnd.month, previousEnd.day);
    final safeEndDate = proposedEndDate.isBefore(startDate)
        ? startDate : (proposedEndDate.isAfter(lastDate) ? lastDate : proposedEndDate);
    final endDate = await showDatePicker(
      context: context,
      initialDate: safeEndDate,
      firstDate: DateTime(startDate.year, startDate.month, startDate.day),
      lastDate: lastDate,
      helpText: 'Select rental end date',
    );
    if (endDate == null || !mounted) return;
    final endTime = await showTimePicker(
      context: context,
      initialTime: endAt == null
          ? TimeOfDay.fromDateTime(start.add(const Duration(hours: 2)))
          : TimeOfDay.fromDateTime(endAt!),
      helpText: 'Select rental end time',
    );
    if (endTime == null || !mounted) return;
    final end = DateTime(endDate.year, endDate.month, endDate.day,
        endTime.hour, endTime.minute);
    final proposed = RentalBookingWindow(startAt: start, endAt: end);
    final error = proposed.validationError(now: DateTime.now());
    if (error != null) {
      showDriveMessage(context, error);
      return;
    }
    setState(() { startAt = start; endAt = end; });
  }

  Future<void> book(Map<String, dynamic> vehicle, String vehicleId) async {
    final selected = window;
    if (selected == null) {
      showDriveMessage(context, AppLocalizations.of(context).rentalWindowNotSelected);
      return;
    }
    final rate = (vehicle['rentalRatePerHourMinor'] as num?)?.toInt() ?? 0;
    final total = selected.totalMinor(rate);
    final t = AppLocalizations.of(context);
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(t.rentalConfirm),
        content: Text(
          '${t.rentalStart}: ${formatDate(selected.startAt)}\n'
          '${t.rentalEnd}: ${formatDate(selected.endAt)}\n'
          '${t.rentalTotal}: ৳${(total / 100).toStringAsFixed(2)}\n\n'
          'The server checks availability again before confirming.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(t.back)),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(t.rentalConfirm)),
        ],
      ),
    );
    if (accepted != true || !mounted) return;
    setState(() => busyVehicleId = vehicleId);
    try {
      final result = await ref.read(rentalRepositoryProvider).bookVehicle(
        vehicleId: vehicleId, startAt: selected.startAt, endAt: selected.endAt,
      );
      if (mounted) {
        final confirmedTotal = (result['totalMinor'] as num?)?.toInt() ?? total;
        showDriveMessage(context,
          '${t.rentalConfirmed} ${t.rentalTotal}: '
          '৳${(confirmedTotal / 100).toStringAsFixed(2)}');
      }
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => busyVehicleId = null);
    }
  }

  Future<void> cancel(String bookingId) async {
    final t = AppLocalizations.of(context);
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(t.rentalCancelBooking),
        content: Text(t.rentalCancelConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(t.back)),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(t.rentalCancelBooking)),
        ],
      ),
    );
    if (accepted != true || !mounted) return;
    setState(() => busyBookingId = bookingId);
    try {
      await ref.read(rentalRepositoryProvider).cancelBooking(bookingId);
      if (mounted) showDriveMessage(context, t.rentalCancelled);
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => busyBookingId = null);
    }
  }

  List<QueryDocumentSnapshot<Map<String, dynamic>>> filterVehicles(
      List<QueryDocumentSnapshot<Map<String, dynamic>>> docs) {
    final area = areaController.text.trim().toLowerCase();
    final maxRateText = maxRateController.text.trim();
    final maxRate = maxRateText.isEmpty ? null : double.tryParse(maxRateText);
    final maxMinor = maxRate == null ? null : (maxRate * 100).round();
    return docs.where((doc) {
      final data = doc.data();
      if (vehicleType != 'all' && data['type'] != vehicleType) { return false; }
      if (area.isNotEmpty &&
          !(data['area']?.toString().toLowerCase().contains(area) ?? false)) {
        return false;
      }
      final rate = (data['rentalRatePerHourMinor'] as num?)?.toInt() ?? 0;
      if (maxMinor != null && rate > maxMinor) { return false; }
      return true;
    }).toList();
  }

  Widget vehicleCard(Map<String, dynamic> data, String id) {
    final t = AppLocalizations.of(context);
    final rate = (data['rentalRatePerHourMinor'] as num?)?.toInt() ?? 0;
    final ownVehicle = data['ownerId']?.toString() == widget.uid;
    final selectedWindow = window;
    final estimated = selectedWindow?.totalMinor(rate);
    final type = data['type']?.toString() ?? '';
    final typeLabel = type == 'bike' ? t.bike : type == 'premium' ? t.premium : t.car;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            CircleAvatar(child: Icon(type == 'bike'
                ? Icons.two_wheeler : Icons.directions_car_outlined)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(data['model']?.toString() ?? 'Vehicle',
                  style: Theme.of(context).textTheme.titleMedium),
                Text('$typeLabel · ${data['seatCount'] ?? 4} ${t.rentalSeats}'),
                Text(data['area']?.toString() ?? '',
                  style: Theme.of(context).textTheme.bodyMedium),
              ],
            )),
            Text('৳${(rate / 100).toStringAsFixed(2)}\n/ hour',
              textAlign: TextAlign.end,
              style: Theme.of(context).textTheme.titleSmall),
          ]),
          const SizedBox(height: 12),
          if (ownVehicle)
            Text(t.rentalOwnVehicle,
              style: TextStyle(color: Theme.of(context).colorScheme.error))
          else
            SizedBox(width: double.infinity,
              child: FilledButton.icon(
                onPressed: busyVehicleId == id || selectedWindow == null
                    ? null : () => book(data, id),
                icon: Icon(busyVehicleId == id
                    ? Icons.hourglass_empty : Icons.calendar_month_outlined),
                label: Text(selectedWindow == null
                    ? t.rentalChooseWindow
                    : '${t.rentalBookVehicle}${estimated == null ? '' : ' · ৳${(estimated / 100).toStringAsFixed(2)}'}'),
              )),
        ]),
      ),
    );
  }

  Widget bookingCard(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final t = AppLocalizations.of(context);
    final data = doc.data();
    final start = data['startAt'] is Timestamp
        ? (data['startAt'] as Timestamp).toDate() : null;
    final end = data['endAt'] is Timestamp
        ? (data['endAt'] as Timestamp).toDate() : null;
    final total = (data['totalMinor'] as num?)?.toInt() ?? 0;
    final status = data['status']?.toString() ?? 'unknown';
    final canCancel = status == 'confirmed' &&
        start != null && start.isAfter(DateTime.now());
    return Card(child: Padding(padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${t.rentalBookingId}: ${doc.id}',
          style: Theme.of(context).textTheme.titleSmall),
        Text('${t.rentalStart}: ${formatDate(start)}'),
        Text('${t.rentalEnd}: ${formatDate(end)}'),
        Text('${t.rentalTotal}: ৳${(total / 100).toStringAsFixed(2)}'),
        Text('${t.rentalStatus}: $status'),
        if (canCancel)
          Align(alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: busyBookingId == doc.id ? null : () => cancel(doc.id),
              icon: const Icon(Icons.cancel_outlined),
              label: Text(t.rentalCancelBooking),
            )),
      ]),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.rentalMarketplace)),
      body: SafeArea(child: ListView(padding: const EdgeInsets.all(16),
        children: [
          Card(child: Padding(padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(t.rentalMarketplaceSubtitle),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: vehicleType,
                  decoration: InputDecoration(labelText: t.vehicleType),
                  items: [
                    DropdownMenuItem(value: 'all', child: Text(t.rentalAllTypes)),
                    DropdownMenuItem(value: 'bike', child: Text(t.bike)),
                    DropdownMenuItem(value: 'car', child: Text(t.car)),
                    DropdownMenuItem(value: 'premium', child: Text(t.premium)),
                  ],
                  onChanged: (value) => setState(() => vehicleType = value ?? 'all'),
                ),
                const SizedBox(height: 10),
                TextField(controller: areaController,
                  decoration: InputDecoration(
                    labelText: t.rentalSearchArea,
                    prefixIcon: const Icon(Icons.location_on_outlined),
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 10),
                TextField(controller: maxRateController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: t.rentalMaxHourlyPrice,
                    prefixIcon: const Icon(Icons.payments_outlined),
                    helperText: 'BDT per hour; leave blank for no limit.',
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: chooseWindow,
                  icon: const Icon(Icons.date_range_outlined),
                  label: Text(window == null
                      ? t.rentalChooseWindow
                      : '${formatDate(startAt)} → ${formatDate(endAt)}'),
                ),
                if (window != null)
                  Text('Duration: ${window!.roundedHours} hour(s). '
                    'The backend rechecks availability.'),
              ],
            ),
          )),
          const SizedBox(height: 18),
          Text(t.rentalAvailableVehicles,
            style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          if (maxRateController.text.trim().isNotEmpty &&
              double.tryParse(maxRateController.text.trim()) == null)
            Text(t.rentalRateError,
              style: TextStyle(color: Theme.of(context).colorScheme.error)),
          StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: vehicles,
            builder: (context, snapshot) {
              if (snapshot.hasError) { return Text(snapshot.error.toString()); }
              if (!snapshot.hasData) { return const Center(
                child: Padding(padding: EdgeInsets.all(20),
                  child: CircularProgressIndicator()),
              ); }
              final found = filterVehicles(snapshot.data!.docs);
              if (found.isEmpty) {
                return Padding(
                  padding: const EdgeInsets.all(20),
                  child: Text(t.rentalNoVehicles),
                );
              }
              return Column(children: [
                for (final doc in found) vehicleCard(doc.data(), doc.id),
              ]);
            },
          ),
          const SizedBox(height: 20),
          Text(t.rentalMyBookings,
            style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: bookings,
            builder: (context, snapshot) {
              if (snapshot.hasError) { return Text(snapshot.error.toString()); }
              if (!snapshot.hasData) return const LinearProgressIndicator();
              if (snapshot.data!.docs.isEmpty) { return Text(t.rentalNoBookings); }
              return Column(children: [
                for (final doc in snapshot.data!.docs) bookingCard(doc),
              ]);
            },
          ),
        ],
      )),
    );
  }
}
