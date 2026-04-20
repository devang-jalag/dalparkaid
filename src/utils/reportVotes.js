import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const MIN_VOTE_WEIGHT = 0.35;
const MAX_VOTE_WEIGHT = 1.9;
const VOTE_WEIGHT_STEP = 0.12;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const normalizeVoteValue = (value) => {
  const normalized = toFiniteNumber(value);
  if (normalized == null) {
    return 0;
  }

  if (normalized > 0) return 1;
  if (normalized < 0) return -1;
  return 0;
};

const toCount = (value) => {
  const normalized = toFiniteNumber(value);
  return normalized == null ? 0 : Math.max(0, Math.round(normalized));
};

export const getReportVoteDocId = (reportId, userId) => `${reportId}_${userId}`;

export const computeVoteWeightMultiplier = (voteScore) =>
  clamp(1 + voteScore * VOTE_WEIGHT_STEP, MIN_VOTE_WEIGHT, MAX_VOTE_WEIGHT);

export const getReportVoteMeta = (report) => {
  const upvoteCount = toCount(report?.upvoteCount);
  const downvoteCount = toCount(report?.downvoteCount);
  const voteScore = upvoteCount - downvoteCount;

  return {
    upvoteCount,
    downvoteCount,
    voteScore,
    voteWeightMultiplier: computeVoteWeightMultiplier(voteScore),
  };
};

export const getReportTrustLabel = (report) => {
  const { voteScore, voteWeightMultiplier } = getReportVoteMeta(report);

  if (voteWeightMultiplier >= 1.25 || voteScore >= 3) {
    return 'Community verified';
  }

  if (voteWeightMultiplier <= 0.8 || voteScore <= -2) {
    return 'Low trust';
  }

  return null;
};

export const loadUserReportVotes = async (userId = auth.currentUser?.uid) => {
  if (!userId) {
    return {};
  }

  const voteQuery = query(collection(db, 'reportVotes'), where('userId', '==', userId));
  const snapshot = await getDocs(voteQuery);
  const votesByReportId = {};

  snapshot.docs.forEach((voteDoc) => {
    const data = voteDoc.data();
    const voteValue = normalizeVoteValue(data?.value);
    if (data?.reportId && voteValue !== 0) {
      votesByReportId[data.reportId] = voteValue;
    }
  });

  return votesByReportId;
};

export const toggleReportVote = async ({
  reportId,
  reportOwnerId,
  nextValue,
  userId = auth.currentUser?.uid,
}) => {
  if (!userId) {
    throw new Error('auth_required');
  }

  if (!reportId) {
    throw new Error('report_required');
  }

  const desiredVote = normalizeVoteValue(nextValue);
  if (desiredVote === 0) {
    throw new Error('invalid_vote');
  }

  if (reportOwnerId && reportOwnerId === userId) {
    throw new Error('self_vote_forbidden');
  }

  const reportRef = doc(db, 'reports', reportId);
  const voteRef = doc(db, 'reportVotes', getReportVoteDocId(reportId, userId));

  return runTransaction(db, async (transaction) => {
    const [reportSnapshot, voteSnapshot] = await Promise.all([
      transaction.get(reportRef),
      transaction.get(voteRef),
    ]);

    if (!reportSnapshot.exists()) {
      throw new Error('report_not_found');
    }

    const reportData = reportSnapshot.data();
    if (reportData?.userId && reportData.userId === userId) {
      throw new Error('self_vote_forbidden');
    }

    const existingVoteData = voteSnapshot.exists() ? voteSnapshot.data() : null;
    const currentVote = normalizeVoteValue(existingVoteData?.value);
    const targetVote = currentVote === desiredVote ? 0 : desiredVote;

    let upvoteCount = toCount(reportData?.upvoteCount);
    let downvoteCount = toCount(reportData?.downvoteCount);

    if (currentVote === 1) {
      upvoteCount = Math.max(0, upvoteCount - 1);
    } else if (currentVote === -1) {
      downvoteCount = Math.max(0, downvoteCount - 1);
    }

    if (targetVote === 1) {
      upvoteCount += 1;
    } else if (targetVote === -1) {
      downvoteCount += 1;
    }

    const voteScore = upvoteCount - downvoteCount;
    const voteWeightMultiplier = computeVoteWeightMultiplier(voteScore);
    const now = Date.now();

    transaction.update(reportRef, {
      upvoteCount,
      downvoteCount,
      voteScore,
      voteWeightMultiplier,
      voteUpdatedAt: now,
    });

    if (targetVote === 0) {
      if (voteSnapshot.exists()) {
        transaction.delete(voteRef);
      }
    } else {
      transaction.set(voteRef, {
        reportId,
        userId,
        value: targetVote,
        createdAt: existingVoteData?.createdAt ?? now,
        updatedAt: now,
      });
    }

    return {
      currentVote: targetVote,
      upvoteCount,
      downvoteCount,
      voteScore,
      voteWeightMultiplier,
      voteUpdatedAt: now,
    };
  });
};
