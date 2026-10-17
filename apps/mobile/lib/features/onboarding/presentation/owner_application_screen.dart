import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../../../l10n/app_localizations.dart';

class OwnerApplicationScreen extends ConsumerStatefulWidget {
  const OwnerApplicationScreen({super.key});
  @override
  ConsumerState<OwnerApplicationScreen> createState() =>
      _OwnerApplicationScreenState();
}

class _OwnerApplicationScreenState extends ConsumerState<OwnerApplicationScreen> {
  final name = TextEditingController();
  bool busy = false;

  @override
  void dispose() {
    name.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    final t = AppLocalizations.of(context);
    if (name.text.trim().length < 2) {
      showDriveMessage(context, t.requiredField);
      return;
    }
    setState(() => busy = true);
    try {
      await ref.read(functionsProvider)
          .httpsCallable('submitOwnerApplication').call({
        'businessName': name.text.trim(),
      });
      if (mounted) {
        showDriveMessage(context, t.applicationSent);
        Navigator.of(context).pop();
      }
    } on FirebaseFunctionsException catch (error) {
      if (mounted) showDriveError(context, error.message ?? error);
    } catch (error) {
      if (mounted) showDriveError(context, error);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final uid = ref.watch(firebaseAuthProvider).currentUser?.uid;
    if (uid == null) return const Scaffold(body: DriveLoading());
    final profile = ref.watch(ownerProfileProvider(uid)).asData?.value;
    final status = profile?['approvalStatus'] as String?;
    return Scaffold(
      appBar: AppBar(title: Text(t.ownerApplication)),
      body: SafeArea(child: Center(child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: ListView(padding: const EdgeInsets.all(24), children: [
          DriveHeader(title: t.ownerApplication, subtitle: t.applyInfo),
          const SizedBox(height: 26),
          if (status == 'approved' || status == 'pending')
            Card(child: ListTile(
              leading: Icon(status == 'approved'
                  ? Icons.verified_rounded : Icons.hourglass_top_rounded),
              title: Text(status == 'approved' ? t.approved : t.pending),
            ))
          else ...[
            if (status == 'rejected') Text(t.rejected),
            TextField(
              controller: name,
              decoration: InputDecoration(
                labelText: t.businessName,
                prefixIcon: const Icon(Icons.business_outlined),
              ),
              maxLength: 100,
            ),
            const SizedBox(height: 18),
            FilledButton(
              onPressed: busy ? null : submit,
              child: Text(busy ? t.loading : t.applyOwner),
            ),
          ],
        ]),
      ))),
    );
  }
}
