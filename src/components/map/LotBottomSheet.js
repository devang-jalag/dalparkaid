import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { STATUS_META } from '../../constants/statusStyle';
import { appTheme, componentMetrics } from '../../theme/tokens';
import { db } from '../../config/firebase';
import { isEveningTime, scoreToStatus } from '../../utils/engine';
import PrimaryButton from '../common/PrimaryButton';

const formatUpdatedAt = (timestamp) => {
  if (!timestamp) {
    return null;
  }

  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value ?? 50)));
const TIMELINE_TRACK_HEIGHT = 44;
const TIMELINE_BAR_MIN_HEIGHT = 8;
const TIMELINE_BAR_MAX_HEIGHT = 40;

const scoreColor = (score) => STATUS_META[scoreToStatus(clampScore(score))]?.color || appTheme.color.status.UNKNOWN;

const getTimelineStats = (scores = []) => {
  const normalizedScores = scores.map(clampScore);
  if (!normalizedScores.length) {
    return {
      normalizedScores,
      minScore: 0,
      maxScore: 100,
      range: 100,
    };
  }

  const minScore = Math.min(...normalizedScores);
  const maxScore = Math.max(...normalizedScores);

  return {
    normalizedScores,
    minScore,
    maxScore,
    range: Math.max(12, maxScore - minScore),
  };
};

const getTimelineBarHeight = (score, minScore, range) => {
  const normalized = range <= 0 ? 0.5 : (clampScore(score) - minScore) / range;
  return TIMELINE_BAR_MIN_HEIGHT + Math.round(normalized * (TIMELINE_BAR_MAX_HEIGHT - TIMELINE_BAR_MIN_HEIGHT));
};

export default function LotBottomSheet({
  visible,
  lot,
  predictedStatus,
  latestPhotoUri = null,
  canReport = true,
  currentTimeMs = Date.now(),
  reportDisabledMessage = '',
  timelineScores = [],
  dragHandleProps = {},
  scrollEnabled = true,
  onClose,
  onNavigate,
  onReport,
}) {
  const [activePage, setActivePage] = useState(0);
  const [pagerWidth, setPagerWidth] = useState(0);
  const [scoreTrackWidth, setScoreTrackWidth] = useState(0);
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [fullscreenPhoto, setFullscreenPhoto] = useState(null);
  const [barContainerWidth, setBarContainerWidth] = useState(0);
  const [hoveredHour, setHoveredHour] = useState(null);
  const pagerRef = useRef(null);
  const barWidthRef = useRef(0);
  const timelinePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const slotW = barWidthRef.current / 24;
        if (slotW <= 0) return;
        const hour = Math.min(23, Math.max(0, Math.floor(e.nativeEvent.locationX / slotW)));
        setHoveredHour(hour);
      },
      onPanResponderMove: (e) => {
        const slotW = barWidthRef.current / 24;
        if (slotW <= 0) return;
        const hour = Math.min(23, Math.max(0, Math.floor(e.nativeEvent.locationX / slotW)));
        setHoveredHour(hour);
      },
      onPanResponderRelease: () => setHoveredHour(null),
      onPanResponderTerminate: () => setHoveredHour(null),
    })
  ).current;

  useEffect(() => {
    setActivePage(0);
    requestAnimationFrame(() => {
      pagerRef.current?.scrollTo({ x: 0, animated: false });
    });
  }, [lot?.id]);

  useEffect(() => {
    if (!lot?.id) {
      setGalleryPhotos([]);
      return;
    }
    setGalleryLoading(true);
    const q = query(
      collection(db, 'reports'),
      where('lotId', '==', lot.id),
      orderBy('clientCreatedAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const photos = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((report) => report.photoUrl && report.photoUrl.length > 0);
      setGalleryPhotos(photos);
      setGalleryLoading(false);
    }, (error) => {
      console.warn('Gallery query failed:', error);
      setGalleryLoading(false);
    });
    return unsubscribe;
  }, [lot?.id]);

  if (!visible || !lot) {
    return null;
  }

  const status = predictedStatus?.status || lot.lastStatus;
  const statusMeta = STATUS_META[status] || STATUS_META.UNKNOWN;
  const clampedScore = clampScore(predictedStatus?.score);
  const dayTotal = (lot.generalSpaces || 0) + (lot.reservedSpaces || 0) + (lot.shortTermSpaces || 0);
  const eveningTotal = (lot.eveningGeneralSpaces || 0) + (lot.eveningShortTermSpaces || 0);
  const dayEst = Math.round((dayTotal * clampedScore) / 100);
  const eveEst = Math.round((eveningTotal * clampedScore) / 100);
  const eveningNow = isEveningTime(new Date(currentTimeMs || Date.now()));
  const activePeriodLabel = eveningNow ? 'Evening availability' : 'Daytime availability';
  const activeEst = eveningNow ? eveEst : dayEst;
  const activeTotal = eveningNow ? eveningTotal : dayTotal;
  const activeIconName = eveningNow ? 'moon-outline' : 'sunny-outline';
  const updatedAt = predictedStatus?.updatedAt || lot.lastStatusAt;
  const updatedText = updatedAt ? `Last updated ${formatUpdatedAt(updatedAt)}` : null;
  const { normalizedScores: normalizedTimelineScores, minScore: timelineMinScore, range: timelineRange } =
    getTimelineStats(timelineScores);
  const currentDate = new Date(currentTimeMs || Date.now());
  const currentTimelineHour = currentDate.getHours();
  const pageStyle = pagerWidth > 0 ? { width: pagerWidth } : null;
  const gradientId = `detailScoreGrad-${lot?.id || 'lot'}`;

  return (
    <View style={styles.container}>
      <View {...dragHandleProps} style={styles.dragArea}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.headerMain}>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} style={styles.name}>
                {lot.name}
              </Text>
              <View style={[styles.statusPill, { backgroundColor: statusMeta.color }]}>
                <Text style={styles.statusPillText}>{statusMeta.label}</Text>
              </View>
            </View>
            <Text numberOfLines={1} style={styles.address}>
              {lot.address}
            </Text>
            {updatedText ? <Text style={styles.updatedText}>{updatedText}</Text> : null}
          </View>
          <Pressable accessibilityLabel="Close lot details" onPress={onClose} style={styles.closeButton}>
            <Ionicons color={appTheme.color.brandGold} name="close" size={18} />
          </Pressable>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled bounces={false} contentContainerStyle={{ flexGrow: 1 }}>
      <View
        onLayout={(event) => {
          const nextWidth = Math.round(event.nativeEvent.layout.width);
          if (nextWidth > 0 && nextWidth !== pagerWidth) {
            setPagerWidth(nextWidth);
          }
        }}
        style={styles.contentShell}
      >
        <ScrollView
          ref={pagerRef}
          bounces={false}
          horizontal
          nestedScrollEnabled
          onMomentumScrollEnd={(event) => {
            const nextPage = pagerWidth > 0 ? Math.round(event.nativeEvent.contentOffset.x / pagerWidth) : 0;
            if (nextPage !== activePage) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setActivePage(nextPage);
          }}
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.pager}
        >
          <View style={[styles.page, styles.overviewPage, pageStyle]}>
            <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled bounces={false} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={styles.primaryCard}>
              <View style={styles.primaryCardMain}>
                <View style={styles.periodIconWrap}>
                  <Ionicons color={appTheme.color.brandGold} name={activeIconName} size={22} />
                </View>
                <View style={styles.primaryCardBody}>
                  <Text style={styles.primaryLabel}>{activePeriodLabel}</Text>
                  <View style={styles.primaryValueRow}>
                    <Text style={styles.primaryValue}>~{activeEst}</Text>
                    <Text style={styles.primaryValueUnit}>/ {activeTotal}</Text>
                  </View>
                  <Text style={styles.primaryCaption}>spots available now</Text>
                </View>
              </View>
              {latestPhotoUri ? (
                <View style={styles.primaryPhotoWrap}>
                  <Image resizeMode="cover" source={{ uri: latestPhotoUri }} style={styles.primaryPhoto} />
                </View>
              ) : null}
            </View>

            <View style={styles.scoreSection}>
              <View
                onLayout={(event) => {
                  const nextWidth = Math.round(event.nativeEvent.layout.width);
                  if (nextWidth > 0 && nextWidth !== scoreTrackWidth) {
                    setScoreTrackWidth(nextWidth);
                  }
                }}
                style={styles.scoreTrack}
              >
                {scoreTrackWidth > 0 ? (
                  <Svg height={14} style={styles.scoreSvg} width={scoreTrackWidth}>
                    <Defs>
                      <LinearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
                        <Stop offset="0%" stopColor={appTheme.color.status.FULL} />
                        <Stop offset="50%" stopColor={appTheme.color.status.CROWDED} />
                        <Stop offset="100%" stopColor={appTheme.color.status.EMPTY} />
                      </LinearGradient>
                    </Defs>
                    <Rect fill={`url(#${gradientId})`} height="10" rx="5" ry="5" width={scoreTrackWidth} x="0" y="2" />
                  </Svg>
                ) : null}
                <View
                  style={[
                    styles.scorePointer,
                    {
                      left: `${clampedScore}%`,
                      backgroundColor: scoreColor(clampedScore),
                    },
                  ]}
                />
              </View>
              <View style={styles.scoreCaptionRow}>
                <Text style={styles.scoreCaption}>Full</Text>
                <Text style={styles.scoreCaption}>Empty</Text>
              </View>
            </View>

            {timelineScores.length > 0 ? (
              <View style={styles.timelineSection}>
                <Text style={styles.timelineTitle}>Today</Text>
                <View style={{ position: 'relative', marginTop: 12, overflow: 'visible' }}>
                  {barContainerWidth > 0 && (() => {
                    const slotWidth = barContainerWidth / 24;
                    const dotLeft = 4 + (currentTimelineHour * slotWidth) + (slotWidth / 2) - 4;
                    return (
                      <View style={{
                        position: 'absolute',
                        top: -9,
                        left: dotLeft,
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: '#FFFFFF',
                        zIndex: 10,
                      }} />
                    );
                  })()}
                  <View
                    style={styles.timelineBars}
                    onLayout={(e) => {
                      const w = e.nativeEvent.layout.width - 8;
                      setBarContainerWidth(w);
                      barWidthRef.current = w;
                    }}
                    {...timelinePanResponder.panHandlers}
                  >
                    {normalizedTimelineScores.map((score, index) => {
                      const isCurrentSlot = index === currentTimelineHour;
                      const isPastSlot = index < currentTimelineHour;

                      return (
                        <View
                          key={`timeline-${index}`}
                          style={[
                            styles.timelineSlot,
                            isPastSlot && styles.timelineSlotPast,
                          ]}
                        >
                          {index === hoveredHour && (
                            <View style={{
                              position: 'absolute',
                              top: -20,
                              alignSelf: 'center',
                              backgroundColor: 'rgba(0,0,0,0.55)',
                              borderRadius: 4,
                              paddingHorizontal: 3,
                              paddingVertical: 1,
                            }}>
                              <Text style={{ color: '#FFFFFF', fontSize: 8, fontWeight: '700' }}>
                                {String(index).padStart(2, '0')}:00
                              </Text>
                            </View>
                          )}
                          <View
                            style={[
                              styles.timelineTrack,
                              isPastSlot && styles.timelineTrackPast,
                              index === 7 && styles.timelinePhaseDivider,
                              index === 17 && styles.timelinePhaseDivider,
                            ]}
                          />
                          <View
                            style={[
                              styles.timelineBar,
                              isPastSlot && styles.timelineBarPast,
                              {
                                height: getTimelineBarHeight(score, timelineMinScore, timelineRange),
                                backgroundColor: scoreColor(score),
                              },
                              index === hoveredHour && { transform: [{ scaleY: 1.4 }] },
                            ]}
                          />
                        </View>
                      );
                    })}
                  </View>
                </View>
                <View style={styles.timelineLabelRow}>
                  <Text style={styles.timelineLabel}>00:00</Text>
                  <Text style={styles.timelineLabel}>08:00</Text>
                  <Text style={styles.timelineLabel}>17:00</Text>
                  <Text style={styles.timelineLabel}>23:00</Text>
                </View>
              </View>
            ) : null}
            </ScrollView>
          </View>

          <View style={[styles.page, pageStyle]}>
            {galleryLoading ? (
              <View style={styles.galleryEmpty}>
                <ActivityIndicator color={appTheme.color.brandGold} size="small" />
              </View>
            ) : galleryPhotos.length === 0 ? (
              <View style={styles.galleryEmpty}>
                <Ionicons name="images-outline" size={36} color={appTheme.color.textSecondary} />
                <Text style={styles.galleryEmptyText}>No photos reported yet</Text>
                <Text style={styles.galleryEmptySubtext}>Be the first to report this lot!</Text>
              </View>
            ) : (
              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                <View style={styles.galleryGrid}>
                  {galleryPhotos.map((photo) => (
                    <Pressable
                      key={photo.id}
                      onPress={() => setFullscreenPhoto(photo.photoUrl)}
                      style={styles.galleryThumb}
                    >
                      <Image
                        source={{ uri: photo.photoUrl }}
                        style={styles.galleryImage}
                        resizeMode="cover"
                      />
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        </ScrollView>
      </View>

      <View style={styles.pageDotRow}>
        <View style={[styles.pageDot, activePage === 0 && styles.pageDotActive]} />
        <View style={[styles.pageDot, activePage === 1 && styles.pageDotActive]} />
      </View>

      <View style={styles.scrollContent}>
        <View style={styles.actionRow}>
          <PrimaryButton accessibilityLabel="Navigate to lot" label="Navigate" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onNavigate(); }} style={styles.actionPrimary} />
          {canReport ? (
            <Pressable accessibilityLabel="Report lot status" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onReport(); }} style={styles.actionSecondary}>
              <Text style={styles.actionSecondaryText}>Report Status</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      </ScrollView>

      {fullscreenPhoto ? (
        <Modal transparent visible={true} onRequestClose={() => setFullscreenPhoto(null)}>
          <Pressable style={styles.fullscreenOverlay} onPress={() => setFullscreenPhoto(null)}>
            <Image source={{ uri: fullscreenPhoto }} style={styles.fullscreenImage} resizeMode="contain" />
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appTheme.color.bgElevated,
    borderTopLeftRadius: appTheme.radius.xl,
    borderTopRightRadius: appTheme.radius.xl,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    paddingHorizontal: componentMetrics.horizontalPadding,
    overflow: 'hidden',
  },
  contentShell: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: componentMetrics.bottomSafePadding + appTheme.spacing.sm,
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  overviewPage: {
    paddingBottom: appTheme.spacing.xs,
  },
  dragArea: {
    paddingTop: appTheme.spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: appTheme.radius.sm,
    backgroundColor: appTheme.color.brandGold,
    opacity: 0.7,
    marginBottom: appTheme.spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: appTheme.spacing.md,
    gap: appTheme.spacing.sm,
  },
  headerMain: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
  },
  name: {
    color: appTheme.color.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    flexShrink: 1,
  },
  address: {
    color: appTheme.color.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  updatedText: {
    color: appTheme.color.textSecondary,
    fontSize: 12,
    marginTop: 6,
  },
  statusPill: {
    borderRadius: appTheme.radius.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillText: {
    color: appTheme.color.bgCanvas,
    fontSize: 12,
    fontWeight: '700',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(242, 201, 76, 0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(242, 201, 76, 0.4)',
  },
  pageDotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 16,
  },
  pageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  pageDotActive: {
    width: 22,
    backgroundColor: '#F2C94C',
  },
  primaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: appTheme.spacing.xs,
    padding: appTheme.spacing.xs,
    borderRadius: appTheme.radius.lg,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgSurface,
    marginBottom: appTheme.spacing.xs,
  },
  primaryCardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: appTheme.spacing.md,
  },
  periodIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(242, 201, 76, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(242, 201, 76, 0.25)',
  },
  primaryCardBody: {
    flex: 1,
  },
  primaryLabel: {
    color: appTheme.color.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  primaryValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  primaryValue: {
    color: appTheme.color.textPrimary,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 30,
  },
  primaryValueUnit: {
    color: appTheme.color.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 1,
  },
  primaryCaption: {
    color: appTheme.color.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  primaryPhotoWrap: {
    width: 128,
    height: 88,
    borderRadius: appTheme.radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgElevated,
  },
  primaryPhoto: {
    width: '100%',
    height: '100%',
  },
  timelineSection: {
    marginBottom: appTheme.spacing.xs,
  },
  timelineTitle: {
    color: appTheme.color.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  timelineBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 48,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    borderRadius: appTheme.radius.sm,
    backgroundColor: appTheme.color.bgSurface,
    paddingHorizontal: 4,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  timelineSlot: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
    borderRadius: 4,
    paddingVertical: 2,
  },
  timelineSlotCurrent: {
    backgroundColor: 'rgba(242, 201, 76, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(242, 201, 76, 0.55)',
  },
  timelineSlotPast: {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  timelineTrack: {
    position: 'absolute',
    bottom: 0,
    width: 4,
    height: TIMELINE_TRACK_HEIGHT,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  timelineTrackCurrent: {
    backgroundColor: 'rgba(242, 201, 76, 0.28)',
  },
  timelineTrackPast: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  timelinePhaseDivider: {
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.16)',
  },
  timelineBar: {
    width: 4,
    borderRadius: 3,
    zIndex: 1,
  },
  timelineBarCurrent: {
    width: 6,
    borderRadius: 4,
  },
  timelineBarPast: {
    opacity: 0.42,
  },
  timelineLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timelineLabel: {
    color: appTheme.color.textSecondary,
    fontSize: 10,
  },
  actionRow: {
    flexDirection: 'row',
    gap: appTheme.spacing.sm,
    marginBottom: 1,
    alignItems: 'center',
  },
  actionPrimary: {
    flex: 1,
  },
  actionSecondary: {
    minHeight: componentMetrics.primaryButtonHeight,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgSurface,
    paddingHorizontal: appTheme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionSecondaryText: {
    color: appTheme.color.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  scoreSection: {
    marginBottom: appTheme.spacing.xs,
  },
  scoreHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: appTheme.spacing.xs,
  },
  scoreHeading: {
    color: appTheme.color.textSecondary,
    fontSize: 12,
  },
  scoreValue: {
    color: appTheme.color.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  scoreTrack: {
    position: 'relative',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
  },
  scoreSvg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  scorePointer: {
    position: 'absolute',
    top: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    transform: [{ translateX: -6 }],
  },
  scoreCaptionRow: {
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreCaption: {
    color: appTheme.color.textSecondary,
    fontSize: 11,
  },
  detailsPanel: {
    marginBottom: appTheme.spacing.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    borderRadius: appTheme.radius.md,
    backgroundColor: appTheme.color.bgSurface,
    padding: appTheme.spacing.md,
    gap: appTheme.spacing.sm,
  },
  detailsGrid: {
    flexDirection: 'row',
    gap: appTheme.spacing.sm,
  },
  detailsItem: {
    flex: 1,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    borderRadius: appTheme.radius.sm,
    backgroundColor: appTheme.color.bgElevated,
    padding: appTheme.spacing.sm,
  },
  detailsItemLabel: {
    color: appTheme.color.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  detailsItemValue: {
    color: appTheme.color.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  detailsLine: {
    color: appTheme.color.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  galleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: appTheme.spacing.xs,
  },
  galleryThumb: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: appTheme.radius.sm,
    overflow: 'hidden',
    backgroundColor: appTheme.color.bgSurface,
  },
  galleryImage: {
    width: '100%',
    height: '100%',
  },
  galleryEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  galleryEmptyText: {
    color: appTheme.color.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  galleryEmptySubtext: {
    color: appTheme.color.textSecondary,
    fontSize: 12,
    opacity: 0.7,
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenImage: {
    width: '90%',
    height: '70%',
  },
});
