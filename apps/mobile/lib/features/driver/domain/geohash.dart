/// Encodes WGS84 coordinates to a standard base32 geohash.
/// This matches geofire-common's geohash encoding for RTDB queries.
String encodeGeoHash(double latitude, double longitude, {int precision = 9}) {
  if (!latitude.isFinite || !longitude.isFinite ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180 ||
      precision < 5 || precision > 12) {
    throw const FormatException('Invalid coordinates or geohash precision.');
  }
  const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
  var latLo = -90.0;
  var latHi = 90.0;
  var lngLo = -180.0;
  var lngHi = 180.0;
  var evenBit = true;
  var bitsRemaining = 5;
  var character = 0;
  final result = StringBuffer();

  while (result.length < precision) {
    final lo = evenBit ? lngLo : latLo;
    final hi = evenBit ? lngHi : latHi;
    final middle = (lo + hi) / 2;
    final coordinate = evenBit ? longitude : latitude;
    character <<= 1;
    if (coordinate >= middle) {
      character |= 1;
      if (evenBit) {
        lngLo = middle;
      } else {
        latLo = middle;
      }
    } else if (evenBit) {
      lngHi = middle;
    } else {
      latHi = middle;
    }
    evenBit = !evenBit;
    bitsRemaining--;
    if (bitsRemaining == 0) {
      result.write(alphabet[character]);
      bitsRemaining = 5;
      character = 0;
    }
  }
  return result.toString();
}
