import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, limit, onSnapshot, orderBy, query, getDocs, where } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { appTheme, componentMetrics } from '../theme/tokens';
import { getReportTrustLabel, getReportVoteMeta, loadUserReportVotes, toggleReportVote } from '../utils/reportVotes';

// ─── Constants ────────────────────────────────────────────────────────────────
const BUSY_TAGS = ['Full', 'Busy', 'Moderate', 'Available', 'Empty'];
const RATING_LABELS = ['Full', 'Busy', 'Moderate', 'Available', 'Empty'];
const ONE_HR = 60 * 60 * 1000;
const LIKE_VALUE = 1;
const DISLIKE_VALUE = -1;
const REPORTS_HISTORY_LIMIT = 200;
const REPORT_CARD_MEDIA_HEIGHT = 86;
const MEDAL_EMOJIS = ['🥇', '🥈', '🥉'];
const MAX_LOT_FILTER_CHIPS = 4; // "All Lots" + 3 unique lot names shown

// ─── Helpers ──────────────────────────────────────────────────────────────────
const toTimestampMs = (value) => {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const fmtDate = (ts) => {
  if (!ts) return '';
  const d = new Date(toTimestampMs(ts));
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const getReportCreatedAt = (report) => report?.createdAt ?? report?.clientCreatedAt ?? null;
const getReportImageUri = (report) => report?.photoUrl || report?.imgUri || null;

const getMonthLabel = () => {
  const now = new Date();
  return now.toLocaleString('default', { month: 'long', year: 'numeric' });
};

const isThisMonth = (report) => {
  const ts = toTimestampMs(getReportCreatedAt(report));
  if (!ts) return false;
  const d = new Date(ts);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

// Rating index (1-based) → status filter label
const ratingMatchesFilter = (rating, statusFilter) => {
  if (statusFilter === 'All') return true;
  const label = RATING_LABELS[(rating || 1) - 1];
  return label === statusFilter;
};

// ─── BusyDots ─────────────────────────────────────────────────────────────────
const BusyDots = ({ lvl, compact = false }) => (
  <View style={[st.dotsRow, compact && st.dotsRowCompact]}>
    {[1, 2, 3, 4, 5].map((v) => (
      <View key={v} style={[st.dot, v <= lvl && st.dotFill]} />
    ))}
    <Text style={[st.dotLbl, compact && st.dotLblCompact]}>{BUSY_TAGS[lvl - 1]}</Text>
  </View>
);

// ─── Dropdown Picker ──────────────────────────────────────────────────────────
const DropdownPicker = ({ label, options, selected, onSelect, accentColor, defaultValue }) => {
  const [open, setOpen] = useState(false);
  const isNonDefault = selected !== defaultValue;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[
          st.dropdownBtn,
          isNonDefault && { borderColor: accentColor },
        ]}
      >
        <Text
          style={[
            st.dropdownBtnTxt,
            isNonDefault && { color: accentColor },
          ]}
          numberOfLines={1}
        >
          {isNonDefault ? selected : label}
        </Text>
        <Ionicons name="chevron-down" size={14} color={isNonDefault ? accentColor : appTheme.color.textSecondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={st.modalOverlay} onPress={() => setOpen(false)}>
          <View style={st.modalSheet} onStartShouldSetResponder={() => true}>
            <Text style={st.modalTitle}>{label}</Text>
            {options.map((opt) => {
              const active = opt === selected;
              return (
                <Pressable
                  key={opt}
                  onPress={() => { onSelect(opt); setOpen(false); }}
                  style={st.modalOption}
                >
                  <Text style={[st.modalOptionTxt, active && { color: accentColor }]}>{opt}</Text>
                  {active && <Ionicons name="checkmark" size={18} color={accentColor} />}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
};

// ─── Tab Toggle ───────────────────────────────────────────────────────────────
const TabToggle = ({ activeTab, onTabChange }) => (
  <View style={st.toggleRow}>
    <Pressable
      style={[st.toggleBtn, activeTab === 'community' && st.toggleBtnActive]}
      onPress={() => onTabChange('community')}
    >
      <Text style={[st.toggleTxt, activeTab === 'community' && st.toggleTxtActive]}>Community</Text>
    </Pressable>
    <Pressable
      style={[st.toggleBtn, activeTab === 'leaderboard' && st.toggleBtnActive]}
      onPress={() => onTabChange('leaderboard')}
    >
      <Text style={[st.toggleTxt, activeTab === 'leaderboard' && st.toggleTxtActive]}>Leaderboard</Text>
    </Pressable>
  </View>
);

// ─── Leaderboard Row ──────────────────────────────────────────────────────────
const LeaderRow = ({ entry, rank, isMe }) => {
  const medal = rank <= 3 ? MEDAL_EMOJIS[rank - 1] : null;
  const rankLabel = medal || `#${rank}`;
  return (
    <View style={[st.leaderCard, isMe && st.leaderCardMe]}>
      <Text style={st.leaderRank}>{rankLabel}</Text>
      <View style={st.leaderInfo}>
        <Text style={[st.leaderName, isMe && st.leaderNameMe]} numberOfLines={1}>
          {entry.displayName || 'Anonymous'}
          {isMe ? '  (you)' : ''}
        </Text>
        <Text style={st.leaderSub}>
          {entry.monthCount} this month · {entry.totalCount} total
        </Text>
      </View>
      <View style={[st.leaderBadge, isMe && st.leaderBadgeMe]}>
        <Text style={[st.leaderBadgeNum, isMe && st.leaderBadgeNumMe]}>{entry.monthCount}</Text>
        <Text style={[st.leaderBadgeLbl, isMe && st.leaderBadgeLblMe]}>reports</Text>
      </View>
    </View>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function HistoryScreen() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bigImg, setBigImg] = useState(null);
  const [userVotes, setUserVotes] = useState({});
  const [pendingVotes, setPendingVotes] = useState({});
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const [activeTab, setActiveTab] = useState('community');

  // Filter state
  const [lotFilter, setLotFilter] = useState('All Lots');
  const [statusFilter, setStatusFilter] = useState('All');
  
  // Real-time profile state for the leaderboard
  const [leaderboardProfiles, setLeaderboardProfiles] = useState({});

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setCurrentUser(nextUser);
    });
    return unsubscribe;
  }, []);

  const pull = useCallback(async () => {
    try {
      if (!currentUser?.uid) { setUserVotes({}); return; }
      const voteMap = await loadUserReportVotes(currentUser?.uid);
      setUserVotes(voteMap);
    } catch (_e) {
      setUserVotes({});
    }
  }, [currentUser?.uid]);

  useEffect(() => {
    const reportsQuery = query(
      collection(db, 'reports'),
      orderBy('clientCreatedAt', 'desc'),
      limit(REPORTS_HISTORY_LIMIT)
    );
    return onSnapshot(
      reportsQuery,
      (snapshot) => {
        const rows = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => toTimestampMs(getReportCreatedAt(b)) - toTimestampMs(getReportCreatedAt(a)));
        setItems(rows);
        setBusy(false);
        setRefreshing(false);
      },
      () => {
        setItems([]);
        setBusy(false);
        setRefreshing(false);
      }
    );
  }, []);

  useEffect(() => { pull(); }, [pull]);

  // ── Lot filter options derived from data
  const lotFilterOptions = useMemo(() => {
    const names = [...new Set(items.map((r) => r.lotName || r.lotId).filter(Boolean))];
    // show up to MAX_LOT_FILTER_CHIPS-1 lot names after "All Lots"
    return ['All Lots', ...names.slice(0, MAX_LOT_FILTER_CHIPS - 1)];
  }, [items]);

  const statusFilterOptions = ['All', 'Full', 'Busy', 'Moderate', 'Available', 'Empty'];

  // ── Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((r) => {
      const lotMatch = lotFilter === 'All Lots' || (r.lotName || r.lotId) === lotFilter;
      const statusMatch = ratingMatchesFilter(r.rating, statusFilter);
      return lotMatch && statusMatch;
    });
  }, [items, lotFilter, statusFilter]);

  // ── Community feed sections
  const sections = useMemo(() => {
    const cutoff = Date.now() - ONE_HR;
    const recent = filteredItems.filter((r) => toTimestampMs(getReportCreatedAt(r)) > cutoff);
    const past = filteredItems.filter((r) => toTimestampMs(getReportCreatedAt(r)) <= cutoff);
    const out = [];
    if (recent.length > 0) out.push({ title: 'Recent (Active)', data: recent });
    if (past.length > 0) out.push({ title: 'Past', data: past });
    return out;
  }, [filteredItems]);

  // ── Leaderboard aggregation
  const leaderboard = useMemo(() => {
    const map = {};
    items.forEach((report) => {
      const uid = report.userId || report.userEmail || 'anon';
      if (!map[uid]) {
        map[uid] = {
          uid,
          displayName: report.displayName || null,
          userEmail: report.userEmail || null,
          totalCount: 0,
          monthCount: 0,
        };
      }
      map[uid].totalCount += 1;
      if (isThisMonth(report)) map[uid].monthCount += 1;
    });
    return Object.values(map)
      .sort((a, b) => b.monthCount - a.monthCount || b.totalCount - a.totalCount);
  }, [items]);

  useEffect(() => {
    const fetchProfiles = async () => {
      // Query up to 10 top UIDs to fetch their live profiles
      const topIds = leaderboard.slice(0, 10).map(u => u.uid).filter(uid => uid !== 'anon');
      if (topIds.length === 0) return;
      
      try {
        const q = query(collection(db, 'userProfiles'), where('__name__', 'in', topIds));
        const snapshot = await getDocs(q);
        const pMap = {};
        snapshot.forEach(doc => {
          pMap[doc.id] = doc.data();
        });
        setLeaderboardProfiles(pMap);
      } catch (err) {
        console.log('Failed to pull live names', err);
      }
    };
    fetchProfiles();
  }, [leaderboard]);

  // ── Vote handler
  const handleVote = async (item, nextValue) => {
    if (!currentUser) {
      Alert.alert('Sign in required', 'Please sign in to vote on community reports.');
      return;
    }
    if (item.userId === currentUser.uid) return;
    if (pendingVotes[item.id]) return;

    setPendingVotes((prev) => ({ ...prev, [item.id]: true }));
    try {
      const result = await toggleReportVote({
        reportId: item.id,
        reportOwnerId: item.userId,
        nextValue,
        userId: currentUser.uid,
      });
      setUserVotes((prev) => ({ ...prev, [item.id]: result.currentVote }));
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? {
              ...entry,
              upvoteCount: result.upvoteCount,
              downvoteCount: result.downvoteCount,
              voteScore: result.voteScore,
              voteWeightMultiplier: result.voteWeightMultiplier,
              voteUpdatedAt: result.voteUpdatedAt,
            }
            : entry
        )
      );
    } catch (error) {
      if (error?.message === 'self_vote_forbidden') {
        Alert.alert('Vote unavailable', 'You cannot vote on your own report.');
      } else {
        Alert.alert('Vote failed', 'Could not update your vote right now.');
      }
    } finally {
      setPendingVotes((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  // ── Report card renderer
  const row = ({ item }) => {
    const voteMeta = getReportVoteMeta(item);
    const currentVote = userVotes[item.id] || 0;
    const trustLabel = getReportTrustLabel(item);
    const votingDisabled = !currentUser || item.userId === currentUser?.uid || pendingVotes[item.id];
    const imageUri = getReportImageUri(item);

    const voteControls = (
      <View style={[st.voteRow, !imageUri && st.voteRowCompact]}>
        <Pressable
          accessibilityLabel="Like report"
          accessibilityRole="button"
          disabled={votingDisabled}
          onPress={() => handleVote(item, LIKE_VALUE)}
          style={[
            st.voteBtn,
            !imageUri && st.voteBtnCompact,
            currentVote === LIKE_VALUE && st.voteBtnLiked,
            votingDisabled && st.voteBtnDisabled,
          ]}
        >
          <Ionicons
            color={currentVote === LIKE_VALUE ? appTheme.color.bgCanvas : appTheme.color.textSecondary}
            name={currentVote === LIKE_VALUE ? 'thumbs-up' : 'thumbs-up-outline'}
            size={14}
          />
          <Text style={[st.voteTxt, currentVote === LIKE_VALUE && st.voteTxtActive]}>
            {voteMeta.upvoteCount}
          </Text>
        </Pressable>

        <Pressable
          accessibilityLabel="Dislike report"
          accessibilityRole="button"
          disabled={votingDisabled}
          onPress={() => handleVote(item, DISLIKE_VALUE)}
          style={[
            st.voteBtn,
            !imageUri && st.voteBtnCompact,
            currentVote === DISLIKE_VALUE && st.voteBtnDisliked,
            votingDisabled && st.voteBtnDisabled,
          ]}
        >
          <Ionicons
            color={currentVote === DISLIKE_VALUE ? '#FFFFFF' : appTheme.color.textSecondary}
            name={currentVote === DISLIKE_VALUE ? 'thumbs-down' : 'thumbs-down-outline'}
            size={14}
          />
          <Text style={[st.voteTxt, currentVote === DISLIKE_VALUE && st.voteTxtDisliked]}>
            {voteMeta.downvoteCount}
          </Text>
        </Pressable>

        {trustLabel ? <Text style={[st.trustTag, !imageUri && st.trustTagCompact]}>{trustLabel}</Text> : null}
      </View>
    );

    return (
      <View style={st.card}>
        <View style={[st.cardInner, !imageUri && st.cardInnerNoPhoto]}>
          <View style={[st.cardMain, !imageUri && st.cardMainNoPhoto]}>
            <Text style={[st.lotTxt, !imageUri && st.lotTxtNoPhoto]}>{item.lotName || item.lotId}</Text>
            <Text style={[st.dateTxt, !imageUri && st.dateTxtNoPhoto]}>{fmtDate(getReportCreatedAt(item))}</Text>
            {imageUri ? <BusyDots lvl={item.rating} /> : null}
            {imageUri ? voteControls : null}
          </View>
          {!imageUri ? (
            <View style={st.cardSide}>
              <BusyDots compact lvl={item.rating} />
              {voteControls}
            </View>
          ) : null}
        </View>
        {imageUri ? (
          <Pressable onPress={() => setBigImg(imageUri)}>
            <Image source={{ uri: imageUri }} style={st.thumb} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  if (busy) {
    return (
      <View style={st.wrap}>
        <Text style={st.noDataTxt}>Loading reports...</Text>
      </View>
    );
  }

  return (
    <View style={st.wrap}>
      {/* Tab toggle */}
      <View style={st.headerArea}>
        <TabToggle activeTab={activeTab} onTabChange={setActiveTab} />
      </View>

      {/* ── COMMUNITY TAB ── */}
      {activeTab === 'community' && (
        <>
          {/* Filter dropdowns */}
          <View style={st.filterRow}>
            <DropdownPicker
              label="Filter by Lot"
              options={lotFilterOptions}
              selected={lotFilter}
              onSelect={setLotFilter}
              accentColor={appTheme.color.brandGold}
              defaultValue="All Lots"
            />
            <DropdownPicker
              label="Filter by Status"
              options={statusFilterOptions}
              selected={statusFilter}
              onSelect={setStatusFilter}
              accentColor={appTheme.color.brandBlue}
              defaultValue="All"
            />
          </View>

          {filteredItems.length === 0 ? (
            <View style={st.noData}>
              <Text style={st.noDataTxt}>
                {items.length === 0 ? 'No reports yet.' : 'No reports match your filters.'}
              </Text>
              {items.length === 0 ? (
                <Text style={st.noDataSub}>
                  Go to the map, pick a lot, and tap "Report Status" to submit your first one.
                </Text>
              ) : null}
            </View>
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(i) => i.id}
              renderItem={row}
              renderSectionHeader={({ section }) => (
                <Text style={st.sectionHdr}>{section.title}</Text>
              )}
              contentContainerStyle={st.feed}
              showsVerticalScrollIndicator={false}
              stickySectionHeadersEnabled={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={async () => {
                    setRefreshing(true);
                    await pull();
                    setRefreshing(false);
                  }}
                  tintColor={appTheme.color.brandGold}
                  colors={[appTheme.color.brandGold]}
                />
              }
            />
          )}
        </>
      )}

      {/* ── LEADERBOARD TAB ── */}
      {activeTab === 'leaderboard' && (
        <ScrollView
          contentContainerStyle={st.leaderFeed}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await pull();
                setRefreshing(false);
              }}
              tintColor={appTheme.color.brandGold}
              colors={[appTheme.color.brandGold]}
            />
          }
        >
          <Text style={st.leaderMonthLabel}>{getMonthLabel()}</Text>

          {leaderboard.length === 0 ? (
            <View style={st.noData}>
              <Text style={st.noDataTxt}>No reports this month yet.</Text>
              <Text style={st.noDataSub}>Be the first to report a lot's status!</Text>
            </View>
          ) : (
            leaderboard.map((entry, idx) => {
              const liveProfile = leaderboardProfiles[entry.uid];
              const resolvedName = liveProfile?.isAnonymous 
                ? 'Anonymous' 
                : (liveProfile?.displayName || entry.displayName || entry.userEmail || 'User');

              return (
                <LeaderRow
                  key={entry.uid}
                  entry={{ ...entry, displayName: resolvedName }}
                  rank={idx + 1}
                  isMe={currentUser?.uid === entry.uid}
                />
              );
            })
          )}
        </ScrollView>
      )}

      {/* Fullscreen image modal */}
      <Modal
        visible={!!bigImg}
        transparent
        animationType="fade"
        onRequestClose={() => setBigImg(null)}
      >
        <Pressable style={st.imgOverlay} onPress={() => setBigImg(null)}>
          {bigImg && <Image source={{ uri: bigImg }} style={st.bigImg} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: appTheme.color.bgCanvas,
    paddingTop: 60,
  },

  // ── Header / toggle ──────────────────────────────────────────────────────────
  headerArea: {
    paddingHorizontal: componentMetrics.horizontalPadding,
    marginBottom: appTheme.spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: appTheme.spacing.sm,
  },
  toggleBtn: {
    flex: 1,
    height: 42,
    borderRadius: appTheme.radius.lg,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnActive: {
    borderColor: appTheme.color.brandGold,
    backgroundColor: 'rgba(242,201,76,0.12)',
  },
  toggleTxt: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
  },
  toggleTxtActive: {
    color: appTheme.color.brandGold,
  },

  // ── Filter dropdowns ─────────────────────────────────────────────────────────
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: componentMetrics.horizontalPadding,
    gap: appTheme.spacing.sm,
    marginBottom: appTheme.spacing.xs,
  },
  dropdownBtn: {
    flex: 1,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgSurface,
  },
  dropdownBtnTxt: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
    fontWeight: '600',
    flex: 1,
    marginRight: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: appTheme.color.bgSurface,
    borderTopLeftRadius: appTheme.radius.lg,
    borderTopRightRadius: appTheme.radius.lg,
    paddingTop: appTheme.spacing.md,
    paddingBottom: 32,
    paddingHorizontal: componentMetrics.horizontalPadding,
  },
  modalTitle: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.md,
    fontWeight: '700',
    marginBottom: appTheme.spacing.sm,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: appTheme.color.borderDefault,
  },
  modalOptionTxt: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.sm,
  },

  // ── Community feed ───────────────────────────────────────────────────────────
  feed: {
    paddingHorizontal: componentMetrics.horizontalPadding,
    paddingBottom: 20,
  },
  sectionHdr: {
    color: appTheme.color.brandGold,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
    marginTop: appTheme.spacing.md,
    marginBottom: appTheme.spacing.xs,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: appTheme.color.bgSurface,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    padding: appTheme.spacing.sm,
    marginBottom: appTheme.spacing.sm,
    minHeight: REPORT_CARD_MEDIA_HEIGHT + appTheme.spacing.sm * 2,
  },
  cardInner: { flex: 1 },
  cardInnerNoPhoto: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: appTheme.spacing.md,
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
  },
  cardMainNoPhoto: { justifyContent: 'center' },
  cardSide: {
    width: 138,
    alignItems: 'flex-end',
    alignSelf: 'stretch',
    justifyContent: 'center',
    gap: appTheme.spacing.sm,
  },
  lotTxt: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.md,
    fontWeight: '700',
  },
  lotTxtNoPhoto: { marginBottom: 6, lineHeight: 22 },
  dateTxt: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
    marginTop: 2,
    marginBottom: appTheme.spacing.xs,
  },
  dateTxtNoPhoto: { marginTop: 0, marginBottom: 0, lineHeight: 18 },

  // ── Dots ─────────────────────────────────────────────────────────────────────
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dotsRowCompact: { justifyContent: 'flex-end', flexWrap: 'wrap' },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: appTheme.color.bgElevated,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
  },
  dotFill: { backgroundColor: appTheme.color.brandGold, borderColor: appTheme.color.brandGold },
  dotLbl: { color: appTheme.color.textSecondary, fontSize: 11, marginLeft: 4 },
  dotLblCompact: { marginLeft: 0 },

  // ── Votes ────────────────────────────────────────────────────────────────────
  voteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: appTheme.spacing.sm,
  },
  voteRowCompact: { justifyContent: 'flex-end', marginTop: 0, gap: 6 },
  voteBtn: {
    minWidth: 58,
    height: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  voteBtnCompact: { minWidth: 54, height: 28, paddingHorizontal: 8 },
  voteBtnLiked: { backgroundColor: 'rgba(34,197,94,0.22)', borderColor: 'rgba(34,197,94,0.6)' },
  voteBtnDisliked: { backgroundColor: 'rgba(239,68,68,0.28)', borderColor: 'rgba(239,68,68,0.6)' },
  voteBtnDisabled: { opacity: 0.65 },
  voteTxt: { color: appTheme.color.textSecondary, fontSize: 12, fontWeight: '700' },
  voteTxtActive: { color: appTheme.color.textPrimary },
  voteTxtDisliked: { color: '#FFFFFF' },
  trustTag: { color: appTheme.color.brandGold, fontSize: 11, fontWeight: '700' },
  trustTagCompact: { textAlign: 'right' },

  // ── Thumb ────────────────────────────────────────────────────────────────────
  thumb: {
    width: 158,
    height: REPORT_CARD_MEDIA_HEIGHT,
    borderRadius: appTheme.radius.sm,
    marginLeft: appTheme.spacing.sm,
  },

  // ── Empty states ──────────────────────────────────────────────────────────────
  noData: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: componentMetrics.horizontalPadding,
  },
  noDataTxt: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.md,
    textAlign: 'center',
  },
  noDataSub: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.sm,
    textAlign: 'center',
    marginTop: appTheme.spacing.xs,
  },

  // ── Image modal ───────────────────────────────────────────────────────────────
  imgOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bigImg: { width: '90%', height: '70%' },

  // ── Leaderboard ───────────────────────────────────────────────────────────────
  leaderFeed: {
    paddingHorizontal: componentMetrics.horizontalPadding,
    paddingBottom: 32,
  },
  leaderMonthLabel: {
    color: appTheme.color.brandGold,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
    marginBottom: appTheme.spacing.sm,
  },
  leaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appTheme.color.bgSurface,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    padding: appTheme.spacing.md,
    marginBottom: appTheme.spacing.sm,
    gap: appTheme.spacing.sm,
  },
  leaderCardMe: {
    borderColor: appTheme.color.brandGold,
    backgroundColor: 'rgba(242,201,76,0.08)',
  },
  leaderRank: {
    width: 36,
    fontSize: 22,
    textAlign: 'center',
    color: appTheme.color.textPrimary,
  },
  leaderInfo: { flex: 1, minWidth: 0 },
  leaderName: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
  },
  leaderNameMe: { color: appTheme.color.brandGold },
  leaderSub: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
    marginTop: 2,
  },
  leaderBadge: {
    minWidth: 56,
    paddingHorizontal: appTheme.spacing.sm,
    paddingVertical: 6,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgElevated,
    alignItems: 'center',
  },
  leaderBadgeMe: {
    borderColor: appTheme.color.brandGold,
    backgroundColor: 'rgba(242,201,76,0.14)',
  },
  leaderBadgeNum: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.md,
    fontWeight: '700',
  },
  leaderBadgeNumMe: { color: appTheme.color.brandGold },
  leaderBadgeLbl: { color: appTheme.color.textSecondary, fontSize: 10, fontWeight: '700' },
  leaderBadgeLblMe: { color: appTheme.color.brandGold },
});