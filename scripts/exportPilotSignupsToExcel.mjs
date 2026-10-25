// Export DalParkAid Pilot Signups from Firebase Firestore (dalparking-19789) to an Excel-ready CSV file
// Usage: node scripts/exportPilotSignupsToExcel.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'dalparking-19789';
const COLLECTION = 'pilotSignups';
const ENDPOINT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}?pageSize=500`;

// Security Fix V2: Neutralize CSV/Excel formula injection (=, +, -, @, \t, \r)
export function sanitizeCSVCell(val) {
  let str = String(val ?? '');
  const trimmed = str.trimStart();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export async function exportToExcelCSV() {
  console.log(`Fetching pilot signups from Firebase Firestore (${PROJECT_ID}/${COLLECTION})...`);
  const res = await fetch(ENDPOINT);
  if (!res.ok) {
    throw new Error(`Firestore request failed with status ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const docs = Array.isArray(data.documents) ? data.documents : [];

  const rows = docs.map((doc) => {
    const f = doc.fields || {};
    return {
      submittedAt: f.submittedAt?.stringValue || '',
      name: f.name?.stringValue || '',
      email: f.email?.stringValue || '',
      role: f.role?.stringValue || '',
      campus: f.campus?.stringValue || '',
      permit: f.permit?.stringValue || '',
      openToInterview: f.openToInterview?.stringValue || '',
      note: f.note?.stringValue || ''
    };
  });

  const headers = [
    'Submitted At (ISO)',
    'Full Name',
    'Email',
    'Role',
    'Campus / Zone',
    'Permit Tier',
    'Open to 10-Min Chat',
    'Parking Feedback Note'
  ];

  const csvContent =
    '\uFEFF' +
    [
      headers.map(sanitizeCSVCell).join(','),
      ...rows.map((r) =>
        [
          r.submittedAt,
          r.name,
          r.email,
          r.role,
          r.campus,
          r.permit,
          r.openToInterview,
          r.note
        ]
          .map(sanitizeCSVCell)
          .join(',')
      )
    ].join('\r\n');

  const outPath = path.resolve(process.cwd(), 'DalParkAid_Pilot_Signups.csv');
  fs.writeFileSync(outPath, csvContent, 'utf8');
  console.log(`Exported ${rows.length} signup(s) to Excel CSV: ${outPath}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  exportToExcelCSV().catch((err) => {
    console.error('Export error:', err.message);
    process.exit(1);
  });
}
