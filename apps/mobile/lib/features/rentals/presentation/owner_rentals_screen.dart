import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../../../l10n/app_localizations.dart';
import '../data/rental_repository.dart';

class OwnerRentalsScreen extends ConsumerStatefulWidget {
  const OwnerRentalsScreen({super.key, required this.uid});
  final String uid;
  @override
  ConsumerState<OwnerRentalsScreen> createState() => _OwnerRentalsScreenState();
}

class _OwnerRentalsScreenState extends ConsumerState<OwnerRentalsScreen> {
  String? busyBookingId;
  late final Stream<QuerySnapshot<Map<String, dynamic>>> vehicles;
  late final Stream<QuerySnapshot<Map<String, dynamic>>> bookings;

  @override
  void initState() {
    super.initState();
    final repository = ref.read(rentalRepositoryProvider);
    vehicles = repository.ownerVehicles(widget.uid);
    bookings = repository.ownerBookings(widget.uid);
  }

  String formatDate(dynamic value) {
    if (value is Timestamp) {
      return value.toDate().toLocal().toString().substring(0, 16);
    }
    return '—';
  }

  Future<void> addVehicle() async {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => const RegisterRentalVehicleScreen(),
    ));
  }

  Future<void> cancelBooking(String bookingId) async {
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

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.ownerCenter)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: addVehicle,
        icon: const Icon(Icons.add),
        label: Text(t.rentalAddVehicle),
      ),
      body: SafeArea(child: ListView(padding: const EdgeInsets.all(16),
        children: [
          DriveHeader(title: t.ownerCenter, subtitle: t.ownerReady),
          const SizedBox(height: 18),
          Text(t.rentalMyVehicles,
            style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: vehicles,
            builder: (context, snapshot) {
              if (snapshot.hasError) return Text(snapshot.error.toString());
              if (!snapshot.hasData) return const LinearProgressIndicator();
              if (snapshot.data!.docs.isEmpty) return Text(t.ownerNext);
              return Column(children: [
                for (final doc in snapshot.data!.docs)
                  Card(child: ListTile(
                    leading: Icon(doc.data()['type'] == 'bike'
                        ? Icons.two_wheeler : Icons.directions_car_outlined),
                    title: Text(doc.data()['model']?.toString() ?? doc.id),
                    subtitle: Text(
                      '${doc.data()['approvalStatus'] ?? t.pending} · '
                      '৳${(((doc.data()['rentalRatePerHourMinor'] as num?)?.toInt() ?? 0) / 100).toStringAsFixed(2)}/hr · '
                      '${doc.data()['area'] ?? ''}',
                    ),
                  )),
              ]);
            },
          ),
          const SizedBox(height: 22),
          Text(t.rentalOwnerBookings,
            style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: bookings,
            builder: (context, snapshot) {
              if (snapshot.hasError) return Text(snapshot.error.toString());
              if (!snapshot.hasData) return const LinearProgressIndicator();
              if (snapshot.data!.docs.isEmpty) return Text(t.rentalNoBookings);
              return Column(children: [
                for (final doc in snapshot.data!.docs)
                  _ownerBookingCard(doc, t),
              ]);
            },
          ),
        ],
      )),
    );
  }

  Widget _ownerBookingCard(
      QueryDocumentSnapshot<Map<String, dynamic>> doc, AppLocalizations t) {
    final data = doc.data();
    final start = data['startAt'] is Timestamp
        ? (data['startAt'] as Timestamp).toDate() : null;
    final total = (data['totalMinor'] as num?)?.toInt() ?? 0;
    final status = data['status']?.toString() ?? 'unknown';
    final renterId = data['renterId']?.toString() ?? '';
    final renterShort = renterId.substring(0,
        renterId.length < 8 ? renterId.length : 8);
    final canCancel = status == 'confirmed' &&
        start != null && start.isAfter(DateTime.now());
    return Card(child: Padding(padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${t.rentalBookingId}: ${doc.id}',
          style: Theme.of(context).textTheme.titleSmall),
        Text('Renter: $renterShort'),
        Text('${t.rentalStart}: ${formatDate(data['startAt'])}'),
        Text('${t.rentalEnd}: ${formatDate(data['endAt'])}'),
        Text('${t.rentalTotal}: ৳${(total / 100).toStringAsFixed(2)}'),
        Text('${t.rentalStatus}: $status'),
        if (canCancel)
          Align(alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: busyBookingId == doc.id
                  ? null : () => cancelBooking(doc.id),
              icon: const Icon(Icons.cancel_outlined),
              label: Text(t.rentalCancelBooking),
            )),
      ]),
    ));
  }
}

class RegisterRentalVehicleScreen extends ConsumerStatefulWidget {
  const RegisterRentalVehicleScreen({super.key});
  @override
  ConsumerState<RegisterRentalVehicleScreen> createState() =>
      _RegisterRentalVehicleScreenState();
}

class _RegisterRentalVehicleScreenState
    extends ConsumerState<RegisterRentalVehicleScreen> {
  final model = TextEditingController();
  final plate = TextEditingController();
  final seats = TextEditingController(text: '4');
  final rate = TextEditingController();
  final area = TextEditingController();
  String type = 'car';
  bool busy = false;

  @override
  void dispose() {
    model.dispose(); plate.dispose(); seats.dispose();
    rate.dispose(); area.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    final t = AppLocalizations.of(context);
    final seatCount = int.tryParse(seats.text.trim());
    final rateTaka = double.tryParse(rate.text.trim());
    if (model.text.trim().length < 2 || plate.text.trim().length < 4 ||
        area.text.trim().length < 2 || seatCount == null ||
        seatCount < 1 || seatCount > 12 || rateTaka == null ||
        !rateTaka.isFinite || rateTaka < 1 || rateTaka > 50000) {
      showDriveMessage(context, t.rentalRequired);
      return;
    }
    if (busy) return;
    setState(() => busy = true);
    try {
      await ref.read(rentalRepositoryProvider).registerVehicle(
        model: model.text.trim(),
        plate: plate.text.trim(),
        type: type,
        seatCount: seatCount,
        rentalRatePerHourMinor: (rateTaka * 100).round(),
        area: area.text.trim(),
      );
      if (mounted) {
        showDriveMessage(context, t.rentalListingSubmitted);
        Navigator.of(context).pop();
      }
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.rentalAddVehicle)),
      body: SafeArea(child: ListView(padding: const EdgeInsets.all(22),
        children: [
          Text(t.rentalPendingApproval),
          const SizedBox(height: 18),
          TextField(controller: model, maxLength: 100,
            decoration: InputDecoration(labelText: t.rentalModel)),
          TextField(controller: plate, maxLength: 32,
            decoration: InputDecoration(labelText: t.rentalPlate)),
          DropdownButtonFormField<String>(
            initialValue: type,
            decoration: InputDecoration(labelText: t.rentalVehicleType),
            items: [
              DropdownMenuItem(value: 'bike', child: Text(t.bike)),
              DropdownMenuItem(value: 'car', child: Text(t.car)),
              DropdownMenuItem(value: 'premium', child: Text(t.premium)),
            ],
            onChanged: (value) => setState(() => type = value ?? 'car'),
          ),
          TextField(controller: seats,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: t.rentalSeatCount)),
          TextField(controller: rate,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: t.rentalHourlyRateInput)),
          TextField(controller: area, maxLength: 100,
            decoration: InputDecoration(labelText: t.rentalArea)),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: busy ? null : submit,
            icon: Icon(busy ? Icons.hourglass_empty : Icons.upload_outlined),
            label: Text(busy ? t.loading : t.submit),
          ),
        ],
      )),
    );
  }
}
