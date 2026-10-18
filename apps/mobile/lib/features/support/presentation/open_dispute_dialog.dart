import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/widgets/drive_widgets.dart';

/// User-initiated internal support case. Does not refund, change booking
/// state, or contact emergency responders.
Future<void> showServiceDisputeDialog({
  required BuildContext context,
  required WidgetRef ref,
  required String serviceType,
  required String serviceId,
}) async {
  final details = TextEditingController();
  String category = 'service';
  final result = await showDialog<Map<String, String>>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, update) => AlertDialog(
        title: Text(serviceType == 'ride' ? 'Report a ride issue' : 'Report a rental issue'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('This sends a private support case to administrators. '
                'It does not issue a refund, notify emergency contacts, '
                'or replace an emergency phone call.'),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: category,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Issue category'),
              items: const [
                DropdownMenuItem(value: 'service', child: Text('Service quality')),
                DropdownMenuItem(value: 'payment', child: Text('Payment or fare')),
                DropdownMenuItem(value: 'safety', child: Text('Safety follow-up (not SOS)')),
                DropdownMenuItem(value: 'other', child: Text('Other issue')),
              ],
              onChanged: (value) => update(() => category = value ?? 'service'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: details,
              maxLines: 4,
              maxLength: 1200,
              onChanged: (_) => update(() {}),
              decoration: const InputDecoration(
                labelText: 'What happened?',
                hintText: 'Please describe the issue clearly (25–1200 characters).',
              ),
            ),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Back')),
          FilledButton(
            onPressed: details.text.trim().length < 25
                ? null : () => Navigator.pop(dialogContext, {
                  'topic': category, 'description': details.text.trim()
                }),
            child: const Text('Submit support case'),
          ),
        ],
      ),
    ),
  );
  details.dispose();
  if (result == null || !context.mounted) return;
  try {
    final callable = ref.read(functionsProvider).httpsCallable('openServiceDispute');
    final response = await callable.call({
      'serviceType': serviceType,
      'serviceId': serviceId,
      ...result,
    });
    if (!context.mounted) return;
    final data = Map<String, dynamic>.from(response.data as Map);
    showDriveMessage(context,
      'Support case recorded: ${data['status']}. '
      'No refund or external emergency alert was triggered.');
  } catch (error) {
    if (context.mounted) showDriveError(context, error);
  }
}
