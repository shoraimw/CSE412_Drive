class InputValidation {
  static final RegExp _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
  static final RegExp _phone = RegExp(r'^\+[1-9]\d{7,14}$');

  static bool email(String value) => _email.hasMatch(value.trim());
  static bool phone(String value) => _phone.hasMatch(value.trim());
  static bool password(String value) => value.length >= 8;
  static bool name(String value) =>
      value.trim().length >= 2 && value.trim().length <= 80;
}
