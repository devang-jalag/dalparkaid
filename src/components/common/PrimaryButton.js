import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';
import { appTheme, componentMetrics } from '../../theme/tokens';

export default function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  accessibilityLabel,
  style,
}) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={appTheme.color.bgCanvas} />
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: componentMetrics.primaryButtonHeight,
    borderRadius: appTheme.radius.md,
    backgroundColor: appTheme.color.brandGold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: appTheme.spacing.lg,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.92,
  },
  label: {
    color: appTheme.color.bgCanvas,
    fontSize: appTheme.typography.size.md,
    fontWeight: '700',
  },
});
