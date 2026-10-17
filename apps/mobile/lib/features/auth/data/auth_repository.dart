import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

class AuthRepository {
  AuthRepository({required this.auth, required this.functions});

  final FirebaseAuth auth;
  final FirebaseFunctions functions;
  Future<void>? _googleInitialized;

  Future<void> register(String email, String password, String displayName) async {
    final credential = await auth.createUserWithEmailAndPassword(
      email: email.trim(), password: password,
    );
    final user = credential.user;
    if (user == null) throw StateError('Firebase did not return an account.');
    await user.updateDisplayName(displayName.trim());
    await user.sendEmailVerification();
  }

  Future<void> signIn(String email, String password) async {
    await auth.signInWithEmailAndPassword(
      email: email.trim(), password: password,
    );
  }

  Future<void> googleSignIn() async {
    _googleInitialized ??= GoogleSignIn.instance.initialize();
    await _googleInitialized;
    final account = await GoogleSignIn.instance.authenticate();
    final tokens = account.authentication;
    if (tokens.idToken == null) {
      throw StateError('Google did not return a valid identity token.');
    }
    await auth.signInWithCredential(
      GoogleAuthProvider.credential(idToken: tokens.idToken),
    );
  }

  Future<void> sendPhoneOtp({
    required String phone,
    required void Function(String verificationId) onCodeSent,
    required void Function() onAutomaticVerification,
    required void Function(FirebaseAuthException exception) onFailure,
  }) async {
    await auth.verifyPhoneNumber(
      phoneNumber: phone.trim(),
      timeout: const Duration(seconds: 60),
      verificationCompleted: (credential) async {
        try {
          await auth.signInWithCredential(credential);
          onAutomaticVerification();
        } on FirebaseAuthException catch (error) {
          onFailure(error);
        }
      },
      verificationFailed: onFailure,
      codeSent: (verificationId, _) => onCodeSent(verificationId),
      codeAutoRetrievalTimeout: (_) {},
    );
  }

  Future<void> verifyPhoneCode(String verificationId, String code) async {
    final credential = PhoneAuthProvider.credential(
      verificationId: verificationId, smsCode: code.trim(),
    );
    await auth.signInWithCredential(credential);
  }

  Future<void> resendEmailVerification() async {
    final user = auth.currentUser;
    if (user == null) throw StateError('Sign in first.');
    await user.sendEmailVerification();
  }

  Future<bool> refreshEmailVerification() async {
    await auth.currentUser?.reload();
    await auth.currentUser?.getIdToken(true);
    return auth.currentUser?.emailVerified ?? false;
  }

  Future<void> resetPassword(String email) async {
    await auth.sendPasswordResetEmail(email: email.trim());
  }

  Future<void> ensureProfile(String displayName, String locale) async {
    await functions.httpsCallable('ensureProfile').call({
      'displayName': displayName.trim(),
      'locale': locale,
    });
  }

  Future<void> logout() async {
    await auth.signOut();
    // GoogleSignIn sign-out is intentionally not required to revoke Firebase
    // access. The Firebase session is the authorization source of truth.
  }
}
