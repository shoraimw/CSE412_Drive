import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/providers.dart';
import '../../../core/widgets/drive_widgets.dart';

class TripCheckoutScreen extends ConsumerStatefulWidget {
  const TripCheckoutScreen({super.key, required this.rideId});
  final String rideId;
  @override
  ConsumerState<TripCheckoutScreen> createState() => _CheckoutState();
}
class _CheckoutState extends ConsumerState<TripCheckoutScreen> {
  bool busy = false;
  int stars = 5;
  final comment = TextEditingController();
  late final Stream<DocumentSnapshot<Map<String, dynamic>>> rideStream;
  late final Stream<DocumentSnapshot<Map<String, dynamic>>> paymentStream;
  late final Stream<DocumentSnapshot<Map<String, dynamic>>> ratingStream;

  @override
  void initState() {
    super.initState();
    final service = ref.read(tripServicesRepositoryProvider);
    final uid = ref.read(firebaseAuthProvider).currentUser?.uid ?? '';
    rideStream = ref.read(firestoreProvider)
        .collection('rides').doc(widget.rideId).snapshots();
    paymentStream = service.payment(widget.rideId);
    ratingStream = service.myRating(widget.rideId, uid);
  }
  @override
  void dispose() {comment.dispose(); super.dispose();}

  Future<void> action(Future<void> Function() work, String success) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await work();
      if (mounted) showDriveMessage(context, success);
    } catch (e) {
      if (mounted) showDriveError(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = ref.watch(firebaseAuthProvider).currentUser?.uid;
    final services = ref.read(tripServicesRepositoryProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Payment and rating')),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: rideStream,
        builder: (context, trip) {
          if (trip.hasError) {
            return DriveErrorView(
              message: trip.error.toString(),
              onRetry: () => setState(() {}), retryLabel: 'Retry');
          }
          if (!trip.hasData) {
            return const DriveLoading();
          }
          final ride = trip.data!.data();
          if (ride == null) return const Center(child: Text('Ride not found.'));
          if (ride['status'] != 'completed') {
            return const Center(child: Text('Checkout opens after trip completion.'));
          }
          final rider = uid == ride['riderId'];
          final driver = uid == ride['driverId'];
          if (!rider && !driver) {
            return const Center(child: Text('Not a trip participant.'));
          }
          final fare = ride['finalFare'] ?? ride['fare'];
          final minor = fare is Map ? fare['totalMinor'] as num? : null;
          return ListView(padding: const EdgeInsets.all(18), children: [
            Text('Trip summary', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Card(child: Padding(padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SelectableText('Trip: ${widget.rideId}'),
                  const SizedBox(height: 10),
                  Text(minor == null ? 'Fare unavailable'
                      : '৳${(minor / 100).toStringAsFixed(2)}',
                    style: Theme.of(context).textTheme.headlineMedium),
                  Text('Currency: ${ride['currency'] ?? 'BDT'}'),
                  if (ride['finalFareIsProvisional'] == true)
                    const Text('Fare was based on a provisional route estimate.'),
                  const SizedBox(height: 6),
                  const Text('Not a tax invoice or proof of payment.'),
                ]),
            )),
            const SizedBox(height: 14),
            StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
              stream: paymentStream,
              builder: (context, snapshot) {
                if (snapshot.hasError) return Text(snapshot.error.toString());
                if (!snapshot.hasData) return const LinearProgressIndicator();
                final payment = snapshot.data!.data();
                final status = payment?['status']?.toString();
                return Card(child: Padding(padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('Payment', style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 8),
                      Text('Method: ${payment?['method'] ?? 'not selected'}'),
                      Text('Status: ${status ?? 'not initiated'}'),
                      if (status == 'cash_reported_received')
                        const Text('Driver-reported cash, not externally reconciled.'),
                      if (status == 'paid_test')
                        const Text('Signed Stripe TEST webhook confirmed. '
                          'No live funds were charged.'),
                      if (rider && payment == null) ...[
                        const SizedBox(height: 12),
                        FilledButton(onPressed: busy ? null : () => action(
                          () => services.chooseCash(widget.rideId),
                          'Cash selected; pay the driver directly.'),
                          child: const Text('Choose cash')),
                        OutlinedButton(
                          onPressed: busy ? null : () => action(
                              () => services.openStripeTestCheckout(widget.rideId),
                              'Stripe TEST checkout opened. Return here to check the signed webhook result.'),
                          child: const Text('Open Stripe TEST checkout'),
                        ),
                      ],
                      if (rider && payment?['method'] == 'stripe_test' &&
                          ['initializing', 'checkout_open',
                            'payment_failed'].contains(status))
                        OutlinedButton(
                          onPressed: busy ? null : () => action(
                                () => services.openStripeTestCheckout(widget.rideId),
                                'Stripe TEST checkout opened. Payment status updates after webhook.'),
                          child: const Text('Continue Stripe TEST payment'),
                        ),
                      if (driver && status == 'cash_due')
                        FilledButton(
                          onPressed: busy ? null : () => action(
                            () => services.reportCashReceived(widget.rideId),
                            'Cash reported, not independently verified.'),
                          child: const Text('Report cash received'),
                        ),
                    ]),
                ));
              },
            ),
            const SizedBox(height: 14),
            StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
              stream: ratingStream,
              builder: (context, snapshot) {
                if (snapshot.hasError) return Text(snapshot.error.toString());
                if (!snapshot.hasData) return const LinearProgressIndicator();
                if (snapshot.data!.exists) {
                  final data = snapshot.data!.data()!;
                  return Card(child: ListTile(
                    leading: const Icon(Icons.star),
                    title: const Text('You already reviewed this trip'),
                    subtitle: Text('${data['stars']} of 5 stars'),
                  ));
                }
                return Card(child: Padding(padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(rider ? 'Rate your driver' : 'Rate your rider',
                        style: Theme.of(context).textTheme.titleLarge),
                      Wrap(children: [
                        for (var i = 1; i <= 5; i++)
                          IconButton(
                            tooltip: '$i stars',
                            onPressed: busy ? null : () => setState(() => stars = i),
                            icon: Icon(i <= stars ? Icons.star : Icons.star_border),
                          ),
                      ]),
                      TextField(controller: comment, maxLines: 3, maxLength: 500,
                        decoration: const InputDecoration(
                          labelText: 'Review (optional)')),
                      FilledButton(
                        onPressed: busy ? null : () => action(
                          () => services.rateRide(widget.rideId, stars, comment.text),
                          'Rating saved.'),
                        child: const Text('Submit rating'),
                      ),
                    ]),
                ));
              },
            ),
          ]);
        },
      ),
    );
  }
}
