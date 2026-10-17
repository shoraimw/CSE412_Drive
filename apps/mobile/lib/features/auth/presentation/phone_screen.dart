import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/validation/validation.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../../../l10n/app_localizations.dart';

class PhoneAuthScreen extends ConsumerStatefulWidget {
  const PhoneAuthScreen({super.key});
  @override
  ConsumerState<PhoneAuthScreen> createState() => _PhoneAuthScreenState();
}

class _PhoneAuthScreenState extends ConsumerState<PhoneAuthScreen> {
  final phone = TextEditingController(text: '+880');
  final code = TextEditingController();
  String? verificationId;
  bool busy = false;

  @override
  void dispose() {
    phone.dispose();
    code.dispose();
    super.dispose();
  }

  Future<void> sendCode() async {
    final t = AppLocalizations.of(context);
    if (!InputValidation.phone(phone.text)) {
      showDriveMessage(context, t.invalidPhone);
      return;
    }
    setState(() => busy = true);
    try {
      await ref.read(authRepositoryProvider).sendPhoneOtp(
        phone: phone.text,
        onCodeSent: (id) {
          if (mounted) {
            setState(() {
              verificationId = id;
              busy = false;
            });
          }
        },
        onAutomaticVerification: () {
          if (mounted) {
            Navigator.of(context).pop();
          }
        },
        onFailure: (FirebaseAuthException e) {
          if (mounted) {
            showDriveError(context, e.message ?? e);
            setState(() => busy = false);
          }
        },
      );
    } catch (error) {
      if (mounted) {
        showDriveError(context, error);
        setState(() => busy = false);
      }
    }
  }

  Future<void> confirmCode() async {
    if (busy || verificationId == null) return;
    if (!RegExp(r'^\d{6}$').hasMatch(code.text.trim())) {
      showDriveMessage(context, AppLocalizations.of(context).codeExpired);
      return;
    }
    setState(() => busy = true);
    try {
      await ref.read(authRepositoryProvider).verifyPhoneCode(
        verificationId!, code.text,
      );
      if (mounted) Navigator.of(context).pop();
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
      appBar: AppBar(title: Text(t.phoneTitle)),
      body: SafeArea(child: Center(child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: ListView(padding: const EdgeInsets.all(24), children: [
          const Icon(Icons.sms_outlined, size: 60),
          const SizedBox(height: 20),
          DriveHeader(title: t.phoneTitle, subtitle: t.phoneHelp),
          const SizedBox(height: 26),
          if (verificationId == null) ...[
            TextField(
              controller: phone,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: InputDecoration(
                labelText: t.phoneNumber,
                prefixIcon: const Icon(Icons.phone),
              ),
            ),
            const SizedBox(height: 18),
            FilledButton(
              onPressed: busy ? null : sendCode,
              child: Text(busy ? t.loading : t.sendCode),
            ),
          ] else ...[
            TextField(
              controller: code,
              keyboardType: TextInputType.number,
              maxLength: 6,
              autofillHints: const [AutofillHints.oneTimeCode],
              decoration: InputDecoration(labelText: t.enterCode),
            ),
            const SizedBox(height: 18),
            FilledButton(
              onPressed: busy ? null : confirmCode,
              child: Text(busy ? t.loading : t.verifyCode),
            ),
            TextButton(onPressed: busy ? null : () {
              setState(() => verificationId = null);
            }, child: Text(t.sendAgain)),
          ],
        ]),
      ))),
    );
  }
}
