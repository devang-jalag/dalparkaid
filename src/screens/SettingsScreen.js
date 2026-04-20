import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Switch,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { onAuthStateChanged, sendPasswordResetEmail, updateProfile } from 'firebase/auth';
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import PrimaryButton from '../components/common/PrimaryButton';
import { auth, db, storage } from '../config/firebase';
import { appTheme, componentMetrics } from '../theme/tokens';

const EMPTY_PROFILE = {
  displayName: '',
  photoUrl: '',
  role: '',
  preferredCampus: '',
  about: '',
  isAnonymous: false,
};

const ROLE_OPTIONS = ['Student', 'Staff', 'Faculty', 'Visitor', 'Resident'];
const CAMPUS_OPTIONS = ['Studley', 'Sexton'];
const REPORT_RATING_LABELS = ['Full', 'Busy', 'Moderate', 'Available', 'Empty'];

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

const formatLastReport = (timestampMs) => {
  if (!timestampMs) return 'No reports submitted yet';
  return new Date(timestampMs).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const uploadAvatarPhoto = async ({ photoUri, userId }) => {
  const response = await fetch(photoUri);
  const blob = await response.blob();
  const avatarPath = `avatars/${userId}/profile-${Date.now()}.jpg`;
  const avatarRef = ref(storage, avatarPath);

  try {
    await uploadBytes(avatarRef, blob, {
      contentType: blob.type || 'image/jpeg',
    });
  } finally {
    if (typeof blob.close === 'function') {
      blob.close();
    }
  }

  return getDownloadURL(avatarRef);
};

const StaticRow = ({ icon, label, value }) => (
  <View style={styles.row}>
    <View style={styles.rowMain}>
      <Ionicons color={appTheme.color.textPrimary} name={icon} size={18} />
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text numberOfLines={3} style={styles.rowValue}>
          {value}
        </Text>
      </View>
    </View>
  </View>
);

const ActionRow = ({ icon, label, value, onPress, danger = false }) => (
  <Pressable
    accessibilityRole="button"
    onPress={onPress}
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
  >
    <View style={styles.rowMain}>
      <Ionicons color={danger ? '#FF9F6B' : appTheme.color.textPrimary} name={icon} size={18} />
      <View style={styles.rowTextWrap}>
        <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
        {value ? (
          <Text numberOfLines={3} style={styles.rowValue}>
            {value}
          </Text>
        ) : null}
      </View>
    </View>
    <Ionicons color={danger ? '#FF9F6B' : appTheme.color.textSecondary} name="chevron-forward" size={18} />
  </Pressable>
);

const StatCard = ({ label, value }) => (
  <View style={styles.statCard}>
    <Text numberOfLines={2} style={styles.statValue}>
      {value}
    </Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const FeedbackBanner = ({ feedback, onClose, onRetry }) => {
  if (!feedback?.message) return null;

  const isError = feedback.type === 'error';
  return (
    <View style={[styles.feedbackBanner, isError ? styles.feedbackBannerError : styles.feedbackBannerSuccess]}>
      <View style={styles.feedbackCopy}>
        <Text style={styles.feedbackTitle}>{isError ? 'Something went wrong' : 'Done'}</Text>
        <Text style={styles.feedbackMessage}>{feedback.message}</Text>
      </View>
      <View style={styles.feedbackActions}>
        {onRetry ? (
          <Pressable onPress={onRetry} style={styles.feedbackActionBtn}>
            <Text style={styles.feedbackActionText}>Retry</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} style={styles.feedbackDismissBtn}>
          <Ionicons color={appTheme.color.textPrimary} name="close" size={16} />
        </Pressable>
      </View>
    </View>
  );
};

export default function SettingsScreen() {
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [profileDraft, setProfileDraft] = useState(EMPTY_PROFILE);
  const [profileExists, setProfileExists] = useState(false);
  const [reportStats, setReportStats] = useState({
    count: 0,
    latestTimestampMs: 0,
  });
  const [userReports, setUserReports] = useState([]);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [manageReportsVisible, setManageReportsVisible] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState('');
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [editorAvatarLoadFailed, setEditorAvatarLoadFailed] = useState(false);
  const [editorPane, setEditorPane] = useState('main');
  const [feedback, setFeedback] = useState(null);
  const [lastAvatarUploadMode, setLastAvatarUploadMode] = useState(null);

  const clearFeedback = () => setFeedback(null);
  const showFeedback = (scope, type, message, options = {}) => {
    setFeedback({ scope, type, message, ...options });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setCurrentUser(nextUser);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) {
      setProfile(EMPTY_PROFILE);
      setProfileDraft(EMPTY_PROFILE);
      setProfileExists(false);
      return undefined;
    }

    const profileRef = doc(db, 'userProfiles', currentUser.uid);
    return onSnapshot(
      profileRef,
      (snapshot) => {
        const data = snapshot.data() || {};
        const nextProfile = {
          displayName: data.displayName || currentUser.displayName || '',
          photoUrl: data.photoUrl || currentUser.photoURL || '',
          role: data.role || data.affiliation || '',
          preferredCampus: data.preferredCampus || '',
          about: data.about || '',
          isAnonymous: data.isAnonymous || false,
        };

        setProfileExists(snapshot.exists());
        setProfile(nextProfile);
        setProfileDraft(nextProfile);
        setAvatarLoadFailed(false);
        setEditorAvatarLoadFailed(false);
      },
      () => {
        const fallbackProfile = {
          displayName: currentUser.displayName || '',
          photoUrl: currentUser.photoURL || '',
          role: '',
          preferredCampus: '',
          about: '',
          isAnonymous: false,
        };
        setProfileExists(false);
        setProfile(fallbackProfile);
        setProfileDraft(fallbackProfile);
        setAvatarLoadFailed(false);
        setEditorAvatarLoadFailed(false);
      }
    );
  }, [currentUser?.uid, currentUser?.displayName, currentUser?.photoURL]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setReportStats({
        count: 0,
        latestTimestampMs: 0,
      });
      setUserReports([]);
      return undefined;
    }

    const reportsQuery = query(collection(db, 'reports'), where('userId', '==', currentUser.uid));
    return onSnapshot(
      reportsQuery,
      (snapshot) => {
        const docs = snapshot.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .sort((a, b) => toTimestampMs(b?.createdAt ?? b?.clientCreatedAt) - toTimestampMs(a?.createdAt ?? a?.clientCreatedAt));
        const latestTimestampMs = docs.reduce((latest, entry) => {
          const nextTs = toTimestampMs(entry?.createdAt ?? entry?.clientCreatedAt);
          return nextTs > latest ? nextTs : latest;
        }, 0);

        setUserReports(docs);
        setReportStats({
          count: docs.length,
          latestTimestampMs,
        });
      },
      () => {
        setUserReports([]);
        setReportStats({
          count: 0,
          latestTimestampMs: 0,
        });
      }
    );
  }, [currentUser?.uid]);

  const displayName = profile.displayName?.trim() || 'DalParkAid user';
  const lastReportText = useMemo(
    () => formatLastReport(reportStats.latestTimestampMs),
    [reportStats.latestTimestampMs]
  );
  const profileSubline = useMemo(
    () => [profile.role, profile.preferredCampus].filter(Boolean).join(' · '),
    [profile.preferredCampus, profile.role]
  );

  const handleSaveProfile = async () => {
    if (!auth.currentUser?.uid) return;

    const trimmedDisplayName = profileDraft.displayName.trim();
    if (!trimmedDisplayName) {
      showFeedback('edit', 'error', 'Enter a display name before saving.');
      return;
    }

    setSavingProfile(true);
    try {
      await updateProfile(auth.currentUser, {
        displayName: trimmedDisplayName,
        photoURL: profileDraft.photoUrl || '',
      });

      const profileRef = doc(db, 'userProfiles', auth.currentUser.uid);
      const payload = {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email || '',
        displayName: trimmedDisplayName,
        photoUrl: profileDraft.photoUrl || '',
        role: profileDraft.role.trim(),
        preferredCampus: profileDraft.preferredCampus.trim(),
        about: profileDraft.about.trim(),
        isAnonymous: Boolean(profileDraft.isAnonymous),
        updatedAt: serverTimestamp(),
      };

      if (!profileExists) {
        payload.createdAt = serverTimestamp();
      }

      await setDoc(profileRef, payload, { merge: true });

      const nextProfile = {
        displayName: trimmedDisplayName,
        photoUrl: profileDraft.photoUrl || '',
        role: profileDraft.role.trim(),
        preferredCampus: profileDraft.preferredCampus.trim(),
        about: profileDraft.about.trim(),
        isAnonymous: Boolean(profileDraft.isAnonymous),
      };

      setProfile(nextProfile);
      setProfileDraft(nextProfile);
      setAvatarLoadFailed(false);
      setEditModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showFeedback('screen', 'success', 'Profile updated successfully.');
    } catch (error) {
      showFeedback('edit', 'error', error?.message || 'Could not update your profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarUpload = async (mode) => {
    if (!auth.currentUser?.uid) return;
    setLastAvatarUploadMode(mode);
    clearFeedback();

    try {
      let asset = null;

      if (mode === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (permission.status !== 'granted') {
          showFeedback('edit', 'error', 'Camera access is required to take a profile photo.');
          return;
        }

        const result = await ImagePicker.launchCameraAsync({
          quality: 0.5,
          allowsEditing: true,
          aspect: [1, 1],
        });
        if (!result.canceled && result.assets?.[0]) {
          asset = result.assets[0];
        }
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          quality: 0.5,
          allowsEditing: true,
          aspect: [1, 1],
        });
        if (!result.canceled && result.assets?.[0]) {
          asset = result.assets[0];
        }
      }

      if (!asset?.uri) return;

      setUploadingAvatar(true);
      const nextPhotoUrl = await uploadAvatarPhoto({
        photoUri: asset.uri,
        userId: auth.currentUser.uid,
      });
      setEditorAvatarLoadFailed(false);
      setProfileDraft((prev) => ({ ...prev, photoUrl: nextPhotoUrl }));
      showFeedback('edit', 'success', 'Photo uploaded. Tap Save to apply it.');
    } catch (error) {
      let message = error?.message || 'Could not upload the profile photo.';
      if (error?.code === 'storage/unauthorized') {
        message = 'Photo upload is blocked by Firebase Storage permissions.';
      } else if (error?.code === 'storage/retry-limit-exceeded' || error?.code === 'storage/network-request-failed') {
        message = 'Photo upload failed because the network was unstable.';
      }
      showFeedback('edit', 'error', message, { retryAction: 'avatar' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleResetPassword = async () => {
    if (!currentUser?.email) {
      Alert.alert('Reset unavailable', 'No email address is attached to this account.');
      return;
    }

    setSendingReset(true);
    try {
      await sendPasswordResetEmail(auth, currentUser.email);
      showFeedback('screen', 'success', `A password reset link was sent to ${currentUser.email}.`);
    } catch (error) {
      showFeedback('screen', 'error', error?.message || 'Could not send the password reset email.');
    } finally {
      setSendingReset(false);
    }
  };

  const openEditor = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setProfileDraft(profile);
    setEditorAvatarLoadFailed(false);
    setEditorPane('main');
    clearFeedback();
    setEditModalVisible(true);
  };

  const openManageReports = () => {
    clearFeedback();
    setManageReportsVisible(true);
  };

  const handleAvatarEditPress = () => {
    if (uploadingAvatar) return;

    const options = [
      { text: 'Take photo', onPress: () => handleAvatarUpload('camera') },
      { text: 'Choose from library', onPress: () => handleAvatarUpload('library') },
    ];

    if (profileDraft.photoUrl) {
      options.push({
        text: 'Use default avatar',
        onPress: () => {
          setEditorAvatarLoadFailed(false);
          setProfileDraft((prev) => ({ ...prev, photoUrl: '' }));
        },
      });
    }

    options.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert('Profile photo', 'Choose how you want to update your avatar.', options);
  };

  const editorAvatarUrl = profileDraft.photoUrl;

  const handleDeleteReport = (report) => {
    Alert.alert(
      'Delete report',
      `Delete your report for ${report.lotName || report.lotId}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingReportId(report.id);
            try {
              await deleteDoc(doc(db, 'reports', report.id));
              if (report.photoPath) {
                try {
                  await deleteObject(ref(storage, report.photoPath));
                } catch (_error) {
                  // Ignore missing storage object; the report is already deleted.
                }
              }
              showFeedback('manage', 'success', 'Report deleted.');
            } catch (error) {
              showFeedback('manage', 'error', error?.message || 'Could not delete the report.');
            } finally {
              setDeletingReportId('');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerBlock}>
          <Text style={styles.header}>Settings</Text>
        </View>
        {feedback?.scope === 'screen' ? (
          <FeedbackBanner feedback={feedback} onClose={clearFeedback} />
        ) : null}

        <View style={styles.profileCard}>
          <Pressable
            accessibilityLabel="Edit profile"
            accessibilityRole="button"
            onPress={openEditor}
            style={({ pressed }) => [styles.profileSettingsBtn, pressed && styles.profileSettingsBtnPressed]}
          >
            <Ionicons color={appTheme.color.textPrimary} name="settings-outline" size={18} />
          </Pressable>

          <View style={styles.profileIdentity}>
            <View style={styles.profileAvatar}>
              {profile.photoUrl && !avatarLoadFailed ? (
                <Image
                  source={{ uri: profile.photoUrl }}
                  style={styles.profileAvatarImage}
                  onError={() => setAvatarLoadFailed(true)}
                />
              ) : (
                <Ionicons color={appTheme.color.brandGold} name="person-circle" size={46} />
              )}
            </View>

            <View style={styles.profileCopy}>
              <Text numberOfLines={1} style={styles.profileName}>
                {displayName}
              </Text>
              {profileSubline ? (
                <Text numberOfLines={1} style={styles.profileSubline}>
                  {profileSubline}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Personal info</Text>
          <StaticRow icon="mail-outline" label="Email" value={currentUser?.email || 'No email available'} />
          <StaticRow icon="briefcase-outline" label="Role" value={profile.role || 'Not set'} />
          <StaticRow icon="business-outline" label="Preferred campus" value={profile.preferredCampus || 'Not set'} />
          <StaticRow icon="chatbubble-ellipses-outline" label="About" value={profile.about || 'No personal note yet'} />
          <ActionRow
            icon="key-outline"
            label={sendingReset ? 'Sending reset email...' : 'Reset password'}
            onPress={handleResetPassword}
            value="Send a reset link to your current email"
          />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Reports</Text>
          <View style={styles.statsRow}>
            <StatCard label="Submitted" value={`${reportStats.count}`} />
            <StatCard label="Latest activity" value={reportStats.latestTimestampMs ? lastReportText : 'No reports yet'} />
          </View>
          <ActionRow
            icon="folder-open-outline"
            label="Manage reports"
            onPress={openManageReports}
            value="Browse and delete your reports"
          />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Session</Text>
          <ActionRow
            danger
            icon="log-out-outline"
            label="Log out"
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); auth.signOut(); }}
            value="Sign out on this device"
          />
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={editModalVisible}
        onRequestClose={() => {
          if (editorPane === 'main') {
            setEditModalVisible(false);
          } else {
            setEditorPane('main');
          }
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalAvoiding}
        >
          <ScrollView
            contentContainerStyle={styles.modalScrollContent}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Pressable onPress={Keyboard.dismiss} style={styles.modalOverlay}>
              <Pressable onPress={() => {}} style={styles.modalCard}>
            {feedback?.scope === 'edit' ? (
              <FeedbackBanner
                feedback={feedback}
                onClose={clearFeedback}
                onRetry={feedback.retryAction === 'avatar' && lastAvatarUploadMode ? () => handleAvatarUpload(lastAvatarUploadMode) : null}
              />
            ) : null}
            {editorPane === 'main' ? (
              <>
                <Text style={styles.modalTitle}>Edit profile</Text>
                <Text style={styles.modalText}>Update your name, campus, and personal details here.</Text>

                <View style={styles.editorAvatarBlock}>
                  <Pressable
                    accessibilityLabel="Edit avatar"
                    accessibilityRole="button"
                    onPress={handleAvatarEditPress}
                    style={({ pressed }) => [styles.editorAvatar, pressed && styles.editorAvatarPressed]}
                  >
                    {editorAvatarUrl && !editorAvatarLoadFailed ? (
                      <Image
                        source={{ uri: editorAvatarUrl }}
                        style={styles.editorAvatarImage}
                        onError={() => setEditorAvatarLoadFailed(true)}
                      />
                    ) : (
                      <Ionicons color={appTheme.color.brandGold} name="person-circle" size={70} />
                    )}
                    <View style={styles.editorAvatarBadge}>
                      <Ionicons color="#FFFFFF" name={uploadingAvatar ? 'sync' : 'camera'} size={16} />
                    </View>
                  </Pressable>
                  <Text style={styles.editorAvatarHint}>
                    {uploadingAvatar ? 'Uploading photo...' : 'Tap avatar to change photo'}
                  </Text>
                </View>

                <TextInput
                  autoCapitalize="words"
                  autoCorrect={false}
                  onChangeText={(value) => setProfileDraft((prev) => ({ ...prev, displayName: value }))}
                  placeholder="Display name"
                  placeholderTextColor={appTheme.color.textSecondary}
                  style={styles.input}
                  value={profileDraft.displayName}
                />

                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>Campus</Text>
                  <View style={styles.segmentedControl}>
                    {CAMPUS_OPTIONS.map((option) => {
                      const active = profileDraft.preferredCampus === option;
                      return (
                        <Pressable
                          key={option}
                          onPress={() => setProfileDraft((prev) => ({ ...prev, preferredCampus: option }))}
                          style={({ pressed }) => [
                            styles.segmentedPill,
                            active && styles.segmentedPillActive,
                            pressed && styles.segmentedPillPressed,
                          ]}
                        >
                          <Text style={[styles.segmentedPillText, active && styles.segmentedPillTextActive]}>
                            {option}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <Pressable onPress={() => setEditorPane('role')} style={styles.selectorInput}>
                  <Text style={styles.selectorValueLabel}>Role</Text>
                  <View style={styles.selectorValueRow}>
                    <Text style={profileDraft.role ? styles.selectorValue : styles.selectorPlaceholder}>
                      {profileDraft.role || 'Choose'}
                    </Text>
                    <Ionicons color={appTheme.color.textSecondary} name="chevron-forward" size={18} />
                  </View>
                </Pressable>

                <Pressable onPress={() => setEditorPane('about')} style={styles.selectorInput}>
                  <Text style={styles.selectorValueLabel}>About</Text>
                  <View style={styles.selectorValueRow}>
                    <Text numberOfLines={1} style={profileDraft.about ? styles.selectorValue : styles.selectorPlaceholder}>
                      {profileDraft.about || 'Add a short note'}
                    </Text>
                    <Ionicons color={appTheme.color.textSecondary} name="chevron-forward" size={18} />
                  </View>
                </Pressable>

                <View style={[styles.selectorInput, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                  <Text style={styles.selectorValueLabel}>Hide name on Leaderboard</Text>
                  <Switch
                    value={profileDraft.isAnonymous}
                    onValueChange={(val) => setProfileDraft((prev) => ({ ...prev, isAnonymous: val }))}
                    trackColor={{ false: '#767577', true: appTheme.color.brandGold }}
                    thumbColor="#f4f3f4"
                  />
                </View>

                <View style={styles.modalActions}>
                  <Pressable onPress={() => setEditModalVisible(false)} style={styles.modalSecondaryBtn}>
                    <Text style={styles.modalSecondaryText}>Cancel</Text>
                  </Pressable>
                  <PrimaryButton label="Save" loading={savingProfile} onPress={handleSaveProfile} style={styles.modalPrimaryBtn} />
                </View>
              </>
            ) : null}

            {editorPane === 'role' ? (
              <>
                <View style={styles.subEditorHeader}>
                  <Pressable onPress={() => setEditorPane('main')} style={styles.subEditorBackBtn}>
                    <Ionicons color={appTheme.color.textPrimary} name="chevron-back" size={18} />
                  </Pressable>
                  <Text style={styles.modalTitle}>Role</Text>
                </View>
                <Text style={styles.modalText}>Choose the role that fits you best.</Text>
                <View style={styles.inlineSelectorList}>
                  {ROLE_OPTIONS.map((option) => (
                    <Pressable
                      key={option}
                      onPress={() => {
                        setProfileDraft((prev) => ({ ...prev, role: option }));
                        setEditorPane('main');
                      }}
                      style={({ pressed }) => [
                        styles.selectorOption,
                        profileDraft.role === option && styles.selectorOptionActive,
                        pressed && styles.selectorOptionPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.selectorOptionText,
                          profileDraft.role === option && styles.selectorOptionTextActive,
                        ]}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {editorPane === 'about' ? (
              <>
                <View style={styles.subEditorHeader}>
                  <Pressable onPress={() => setEditorPane('main')} style={styles.subEditorBackBtn}>
                    <Ionicons color={appTheme.color.textPrimary} name="chevron-back" size={18} />
                  </Pressable>
                  <Text style={styles.modalTitle}>About</Text>
                </View>
                <Text style={styles.modalText}>Add a short personal note for your profile.</Text>
                <TextInput
                  autoCapitalize="sentences"
                  blurOnSubmit
                  multiline
                  onChangeText={(value) => setProfileDraft((prev) => ({ ...prev, about: value }))}
                  onSubmitEditing={Keyboard.dismiss}
                  placeholder="About you"
                  placeholderTextColor={appTheme.color.textSecondary}
                  style={[styles.input, styles.inputMultiline, styles.aboutEditorInput]}
                  textAlignVertical="top"
                  value={profileDraft.about}
                />
                <View style={styles.modalActions}>
                  <Pressable onPress={() => setEditorPane('main')} style={styles.modalSecondaryBtn}>
                    <Text style={styles.modalSecondaryText}>Done</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
              </Pressable>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={manageReportsVisible}
        onRequestClose={() => setManageReportsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.manageModalCard}>
            {feedback?.scope === 'manage' ? (
              <FeedbackBanner feedback={feedback} onClose={clearFeedback} />
            ) : null}
            <View style={styles.manageHeader}>
              <Text style={styles.modalTitle}>Manage reports</Text>
              <Pressable
                accessibilityLabel="Close report manager"
                accessibilityRole="button"
                onPress={() => setManageReportsVisible(false)}
                style={styles.manageCloseBtn}
              >
                <Ionicons color={appTheme.color.textPrimary} name="close" size={18} />
              </Pressable>
            </View>
            <Text style={styles.manageSummary}>
              {userReports.length} report{userReports.length !== 1 ? 's' : ''}
            </Text>

            <ScrollView
              contentContainerStyle={styles.manageListContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {userReports.length ? (
                userReports.map((report) => {
                  const createdAtMs = toTimestampMs(report.createdAt ?? report.clientCreatedAt);
                  const ratingLabel = REPORT_RATING_LABELS[(report.rating || 1) - 1] || 'Unknown';
                  const imageUri = report.photoUrl || report.imgUri || null;
                  const isDeleting = deletingReportId === report.id;

                  return (
                    <View key={report.id} style={[styles.manageReportCard, !imageUri && styles.manageReportCardNoPhoto]}>
                      <View style={styles.manageReportBody}>
                        <View style={styles.manageReportText}>
                          <Text numberOfLines={1} style={styles.manageReportLot}>
                            {report.lotName || report.lotId}
                          </Text>
                          <Text style={styles.manageReportMeta}>{ratingLabel}</Text>
                          <Text style={styles.manageReportMeta}>{formatLastReport(createdAtMs)}</Text>
                        </View>
                        {imageUri ? (
                          <View style={styles.manageThumbWrap}>
                            <Image source={{ uri: imageUri }} style={styles.manageThumb} />
                          </View>
                        ) : (
                          <View style={styles.manageNoPhotoPill}>
                            <Ionicons color={appTheme.color.textSecondary} name="image-outline" size={14} />
                            <Text style={styles.manageNoPhotoText}>No photo</Text>
                          </View>
                        )}
                      </View>

                      <View style={[styles.manageReportActions, !imageUri && styles.manageReportActionsNoPhoto]}>
                        <Pressable
                          disabled={isDeleting}
                          onPress={() => handleDeleteReport(report)}
                          style={[styles.manageDeleteBtn, isDeleting && styles.manageDeleteBtnDisabled]}
                        >
                          <Text style={styles.manageDeleteText}>{isDeleting ? 'Deleting...' : 'Delete'}</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              ) : (
                <View style={styles.emptyManageState}>
                  <Ionicons color={appTheme.color.textSecondary} name="document-text-outline" size={28} />
                  <Text style={styles.emptyManageTitle}>No reports yet</Text>
                  <Text style={styles.emptyManageText}>
                    Your submitted reports will appear here.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appTheme.color.bgCanvas,
  },
  content: {
    paddingTop: 56,
    paddingHorizontal: componentMetrics.horizontalPadding,
    paddingBottom: componentMetrics.bottomSafePadding + appTheme.spacing.xl,
    gap: appTheme.spacing.md,
  },
  headerBlock: {
    marginBottom: appTheme.spacing.xs,
  },
  header: {
    color: appTheme.color.textPrimary,
    fontFamily: appTheme.typography.familyHeading,
    fontSize: appTheme.typography.size.xxl,
    marginBottom: 6,
  },
  subheader: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.sm,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: appTheme.spacing.sm,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    paddingHorizontal: appTheme.spacing.md,
    paddingVertical: appTheme.spacing.sm,
  },
  feedbackBannerSuccess: {
    backgroundColor: 'rgba(92, 184, 92, 0.12)',
    borderColor: 'rgba(92, 184, 92, 0.28)',
  },
  feedbackBannerError: {
    backgroundColor: 'rgba(255, 107, 107, 0.12)',
    borderColor: 'rgba(255, 107, 107, 0.24)',
  },
  feedbackCopy: {
    flex: 1,
    gap: 2,
  },
  feedbackTitle: {
    color: appTheme.color.textPrimary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.xs,
    fontWeight: '700',
  },
  feedbackMessage: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.xs,
    lineHeight: 18,
  },
  feedbackActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedbackActionBtn: {
    minHeight: 28,
    paddingHorizontal: appTheme.spacing.sm,
    borderRadius: appTheme.radius.sm,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackActionText: {
    color: appTheme.color.textPrimary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.xs,
    fontWeight: '700',
  },
  feedbackDismissBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCard: {
    backgroundColor: appTheme.color.bgSurface,
    borderRadius: appTheme.radius.lg,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    paddingHorizontal: appTheme.spacing.lg,
    paddingTop: appTheme.spacing.lg,
    paddingBottom: appTheme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  profileIdentity: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appTheme.color.bgElevated,
    overflow: 'hidden',
  },
  profileAvatarImage: {
    width: '100%',
    height: '100%',
  },
  profileCopy: {
    alignItems: 'center',
    marginTop: appTheme.spacing.sm,
    gap: 4,
    width: '100%',
  },
  profileName: {
    color: appTheme.color.textPrimary,
    fontFamily: appTheme.typography.familyHeading,
    fontSize: appTheme.typography.size.lg,
    textAlign: 'center',
  },
  profileSubline: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.sm,
    textAlign: 'center',
  },
  profileSettingsBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appTheme.color.bgElevated,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    position: 'absolute',
    top: appTheme.spacing.sm,
    right: appTheme.spacing.sm,
  },
  profileSettingsBtnPressed: {
    opacity: 0.88,
  },
  sectionCard: {
    backgroundColor: appTheme.color.bgSurface,
    borderRadius: appTheme.radius.lg,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    paddingVertical: appTheme.spacing.sm,
    overflow: 'hidden',
  },
  sectionTitle: {
    color: appTheme.color.textPrimary,
    fontFamily: appTheme.typography.familyHeading,
    fontSize: appTheme.typography.size.md,
    paddingHorizontal: appTheme.spacing.lg,
    paddingTop: appTheme.spacing.sm,
    paddingBottom: appTheme.spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    gap: appTheme.spacing.sm,
    paddingHorizontal: appTheme.spacing.lg,
    paddingTop: appTheme.spacing.xs,
    paddingBottom: appTheme.spacing.sm,
  },
  statCard: {
    flex: 1,
    minHeight: 84,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgElevated,
    paddingHorizontal: appTheme.spacing.md,
    paddingVertical: appTheme.spacing.md,
    justifyContent: 'space-between',
  },
  statValue: {
    color: appTheme.color.textPrimary,
    fontFamily: appTheme.typography.familyHeading,
    fontSize: appTheme.typography.size.sm,
    lineHeight: 20,
  },
  statLabel: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  row: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: appTheme.spacing.lg,
    paddingVertical: appTheme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(184, 194, 209, 0.12)',
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: appTheme.spacing.sm,
    flex: 1,
    paddingRight: appTheme.spacing.md,
  },
  rowTextWrap: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: appTheme.color.textPrimary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
  },
  rowLabelDanger: {
    color: '#FF9F6B',
  },
  rowValue: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.xs,
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(4, 10, 18, 0.72)',
    justifyContent: 'center',
    padding: appTheme.spacing.lg,
  },
  modalAvoiding: {
    flex: 1,
  },
  modalScrollContent: {
    flexGrow: 1,
  },
  modalCard: {
    backgroundColor: appTheme.color.bgSurface,
    borderRadius: appTheme.radius.xl,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    padding: appTheme.spacing.lg,
  },
  manageModalCard: {
    backgroundColor: appTheme.color.bgSurface,
    borderRadius: appTheme.radius.xl,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    padding: appTheme.spacing.lg,
    maxHeight: '84%',
  },
  manageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: appTheme.spacing.sm,
  },
  manageCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appTheme.color.bgElevated,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
  },
  manageSummary: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.xs,
    marginBottom: appTheme.spacing.sm,
  },
  manageListContent: {
    gap: appTheme.spacing.sm,
    paddingBottom: appTheme.spacing.xs,
  },
  manageReportCard: {
    borderRadius: appTheme.radius.lg,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgElevated,
    padding: appTheme.spacing.md,
    gap: appTheme.spacing.sm,
  },
  manageReportCardNoPhoto: {
    gap: appTheme.spacing.xs,
  },
  manageReportBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: appTheme.spacing.sm,
  },
  manageReportText: {
    flex: 1,
    gap: 3,
  },
  manageReportLot: {
    color: appTheme.color.textPrimary,
    fontFamily: appTheme.typography.familyHeading,
    fontSize: appTheme.typography.size.sm,
  },
  manageReportMeta: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.xs,
  },
  manageThumbWrap: {
    width: 96,
    height: 64,
    borderRadius: appTheme.radius.sm,
    overflow: 'hidden',
    backgroundColor: appTheme.color.bgCanvas,
  },
  manageThumb: {
    width: '100%',
    height: '100%',
  },
  manageNoPhotoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 96,
    minHeight: 36,
    paddingHorizontal: appTheme.spacing.sm,
    borderRadius: appTheme.radius.sm,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgSurface,
    justifyContent: 'center',
  },
  manageNoPhotoText: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.xs,
    fontWeight: '700',
  },
  manageReportActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: appTheme.spacing.sm,
  },
  manageReportActionsNoPhoto: {
    marginTop: 2,
  },
  manageDeleteBtn: {
    minHeight: 34,
    paddingHorizontal: appTheme.spacing.md,
    borderRadius: appTheme.radius.md,
    backgroundColor: 'rgba(255, 107, 107, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageDeleteBtnDisabled: {
    opacity: 0.7,
  },
  manageDeleteText: {
    color: '#FF9F6B',
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.xs,
    fontWeight: '700',
  },
  emptyManageState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: appTheme.spacing.xl,
    gap: appTheme.spacing.xs,
  },
  emptyManageTitle: {
    color: appTheme.color.textPrimary,
    fontFamily: appTheme.typography.familyHeading,
    fontSize: appTheme.typography.size.md,
  },
  emptyManageText: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.sm,
    textAlign: 'center',
  },
  modalTitle: {
    color: appTheme.color.textPrimary,
    fontFamily: appTheme.typography.familyHeading,
    fontSize: appTheme.typography.size.lg,
    marginBottom: 8,
  },
  modalText: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.sm,
    lineHeight: 20,
    marginBottom: appTheme.spacing.md,
  },
  editorAvatarBlock: {
    alignItems: 'center',
    marginBottom: appTheme.spacing.lg,
  },
  editorAvatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: appTheme.color.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    position: 'relative',
  },
  editorAvatarPressed: {
    opacity: 0.9,
  },
  editorAvatarImage: {
    width: '100%',
    height: '100%',
  },
  editorAvatarBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: appTheme.color.brandGold,
    borderWidth: 2,
    borderColor: appTheme.color.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorAvatarHint: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.xs,
    marginTop: appTheme.spacing.sm,
  },
  input: {
    minHeight: componentMetrics.inputHeight,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgElevated,
    color: appTheme.color.textPrimary,
    paddingHorizontal: appTheme.spacing.md,
    fontSize: appTheme.typography.size.md,
    marginBottom: appTheme.spacing.sm,
  },
  fieldBlock: {
    marginBottom: appTheme.spacing.sm,
  },
  fieldLabel: {
    color: appTheme.color.textSecondary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.xs,
    fontWeight: '700',
    marginBottom: appTheme.spacing.xs,
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: appTheme.spacing.sm,
  },
  segmentedPill: {
    flex: 1,
    minHeight: 44,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedPillActive: {
    borderColor: appTheme.color.brandGold,
    backgroundColor: 'rgba(242, 201, 76, 0.12)',
  },
  segmentedPillPressed: {
    opacity: 0.9,
  },
  segmentedPillText: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
  },
  segmentedPillTextActive: {
    color: appTheme.color.brandGold,
  },
  selectorInput: {
    minHeight: componentMetrics.inputHeight,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgElevated,
    paddingHorizontal: appTheme.spacing.md,
    marginBottom: appTheme.spacing.sm,
    justifyContent: 'center',
    gap: 4,
  },
  selectorValueLabel: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.xs,
    fontWeight: '700',
    alignSelf: 'flex-start',
  },
  selectorValueRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorValue: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.md,
    flex: 1,
  },
  selectorPlaceholder: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.md,
    flex: 1,
  },
  inputMultiline: {
    minHeight: 92,
    paddingTop: appTheme.spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    gap: appTheme.spacing.sm,
    marginTop: appTheme.spacing.sm,
  },
  modalSecondaryBtn: {
    minHeight: componentMetrics.primaryButtonHeight,
    minWidth: 96,
    paddingHorizontal: appTheme.spacing.lg,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appTheme.color.bgElevated,
  },
  modalPrimaryBtn: {
    flex: 1,
  },
  inlineSelectorList: {
    gap: appTheme.spacing.xs,
    marginBottom: appTheme.spacing.sm,
  },
  selectorOption: {
    minHeight: 44,
    borderRadius: appTheme.radius.md,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgElevated,
    paddingHorizontal: appTheme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorOptionActive: {
    borderColor: appTheme.color.brandGold,
    backgroundColor: 'rgba(242, 201, 76, 0.12)',
  },
  selectorOptionPressed: {
    opacity: 0.88,
  },
  selectorOptionText: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
  },
  selectorOptionTextActive: {
    color: appTheme.color.brandGold,
  },
  modalSecondaryText: {
    color: appTheme.color.textPrimary,
    fontFamily: appTheme.typography.familyBody,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '700',
  },
  subEditorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: appTheme.spacing.sm,
    marginBottom: appTheme.spacing.xs,
  },
  subEditorBackBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appTheme.color.bgElevated,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
  },
  aboutEditorInput: {
    minHeight: 180,
  },
});
