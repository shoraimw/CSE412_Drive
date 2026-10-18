import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../../core/providers.dart';
import '../../../core/theme/drive_theme.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../../../l10n/app_localizations.dart';
import '../data/driver_repository.dart';
import '../domain/driver_earnings.dart';

final driverRepositoryProvider = Provider<DriverRepository>((ref) {
  return DriverRepository(
    functions: ref.watch(functionsProvider),
    firestore: ref.watch(firestoreProvider),
    database: ref.watch(databaseProvider),
  );
});

class DriverScreen extends ConsumerStatefulWidget {
  const DriverScreen({
    super.key, required this.uid, required this.profile,
  });

  final String uid;
  final Map<String, dynamic> profile;

  @override
  ConsumerState<DriverScreen> createState() => _DriverScreenState();
}

class _DriverScreenState extends ConsumerState<DriverScreen>
    with WidgetsBindingObserver {
  StreamSubscription<Position>? gpsSubscription;
  Timer? countdown;
  bool busy = false;
  bool trackingBusy = false;
  String? gpsError;
  Position? lastPosition;
  String? activeRideId;
  bool disposed = false;

  DriverRepository get repo => ref.read(driverRepositoryProvider);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    countdown = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
    if (widget.profile['online'] == true) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_beginTracking());
      });
    }
  }

  @override
  void didUpdateWidget(covariant DriverScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.profile['online'] == true &&
        gpsSubscription == null && !trackingBusy) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_beginTracking());
      });
    }
    if (widget.profile['online'] != true && gpsSubscription != null) {
      unawaited(_endTracking());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        widget.profile['online'] == true &&
        gpsSubscription == null && !trackingBusy) {
      unawaited(_beginTracking());
    }
  }

  @override
  void dispose() {
    disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    countdown?.cancel();
    unawaited(gpsSubscription?.cancel() ?? Future<void>.value());
    super.dispose();
  }

  Future<void> _beginTracking() async {
    if (trackingBusy || gpsSubscription != null || disposed) return;
    trackingBusy = true;
    try {
      await ref.read(firebaseAuthProvider).currentUser?.getIdToken(true);
      final subscription = await repo.beginTracking(
        uid: widget.uid,
        activeRideId: () => activeRideId,
        onPosition: (position) {
          if (mounted) {
            setState(() {
              lastPosition = position;
              gpsError = null;
            });
          }
        },
        onError: (error) {
          if (mounted) setState(() => gpsError = error.toString());
        },
      );
      if (disposed) {
        await subscription.cancel();
      } else {
        gpsSubscription = subscription;
        if (mounted) setState(() => gpsError = null);
      }
    } catch (error) {
      if (mounted) setState(() => gpsError = error.toString());
    } finally {
      trackingBusy = false;
    }
  }

  Future<void> _endTracking() async {
    final subscription = gpsSubscription;
    gpsSubscription = null;
    await subscription?.cancel();
  }

  Future<void> _toggle(bool desired) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      if (desired) {
        if (!await Geolocator.isLocationServiceEnabled()) {
          throw StateError('Turn on GPS before going online.');
        }
        await repo.setAvailability(true);
        await _beginTracking();
        if (gpsSubscription == null) {
          await repo.setAvailability(false);
          throw StateError(gpsError ?? 'GPS tracking could not start.');
        }
      } else {
        await repo.setAvailability(false);
        await _endTracking();
        await repo.stopPresence(widget.uid);
        if (mounted) setState(() => lastPosition = null);
      }
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _answer(String offerId, bool accept) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final status = await repo.respond(offerId, accept: accept);
      if (mounted) {
        showDriveMessage(context, status == 'accepted'
          ? 'Ride accepted. Navigate to the pickup location.'
          : 'Ride declined.');
      }
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _changeRide(String rideId, String status) async {
    if (busy) return;
    final title = status == 'completed' ? 'Finish ride'
        : status == 'in_progress' ? 'Start ride' : 'Mark arriving';
    final confirmed = await showDialog<bool>(
      context: context, builder: (dialog) => AlertDialog(
        title: Text(title),
        content: const Text('Confirm this trip status transition. '
          'Card payments are not processed in Phase 5.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false),
            child: const Text('Back')),
          FilledButton(onPressed: () => Navigator.pop(dialog, true),
            child: Text(title)),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => busy = true);
    try {
      await repo.advance(rideId, status);
      if (mounted) showDriveMessage(context, 'Trip status: $status');
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _cancel(String rideId) async {
    if (busy) return;
    final confirmed = await showDialog<bool>(
      context: context, builder: (dialog) => AlertDialog(
        title: const Text('Cancel assigned ride?'),
        content: const Text('Cancellation is permitted before starting '
          'the trip. Current demo policy has zero cancellation fees.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false),
            child: const Text('Keep ride')),
          FilledButton(onPressed: () => Navigator.pop(dialog, true),
            child: const Text('Cancel ride')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => busy = true);
    try {
      await repo.cancelRide(rideId);
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _navigate(Map<String, dynamic> ride, bool pickup) async {
    try {
      final point = Map<String, dynamic>.from(
        ride[pickup ? 'pickup' : 'destination'] as Map,
      );
      await repo.navigateTo((point['lat'] as num).toDouble(),
          (point['lng'] as num).toDouble());
    } catch (error) {
      if (mounted) showDriveError(context, error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final online = widget.profile['online'] == true;
    final repository = ref.watch(driverRepositoryProvider);
    return StreamBuilder<List<QueryDocumentSnapshot<Map<String, dynamic>>>>(
      stream: repository.rides(widget.uid),
      builder: (context, snapshots) {
        if (snapshots.hasError) {
          return DriveErrorView(
            message: snapshots.error.toString(), retryLabel: t.tryAgain,
            onRetry: () => setState(() {}),
          );
        }
        if (!snapshots.hasData) return const DriveLoading();
        final rides = snapshots.data!;
        const active = {'accepted', 'driver_arriving', 'in_progress'};
        QueryDocumentSnapshot<Map<String, dynamic>>? current;
        for (final ride in rides) {
          if (active.contains(ride.data()['status'])) {
            current = ride;
            break;
          }
        }
        activeRideId = current?.id;
        final completed = <CompletedRideAmount>[];
        for (final ride in rides) {
          final value = ride.data();
          if (value['status'] != 'completed') continue;
          final timestamp = value['completedAt'];
          final amount = value['finalFare'] ?? value['fare'];
          if (timestamp is! Timestamp || amount is! Map ||
              amount['totalMinor'] is! num) {
            continue;
          }
          completed.add(CompletedRideAmount(
            completedAt: timestamp.toDate(),
            amountMinor: (amount['totalMinor'] as num).toInt(),
          ));
        }
        final gross = summarizeGross(completed, DateTime.now());
        return ListView(padding: const EdgeInsets.fromLTRB(18, 16, 18, 32),
          children: [
            DriveHeader(title: t.driverCenter, subtitle: t.driverReady),
            const SizedBox(height: 16),
            Card(child: Padding(padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Icon(online ? Icons.check_circle : Icons.pause_circle,
                      color: online ? DrivePalette.green : DrivePalette.warning),
                    const SizedBox(width: 10),
                    Expanded(child: Text(online ? t.online : t.offline,
                      style: Theme.of(context).textTheme.titleLarge)),
                    Switch.adaptive(
                      value: online, onChanged: busy ? null : _toggle,
                      activeTrackColor: DrivePalette.green),
                  ]),
                  const SizedBox(height: 10),
                  if (online) Text(gpsError != null
                      ? '${t.driverGpsError}: $gpsError'
                      : lastPosition == null ? t.driverNoLocation
                      : '${t.driverLiveLocation}: '
                        '${lastPosition!.latitude.toStringAsFixed(5)}, '
                        '${lastPosition!.longitude.toStringAsFixed(5)}')
                  else Text(t.driverOfflineHelp),
                  const SizedBox(height: 8),
                  Text(t.driverTrackingWarning,
                    style: Theme.of(context).textTheme.bodySmall),
                ]),
            )),
            const SizedBox(height: 18),
            if (current != null) _tripCard(current, t),
            if (current == null && online) ...[
              Text(t.driverIncomingOffers,
                style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              StreamBuilder<List<QueryDocumentSnapshot<Map<String, dynamic>>>>(
                stream: repository.offers(widget.uid),
                builder: (context, snapshot) {
                  if (snapshot.hasError) {
                    return Text('${t.somethingWrong}: ${snapshot.error}');
                  }
                  if (!snapshot.hasData) return const LinearProgressIndicator();
                  final pending = snapshot.data!.where((doc) {
                    final data = doc.data();
                    final expiry = data['expiresAt'];
                    return data['status'] == 'pending' &&
                      expiry is Timestamp && expiry.toDate().isAfter(DateTime.now());
                  }).take(6).toList();
                  if (pending.isEmpty) {
                    return Card(child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: Text(t.driverNoOffers),
                    ));
                  }
                  return Column(children: [
                    for (final offer in pending) _offerCard(offer, t),
                  ]);
                },
              ),
            ],
            const SizedBox(height: 22),
            Text(t.driverGrossSummary,
              style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Card(child: Padding(padding: const EdgeInsets.all(18),
              child: Column(children: [
                _amountRow(t.driverToday, '৳${gross.todayBdt}'),
                const Divider(),
                _amountRow(t.driverLastSevenDays, '৳${gross.sevenDaysBdt}'),
                const Divider(),
                Text(t.driverEarningsNote,
                  style: Theme.of(context).textTheme.bodySmall),
              ]))),
            const SizedBox(height: 8),
            Text('${gross.tripCount} ${t.driverFinished}',
              style: Theme.of(context).textTheme.bodySmall),
          ],
        );
      },
    );
  }

  Widget _amountRow(String label, String amount) {
    return Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      Expanded(child: Text(label)),
      Text(amount, style: Theme.of(context).textTheme.titleLarge),
    ]);
  }

  Widget _offerCard(QueryDocumentSnapshot<Map<String, dynamic>> offer,
      AppLocalizations t) {
    final data = offer.data();
    final expires = data['expiresAt'] as Timestamp;
    final seconds = expires.toDate().difference(DateTime.now()).inSeconds;
    final fare = data['estimatedFareMinor'];
    final pickup = data['pickup'];
    final position = pickup is Map ? pickup : <String, dynamic>{};
    return Card(child: Padding(padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            const Icon(Icons.local_taxi_outlined, color: DrivePalette.green),
            const SizedBox(width: 10),
            Expanded(child: Text('${data['vehicleType'] ?? 'Ride'} · '
              '${t.driverOfferExpires}: ${seconds > 0 ? seconds : 0}s')),
          ]),
          const SizedBox(height: 10),
          Text('Pickup: ${position['lat']}, ${position['lng']}'),
          if (fare is num) Text('${t.driverEstimatedGross}: '
            '৳${(fare / 100).toStringAsFixed(2)}'),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: OutlinedButton(
              onPressed: busy || seconds <= 0 ? null :
                () => _answer(offer.id, false),
              child: Text(t.driverDecline),
            )),
            const SizedBox(width: 10),
            Expanded(child: FilledButton(
              onPressed: busy || seconds <= 0 ? null :
                () => _answer(offer.id, true),
              child: Text(t.driverAccept),
            )),
          ]),
        ]),
    ));
  }

  Widget _tripCard(QueryDocumentSnapshot<Map<String, dynamic>> doc,
      AppLocalizations t) {
    final data = doc.data();
    final status = data['status'] as String? ?? '';
    final amount = (data['fare'] as Map?)?['totalMinor'];
    final next = switch (status) {
      'accepted' => 'driver_arriving',
      'driver_arriving' => 'in_progress',
      'in_progress' => 'completed',
      _ => null,
    };
    final action = switch (status) {
      'accepted' => t.driverArriving,
      'driver_arriving' => t.driverStartTrip,
      'in_progress' => t.driverEndTrip,
      _ => t.driverTrip,
    };
    return Card(child: Padding(padding: const EdgeInsets.all(18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(t.driverTrip, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Chip(label: Text(status.replaceAll('_', ' '))),
          if (amount is num)
            Text('${t.driverEstimatedGross}: ৳${(amount / 100).toStringAsFixed(2)}'),
          Text('${t.driverTripStatus}: $status'),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: busy ? null : () => _navigate(data, true),
            icon: const Icon(Icons.navigation),
            label: Text(t.driverNavigatePickup),
          ),
          OutlinedButton.icon(
            onPressed: busy ? null : () => _navigate(data, false),
            icon: const Icon(Icons.route),
            label: Text(t.driverNavigateDestination),
          ),
          const SizedBox(height: 10),
          if (next != null) FilledButton(
            onPressed: busy ? null : () => _changeRide(doc.id, next),
            child: Text(action),
          ),
          if (status == 'accepted' || status == 'driver_arriving')
            TextButton(
              onPressed: busy ? null : () => _cancel(doc.id),
              child: Text(t.cancel),
            ),
        ]),
    ));
  }
}
