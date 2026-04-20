import AsyncStorage from '@react-native-async-storage/async-storage';

// Keep keys in one place so we do not mistype them across files.
const MAP_REGION_KEY = 'dalparking:map:region';
const SEARCH_QUERY_KEY = 'dalparking:map:search-query';
const LOT_LIST_VISIBLE_KEY = 'dalparking:map:lot-list-visible';
const SELECTED_LOT_ID_KEY = 'dalparking:map:selected-lot-id';

// Safe JSON parse helper for anything we read from AsyncStorage.
const parseJson = (rawValue) => {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return null;
  }
};

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// Region shape guard to avoid crashing on bad cached data.
const isValidRegion = (value) => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    isFiniteNumber(value.latitude) &&
    isFiniteNumber(value.longitude) &&
    isFiniteNumber(value.latitudeDelta) &&
    isFiniteNumber(value.longitudeDelta)
  );
};

const withSilentFailure = async (work) => {
  try {
    await work();
  } catch (_error) {
    // Local cache failure should never block map usage.
  }
};

// Read all map preferences in one shot.
export const loadMapPreferences = async () => {
  try {
    const [regionRaw, queryRaw, lotListVisibleRaw, selectedLotIdRaw] = await Promise.all([
      AsyncStorage.getItem(MAP_REGION_KEY),
      AsyncStorage.getItem(SEARCH_QUERY_KEY),
      AsyncStorage.getItem(LOT_LIST_VISIBLE_KEY),
      AsyncStorage.getItem(SELECTED_LOT_ID_KEY),
    ]);

    const parsedRegion = parseJson(regionRaw);
    const parsedQuery = parseJson(queryRaw);
    const parsedLotListVisible = parseJson(lotListVisibleRaw);
    const parsedSelectedLotId = parseJson(selectedLotIdRaw);

    return {
      mapRegion: isValidRegion(parsedRegion) ? parsedRegion : null,
      searchQuery: typeof parsedQuery === 'string' ? parsedQuery : '',
      lotListVisible: typeof parsedLotListVisible === 'boolean' ? parsedLotListVisible : null,
      selectedLotId: typeof parsedSelectedLotId === 'string' ? parsedSelectedLotId : null,
    };
  } catch (_error) {
    return {
      mapRegion: null,
      searchQuery: '',
      lotListVisible: null,
      selectedLotId: null,
    };
  }
};

export const saveMapRegion = async (region) => {
  // Save latest map viewport.
  await withSilentFailure(async () => {
    await AsyncStorage.setItem(MAP_REGION_KEY, JSON.stringify(region));
  });
};

export const saveSearchQuery = async (query) => {
  // Save current search text.
  await withSilentFailure(async () => {
    await AsyncStorage.setItem(SEARCH_QUERY_KEY, JSON.stringify(query));
  });
};

export const saveLotListVisible = async (isVisible) => {
  // Save list panel open closed state.
  await withSilentFailure(async () => {
    await AsyncStorage.setItem(LOT_LIST_VISIBLE_KEY, JSON.stringify(isVisible));
  });
};

export const saveSelectedLotId = async (lotId) => {
  // Save selected lot so we can restore focus on next launch
  await withSilentFailure(async () => {
    await AsyncStorage.setItem(SELECTED_LOT_ID_KEY, JSON.stringify(lotId));
  });
};
