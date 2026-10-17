import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/theme/drive_theme.dart';
import '../../../core/validation/validation.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../../../l10n/app_localizations.dart';
import 'phone_screen.dart';

class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key});
  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen> {
  final form = GlobalKey<FormState>();
  final email = TextEditingController();
  final password = TextEditingController();
  final confirm = TextEditingController();
  final name = TextEditingController();
  bool register = false;
  bool busy = false;
  bool revealPassword = false;

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    confirm.dispose();
    name.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (!form.currentState!.validate() || busy) return;
    setState(() => busy = true);
    try {
      final auth = ref.read(authRepositoryProvider);
      if (register) {
        await auth.register(email.text, password.text, name.text);
      } else {
        await auth.signIn(email.text, password.text);
      }
    } on FirebaseAuthException catch (error) {
      if (mounted) showDriveError(context, error.message ?? error);
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> google() async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await ref.read(authRepositoryProvider).googleSignIn();
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> forgot() async {
    final t = AppLocalizations.of(context);
    final address = email.text.trim();
    if (!InputValidation.email(address)) {
      showDriveMessage(context, t.invalidEmail);
      return;
    }
    try {
      await ref.read(authRepositoryProvider).resetPassword(address);
      if (mounted) showDriveMessage(context, t.resetSent);
    } catch (error) {
      if (mounted) showDriveError(context, error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(child: Center(child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
          children: [
            Row(children: [
              const CircleAvatar(
                radius: 23,
                backgroundColor: DrivePalette.green,
                child: Icon(Icons.route_rounded, color: Colors.black),
              ),
              const SizedBox(width: 12),
              Text('DRIVE', style: Theme.of(context).textTheme.headlineMedium),
            ]),
            const SizedBox(height: 42),
            DriveHeader(title: t.welcome, subtitle: t.welcomeSubtitle),
            const SizedBox(height: 28),
            Form(
              key: form,
              child: Column(children: [
                if (register) ...[
                  TextFormField(
                    controller: name,
                    textCapitalization: TextCapitalization.words,
                    textInputAction: TextInputAction.next,
                    decoration: InputDecoration(
                      labelText: t.fullName,
                      prefixIcon: const Icon(Icons.person_outline_rounded),
                    ),
                    validator: (v) => InputValidation.name(v ?? '') ? null : t.invalidName,
                  ),
                  const SizedBox(height: 14),
                ],
                TextFormField(
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: t.email,
                    prefixIcon: const Icon(Icons.alternate_email_rounded),
                  ),
                  validator: (v) => InputValidation.email(v ?? '') ? null : t.invalidEmail,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: password,
                  obscureText: !revealPassword,
                  autofillHints: [register ? AutofillHints.newPassword : AutofillHints.password],
                  textInputAction: register ? TextInputAction.next : TextInputAction.done,
                  decoration: InputDecoration(
                    labelText: t.password,
                    prefixIcon: const Icon(Icons.lock_outline_rounded),
                    suffixIcon: IconButton(
                      tooltip: revealPassword ? 'Hide password' : 'Show password',
                      onPressed: () => setState(() => revealPassword = !revealPassword),
                      icon: Icon(revealPassword ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined),
                    ),
                  ),
                  validator: (v) => InputValidation.password(v ?? '')
                      ? null : t.shortPassword,
                ),
                if (register) ...[
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: confirm, obscureText: true,
                    decoration: InputDecoration(
                      labelText: t.confirmPassword,
                      prefixIcon: const Icon(Icons.lock_reset_rounded),
                    ),
                    validator: (v) => v == password.text ? null : t.passwordMismatch,
                  ),
                ],
                if (!register)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: busy ? null : forgot,
                      child: Text(t.forgotPassword),
                    ),
                  ),
                const SizedBox(height: 18),
                FilledButton(
                  onPressed: busy ? null : submit,
                  child: Text(busy ? t.loading : register ? t.signUp : t.signIn),
                ),
              ]),
            ),
            const SizedBox(height: 18),
            OutlinedButton.icon(
              onPressed: busy ? null : google,
              icon: const Icon(Icons.account_circle_outlined),
              label: Text(t.continueGoogle),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: busy ? null : () {
                Navigator.of(context).push(MaterialPageRoute<void>(
                  builder: (_) => const PhoneAuthScreen(),
                ));
              },
              icon: const Icon(Icons.phone_android_rounded),
              label: Text(t.continuePhone),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
            ),
            const SizedBox(height: 22),
            TextButton(
              onPressed: busy ? null : () {
                form.currentState?.reset();
                setState(() => register = !register);
              },
              child: Text(register ? t.alreadyAccount : t.noAccount),
            ),
            const SizedBox(height: 30),
            Text(
              t.version, textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
            ),
          ],
        ),
      ))),
    );
  }
}
