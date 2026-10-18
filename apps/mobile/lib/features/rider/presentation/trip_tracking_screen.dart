import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../core/providers.dart';
import '../../../core/theme/drive_theme.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../data/rider_repository.dart';
import '../domain/route_models.dart';

class TripTrackingScreen extends ConsumerStatefulWidget {
  const TripTrackingScreen({
    super.key, required this.rideId, required this.repository,
    required this.showGoogleMap, required this.onFinished,
  });
  final String rideId;
  final RiderRepository repository;
  final bool showGoogleMap;
  final VoidCallback onFinished;

  @override
  ConsumerState<TripTrackingScreen> createState() => _TripTrackingScreenState();
}

class _TripTrackingScreenState extends ConsumerState<TripTrackingScreen> {
  bool working = false;
  bool showSafetyDetails = false;
  GoogleMapController? controller;

  Future<void> cancel() async {
    if (working) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel this ride?'),
        content: const Text('Current Phase 4 demo uses a zero-fee '
            'cancellation rule before the trip starts.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Keep ride')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Cancel ride')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => working = true);
    try {
      await widget.repository.cancel(widget.rideId);
      if (mounted) {
        widget.onFinished();
      }
    } catch (e) {
      if (mounted) showDriveError(context, e);
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> dispatch() async {
    setState(() => working = true);
    try {
      final result = await widget.repository.dispatch(widget.rideId);
      final count = (result['offeredTo'] as List<dynamic>? ?? []).length;
      if (mounted) {
        showDriveMessage(context,
          count == 0 ? 'No eligible drivers are online near pickup.'
              : 'Ride offer sent to $count driver(s).');
      }
    } catch (e) {
      if (mounted) showDriveError(context, e);
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> finalize() async {
    setState(() => working = true);
    try {
      await widget.repository.finalizeUnmatched(widget.rideId);
      if (mounted) widget.onFinished();
    } catch (e) {
      if (mounted) showDriveError(context, e);
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> sos() async {
    setState(() => working = true);
    try {
      final result = await ref.read(functionsProvider)
          .httpsCallable('reportSafetyIncident').call({
            'rideId': widget.rideId, 'type': 'sos',
            'note': 'Rider pressed SOS in the Flutter app.',
          });
      if (!mounted) return;
      final info = Map<String, dynamic>.from(result.data as Map);
      await showDialog<void>(context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Safety incident recorded'),
          content: Text(
            'Incident ID: ${info['incidentId']}\n\n'
            'No emergency contact or police dispatch was notified. '
            'Use your phone emergency services if immediate help is needed.'),
          actions: [
            FilledButton(onPressed: () => Navigator.pop(ctx),
                child: const Text('Close')),
          ],
        ));
    } catch (e) {
      if (mounted) showDriveError(context, e);
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<Map<String, dynamic>?>(
      stream: widget.repository.watchTrip(widget.rideId),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return DriveErrorView(
            message: snapshot.error.toString(), retryLabel: 'Retry',
            onRetry: () => setState(() {}),
          );
        }
        if (!snapshot.hasData) return const DriveLoading();
        final ride = snapshot.data;
        if (ride == null) {
          return DriveErrorView(
            message: 'Trip no longer exists.', retryLabel: 'Back',
            onRetry: widget.onFinished,
          );
        }
        final status = ride['status'] as String? ?? 'unknown';
        const terminal = {'completed', 'cancelled', 'no_driver_found', 'expired'};
        final isFinished = terminal.contains(status);
        final driverId = ride['driverId'] as String?;
        final pickup = Map<String, dynamic>.from(ride['pickup'] as Map);
        final destination = Map<String, dynamic>.from(ride['destination'] as Map);
        final route = ride['routePolyline'] as String? ?? '';
        final p = LatLng((pickup['lat'] as num).toDouble(),
            (pickup['lng'] as num).toDouble());
        final d = LatLng((destination['lat'] as num).toDouble(),
            (destination['lng'] as num).toDouble());

        return ListView(children: [
          if (driverId != null && !isFinished)
            StreamBuilder<Map<String, dynamic>?>(
              stream: widget.repository.watchTripLocation(widget.rideId),
              builder: (context, location) {
                final data = location.data;
                final current = data != null &&
                    data['lat'] is num && data['lng'] is num
                    ? LatLng((data['lat'] as num).toDouble(),
                        (data['lng'] as num).toDouble())
                    : null;
                final updatedAt = data?['updatedAt'];
                final stale = updatedAt is! num ||
                    DateTime.now().millisecondsSinceEpoch - updatedAt.toInt() > 30000;
                return Column(children: [
                  _map(p, d, route, current, !stale),
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(location.hasError
                        ? 'Live driver location unavailable; check network and trip access.'
                        : current == null ? 'Waiting for driver GPS updates.'
                        : stale ? 'Driver GPS is stale — last known position shown.'
                        : 'Driver location updating live.'),
                  ),
                ]);
              },
            )
          else _map(p, d, route, null, false),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(children: [
                  const Icon(Icons.local_taxi, color: DrivePalette.green),
                  const SizedBox(width: 10),
                  Expanded(child: Text(
                    'Trip ${widget.rideId.substring(0, 8)}',
                    style: Theme.of(context).textTheme.titleLarge)),
                  Chip(label: Text(status.replaceAll('_', ' '))),
                ]),
                const SizedBox(height: 10),
                Text(_statusDescription(status)),
                const SizedBox(height: 14),
                Text('Pickup: ${p.latitude.toStringAsFixed(5)}, '
                     '${p.longitude.toStringAsFixed(5)}'),
                const SizedBox(height: 4),
                Text('Destination: ${d.latitude.toStringAsFixed(5)}, '
                     '${d.longitude.toStringAsFixed(5)}'),
                const SizedBox(height: 14),
                _fare(ride),
                if (ride['provisional'] == true)
                  const Padding(padding: EdgeInsets.only(top: 10),
                    child: Text('Route and fare are emulator-demo estimates, '
                      'not live road measurements.')),
                const SizedBox(height: 16),
                if (status == 'matching') ...[
                  OutlinedButton.icon(
                    onPressed: working ? null : dispatch,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry nearby-driver matching'),
                  ),
                  OutlinedButton(
                    onPressed: working ? null : finalize,
                    child: const Text('End search after offers expire'),
                  ),
                ],
                if (['matching', 'accepted', 'driver_arriving'].contains(status))
                  OutlinedButton.icon(
                    onPressed: working ? null : cancel,
                    icon: const Icon(Icons.close),
                    label: const Text('Cancel ride'),
                  ),
                if (!isFinished) ...[
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: working ? null : sos,
                    icon: const Icon(Icons.sos),
                    label: const Text('Record SOS incident (demo)'),
                  ),
                  const Text('SOS currently records an incident only. '
                      'It does not contact police or trusted contacts.'),
                ],
                if (isFinished) ...[
                  const SizedBox(height: 18),
                  FilledButton(
                    onPressed: widget.onFinished,
                    child: const Text('Back to rider home'),
                  ),
                ],
              ]),
          ),
        ]);
      },
    );
  }

  Widget _fare(Map<String, dynamic> ride) {
    final fare = ride['finalFare'] ?? ride['fare'];
    if (fare is! Map) return const Text('Fare not available');
    final minor = (fare['totalMinor'] as num?)?.toInt();
    if (minor == null) return const Text('Fare not available');
    return Row(children: [
      const Icon(Icons.payments_outlined),
      const SizedBox(width: 10),
      Text('Estimated fare: ৳${(minor / 100).toStringAsFixed(2)}',
        style: Theme.of(context).textTheme.titleMedium),
    ]);
  }

  Widget _map(LatLng pickup, LatLng destination, String encoded,
      LatLng? driver, bool fresh) {
    if (!widget.showGoogleMap) {
      return Container(
        height: 190,
        color: const Color(0xFFE2F4EF),
        child: Center(child: Padding(
          padding: const EdgeInsets.all(18),
          child: Text(driver == null
              ? 'Trip route map needs the Google Maps SDK key.'
              : 'Driver: ${driver.latitude.toStringAsFixed(5)}, '
                '${driver.longitude.toStringAsFixed(5)}'
                '${fresh ? ' (live)' : ' (stale)'}',
            textAlign: TextAlign.center),
        )),
      );
    }
    Set<Polyline> line = {};
    if (encoded.isNotEmpty) {
      try {
        line = {Polyline(polylineId: const PolylineId('tripRoute'),
          points: decodePolyline(encoded),
          color: DrivePalette.green, width: 5)};
      } on FormatException {
        line = {};
      }
    }
    return SizedBox(
      height: 300,
      child: GoogleMap(
        initialCameraPosition: CameraPosition(target: pickup, zoom: 13),
        onMapCreated: (c) => controller = c,
        markers: {
          Marker(markerId: const MarkerId('pickup'), position: pickup),
          Marker(markerId: const MarkerId('destination'), position: destination),
          if (driver != null)
            Marker(markerId: const MarkerId('driver'), position: driver,
              icon: BitmapDescriptor.defaultMarkerWithHue(
                BitmapDescriptor.hueAzure)),
        },
        polylines: line,
        mapToolbarEnabled: false,
      ),
    );
  }

  String _statusDescription(String state) {
    switch (state) {
      case 'matching': return 'Searching for an eligible nearby driver. '
          'Driver offers require an online driver client.';
      case 'accepted': return 'A driver accepted your trip.';
      case 'driver_arriving': return 'Your driver is travelling to pickup.';
      case 'in_progress': return 'Your trip is underway.';
      case 'completed': return 'Trip completed. Payment and receipts come in Phase 6.';
      case 'cancelled': return 'This trip was cancelled.';
      case 'no_driver_found': return 'No driver accepted within the search period.';
      default: return 'Current status: $state';
    }
  }
}
