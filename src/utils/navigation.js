import { Linking, Platform } from 'react-native';

const toNumberString = (value) => Number(value).toFixed(6);

export const openNavigationToCoordinate = async ({ latitude, longitude, label }) => {
  const lat = toNumberString(latitude);
  const lon = toNumberString(longitude);
  const encodedLabel = encodeURIComponent(label || 'Parking Lot');

  const googleWebUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;

  if (Platform.OS === 'ios') {
    const googleMapsAppUrl = `comgooglemaps://?daddr=${lat},${lon}&directionsmode=driving`;
    const appleMapsUrl = `http://maps.apple.com/?daddr=${lat},${lon}&dirflg=d&q=${encodedLabel}`;

    const canOpenGoogleMaps = await Linking.canOpenURL(googleMapsAppUrl);
    if (canOpenGoogleMaps) {
      await Linking.openURL(googleMapsAppUrl);
      return true;
    }

    const canOpenAppleMaps = await Linking.canOpenURL(appleMapsUrl);
    if (canOpenAppleMaps) {
      await Linking.openURL(appleMapsUrl);
      return true;
    }
  }

  const canOpenGoogleWeb = await Linking.canOpenURL(googleWebUrl);
  if (canOpenGoogleWeb) {
    await Linking.openURL(googleWebUrl);
    return true;
  }

  return false;
};
