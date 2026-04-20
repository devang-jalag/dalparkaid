import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { onAuthStateChanged } from 'firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../config/firebase';
import { appTheme } from '../theme/tokens';
import SplashOverlay from '../components/common/SplashOverlay';

import LoginScreen from '../screens/LoginScreen.js';
import MapScreen from '../screens/MapScreen.js';
import HistoryScreen from '../screens/HistoryScreen.js';
import SettingsScreen from '../screens/SettingsScreen.js';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator initialRouteName='Map'
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: appTheme.color.bgSurface,
          borderTopWidth: 0,
        },
        tabBarActiveTintColor: appTheme.color.brandGold,
        tabBarInactiveTintColor: appTheme.color.textSecondary,
        tabBarIcon: ({ selected, color, size }) => {
          let iconName;
          if (route.name === 'Map') {
            iconName = selected ? 'map' : 'map-outline';
          } else if (route.name === 'History') {
            iconName = selected ? 'time' : 'time-outline';
          } else if (route.name === 'Settings') {
            iconName = selected ? 'settings' : 'settings-outline';
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const [activeUser, setActiveUser] = useState(null);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setActiveUser(currentUser);
    });
    return unsubscribe;
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {activeUser ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Auth" component={LoginScreen} />
        )}
      </Stack.Navigator>
      {!splashDone ? <SplashOverlay onFinish={() => setSplashDone(true)} /> : null}
    </NavigationContainer>
  );
}
