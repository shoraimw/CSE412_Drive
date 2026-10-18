import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/widgets/drive_widgets.dart';
import '../../../core/providers.dart';
import '../data/trip_services_repository.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key, required this.uid});
  final String uid;
  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationState();
}
class _NotificationState extends ConsumerState<NotificationsScreen> {
  late final Stream<QuerySnapshot<Map<String, dynamic>>> stream;
  @override
  void initState() {
    super.initState();
    stream = ref.read(tripServicesRepositoryProvider).notifications(widget.uid);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('DRIVE notifications')),
    body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: stream,
      builder: (context, snapshot) {
        if (snapshot.hasError) return DriveErrorView(
          message: snapshot.error.toString(),
          onRetry: () => setState(() {}), retryLabel: 'Retry');
        if (!snapshot.hasData) {
          return const DriveLoading();
        }
        final records = snapshot.data!.docs;
        if (records.isEmpty) {
          return const Center(child: Padding(
            padding: EdgeInsets.all(24),
            child: Text('No notifications yet. Trip updates appear here.'),
          ));
        }
        return ListView.builder(
          padding: const EdgeInsets.all(14),
          itemCount: records.length,
          itemBuilder: (context, index) {
            final item = records[index].data();
            final time = item['createdAt'];
            final date = time is Timestamp
                ? time.toDate().toLocal().toString().substring(0, 16)
                : 'Pending timestamp';
            return Card(child: ListTile(
              leading: const Icon(Icons.notifications_outlined),
              title: Text(item['title']?.toString() ?? 'DRIVE update'),
              subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item['body']?.toString() ?? ''),
                  Text('$date · Push: ${item['pushStatus'] ?? 'pending'}',
                    style: Theme.of(context).textTheme.labelSmall),
                ]),
            ));
          },
        );
      },
    ),
  );
}
