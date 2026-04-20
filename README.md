# DalParkAid

**Smart parking for Dalhousie University**

DalParkAid is a mobile app that helps Dalhousie students, staff, and visitors find the best parking spot on campus. It combines real-time crowdsourced reports, weather data, academic calendar signals, and a prediction engine to estimate lot availability across 28 Studley and Sexton campus parking lots.

---

## Download & Test

*Production & Development APK links are temporarily offline while we migrate our cloud infrastructure. Check back soon for the final playable builds!*

---

## Features

### Interactive Parking Map
- 28 Dalhousie parking lots displayed with color-coded status markers (Empty → Full)
- Real-time availability predictions powered by a custom scoring engine
- Search and filter lots by name
- Recommended, Nearest, and Most Open lot suggestions
- Satellite / Standard map toggle
- Live weather display with temperature and conditions

### In-App Navigation
- Turn-by-turn driving directions powered by Google Directions API
- Multiple alternate route suggestions — tap to switch
- Walking dots from your current location to the route start
- Start / Center / End navigation controls
- Step-by-step direction banner (e.g., "Turn right onto Queen St — 64 m")
- Auto-arrival detection — navigation ends when you reach the lot
- Destination pin marker at the parking lot

### Lot Detail Bottom Sheet
- **Slide 1:** Estimated available spots (day/evening), prediction score gradient (Full ↔ Empty), 24-hour predicted availability timeline
- **Slide 2:** Global photo gallery — browse photos submitted by other users for that lot
- Drag-to-dismiss with spring animation

### Crowdsourced Reporting
- Submit a busy-ness report (1–5 emoji scale) when within 30 meters of a lot
- Attach a photo via camera or gallery — uploaded to Firebase Storage
- Reports are weighted by freshness, photo proof, and community votes

### Community & Gamification
- **Community tab:** Browse all reports with upvote/downvote voting
- **Leaderboard tab:** Users ranked by total reports submitted
- Filter reports by lot name and by rating (Full / Busy / Moderate / Available / Empty)

### User Profile
- Edit display name, role, preferred campus, and about section
- Upload a custom avatar photo
- Manage and delete your own reports
- Reset password via email

### Additional
- Animated splash screen on app launch
- Haptic feedback on key interactions
- Forgot Password on login screen
- Graceful offline fallback — app works with bundled lot data if Firestore is unavailable

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Expo SDK 54, React Native 0.81, React 19 |
| Language | JavaScript (JSX) |
| Navigation | React Navigation 7 (native-stack + bottom-tabs) |
| Maps | react-native-maps (Google Maps) |
| Auth / DB / Storage | Firebase JS SDK 12 (Auth, Firestore, Storage) |
| Location | expo-location |
| Camera | expo-image-picker |
| Haptics | expo-haptics |
| Routing | Google Directions API |
| Weather | Open-Meteo API |
| Icons | @expo/vector-icons (Ionicons, MaterialCommunityIcons) |

---

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- [Expo Go](https://expo.dev/client) app installed on your phone (Android or iOS)
- Git

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://git.cs.dal.ca/courses/2026-winter/csci-4176-5708/project-milestone-2/project-team-11/project-milestone-2.git
cd project-milestone-2
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up API keys

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` and fill in the real `EXPO_PUBLIC_` API credentials (ask a team member for the values). This securely injects the secrets into the app without exposing them to Git.

### 4. Start the development server

```bash
npx expo start -c
```

The `-c` flag clears the Metro bundler cache (recommended for clean starts).

### 5. Connect your device

- **Physical device:** Scan the QR code with Expo Go (Android) or Camera app (iOS). Ensure your phone and computer are on the same Wi-Fi network.
- **Tunnel mode:** If same-network doesn't work, restart with `npx expo start -c --tunnel`.
- **Android emulator:** Press `a` in the terminal (requires Android Studio with an AVD configured).

---

## Project Structure

```
project-milestone-2/
├── App.js                              # Root component
├── index.js                            # Entry point
├── package.json                        # Dependencies and scripts
├── app.json                            # Expo configuration
├── babel.config.js                     # Babel + dotenv plugin
├── storage.rules                       # Firebase Storage security rules
├── .env.example                        # Environment variable template
├── assets/                             # App icons, splash screen, logos
├── scripts/
│   └── syncOfficialPredictionSignals.mjs  # Dal.ca academic data scraper
└── src/
    ├── components/
    │   ├── common/
    │   │   ├── PrimaryButton.js         # Reusable gold button
    │   │   └── SplashOverlay.js         # Animated launch screen
    │   └── map/
    │       ├── LotBottomSheet.js        # Lot detail sheet with gallery
    │       └── ReportModal.js           # Crowdsource report modal
    ├── config/
    │   └── firebase.js                  # Firebase initialization
    ├── constants/
    │   └── statusStyle.js               # Status → color/label mapping
    ├── data/
    │   ├── parkingLots.js               # Local fallback lot data (28 lots)
    │   └── officialPredictionSignals.js # Generated academic calendar + load data
    ├── navigation/
    │   └── AppNavigator.js              # Auth-gated stack + tab navigation
    ├── screens/
    │   ├── LoginScreen.js               # Email/password auth + forgot password
    │   ├── MapScreen.js                 # Main map, navigation, predictions
    │   ├── HistoryScreen.js             # Community reports + leaderboard
    │   └── SettingsScreen.js            # Profile editor + report manager
    ├── theme/
    │   └── tokens.js                    # Design tokens (colors, spacing, typography)
    └── utils/
        ├── engine.js                    # Availability prediction engine
        ├── routing.js                   # Google Directions API + fallback routing
        ├── hrmApi.js                    # HRM parking zone data fetcher
        ├── lotsFirestore.js             # Firestore lot subscription with fallback
        ├── mapPreferencesStorage.js     # AsyncStorage persistence for map state
        ├── navigation.js               # External maps deep link (fallback)
        ├── predictionSignals.js         # Academic signal resolution
        ├── reportVotes.js              # Upvote/downvote Firestore transactions
        └── theme.js                     # Legacy theme (deprecated)
```

---

## Firestore Collections

| Collection | Document ID | Purpose |
|-----------|-------------|---------|
| `lots` | lot slug (e.g., `studley-dalplex`) | Lot metadata, coordinates, capacity, status |
| `reports` | auto-generated | Crowdsourced busy-ness reports with photos |
| `reportVotes` | `{reportId}_{userId}` | One vote per user per report |
| `userProfiles` | Firebase UID | Display name, avatar, role, campus preference |
| `calendarSignals` | auto-generated | Live academic calendar overrides (optional) |
| `campusLoadBuckets` | auto-generated | Live campus load overrides (optional) |

---

## Prediction Engine

The availability prediction engine (`src/utils/engine.js`) blends three signals:

1. **Deterministic engine score** — Based on hour-of-day, day-of-week, weather, lot type, academic calendar, campus load index, and lot capacity.
2. **Crowdsourced reports** — Recent user reports within the last 90 minutes, weighted by freshness, photo proof, user trust, and community votes.
3. **Historical patterns** — Matching reports from the same weekday and hour over the past 42 days.

Output: a 0–100 availability score mapped to status labels (Empty / Normal / Crowded / Almost Full / Full).

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the Expo dev server |
| `npm run android` | Start on Android |
| `npm run ios` | Start on iOS |
| `npm run web` | Start on web (limited — maps not supported) |
| `npm run sync:signals` | Scrape Dal.ca and regenerate academic signal data |

---

## External APIs

| API | Purpose |
|-----|---------|
| [Google Directions API](https://developers.google.com/maps/documentation/directions) | In-app driving route calculation |
| [Open-Meteo](https://open-meteo.com/) | Real-time weather data (free, no key required) |
| [Firebase](https://firebase.google.com/) | Authentication, Firestore database, Cloud Storage |

---

## Team

**Project Team 11** — CSCI 4176/5708 Mobile Computing, Dalhousie University, Winter 2026

---

## License

This project was developed as part of the CSCI 4176/5708 course at Dalhousie University. All rights reserved.
