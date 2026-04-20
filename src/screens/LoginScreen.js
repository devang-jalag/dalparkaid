import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet, Alert, TouchableOpacity, Pressable, ScrollView } from 'react-native';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { appTheme, componentMetrics } from '../theme/tokens';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hasAccount, setHasAccount] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedCampus, setSelectedCampus] = useState('');

  const submitCredentials = async () => {
    try {
      if (hasAccount) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (displayName.trim()) {
          await updateProfile(user, { displayName: displayName.trim() });
        }

        await setDoc(doc(db, 'userProfiles', user.uid), {
          displayName: displayName.trim() || '',
          email: email.trim(),
          role: selectedRole || '',
          preferredCampus: selectedCampus || '',
          about: '',
          photoUrl: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      let title = 'Authentication Error';
      let message = error.message;

      switch (error.code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
          message = 'Incorrect email or password. Please try again.';
          break;
        case 'auth/user-not-found':
          message = 'No account found with this email. Try signing up instead.';
          break;
        case 'auth/invalid-email':
          message = 'Please enter a valid email address.';
          break;
        case 'auth/email-already-in-use':
          message = 'An account with this email already exists. Try logging in.';
          break;
        case 'auth/weak-password':
          message = 'Password must be at least 6 characters.';
          break;
        case 'auth/too-many-requests':
          message = 'Too many failed attempts. Please wait a moment and try again.';
          break;
        case 'auth/network-request-failed':
          message = 'Network error. Check your internet connection.';
          break;
        default:
          message = error.message;
      }

      Alert.alert(title, message);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.headerText}>{hasAccount ? 'Login to DalParkAid' : 'Sign Up'}</Text>

        <TextInput
          style={styles.inputField}
          placeholder="Email"
          placeholderTextColor={appTheme.color.textSecondary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.inputField}
          placeholder="Password"
          placeholderTextColor={appTheme.color.textSecondary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {!hasAccount ? (
          <>
            <TextInput
              style={styles.inputField}
              placeholder="Display Name"
              placeholderTextColor={appTheme.color.textSecondary}
              value={displayName}
              onChangeText={setDisplayName}
            />

            <Text style={styles.fieldLabel}>Preferred Campus</Text>
            <View style={styles.campusRow}>
              {['Studley', 'Sexton'].map((campus) => (
                <Pressable
                  key={campus}
                  onPress={() => setSelectedCampus(campus)}
                  style={[styles.campusChip, selectedCampus === campus && styles.campusChipActive]}
                >
                  <Text style={[styles.campusChipText, selectedCampus === campus && styles.campusChipTextActive]}>
                    {campus}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.roleRow}>
              {['Student', 'Staff', 'Faculty', 'Visitor'].map((role) => (
                <Pressable
                  key={role}
                  onPress={() => setSelectedRole(role)}
                  style={[styles.roleChip, selectedRole === role && styles.roleChipActive]}
                >
                  <Text style={[styles.roleChipText, selectedRole === role && styles.roleChipTextActive]}>
                    {role}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <TouchableOpacity style={styles.actionBtn} onPress={submitCredentials}>
          <Text style={styles.btnText}>{hasAccount ? 'Log In' : 'Sign Up'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setHasAccount(!hasAccount)} style={styles.switchModeBtn}>
          <Text style={styles.switchModeText}>
            {hasAccount ? 'Need an account? ' : 'Have an account? '}
            <Text style={styles.switchModeAction}>
              {hasAccount ? 'Sign Up' : 'Log In'}
            </Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appTheme.color.bgCanvas,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: componentMetrics.horizontalPadding,
  },
  headerText: {
    fontSize: appTheme.typography.size.xxl,
    fontWeight: 'bold',
    marginBottom: appTheme.spacing.xl,
    textAlign: 'center',
    color: appTheme.color.brandGold,
  },
  inputField: {
    borderWidth: 1,
    borderColor: appTheme.color.brandGold,
    padding: appTheme.spacing.sm,
    marginBottom: appTheme.spacing.md,
    borderRadius: appTheme.radius.sm,
    color: appTheme.color.textPrimary,
    backgroundColor: appTheme.color.bgSurface,
    fontSize: appTheme.typography.size.md,
  },
  actionBtn: {
    backgroundColor: appTheme.color.brandGold,
    padding: appTheme.spacing.md,
    borderRadius: appTheme.radius.sm,
    alignItems: 'center',
    marginBottom: appTheme.spacing.md,
  },
  btnText: {
    color: appTheme.color.bgCanvas,
    fontWeight: 'bold',
    fontSize: appTheme.typography.size.md,
  },
  switchModeBtn: {
    alignItems: 'center',
  },
  switchModeText: {
    color: appTheme.color.textPrimary,
    fontSize: appTheme.typography.size.sm,
  },
  switchModeAction: {
    color: appTheme.color.brandGold,
    fontWeight: '700',
  },
  fieldLabel: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '600',
    marginBottom: appTheme.spacing.xs,
    marginTop: appTheme.spacing.xs,
  },
  campusRow: {
    flexDirection: 'row',
    gap: appTheme.spacing.sm,
    marginBottom: appTheme.spacing.sm,
  },
  campusChip: {
    flex: 1,
    paddingVertical: appTheme.spacing.sm,
    borderRadius: appTheme.radius.sm,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgSurface,
    alignItems: 'center',
  },
  campusChipActive: {
    borderColor: appTheme.color.brandGold,
    backgroundColor: 'rgba(242, 201, 76, 0.15)',
  },
  campusChipText: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '600',
  },
  campusChipTextActive: {
    color: appTheme.color.brandGold,
  },
  roleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: appTheme.spacing.xs,
    marginBottom: appTheme.spacing.md,
  },
  roleChip: {
    paddingHorizontal: appTheme.spacing.md,
    paddingVertical: appTheme.spacing.xs,
    borderRadius: appTheme.radius.lg,
    borderWidth: 1,
    borderColor: appTheme.color.borderDefault,
    backgroundColor: appTheme.color.bgSurface,
  },
  roleChipActive: {
    borderColor: appTheme.color.brandGold,
    backgroundColor: 'rgba(242, 201, 76, 0.15)',
  },
  roleChipText: {
    color: appTheme.color.textSecondary,
    fontSize: appTheme.typography.size.sm,
    fontWeight: '600',
  },
  roleChipTextActive: {
    color: appTheme.color.brandGold,
  },
});
