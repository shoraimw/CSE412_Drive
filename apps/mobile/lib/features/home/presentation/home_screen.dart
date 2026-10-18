import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/theme/drive_theme.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../../../l10n/app_localizations.dart';
import '../../onboarding/presentation/driver_application_screen.dart';
import '../../onboarding/presentation/owner_application_screen.dart';
import '../../rider/presentation/rider_home_screen.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key, required this.user, required this.profile});
  final User user;
  final Map<String, dynamic> profile;

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int tab = 0;

  @override
  void initState() {
    super.initState();
    final locale = widget.profile['locale'] as String?;
    if (locale == 'bn' || locale == 'en') {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) ref.read(appLocaleProvider.notifier).setLanguage(locale!);
      });
    }
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
      if (driverApproved) _DriverPanel(
        driverData: driverData ?? const <String, dynamic>{},
      ),
      if (ownerApproved) const _OwnerPanel(),
      _AccountPanel(
        user: widget.user, profile: widget.profile,
        driverStatus: driverData?['approvalStatus']?.toString(),
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

class _FeatureTile extends StatelessWidget {
  const _FeatureTile({required this.icon, required this.title,
    required this.subtitle});
  final IconData icon;
  final String title;
  final String subtitle;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(8),
      child: ListTile(
        leading: CircleAvatar(child: Icon(icon)),
        title: Text(title), subtitle: Text(subtitle),
        trailing: const Icon(Icons.lock_clock_outlined),
      ),
    ),
  );
}

class _DriverPanel extends ConsumerStatefulWidget {
  const _DriverPanel({required this.driverData});
  final Map<String, dynamic> driverData;
  @override
  ConsumerState<_DriverPanel> createState() => _DriverPanelState();
}

class _DriverPanelState extends ConsumerState<_DriverPanel> {
  bool busy = false;
  Future<void> toggle(bool value) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await ref.read(functionsProvider)
          .httpsCallable('setDriverAvailability').call({'online': value});
    } on FirebaseFunctionsException catch (e) {
      if (mounted) showDriveError(context, e.message ?? e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final online = widget.driverData['online'] == true;
    return ListView(padding: const EdgeInsets.all(24), children: [
      DriveHeader(title: t.driverCenter, subtitle: t.driverReady),
      const SizedBox(height: 20),
      Card(child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(children: [
          Icon(online ? Icons.check_circle : Icons.pause_circle,
            color: online ? DrivePalette.green : DrivePalette.warning, size: 36),
          const SizedBox(width: 12),
          Expanded(child: Text(online ? t.online : t.offline,
              style: Theme.of(context).textTheme.titleLarge)),
          Switch.adaptive(
            value: online, onChanged: busy ? null : toggle,
            activeTrackColor: DrivePalette.green,
          ),
        ]),
      )),
      const SizedBox(height: 18),
      _FeatureTile(icon: Icons.navigation_outlined, title: t.upcoming,
        subtitle: t.driverNext),
    ]);
  }
}

class _OwnerPanel extends ConsumerWidget {
  const _OwnerPanel();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final uid = ref.watch(firebaseAuthProvider).currentUser?.uid;
    if (uid == null) return const DriveLoading();
    final stream = ref.watch(firestoreProvider).collection('vehicles')
        .where('ownerId', isEqualTo: uid).snapshots();
    return ListView(padding: const EdgeInsets.all(24), children: [
      DriveHeader(title: t.ownerCenter, subtitle: t.ownerReady),
      const SizedBox(height: 24),
      Text(t.vehicleRentals, style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 12),
      StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: stream,
        builder: (context, snapshot) {
          if (snapshot.hasError) return Text(snapshot.error.toString());
          if (!snapshot.hasData) return const LinearProgressIndicator();
          if (snapshot.data!.docs.isEmpty) return Text(t.ownerNext);
          return Column(children: snapshot.data!.docs.map((doc) {
            final vehicle = doc.data();
            return Card(child: ListTile(
              leading: const Icon(Icons.directions_car),
              title: Text(vehicle['model']?.toString() ?? doc.id),
              subtitle: Text(vehicle['approvalStatus']?.toString() ?? t.pending),
            ));
          }).toList());
        },
      ),
    ]);
  }
}

class _AccountPanel extends ConsumerWidget {
  const _AccountPanel({
    required this.user, required this.profile,
    required this.driverStatus, required this.ownerStatus,
  });
  final User user;
  final Map<String, dynamic> profile;
  final String? driverStatus;
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
        onPressed: () => ref.read(authRepositoryProvider).logout(),
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
