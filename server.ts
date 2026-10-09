import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Initialize Gemini SDK on server-side
const geminiApiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (geminiApiKey) {
  try {
    ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } catch (err) {
    console.warn('Failed to initialize GoogleGenAI with provided key:', err);
  }
}

// In-memory data stores for reports, live sharing, and Overpass cache
interface Report {
  id: string;
  lat: number;
  lng: number;
  type: 'dark_patch' | 'broken_streetlight' | 'harassment' | 'suspicious_activity' | 'isolated_area' | 'other';
  note?: string;
  timestamp: number;
  confirmations: number;
  dismissals: number;
  ipHash?: string;
}

interface LiveSession {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  originName: string;
  destinationName: string;
  routeGeometry: [number, number][]; // [lng, lat]
  currentLocation?: {
    lat: number;
    lng: number;
    accuracy?: number;
    heading?: number;
    speed?: number;
    updatedAt: number;
  };
  status: 'active' | 'completed' | 'off_route_alert';
  alertMessage?: string;
}

// Seed initial verified reports around common demonstration areas
const reports: Report[] = [
  {
    id: 'seed-rep-1',
    lat: 26.8449,
    lng: 75.5645,
    type: 'dark_patch',
    note: 'Flickering street fixture; sidewalk completely dark after 9 PM',
    timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000,
    confirmations: 4,
    dismissals: 0,
  },
  {
    id: 'seed-rep-2',
    lat: 26.8422,
    lng: 75.5670,
    type: 'isolated_area',
    note: 'Narrow unmonitored lane behind service perimeter',
    timestamp: Date.now() - 6 * 24 * 60 * 60 * 1000,
    confirmations: 6,
    dismissals: 1,
  },
  {
    id: 'seed-rep-3',
    lat: 26.8465,
    lng: 75.5630,
    type: 'broken_streetlight',
    note: 'Street pole #14 light bulb shattered',
    timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000,
    confirmations: 2,
    dismissals: 0,
  },
];

const liveSessions = new Map<string, LiveSession>();
const overpassServerCache = new Map<string, { timestamp: number; data: any }>();

// Deterministic template fallback function for route comparison explanations
function generateDeterministicRouteExplanation(stats: {
  routeName: string;
  safetyScore: number;
  litPercent: number;
  unlitDistanceMeters: number;
  openPlacesCount: number;
  openHavensPassedCount: number;
  longestHavenGapMeters: number;
  durationMins: number;
  timeDiffMins?: number;
  scoreDiff?: number;
  isBestSafe?: boolean;
}): string {
  const parts: string[] = [];

  if (stats.isBestSafe) {
    parts.push(`Highest safety rating (${stats.safetyScore}/100)`);
  }

  if (stats.litPercent >= 75) {
    parts.push(`${stats.litPercent}% illuminated with active street lighting`);
  } else if (stats.unlitDistanceMeters > 0) {
    parts.push(`contains a ${Math.round(stats.unlitDistanceMeters)}m dimmer stretch`);
  }

  if (stats.openHavensPassedCount > 0) {
    parts.push(`passes within 100m of ${stats.openHavensPassedCount} open safe haven${stats.openHavensPassedCount > 1 ? 's' : ''}`);
  }

  if (stats.longestHavenGapMeters > 300) {
    parts.push(`longest gap between safe havens is ${Math.round(stats.longestHavenGapMeters)}m`);
  } else if (stats.longestHavenGapMeters > 0) {
    parts.push(`maintains continuous haven proximity within ${Math.round(stats.longestHavenGapMeters)}m`);
  }

  if (stats.openPlacesCount > 0) {
    parts.push(`crosses ${stats.openPlacesCount} open businesses with pedestrian activity`);
  }

  if (stats.timeDiffMins && Math.abs(stats.timeDiffMins) > 0) {
    const diffStr = Math.abs(stats.timeDiffMins) === 1 ? '1 min' : `${Math.abs(stats.timeDiffMins)} mins`;
    if (stats.timeDiffMins > 0) {
      return `This route is ${diffStr} longer, but ${parts.slice(0, 3).join(', ')}.`;
    } else {
      return `This route is ${diffStr} faster while keeping a ${stats.safetyScore}/100 safety score (${parts.slice(0, 2).join(', ')}).`;
    }
  }

  return `Rated ${stats.safetyScore}/100: ${parts.slice(0, 3).join(', ')}.`;
}

// -------------------------------------------------------------
// API ROUTES
// -------------------------------------------------------------

// 1. Gemini Route Explanation Endpoint
app.post('/api/routes/explain', async (req, res) => {
  try {
    const {
      selectedRouteStats,
      alternativeRouteStats,
      timeString,
      isCampusMode,
    } = req.body;

    if (!selectedRouteStats) {
      return res.status(400).json({ error: 'Missing selectedRouteStats in request' });
    }

    const durationMins = Math.round(selectedRouteStats.rawDuration / 60);
    const altDurationMins = alternativeRouteStats ? Math.round(alternativeRouteStats.rawDuration / 60) : undefined;
    const timeDiffMins = altDurationMins !== undefined ? (durationMins - altDurationMins) : 0;
    const scoreDiff = alternativeRouteStats ? (selectedRouteStats.safetyScore - alternativeRouteStats.safetyScore) : 0;

    const fallbackExplanation = generateDeterministicRouteExplanation({
      routeName: selectedRouteStats.name || 'Selected Route',
      safetyScore: selectedRouteStats.safetyScore,
      litPercent: selectedRouteStats.litPercent,
      unlitDistanceMeters: selectedRouteStats.unlitDistanceMeters,
      openPlacesCount: selectedRouteStats.openPlacesCount,
      openHavensPassedCount: selectedRouteStats.openHavensPassedCount,
      longestHavenGapMeters: selectedRouteStats.longestHavenGapMeters,
      durationMins,
      timeDiffMins,
      scoreDiff,
      isBestSafe: scoreDiff >= 0,
    });

    if (!ai) {
      return res.json({
        explanation: fallbackExplanation,
        provider: 'deterministic-template',
      });
    }

    const prompt = `You are the safety intelligence engine for NightOwl, a pedestrian navigation app.
Your task is to write a concise, calming, plain-English 2-sentence explanation comparing walking routes at ${timeString || 'the selected time'}.

STRICT RULES:
1. State ONLY facts from the provided data. NEVER hallucinate shops, police, lights, or distances not present in data.
2. Tone: Calm, reassuring, objective, informative. No alarming or sensationalist language.
3. Maximum 2 sentences.

DATA:
- Selected Route: "${selectedRouteStats.name || 'Route'}"
  - Safety Score: ${selectedRouteStats.safetyScore}/100
  - Duration: ${durationMins} minutes (${Math.round(selectedRouteStats.rawDistance)} meters)
  - Street Lighting: ${selectedRouteStats.litPercent}% lit (${Math.round(selectedRouteStats.unlitDistanceMeters)}m unlit or unknown stretch)
  - Open Businesses nearby: ${selectedRouteStats.openPlacesCount}
  - Open Safe Havens passed (within 100m): ${selectedRouteStats.openHavensPassedCount}
  - Longest stretch without safe haven: ${Math.round(selectedRouteStats.longestHavenGapMeters)} meters
  - Reported Incidents nearby: ${selectedRouteStats.nearbyIncidentsCount}
${alternativeRouteStats ? `
- Alternative Route: "${alternativeRouteStats.name || 'Alternative'}"
  - Safety Score: ${alternativeRouteStats.safetyScore}/100
  - Duration: ${Math.round(alternativeRouteStats.rawDuration / 60)} minutes (${Math.round(alternativeRouteStats.rawDistance)} meters)
  - Street Lighting: ${alternativeRouteStats.litPercent}% lit
  - Open Safe Havens: ${alternativeRouteStats.openHavensPassedCount}
  - Time Difference: ${timeDiffMins > 0 ? `${timeDiffMins} minutes longer` : `${Math.abs(timeDiffMins)} minutes faster`}
  - Score Difference: ${scoreDiff > 0 ? `+${scoreDiff} points safer` : `${scoreDiff} points`}
` : ''}
${isCampusMode ? '- Note: Walking through an active pedestrian campus zone.' : ''}

Output ONLY the 2-sentence plain-English explanation:`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        temperature: 0.2, // Low temperature for high factual adherence
      },
    });

    const aiText = response.text?.trim();
    if (!aiText) {
      return res.json({ explanation: fallbackExplanation, provider: 'fallback' });
    }

    return res.json({
      explanation: aiText,
      provider: 'gemini-3.8-flash',
    });
  } catch (err: any) {
    console.warn('Gemini explanation error, using fallback:', err?.message || err);
    const fallback = generateDeterministicRouteExplanation({
      routeName: req.body?.selectedRouteStats?.name || 'Selected Route',
      safetyScore: req.body?.selectedRouteStats?.safetyScore || 75,
      litPercent: req.body?.selectedRouteStats?.litPercent || 80,
      unlitDistanceMeters: req.body?.selectedRouteStats?.unlitDistanceMeters || 0,
      openPlacesCount: req.body?.selectedRouteStats?.openPlacesCount || 3,
      openHavensPassedCount: req.body?.selectedRouteStats?.openHavensPassedCount || 1,
      longestHavenGapMeters: req.body?.selectedRouteStats?.longestHavenGapMeters || 120,
      durationMins: Math.round((req.body?.selectedRouteStats?.rawDuration || 600) / 60),
    });
    return res.json({ explanation: fallback, provider: 'fallback' });
  }
});

// 2. Crowdsourced Reports Endpoints
app.get('/api/reports', (_req, res) => {
  res.json({ reports });
});

app.post('/api/reports', (req, res) => {
  const { lat, lng, type, note } = req.body;
  if (!lat || !lng || !type) {
    return res.status(400).json({ error: 'Missing required report fields (lat, lng, type)' });
  }

  const newReport: Report = {
    id: `rep-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    lat: Number(lat),
    lng: Number(lng),
    type,
    note: note ? String(note).slice(0, 300) : undefined,
    timestamp: Date.now(),
    confirmations: 1, // Submitter confirmation
    dismissals: 0,
    ipHash: req.ip,
  };

  reports.push(newReport);
  res.status(201).json({ success: true, report: newReport });
});

app.post('/api/reports/:id/vote', (req, res) => {
  const { id } = req.params;
  const { vote } = req.body; // 'confirm' or 'dismiss'

  const rep = reports.find(r => r.id === id);
  if (!rep) {
    return res.status(404).json({ error: 'Report not found' });
  }

  if (vote === 'confirm') {
    rep.confirmations += 1;
  } else if (vote === 'dismiss') {
    rep.dismissals += 1;
  }

  res.json({ success: true, report: rep });
});

// 3. Live Share Sessions Endpoints
app.post('/api/share', (req, res) => {
  const { originName, destinationName, routeGeometry, currentLocation } = req.body;
  const sessionId = Math.random().toString(36).substring(2, 10).toUpperCase();

  const session: LiveSession = {
    sessionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 4 * 60 * 60 * 1000, // 4 hours TTL
    originName: originName || 'Start Point',
    destinationName: destinationName || 'Destination',
    routeGeometry: routeGeometry || [],
    currentLocation: currentLocation || undefined,
    status: 'active',
  };

  liveSessions.set(sessionId, session);
  res.status(201).json({ success: true, sessionId, session });
});

app.put('/api/share/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = liveSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Live session not found or expired' });
  }

  const { currentLocation, status, alertMessage } = req.body;
  if (currentLocation) {
    session.currentLocation = {
      ...currentLocation,
      updatedAt: Date.now(),
    };
  }
  if (status) session.status = status;
  if (alertMessage !== undefined) session.alertMessage = alertMessage;

  res.json({ success: true, session });
});

app.get('/api/share/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = liveSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (Date.now() > session.expiresAt) {
    liveSessions.delete(sessionId);
    return res.status(410).json({ error: 'Session has expired' });
  }

  res.json({ session });
});

app.delete('/api/share/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  liveSessions.delete(sessionId);
  res.json({ success: true });
});

// 4. Overpass Corridor Cache Proxy (protects client rate-limits and CORS)
app.post('/api/osm/corridor', async (req, res) => {
  const { query, cacheKey } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });

  if (cacheKey) {
    const cached = overpassServerCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 15 * 60 * 1000) {
      return res.json(cached.data);
    }
  }

  const overpassMirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  let lastError: string = '';
  for (const mirrorUrl of overpassMirrors) {
    try {
      const overpassRes = await fetch(mirrorUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!overpassRes.ok) {
        console.error(`Overpass server proxy failed: ${mirrorUrl} (status: ${overpassRes.status})`);
        lastError = `Status ${overpassRes.status}`;
        continue; // Try backup mirror
      }

      const data = await overpassRes.json();
      if (cacheKey) {
        overpassServerCache.set(cacheKey, { timestamp: Date.now(), data });
      }
      return res.json(data);
    } catch (err: any) {
      console.error(`Overpass server proxy error: ${mirrorUrl} (status: network error - ${err?.message || err})`);
      lastError = err?.message || String(err);
    }
  }

  return res.status(502).json({ error: 'Failed to reach Overpass API mirrors', details: lastError });
});

// Setup Vite middleware in dev or static serving in prod
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NightOwl server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
