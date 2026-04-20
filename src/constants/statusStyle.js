import { appTheme } from '../theme/tokens';

export const STATUS_META = {
  EMPTY: { label: 'Empty', color: appTheme.color.status.EMPTY },
  NORMAL: { label: 'Normal', color: appTheme.color.status.NORMAL },
  CROWDED: { label: 'Crowded', color: appTheme.color.status.CROWDED },
  ALMOST_FULL: { label: 'Almost Full', color: appTheme.color.status.ALMOST_FULL },
  FULL: { label: 'Full', color: appTheme.color.status.FULL },
  UNKNOWN: { label: 'Unknown', color: appTheme.color.status.UNKNOWN },
};
