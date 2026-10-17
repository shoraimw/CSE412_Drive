import 'package:flutter_test/flutter_test.dart';
import 'package:drive_mobile/core/validation/validation.dart';

void main() {
  group('Email validation', () {
    test('rejects missing domain or whitespace', () {
      expect(InputValidation.email('alice'), isFalse);
      expect(InputValidation.email('name@'), isFalse);
      expect(InputValidation.email('foo bar@test.com'), isFalse);
    });
    test('accepts a trimmed valid email', () {
      expect(InputValidation.email('  alice@example.com '), isTrue);
    });
  });
  group('Phone and password validation', () {
    test('supports international E.164-style phone input', () {
      expect(InputValidation.phone('+8801712345678'), isTrue);
      expect(InputValidation.phone('01712345678'), isFalse);
    });
    test('rejects short passwords and short names', () {
      expect(InputValidation.password('short'), isFalse);
      expect(InputValidation.password('long-enough-password'), isTrue);
      expect(InputValidation.name('A'), isFalse);
      expect(InputValidation.name('Alice'), isTrue);
    });
  });
}
