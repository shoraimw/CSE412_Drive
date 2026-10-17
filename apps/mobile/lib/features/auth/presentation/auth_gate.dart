import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../../../l10n/app_localizations.dart';
import '../../home/presentation/home_screen.dart';
import 'auth_screen.dart';

class AuthGate extends ConsumerWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final auth = ref.watch(authChangesProvider);
    return auth.when(
      loading: () => const Scaffold(body: DriveLoading()),
      error: (e, _) => Scaffold(
        body: DriveErrorView(
          message: e.toString(), retryLabel: t.tryAgain,
          onRetry: () => ref.invalidate(authChangesProvider),
        ),
      ),
      data: (user) {
        if (user == null) return const AuthScreen();
        if (user.email != null && !user.emailVerified) {
          return const VerifyEmailScreen();
        }
        return _ProfileGate(user: user);
      },
    );
  }
}

class _ProfileGate extends ConsumerWidget {
  const _ProfileGate({required this.user});
  final User user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final profile = ref.watch(userProfileProvider(user.uid));
    return profile.when(
      loading: () => const Scaffold(body: DriveLoading()),
      error: (e, _) => Scaffold(
        body: DriveErrorView(
          message: e.toString(), retryLabel: t.tryAgain,
          onRetry: () => ref.invalidate(userProfileProvider(user.uid)),
        ),
      ),
      data: (value) {
        if (value == null) return CompleteProfileScreen(user: user);
        if (value['accountStatus'] != 'active') {
          return Scaffold(
            appBar: AppBar(title: Text(t.accountStatus)),
            body: Center(child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(t.statusDisabled),
                TextButton(
                  onPressed: () => ref.read(authRepositoryProvider).logout(),
                  child: Text(t.signOut),
                ),
              ],
            )),
          );
        }
        return HomeScreen(user: user, profile: value);
      },
    );
  }
}

class CompleteProfileScreen extends ConsumerStatefulWidget {
  const CompleteProfileScreen({super.key, required this.user});
  final User user;

  @override
  ConsumerState<CompleteProfileScreen> createState() =>
      _CompleteProfileScreenState();
}

class _CompleteProfileScreenState extends ConsumerState<CompleteProfileScreen> {
  final form = GlobalKey<FormState>();
  final name = TextEditingController();
  bool busy = false;

  @override
  void initState() {
    super.initState();
    name.text = widget.user.displayName ?? '';
  }
  @override
  void dispose() {
    name.dispose();
    super.dispose();
  }

  Future<void> save() async {
    if (!form.currentState!.validate() || busy) return;
    setState(() => busy = true);
    try {
      await ref.read(authRepositoryProvider).ensureProfile(
        name.text, ref.read(appLocaleProvider).languageCode,
      );
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
      appBar: AppBar(title: Text(t.completeProfile)),
      body: SafeArea(child: Center(child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: Form(key: form, child: ListView(padding: const EdgeInsets.all(24), children: [
          DriveHeader(title: t.completeProfile, subtitle: t.yourDetails),
          const SizedBox(height: 24),
          TextFormField(
            controller: name, textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(labelText: t.fullName),
            validator: (value) => value != null &&
                value.trim().length >= 2 && value.trim().length <= 80
                ? null : t.invalidName,
          ),
          const SizedBox(height: 20),
          FilledButton(onPressed: busy ? null : save,
            child: Text(busy ? t.loading : t.saveProfile)),
          TextButton(
            onPressed: () => ref.read(authRepositoryProvider).logout(),
            child: Text(t.signOut),
          ),
        ])),
      ))),
    );
  }
}

class VerifyEmailScreen extends ConsumerStatefulWidget {
  const VerifyEmailScreen({super.key});
  @override
  ConsumerState<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends ConsumerState<VerifyEmailScreen> {
  bool busy = false;
  Future<void> verify() async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final verified = await ref.read(authRepositoryProvider).refreshEmailVerification();
      if (!mounted) return;
      if (verified) {
        ref.invalidate(authChangesProvider);
      } else {
        showDriveMessage(context, AppLocalizations.of(context).notVerified);
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
      appBar: AppBar(title: Text(t.verificationTitle)),
      body: SafeArea(child: Center(child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: ListView(padding: const EdgeInsets.all(24), children: [
          const Icon(Icons.mark_email_unread_outlined, size: 64),
          const SizedBox(height: 24),
          DriveHeader(title: t.verificationTitle, subtitle: t.verificationBody),
          const SizedBox(height: 24),
          FilledButton(onPressed: busy ? null : verify,
            child: Text(busy ? t.loading : t.verified)),
          TextButton(
            onPressed: busy ? null : () async {
              try {
                await ref.read(authRepositoryProvider).resendEmailVerification();
                if (context.mounted) showDriveMessage(context, t.emailSent);
              } catch (e) {
                if (context.mounted) showDriveError(context, e);
              }
            }, child: Text(t.sendAgain),
          ),
          TextButton(
            onPressed: () => ref.read(authRepositoryProvider).logout(),
            child: Text(t.signOut),
          ),
        ]),
      ))),
    );
  }
}
