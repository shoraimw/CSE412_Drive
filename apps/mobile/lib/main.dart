import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/config/firebase_bootstrap.dart';
import 'core/providers.dart';
import 'core/theme/drive_theme.dart';
import 'features/auth/presentation/auth_gate.dart';
import 'l10n/app_localizations.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await DriveFirebaseConfig.initialize();
    runApp(const ProviderScope(child: DriveApp()));
  } catch (error) {
    runApp(MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: SelectableText(
              'DRIVE cannot start.\n\n$error',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ),
    ));
  }
}

class DriveApp extends ConsumerWidget {
  const DriveApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'DRIVE',
      debugShowCheckedModeBanner: false,
      theme: DriveTheme.light(),
      darkTheme: DriveTheme.dark(),
      themeMode: ref.watch(appThemeProvider),
      locale: ref.watch(appLocaleProvider),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      home: const AuthGate(),
    );
  }
}
