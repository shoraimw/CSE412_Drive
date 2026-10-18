import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../../../l10n/app_localizations.dart';
import '../../onboarding/presentation/driver_application_screen.dart';
import '../../onboarding/presentation/owner_application_screen.dart';
import '../../rider/presentation/rider_home_screen.dart';
import '../../driver/presentation/driver_screen.dart';
import '../../trip_services/presentation/notifications_screen.dart';
import '../../rentals/presentation/owner_rentals_screen.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key, required this.user, required this.profile});
  final User user;
  final Map<String, dynamic> profile;

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int tab = 0;
  StreamSubscription<String>? pushListener;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      try {
        final listener = await ref.read(tripServicesRepositoryProvider)
            .startPushRegistration();
        if (mounted) {
          pushListener = listener;
        } else {
          await listener?.cancel();
        }
      } catch (error) {
        // In-app notifications remain usable when FCM is not configured.
        debugPrint('Push setup unavailable on this device.');
      }
    });
    final locale = widget.profile['locale'] as String?;
    if (locale == 'bn' || locale == 'en') {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) ref.read(appLocaleProvider.notifier).setLanguage(locale!);
      });
    }
  }

  @override
  void dispose() {
    unawaited(pushListener?.cancel() ?? Future<void>.value());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final driverData = ref.watch(driverProfileProvider(widget.user.uid)).asData?.value;
    final ownerData = ref.watch(ownerProfileProvider(widget.user.uid)).asData?.value;
    final driverApproved = driverData?['approvalStatus'] == 'approved';
    final ownerApproved = ownerData?['approvalStatus'] == 'approved';
    final views = <Widget>[
      const RiderHomeScreen(),
      if (driverApproved) DriverScreen(
        uid: widget.user.uid,
        profile: driverData ?? const <String, dynamic>{},
      ),
      if (ownerApproved) OwnerRentalsScreen(uid: widget.user.uid),
      _AccountPanel(
        user: widget.user, profile: widget.profile,
        driverStatus: driverData?['approvalStatus']?.toString(),
        driverIsOnline: driverData?['online'] == true,
        ownerStatus: ownerData?['approvalStatus']?.toString(),
      ),
    ];
    final destinations = <NavigationDestination>[
      NavigationDestination(icon: const Icon(Icons.directions_car_outlined),
        selectedIcon: const Icon(Icons.directions_car), label: t.rider),
      if (driverApproved) NavigationDestination(
        icon: const Icon(Icons.local_taxi_outlined),
        selectedIcon: const Icon(Icons.local_taxi), label: t.driver),
      if (ownerApproved) NavigationDestination(
        icon: const Icon(Icons.car_rental_outlined),
        selectedIcon: const Icon(Icons.car_rental), label: t.owner),
      NavigationDestination(
        icon: const Icon(Icons.person_outline),
        selectedIcon: const Icon(Icons.person), label: t.account),
    ];
    final current = tab.clamp(0, views.length - 1).toInt();
    return Scaffold(
      appBar: AppBar(
        title: Text('DRIVE', style: Theme.of(context).textTheme.titleLarge),
        actions: [
          IconButton(
            tooltip: 'Notifications',
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => NotificationsScreen(uid: widget.user.uid),
            )),
          ),
          IconButton(
            tooltip: t.refreshAccess,
            onPressed: () async {
              try {
                await widget.user.getIdToken(true);
                ref.invalidate(driverProfileProvider(widget.user.uid));
                ref.invalidate(ownerProfileProvider(widget.user.uid));
                if (context.mounted) showDriveMessage(context, t.refreshAccess);
              } catch (e) {
                if (context.mounted) showDriveError(context, e);
              }
            },
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: IndexedStack(
        index: current, children: views,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: current,
        onDestinationSelected: (index) => setState(() => tab = index),
        destinations: destinations,
      ),
    );
  }
}

class _AccountPanel extends ConsumerWidget {
  const _AccountPanel({
    required this.user, required this.profile,
    required this.driverStatus, required this.driverIsOnline,
    required this.ownerStatus,
  });
  final User user;
  final Map<String, dynamic> profile;
  final String? driverStatus;
  final bool driverIsOnline;
  final String? ownerStatus;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final locale = ref.watch(appLocaleProvider).languageCode;
    final theme = ref.watch(appThemeProvider);
    return ListView(padding: const EdgeInsets.all(20), children: [
      DriveHeader(title: t.account, subtitle: user.email ?? user.phoneNumber ?? ''),
      const SizedBox(height: 18),
      Card(child: ListTile(
        leading: const Icon(Icons.account_circle_outlined, size: 34),
        title: Text(profile['displayName']?.toString() ?? ''),
        subtitle: Text(t.approved),
        onTap: () => Navigator.push(context, MaterialPageRoute<void>(
          builder: (_) => _EditProfilePage(
            initialName: profile['displayName']?.toString() ?? '',
          ),
        )),
        trailing: const Icon(Icons.edit_outlined),
      )),
      const SizedBox(height: 14),
      _ApplicationTile(
        title: t.driverApplication, status: driverStatus,
        onTap: () => Navigator.push(context, MaterialPageRoute<void>(
          builder: (_) => const DriverApplicationScreen(),
        )),
      ),
      _ApplicationTile(
        title: t.ownerApplication, status: ownerStatus,
        onTap: () => Navigator.push(context, MaterialPageRoute<void>(
          builder: (_) => const OwnerApplicationScreen(),
        )),
      ),
      const SizedBox(height: 18),
      Text(t.language, style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      SegmentedButton<String>(
        segments: [
          ButtonSegment(value: 'en', label: Text(t.english)),
          ButtonSegment(value: 'bn', label: Text(t.bangla)),
        ],
        selected: {locale},
        onSelectionChanged: (chosen) async {
          final language = chosen.first;
          ref.read(appLocaleProvider.notifier).setLanguage(language);
          try {
            await ref.read(authRepositoryProvider).ensureProfile(
              profile['displayName']?.toString() ?? '', language,
            );
          } catch (e) {
            if (context.mounted) showDriveError(context, e);
          }
        },
      ),
      const SizedBox(height: 18),
      Text(t.appearance, style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      SegmentedButton<ThemeMode>(
        segments: [
          ButtonSegment(value: ThemeMode.system, label: Text(t.systemTheme)),
          ButtonSegment(value: ThemeMode.light, label: Text(t.lightTheme)),
          ButtonSegment(value: ThemeMode.dark, label: Text(t.darkTheme)),
        ],
        selected: {theme},
        onSelectionChanged: (mode) =>
            ref.read(appThemeProvider.notifier).setTheme(mode.first),
      ),
      const SizedBox(height: 30),
      OutlinedButton.icon(
        onPressed: () async {
          try {
            if (driverIsOnline) {
              await ref.read(functionsProvider)
                  .httpsCallable('setDriverAvailability')
                  .call({'online': false});
            }
            try {
              await ref.read(tripServicesRepositoryProvider)
                  .unregisterDeviceFromPush();
            } catch (error) {
              debugPrint('Could not unregister push ID before logout.');
            }
            await ref.read(authRepositoryProvider).logout();
          } catch (error) {
            if (context.mounted) showDriveError(context, error);
          }
        },
        icon: const Icon(Icons.logout_outlined), label: Text(t.signOut),
      ),
    ]);
  }
}

class _ApplicationTile extends StatelessWidget {
  const _ApplicationTile({required this.title, required this.status,
    required this.onTap});
  final String title;
  final String? status;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Card(
    child: ListTile(
      title: Text(title),
      subtitle: status == null ? null : Text(status!),
      onTap: onTap, trailing: const Icon(Icons.chevron_right),
    ),
  );
}

class _EditProfilePage extends ConsumerStatefulWidget {
  const _EditProfilePage({required this.initialName});
  final String initialName;
  @override
  ConsumerState<_EditProfilePage> createState() => _EditProfilePageState();
}
class _EditProfilePageState extends ConsumerState<_EditProfilePage> {
  late final TextEditingController name;
  bool busy = false;
  @override
  void initState() {
    super.initState();
    name = TextEditingController(text: widget.initialName);
  }
  @override
  void dispose() {name.dispose(); super.dispose();}
  Future<void> save() async {
    if (name.text.trim().length < 2 || busy) return;
    setState(() => busy = true);
    try {
      await ref.read(authRepositoryProvider).ensureProfile(
        name.text, ref.read(appLocaleProvider).languageCode,
      );
      if (mounted) {
        showDriveMessage(context, AppLocalizations.of(context).updateSuccess);
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) showDriveError(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.profile)),
      body: Padding(padding: const EdgeInsets.all(24), child: Column(children: [
        TextField(controller: name,
          decoration: InputDecoration(labelText: t.fullName)),
        const SizedBox(height: 20),
        FilledButton(onPressed: busy ? null : save,
          child: Text(busy ? t.loading : t.saveProfile)),
      ])),
    );
  }
}
