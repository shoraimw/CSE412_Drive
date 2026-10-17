import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:drive_mobile/core/theme/drive_theme.dart';
import 'package:drive_mobile/core/widgets/drive_widgets.dart';

void main() {
  testWidgets('DRIVE renders its accessible header in light theme', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: DriveTheme.light(),
      home: const Scaffold(
        body: DriveHeader(
          title: 'Drive with confidence',
          subtitle: 'A safer way to move.',
        ),
      ),
    ));
    expect(find.text('Drive with confidence'), findsOneWidget);
    expect(find.text('A safer way to move.'), findsOneWidget);
  });

  testWidgets('Error view provides an actionable retry', (tester) async {
    var tries = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: DriveErrorView(
          message: 'Unable to connect',
          retryLabel: 'Retry',
          onRetry: () => tries++,
        ),
      ),
    ));
    expect(find.text('Unable to connect'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    expect(tries, 1);
  });

  testWidgets('Dark theme uses the same design system', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: DriveTheme.dark(),
      home: const Scaffold(body: Text('DRIVE dark')),
    ));
    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.theme?.brightness, Brightness.dark);
    expect(find.text('DRIVE dark'), findsOneWidget);
  });
}
