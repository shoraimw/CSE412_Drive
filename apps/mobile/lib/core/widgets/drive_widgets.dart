import 'package:flutter/material.dart';

class DriveHeader extends StatelessWidget {
  const DriveHeader({super.key, required this.title, required this.subtitle});
  final String title;
  final String subtitle;
  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title, style: Theme.of(context).textTheme.headlineLarge),
      const SizedBox(height: 8),
      Text(subtitle, style: Theme.of(context).textTheme.bodyLarge),
    ]);
  }
}

class DriveErrorView extends StatelessWidget {
  const DriveErrorView({
    super.key, required this.message, required this.onRetry,
    required this.retryLabel,
  });
  final String message;
  final VoidCallback onRetry;
  final String retryLabel;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.wifi_off_rounded, size: 46),
        const SizedBox(height: 16),
        Text(message, textAlign: TextAlign.center),
        const SizedBox(height: 20),
        OutlinedButton(onPressed: onRetry, child: Text(retryLabel)),
      ]),
    ),
  );
}

class DriveLoading extends StatelessWidget {
  const DriveLoading({super.key});
  @override
  Widget build(BuildContext context) => Center(
    child: Semantics(
      label: 'Loading',
      child: const SizedBox.square(
        dimension: 32, child: CircularProgressIndicator.adaptive(),
      ),
    ),
  );
}

void showDriveError(BuildContext context, Object exception) {
  final text = exception.toString()
      .replaceFirst('FirebaseAuthException: ', '')
      .replaceFirst('FirebaseFunctionsException: ', '')
      .replaceFirst('Exception: ', '');
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text.length > 200
        ? text.substring(0, 200) : text)));
}

void showDriveMessage(BuildContext context, String text) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));
}
