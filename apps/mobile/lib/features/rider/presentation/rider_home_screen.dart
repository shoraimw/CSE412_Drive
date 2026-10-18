import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../../core/providers.dart';
import '../../../core/theme/drive_theme.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../data/rider_repository.dart';
import '../domain/route_models.dart';
import 'trip_tracking_screen.dart';
import '../../rentals/presentation/rental_marketplace_screen.dart';
import '../../../l10n/app_localizations.dart';

final riderRepositoryProvider = Provider<RiderRepository>((ref) =>
    RiderRepository(
      functions: ref.watch(functionsProvider),
      firestore: ref.watch(firestoreProvider),
      database: ref.watch(databaseProvider),
    ));

const _mapsReady = bool.fromEnvironment(
  'DRIVE_MAPS_READY', defaultValue: false,
);
const _dhaka = LatLng(23.7806, 90.4074);

class RiderHomeScreen extends ConsumerStatefulWidget {
  const RiderHomeScreen({super.key});
  @override
  ConsumerState<RiderHomeScreen> createState() => _RiderHomeScreenState();
}

class _RiderHomeScreenState extends ConsumerState<RiderHomeScreen> {
  RidePoint? pickup;
  RidePoint? destination;
  String category = 'car';
  RideQuote? quote;
  bool working = false;
  String? bookingRide;
  bool pinPickupNext = false;
  GoogleMapController? controller;

  Future<void> choosePoint({required bool isPickup}) async {
    final point = await showModalBottomSheet<RidePoint>(
      context: context, isScrollControlled: true, useSafeArea: true,
      builder: (context) => FractionallySizedBox(
        heightFactor: 0.78,
        child: _PlacePicker(
          repo: ref.read(riderRepositoryProvider),
          allowCurrentLocation: isPickup,
        ),
      ),
    );
    if (!mounted || point == null) return;
    setState(() {
      if (isPickup) {pickup = point;} else {destination = point;}
      quote = null;
    });
    await controller?.animateCamera(CameraUpdate.newLatLngZoom(point.latLng, 13));
  }

  Future<void> estimate() async {
    if (pickup == null || destination == null || working) return;
    setState(() {working = true; quote = null;});
    try {
      final newQuote = await ref.read(riderRepositoryProvider)
          .getFareQuote(pickup!, destination!, category);
      if (mounted) setState(() => quote = newQuote);
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> book() async {
    if (working || quote == null) return;
    if (quote!.isExpired) {
      showDriveMessage(context, 'Fare estimate expired. Please refresh.');
      return;
    }
    setState(() => working = true);
    try {
      final repo = ref.read(riderRepositoryProvider);
      final rideId = await repo.requestRide(quote!, const Uuid().v4());
      if (mounted) setState(() {bookingRide = rideId; quote = null;});
      // Ride creation is committed before dispatch. Dispatch failure never
      // hides or loses the created ride.
      try {
        await repo.dispatch(rideId);
      } catch (error) {
        if (mounted) {
          showDriveMessage(context, 'Ride created; matching can be retried. $error');
        }
      }
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Set<Marker> markers([LatLng? driver]) {
    return {
      if (pickup != null)
        Marker(markerId: const MarkerId('pickup'),
          position: pickup!.latLng, infoWindow: InfoWindow(title: pickup!.label)),
      if (destination != null)
        Marker(markerId: const MarkerId('destination'),
          position: destination!.latLng,
          infoWindow: InfoWindow(title: destination!.label)),
      if (driver != null)
        Marker(markerId: const MarkerId('driver'),
          position: driver, icon: BitmapDescriptor.defaultMarkerWithHue(
            BitmapDescriptor.hueAzure)),
    };
  }

  Set<Polyline> get paths {
    if (quote == null || quote!.encodedPolyline.isEmpty) return {};
    try {
      return {Polyline(
        polylineId: const PolylineId('route'),
        points: decodePolyline(quote!.encodedPolyline),
        color: DrivePalette.green, width: 5,
      )};
    } on FormatException {
      return {};
    }
  }

  void pin(LatLng point) {
    final selected = RidePoint(lat: point.latitude, lng: point.longitude,
      label: '${point.latitude.toStringAsFixed(5)}, ${point.longitude.toStringAsFixed(5)}');
    setState(() {
      if (pinPickupNext) {
        pickup = selected;
      } else {
        destination = selected;
      }
      quote = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final uid = ref.watch(firebaseAuthProvider).currentUser?.uid;
    if (uid == null) return const DriveLoading();
    final repo = ref.watch(riderRepositoryProvider);
    return StreamBuilder<List<QueryDocumentSnapshot<Map<String, dynamic>>>>(
      stream: repo.ridesFor(uid),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return DriveErrorView(
            message: snapshot.error.toString(),
            retryLabel: 'Retry',
            onRetry: () => setState(() {}),
          );
        }
        if (!snapshot.hasData) return const DriveLoading();
        const currentStates = {'requested', 'matching', 'accepted',
          'driver_arriving', 'in_progress'};
        String? activeRide;
        for (final item in snapshot.data!) {
          if (currentStates.contains(item.data()['status'])) {
            activeRide = item.id;
            break;
          }
        }
        activeRide ??= bookingRide;
        if (activeRide != null) {
          return TripTrackingScreen(
            key: ValueKey(activeRide), rideId: activeRide, repository: repo,
            showGoogleMap: _mapsReady,
            onFinished: () => setState(() {bookingRide = null; quote = null;}),
          );
        }
        final history = snapshot.data!
            .where((ride) => ride.data()['status'] == 'completed')
            .take(8).toList();
        return _bookRideForm(history, repo, uid);
      },
    );
  }

  Widget _bookRideForm(
    List<QueryDocumentSnapshot<Map<String, dynamic>>> history,
    RiderRepository repo,
    String uid,
  ) {
    final theme = Theme.of(context);
    return LayoutBuilder(builder: (context, constraints) {
      return ListView(children: [
        Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Card(child: ListTile(
            leading: const Icon(Icons.car_rental_outlined),
            title: Text(AppLocalizations.of(context).rentalMarketplace),
            subtitle: Text(AppLocalizations.of(context).rentalMarketplaceSubtitle),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => RentalMarketplaceScreen(uid: uid),
            )),
          )),
        ),
        SizedBox(
          height: constraints.maxHeight * 0.42,
          child: _mapsReady
              ? GoogleMap(
                  initialCameraPosition: const CameraPosition(
                    target: _dhaka, zoom: 12,
                  ),
                  onMapCreated: (map) => controller = map,
                  onTap: pin,
                  markers: markers(),
                  polylines: paths,
                  myLocationButtonEnabled: false,
                  compassEnabled: true,
                  mapToolbarEnabled: false,
                )
              : Container(
                  color: theme.brightness == Brightness.dark
                      ? DrivePalette.midnight : const Color(0xFFE2F4EF),
                  child: Center(child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.map_outlined, size: 58,
                          color: DrivePalette.green),
                        const SizedBox(height: 10),
                        Text('Map preview needs a configured Maps SDK key.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.titleMedium),
                        const SizedBox(height: 8),
                        const Text('You can still choose coordinates and test '
                          'demo fares in the Firebase emulator.',
                          textAlign: TextAlign.center),
                      ],
                    ),
                  )),
                ),
        ),
        Padding(padding: const EdgeInsets.fromLTRB(18, 18, 18, 36),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Where are you going?',
                style: theme.textTheme.headlineSmall),
              const SizedBox(height: 12),
              _LocationTile(
                icon: Icons.my_location,
                label: pickup?.label ?? 'Choose pickup',
                onTap: () => choosePoint(isPickup: true),
              ),
              const SizedBox(height: 8),
              _LocationTile(
                icon: Icons.flag_outlined,
                label: destination?.label ?? 'Choose destination',
                onTap: () => choosePoint(isPickup: false),
              ),
              if (_mapsReady)
                SwitchListTile.adaptive(
                  title: const Text('Map taps choose pickup instead of destination'),
                  value: pinPickupNext,
                  onChanged: (value) => setState(() => pinPickupNext = value),
                ),
              const SizedBox(height: 14),
              Text('Choose a vehicle', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'bike', label: Text('Bike')),
                  ButtonSegment(value: 'car', label: Text('Car')),
                  ButtonSegment(value: 'premium', label: Text('Premium')),
                ],
                selected: {category},
                onSelectionChanged: (value) => setState(() {
                  category = value.first; quote = null;
                }),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: working || pickup == null || destination == null
                    ? null : estimate,
                icon: const Icon(Icons.payments_outlined),
                label: Text(working ? 'Calculating…' : 'Estimate fare'),
              ),
              if (quote != null) ...[
                const SizedBox(height: 14),
                Card(child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(quote!.fareLabel,
                        style: theme.textTheme.headlineMedium),
                      Text(quote!.tripLabel),
                      if (quote!.provisional)
                        const Padding(padding: EdgeInsets.only(top: 10),
                          child: Text('DEMO estimate only — not live road routing.')),
                      if (quote!.warning != null)
                        Padding(padding: const EdgeInsets.only(top: 6),
                          child: Text(quote!.warning!)),
                      const SizedBox(height: 14),
                      FilledButton.icon(
                        onPressed: working || quote!.isExpired ? null : book,
                        icon: const Icon(Icons.local_taxi_outlined),
                        label: const Text('Confirm ride request'),
                      ),
                      if (quote!.isExpired)
                        const Text('Quote expired. Generate a new estimate.'),
                    ],
                  ),
                )),
              ],
            ],
          ),
        ),
        if (history.isNotEmpty) Padding(
          padding: const EdgeInsets.fromLTRB(18, 0, 18, 26),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Completed trips', style: theme.textTheme.titleLarge),
              const SizedBox(height: 8),
              for (final ride in history)
                Card(child: ListTile(
                  leading: const Icon(Icons.receipt_long_outlined),
                  title: Text('Trip ${ride.id.substring(0, 8)}'),
                  subtitle: const Text('View payment, summary and rating'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.push(context, MaterialPageRoute<void>(
                    builder: (_) => TripTrackingScreen(
                      rideId: ride.id, repository: repo, showGoogleMap: _mapsReady,
                      onFinished: () => Navigator.of(context).pop(),
                    ),
                  )),
                )),
            ],
          ),
        ),
      ]);
    });
  }
}

class _LocationTile extends StatelessWidget {
  const _LocationTile({
    required this.icon, required this.label, required this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Card(
    child: ListTile(
      leading: Icon(icon, color: DrivePalette.green),
      title: Text(label, maxLines: 2, overflow: TextOverflow.ellipsis),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    ),
  );
}

class _PlacePicker extends StatefulWidget {
  const _PlacePicker({
    required this.repo, required this.allowCurrentLocation,
  });
  final RiderRepository repo;
  final bool allowCurrentLocation;
  @override
  State<_PlacePicker> createState() => _PlacePickerState();
}
class _PlacePickerState extends State<_PlacePicker> {
  final query = TextEditingController();
  final token = const Uuid().v4();
  final suggestions = <PlaceSuggestion>[];
  Timer? debounce;
  int requestSerial = 0;
  bool searching = false;
  String? errorText;

  @override
  void dispose() {
    debounce?.cancel();
    query.dispose();
    super.dispose();
  }

  void change(String value) {
    debounce?.cancel();
    final serial = ++requestSerial;
    if (value.trim().length < 3) {
      setState(() {suggestions.clear(); searching = false; errorText = null;});
      return;
    }
    setState(() {searching = true; errorText = null;});
    debounce = Timer(const Duration(milliseconds: 420), () async {
      try {
        final results = await widget.repo.findPlaces(value.trim(), token);
        if (mounted && requestSerial == serial) {
          setState(() {suggestions..clear()..addAll(results); searching = false;});
        }
      } catch (error) {
        if (mounted && requestSerial == serial) {
          setState(() {searching = false; errorText = error.toString();});
        }
      }
    });
  }

  Future<void> select(PlaceSuggestion suggestion) async {
    setState(() => searching = true);
    try {
      final point = await widget.repo.resolvePlace(suggestion, token);
      if (mounted) Navigator.of(context).pop(point);
    } catch (error) {
      if (mounted) setState(() {searching = false; errorText = error.toString();});
    }
  }

  Future<void> current() async {
    setState(() => searching = true);
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        throw StateError('Location services are off. Enable GPS or enter coordinates.');
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw StateError('Location access was denied. Select manually instead.');
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 12),
        ),
      );
      if (mounted) {
        Navigator.of(context).pop(RidePoint(lat: position.latitude,
          lng: position.longitude, label: 'Current location'));
      }
    } catch (error) {
      if (mounted) setState(() {searching = false; errorText = error.toString();});
    }
  }

  Future<void> manual() async {
    final point = await showDialog<RidePoint>(
      context: context, builder: (_) => const _CoordinatesDialog());
    if (mounted && point != null) Navigator.of(context).pop(point);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 24, 18,
        MediaQuery.viewInsetsOf(context).bottom + 10),
      child: Column(children: [
        Text('Search a place', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 14),
        TextField(
          controller: query, autofocus: true, onChanged: change,
          decoration: const InputDecoration(
            hintText: 'Dhaka, Gulshan, university…',
            prefixIcon: Icon(Icons.search),
          ),
        ),
        if (widget.allowCurrentLocation) ListTile(
          leading: const Icon(Icons.my_location),
          title: const Text('Use device location'),
          onTap: searching ? null : current,
        ),
        ListTile(
          leading: const Icon(Icons.pin_drop_outlined),
          title: const Text('Enter coordinates manually'),
          onTap: manual,
        ),
        if (searching) const LinearProgressIndicator(),
        if (errorText != null)
          Padding(padding: const EdgeInsets.all(8), child: Text(errorText!)),
        Expanded(child: ListView.builder(
          itemCount: suggestions.length,
          itemBuilder: (context, index) {
            final item = suggestions[index];
            return ListTile(
              leading: const Icon(Icons.place_outlined),
              title: Text(item.description),
              onTap: searching ? null : () => select(item),
            );
          },
        )),
      ]),
    );
  }
}

class _CoordinatesDialog extends StatefulWidget {
  const _CoordinatesDialog();
  @override
  State<_CoordinatesDialog> createState() => _CoordinatesDialogState();
}
class _CoordinatesDialogState extends State<_CoordinatesDialog> {
  final lat = TextEditingController();
  final lng = TextEditingController();
  @override
  void dispose() {lat.dispose(); lng.dispose(); super.dispose();}
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Enter coordinates'),
    content: Column(mainAxisSize: MainAxisSize.min, children: [
      TextField(controller: lat,
        keyboardType: const TextInputType.numberWithOptions(
          decimal: true, signed: true),
        decoration: const InputDecoration(labelText: 'Latitude (-90 to 90)')),
      const SizedBox(height: 10),
      TextField(controller: lng,
        keyboardType: const TextInputType.numberWithOptions(
          decimal: true, signed: true),
        decoration: const InputDecoration(labelText: 'Longitude (-180 to 180)')),
    ]),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context),
        child: const Text('Cancel')),
      FilledButton(onPressed: () {
        final a = double.tryParse(lat.text);
        final b = double.tryParse(lng.text);
        if (a == null || b == null || a < -90 || a > 90 ||
            b < -180 || b > 180 || !a.isFinite || !b.isFinite) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Enter valid latitude and longitude.')));
          return;
        }
        Navigator.pop(context, RidePoint(lat: a, lng: b,
          label: '${a.toStringAsFixed(5)}, ${b.toStringAsFixed(5)}'));
      }, child: const Text('Use this location')),
    ],
  );
}
