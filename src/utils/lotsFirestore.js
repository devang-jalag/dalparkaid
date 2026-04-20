import { collection, onSnapshot } from 'firebase/firestore';

import { db } from '../config/firebase';
import { PARKING_LOTS } from '../data/parkingLots';

const ALLOWED_STATUS = new Set(['EMPTY', 'NORMAL', 'CROWDED', 'FULL', 'UNKNOWN']);
const ALLOWED_CONFIDENCE = new Set(['LOW', 'MEDIUM', 'HIGH']);
const ALLOWED_LOT_TYPES = new Set(['COMMUTER_LOT', 'RESIDENCE_LOT', 'PARKADE_LOT', 'EVENT_LOT']);
const DEFAULT_COORDINATE = { latitude: 44.6383, longitude: -63.5859 };

const toNumber = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const toCoordinate = (value, fallback) => {
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const latitude = toNumber(value.latitude, Number.NaN);
  const longitude = toNumber(value.longitude, Number.NaN);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }

  const lat = toNumber(value.lat, Number.NaN);
  const lon = toNumber(value.lng ?? value.lon, Number.NaN);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { latitude: lat, longitude: lon };
  }

  return fallback;
};

const toTimestampMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  return undefined;
};

const inferLotType = (data, fallback) => {
  const directType =
    typeof data?.lotType === 'string'
      ? data.lotType.trim().toUpperCase()
      : typeof fallback?.lotType === 'string'
        ? fallback.lotType.trim().toUpperCase()
        : null;

  if (directType && ALLOWED_LOT_TYPES.has(directType)) {
    return directType;
  }

  const lotName = `${data?.name || fallback?.name || ''}`.toLowerCase();
  if (
    [
      'glengarry',
      'risley hall lot',
      'risley hall parkade',
      'shirreff hall',
      'stairs',
    ].includes(lotName)
  ) {
    return 'RESIDENCE_LOT';
  }

  if (lotName === 'dalplex') {
    return 'EVENT_LOT';
  }

  if (lotName.includes('parkade')) {
    return 'PARKADE_LOT';
  }

  return 'COMMUTER_LOT';
};

const normalizeLot = (id, data) => {
  const localFallback = PARKING_LOTS.find((lot) => lot.id === id) || PARKING_LOTS[0] || {};
  const coordinate = toCoordinate(data.coordinate, localFallback.coordinate || DEFAULT_COORDINATE);

  return {
    id,
    campus:
      data.campus === 'sexton' || data.campus === 'studley'
        ? data.campus
        : localFallback.campus || 'studley',
    lotType: inferLotType(data, localFallback),
    name: typeof data.name === 'string' ? data.name : localFallback.name,
    address: typeof data.address === 'string' ? data.address : localFallback.address,
    coordinate,
    navigationCoordinate: toCoordinate(data.navigationCoordinate, coordinate),
    generalSpaces: toNumber(data.generalSpaces, 0),
    reservedSpaces: toNumber(data.reservedSpaces, 0),
    shortTermSpaces: toNumber(data.shortTermSpaces, 0),
    eveningGeneralSpaces: toNumber(data.eveningGeneralSpaces, 0),
    eveningShortTermSpaces: toNumber(data.eveningShortTermSpaces, 0),
    lastStatus: ALLOWED_STATUS.has(data.lastStatus) ? data.lastStatus : 'UNKNOWN',
    statusConfidence: ALLOWED_CONFIDENCE.has(data.statusConfidence) ? data.statusConfidence : 'LOW',
    lastStatusAt: toTimestampMs(data.lastStatusAt),
  };
};

export const subscribeLots = (onLots, onError) => {
  const lotsRef = collection(db, 'lots');

  return onSnapshot(
    lotsRef,
    (snapshot) => {
      if (snapshot.empty) {
        // Keep app usable even if Firestore has not been seeded yet.
        onLots(PARKING_LOTS);
        return;
      }

      const lots = snapshot.docs
        .map((docSnapshot) => normalizeLot(docSnapshot.id, docSnapshot.data()))
        .sort((left, right) => left.name.localeCompare(right.name));

      onLots(lots);
    },
    (error) => {
      // If network/rules fail, fall back to local data instead of blank map.
      onLots(PARKING_LOTS);
      if (onError) {
        onError(error);
      }
    }
  );
};
