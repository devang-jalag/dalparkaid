import { appTheme } from '../theme/tokens';

const ZONES_URL =
  'https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/Parking_Pay_Zones/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson';

const zoneColors = {
  'ZONE A': { stroke: appTheme.color.zone.A, fill: 'rgba(231, 76, 60, 0.15)' },
  'ZONE B': { stroke: appTheme.color.zone.B, fill: 'rgba(52, 152, 219, 0.15)' },
  'ZONE C': { stroke: appTheme.color.zone.C, fill: 'rgba(46, 204, 113, 0.15)' },
  'ZONE D': { stroke: appTheme.color.zone.D, fill: 'rgba(243, 156, 18, 0.15)' },
  'ZONE E': { stroke: appTheme.color.zone.E, fill: 'rgba(155, 89, 182, 0.15)' },
  'ZONE F': { stroke: appTheme.color.zone.F, fill: 'rgba(26, 188, 156, 0.15)' },
  'ZONE G': { stroke: appTheme.color.zone.G, fill: 'rgba(230, 126, 34, 0.15)' },
  'ZONE H': { stroke: appTheme.color.zone.H, fill: 'rgba(41, 128, 185, 0.15)' },
  'ZONE I': { stroke: appTheme.color.zone.I, fill: 'rgba(192, 57, 43, 0.15)' },
  'ZONE J': { stroke: appTheme.color.zone.J, fill: 'rgba(39, 174, 96, 0.15)' },
};

const fallbackColor = { stroke: appTheme.color.zone.fallback, fill: 'rgba(149, 165, 166, 0.15)' };

const midpoint = (ring) => {
  let ltSum = 0, lnSum = 0;
  for (let i = 0; i < ring.length; i++) {
    lnSum += ring[i][0];
    ltSum += ring[i][1];
  }
  return {
    latitude: ltSum / ring.length,
    longitude: lnSum / ring.length,
  };
};

export const fetchParkingZones = async () => {
  const resp = await fetch(ZONES_URL);
  if (!resp.ok) throw new Error('hrm zone fetch failed');

  const geo = await resp.json();

  return geo.features.map((ft) => {
    const zoneName = ft.properties.ZONE || 'Unknown';
    const outerRing = ft.geometry.coordinates[0];
    const polygon = outerRing.map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    }));
    const clr = zoneColors[zoneName] || fallbackColor;

    return {
      id: ft.properties.OBJECTID,
      name: zoneName,
      polygon,
      centroid: midpoint(outerRing),
      strokeColor: clr.stroke,
      fillColor: clr.fill,
    };
  });
};
