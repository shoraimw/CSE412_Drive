import 'dart:typed_data';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:file_picker/file_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../../../l10n/app_localizations.dart';

class DriverApplicationScreen extends ConsumerStatefulWidget {
  const DriverApplicationScreen({super.key});

  @override
  ConsumerState<DriverApplicationScreen> createState() =>
      _DriverApplicationScreenState();
}

class _DriverApplicationScreenState extends ConsumerState<DriverApplicationScreen> {
  final plate = TextEditingController();
  final model = TextEditingController();
  String vehicleType = 'car';
  bool busy = false;
  final selectedFiles = <String, PlatformFile>{};

  @override
  void dispose() {
    plate.dispose();
    model.dispose();
    super.dispose();
  }

  Future<void> pick(String kind) async {
    final t = AppLocalizations.of(context);
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf'],
        withData: true, allowMultiple: false,
      );
      final file = result?.files.single;
      if (file == null) return;
      final extension = file.extension?.toLowerCase();
      if (!['jpg', 'jpeg', 'png', 'pdf'].contains(extension) ||
          file.size == 0 || file.size >= 10 * 1024 * 1024 ||
          file.bytes == null) {
        if (mounted) showDriveMessage(context, t.selectDocument);
        return;
      }
      if (mounted) setState(() => selectedFiles[kind] = file);
    } catch (error) {
      if (mounted) showDriveError(context, error);
    }
  }

  String contentType(PlatformFile file) {
    switch (file.extension?.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      default:
        return 'application/pdf';
    }
  }

  Future<void> submit() async {
    final t = AppLocalizations.of(context);
    if (busy) return;
    if (model.text.trim().length < 2 || plate.text.trim().length < 4 ||
        selectedFiles.length != 3) {
      showDriveMessage(context, t.requiredField);
      return;
    }
    final uid = ref.read(firebaseAuthProvider).currentUser?.uid;
    if (uid == null) return;
    setState(() => busy = true);
    try {
      final storage = ref.read(storageProvider);
      final paths = <String>[];
      for (final kind in ['licence', 'vehicle', 'photo']) {
        final file = selectedFiles[kind]!;
        final path = 'applications/$uid/$kind.' +
            (file.extension?.toLowerCase() ?? 'pdf');
        await storage.ref(path).putData(
          Uint8List.fromList(file.bytes!),
          SettableMetadata(contentType: contentType(file)),
        );
        paths.add(path);
      }
      await ref.read(functionsProvider)
          .httpsCallable('submitDriverApplication').call({
        'vehicleType': vehicleType,
        'vehiclePlate': plate.text.trim(),
        'vehicleModel': model.text.trim(),
        'documentPaths': paths,
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
    final profile = ref.watch(driverProfileProvider(uid)).asData?.value;
    final status = profile?['approvalStatus'] as String?;
    return Scaffold(
      appBar: AppBar(title: Text(t.driverApplication)),
      body: SafeArea(child: Center(child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: ListView(padding: const EdgeInsets.all(24), children: [
          DriveHeader(title: t.driverApplication, subtitle: t.applyInfo),
          const SizedBox(height: 18),
          if (status == 'approved' || status == 'pending') ...[
            Card(child: ListTile(
              leading: Icon(status == 'approved'
                  ? Icons.verified_rounded : Icons.hourglass_top_rounded),
              title: Text(status == 'approved' ? t.approved : t.pending),
            )),
          ] else ...[
            if (status == 'rejected') Text(t.rejected),
            const SizedBox(height: 18),
            DropdownButtonFormField<String>(
              initialValue: vehicleType,
              decoration: InputDecoration(labelText: t.vehicleType),
              items: [
                DropdownMenuItem(value: 'bike', child: Text(t.bike)),
                DropdownMenuItem(value: 'car', child: Text(t.car)),
                DropdownMenuItem(value: 'premium', child: Text(t.premium)),
              ],
              onChanged: busy ? null : (value) {
                if (value != null) setState(() => vehicleType = value);
              },
            ),
            const SizedBox(height: 12),
            TextField(controller: model,
              decoration: InputDecoration(labelText: t.vehicleModel)),
            const SizedBox(height: 12),
            TextField(controller: plate,
              decoration: InputDecoration(labelText: t.vehiclePlate)),
            const SizedBox(height: 20),
            Text(t.documents, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            for (final (kind, label) in [
              ('licence', t.license), ('vehicle', t.vehiclePapers),
              ('photo', t.selfie),
            ])
              Card(child: ListTile(
                leading: Icon(selectedFiles.containsKey(kind)
                    ? Icons.check_circle_rounded : Icons.upload_file_outlined),
                title: Text(label),
                subtitle: Text(selectedFiles[kind]?.name ?? t.pickFile),
                onTap: busy ? null : () => pick(kind),
                trailing: const Icon(Icons.attach_file),
              )),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: busy ? null : submit,
              child: Text(busy ? t.loading : t.applyDriver),
            ),
          ],
        ]),
      ))),
    );
  }
}
