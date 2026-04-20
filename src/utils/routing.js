import { KEYS } from '../config/keys';

const GOOGLE_MAPS_API_KEY = KEYS.GOOGLE_MAPS_API_KEY;
const GOOGLE_DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const FALLBACK_AVERAGE_SPEED_KMH = 30;

const toFixedCoord = (value) => Number(value).toFixed(6);

const decodePolyline = (encoded) => {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    return [];
  }

  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
};

const toRadians = (value) => (value * Math.PI) / 180;

const haversineDistanceMeters = (origin, destination) => {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(destination.latitude - origin.latitude);
  const dLon = toRadians(destination.longitude - origin.longitude);
  const lat1 = toRadians(origin.latitude);
  const lat2 = toRadians(destination.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
};

const buildStraightLineRoute = (origin, destination) => {
  const distanceMeters = haversineDistanceMeters(origin, destination);
  const durationSeconds = Math.round((distanceMeters / 1000 / FALLBACK_AVERAGE_SPEED_KMH) * 3600);
  return {
    coordinates: [
      { latitude: origin.latitude, longitude: origin.longitude },
      { latitude: destination.latitude, longitude: destination.longitude },
    ],
    durationSeconds,
    distanceMeters,
    isFallback: true,
    steps: [{ id: 0, instruction: 'Head to destination', distance: '', duration: '', maneuver: 'straight' }],
  };
};

export const fetchDrivingRoute = async ({ origin, destination }) => {
  if (!origin || !destination) throw new Error('routing_missing_endpoint');

  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('GOOGLE_MAPS_API_KEY is empty; using straight-line fallback.');
    return { routes: [{ ...buildStraightLineRoute(origin, destination), id: 0, summary: 'Direct', durationText: '', distanceText: '' }], selectedIndex: 0 };
  }

  const originParam = `${toFixedCoord(origin.latitude)},${toFixedCoord(origin.longitude)}`;
  const destinationParam = `${toFixedCoord(destination.latitude)},${toFixedCoord(destination.longitude)}`;
  const url = `${GOOGLE_DIRECTIONS_URL}?origin=${originParam}&destination=${destinationParam}&mode=driving&alternatives=true&key=${GOOGLE_MAPS_API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`routing_request_failed_${response.status}`);
    const payload = await response.json();
    if (payload?.status !== 'OK' || !payload.routes?.length) throw new Error(`routing_no_route_${payload?.status}`);

    const routes = payload.routes.map((route, index) => {
      const coordinates = decodePolyline(route?.overview_polyline?.points);
      const leg = route?.legs?.[0];
      const steps = (leg?.steps || []).map((step, stepIndex) => ({
        id: stepIndex,
        instruction: (step.html_instructions || '').replace(/<[^>]*>/g, ''),
        distance: step.distance?.text || '',
        duration: step.duration?.text || '',
        maneuver: step.maneuver || 'straight',
      }));
      return {
        id: index,
        coordinates,
        durationSeconds: Number(leg?.duration?.value) || 0,
        distanceMeters: Number(leg?.distance?.value) || 0,
        durationText: leg?.duration?.text || '',
        distanceText: leg?.distance?.text || '',
        summary: route?.summary || `Route ${index + 1}`,
        isFallback: false,
        steps,
      };
    });

    return { routes, selectedIndex: 0 };
  } catch (error) {
    console.warn('Google Directions failed; using fallback:', error);
    return { routes: [{ ...buildStraightLineRoute(origin, destination), id: 0, summary: 'Direct', durationText: '', distanceText: '' }], selectedIndex: 0 };
  }
};
