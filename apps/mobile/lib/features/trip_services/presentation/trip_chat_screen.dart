import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/providers.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../data/trip_services_repository.dart';

class TripChatScreen extends ConsumerStatefulWidget {
  const TripChatScreen({super.key, required this.rideId});
  final String rideId;
  @override
  ConsumerState<TripChatScreen> createState() => _ChatState();
}
class _ChatState extends ConsumerState<TripChatScreen> {
  final controller = TextEditingController();
  bool sending = false;
  late final Stream<QuerySnapshot<Map<String, dynamic>>> updates;
  @override
  void initState() {
    super.initState();
    updates = ref.read(tripServicesRepositoryProvider).messages(widget.rideId);
  }
  @override
  void dispose() { controller.dispose(); super.dispose(); }

  Future<void> send() async {
    if (sending || controller.text.trim().isEmpty) return;
    setState(() => sending = true);
    try {
      await ref.read(tripServicesRepositoryProvider)
          .sendMessage(widget.rideId, controller.text);
      if (mounted) controller.clear();
    } catch (e) {
      if (mounted) showDriveError(context, e);
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = ref.watch(firebaseAuthProvider).currentUser?.uid;
    return Scaffold(
      appBar: AppBar(title: const Text('Trip chat')),
      body: SafeArea(child: Column(children: [
        const Padding(padding: EdgeInsets.all(12),
          child: Text('Only participants can read this chat. '
            'Messages are not end-to-end encrypted.')),
        Expanded(child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: updates,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return DriveErrorView(message: snapshot.error.toString(),
                onRetry: () => setState(() {}), retryLabel: 'Retry');
            }
            if (!snapshot.hasData) return const DriveLoading();
            final records = snapshot.data!.docs;
            if (records.isEmpty) {
              return const Center(child: Text('No messages yet.'));
            }
            return ListView.builder(
              padding: const EdgeInsets.all(16), itemCount: records.length,
              itemBuilder: (context, index) {
                final value = records[index].data();
                final mine = value['senderId'] == uid;
                return Align(
                  alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                  child: Card(child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(value['text']?.toString() ?? ''),
                        Text(mine ? 'You' : 'Trip participant',
                          style: Theme.of(context).textTheme.labelSmall),
                      ]),
                  )),
                );
              },
            );
          },
        )),
        Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
          child: Row(children: [
            Expanded(child: TextField(controller: controller, maxLines: 3,
              minLines: 1, maxLength: 1000,
              decoration: const InputDecoration(
                hintText: 'Type a message', counterText: ''),
              onSubmitted: (_) => send(),
            )),
            IconButton.filled(
              onPressed: sending ? null : send,
              tooltip: 'Send', icon: const Icon(Icons.send),
            ),
          ]),
        ),
      ])),
    );
  }
}
