import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import session from "express-session";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./src/db/schema";
import { eq, and } from "drizzle-orm";

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = drizzle(pool, { schema });

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || "calorie-lens-secret",
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: true, 
    sameSite: 'none',
    httpOnly: true 
  }
}));

// Google OAuth Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback`
);

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file'
];

// Auth Endpoints
app.get('/api/auth/url', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  res.json({ url });
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);
    
    // Get user info to associate with session
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Upsert user
    let user;
    if (userInfo.data.id) {
      const existingUser = await db.query.users.findFirst({
        where: eq(schema.users.googleId, userInfo.data.id),
      });

      if (existingUser) {
        user = existingUser;
      } else {
        const [newUser] = await db.insert(schema.users).values({
          googleId: userInfo.data.id,
          email: userInfo.data.email,
          name: userInfo.data.name,
          avatar: userInfo.data.picture,
        }).returning();
        user = newUser;
      }
    }

    // Store tokens and user in session
    (req.session as any).tokens = tokens;
    (req.session as any).userId = user?.id;

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. You can close this window.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth Callback Error:", error);
    res.status(500).send("Authentication failed");
  }
});

app.get('/api/auth/status', (req, res) => {
  const userId = (req.session as any).userId;
  const tokens = (req.session as any).tokens;
  res.json({ 
    isAuthenticated: !!userId, 
    hasSheetsAccess: !!tokens,
    userId 
  });
});

app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) return res.status(400).json({ error: "Invalid token" });

    // Upsert user
    let user = await db.query.users.findFirst({
      where: eq(schema.users.googleId, payload.sub),
    });

    if (!user) {
      const [newUser] = await db.insert(schema.users).values({
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        avatar: payload.picture,
      }).returning();
      user = newUser;
    } else {
      // Update existing user (optional, e.g. update name/avatar)
      await db.update(schema.users)
        .set({ name: payload.name, avatar: payload.picture })
        .where(eq(schema.users.id, user.id));
    }

    (req.session as any).userId = user.id;
    res.json({ success: true, user });
  } catch (error) {
    console.error("GIS Verification Error:", error);
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.post('/api/logs/sync', async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { logs } = req.body;
  if (!Array.isArray(logs)) return res.status(400).json({ error: "Invalid data" });

  try {
    const tokens = (req.session as any).tokens;
    let sheets: any = null;
    let spreadsheetId = (req.session as any).spreadsheetId;

    if (tokens) {
      oauth2Client.setCredentials(tokens);
      sheets = google.sheets({ version: 'v4', auth: oauth2Client });
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      if (!spreadsheetId) {
        const response = await drive.files.list({
          q: "name = 'CalorieLens Meals' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
          fields: 'files(id, name)',
        });
        if (response.data.files && response.data.files.length > 0) {
          spreadsheetId = response.data.files[0].id;
        } else {
          const spreadsheet = await sheets.spreadsheets.create({
            requestBody: { properties: { title: 'CalorieLens Meals' } },
          });
          spreadsheetId = spreadsheet.data.spreadsheetId;
          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Sheet1!A1',
            valueInputOption: 'RAW',
            requestBody: { values: [['Date', 'Food Name', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)']] },
          });
        }
        (req.session as any).spreadsheetId = spreadsheetId;
      }
    }

    const results = [];
    for (const log of logs) {
      // Save to DB
      const [newLog] = await db.insert(schema.logs).values({
        userId,
        foodName: log.food_name,
        calories: log.calories,
        protein: log.protein,
        carbs: log.carbs,
        fat: log.fat,
        createdAt: new Date(log.timestamp),
      }).returning();

      // Sync to Sheets
      if (sheets && spreadsheetId) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Sheet1!A1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [[log.timestamp, log.food_name, log.calories, log.protein, log.carbs, log.fat]],
          },
        });
      }
      results.push({ localId: log.id, serverId: newLog.id });
    }

    res.json({ success: true, synced: results });
  } catch (error: any) {
    console.error("Batch Sync Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Logs API
app.get('/api/logs', async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  try {
    const userLogs = await db.query.logs.findMany({
      where: eq(schema.logs.userId, userId),
      orderBy: (logs, { desc }) => [desc(logs.createdAt)],
    });
    res.json(userLogs);
  } catch (error) {
    console.error("Fetch Logs Error:", error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

app.delete('/api/logs/:id', async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { id } = req.params;
  try {
    // Basic protection: only delete if it belongs to the user
    const logId = parseInt(id);
    if (isNaN(logId)) return res.status(400).json({ error: "Invalid ID" });

    const result = await db.delete(schema.logs)
      .where(and(eq(schema.logs.id, logId), eq(schema.logs.userId, userId)))
      .returning();

    if (result.length === 0) return res.status(404).json({ error: "Log not found or unauthorized" });
    
    res.json({ success: true });
  } catch (error) {
    console.error("Delete Log Error:", error);
    res.status(500).json({ error: "Failed to delete log" });
  }
});

app.put('/api/logs/:id', async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { id } = req.params;
  const { calories, foodName } = req.body;
  try {
    const logId = parseInt(id);
    if (isNaN(logId)) return res.status(400).json({ error: "Invalid ID" });

    const result = await db.update(schema.logs)
      .set({ calories, foodName })
      .where(and(eq(schema.logs.id, logId), eq(schema.logs.userId, userId)))
      .returning();

    if (result.length === 0) return res.status(404).json({ error: "Log not found or unauthorized" });

    res.json({ success: true, log: result[0] });
  } catch (error) {
    console.error("Update Log Error:", error);
    res.status(500).json({ error: "Failed to update log" });
  }
});

app.post('/api/profile', async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { age, weight, height, gender, activityLevel, targetWeight, targetDate, country } = req.body;
  try {
    await db.update(schema.users)
      .set({ age, weight, height, gender, activityLevel, targetWeight, targetDate, country })
      .where(eq(schema.users.id, userId));
    res.json({ success: true });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// Workouts API
app.get('/api/workouts', async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  try {
    const userWorkouts = await db.select().from(schema.workouts).where(eq(schema.workouts.userId, userId));
    res.json(userWorkouts);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch workouts" });
  }
});

app.post('/api/workouts', async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { type, caloriesBurned, createdAt } = req.body;
  try {
    const [newWorkout] = await db.insert(schema.workouts).values({
      userId,
      type,
      caloriesBurned,
      createdAt: createdAt ? new Date(createdAt) : new Date(),
    }).returning();
    res.json(newWorkout);
  } catch (error) {
    res.status(500).json({ error: "Failed to add workout" });
  }
});

app.delete('/api/workouts/:id', async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  try {
    await db.delete(schema.workouts)
      .where(and(eq(schema.workouts.id, parseInt(req.params.id)), eq(schema.workouts.userId, userId)));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete workout" });
  }
});

app.post('/api/workouts/sync', async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { workouts } = req.body;
  if (!Array.isArray(workouts)) return res.status(400).json({ error: "Invalid data" });

  try {
    const results = [];
    for (const w of workouts) {
      const [newW] = await db.insert(schema.workouts).values({
        userId,
        type: w.type,
        caloriesBurned: w.calories_burned,
        createdAt: new Date(w.timestamp),
      }).returning();
      results.push({ localId: w.id, serverId: newW.id });
    }
    res.json({ success: true, synced: results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
app.post('/api/sync/sheets', async (req, res) => {
  const tokens = (req.session as any).tokens;
  if (!tokens) return res.status(401).json({ error: "Not authenticated" });

  const { foodName, calories, date } = req.body;
  if (!foodName || !calories) return res.status(400).json({ error: "Missing data" });

  try {
    oauth2Client.setCredentials(tokens);
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // 1. Find or Create CalorieLens Spreadsheet
    let spreadsheetId = (req.session as any).spreadsheetId;
    
    if (!spreadsheetId) {
      const response = await drive.files.list({
        q: "name = 'CalorieLens Meals' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
        fields: 'files(id, name)',
      });

      if (response.data.files && response.data.files.length > 0) {
        spreadsheetId = response.data.files[0].id;
      } else {
        const spreadsheet = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title: 'CalorieLens Meals' },
          },
        });
        spreadsheetId = spreadsheet.data.spreadsheetId;
        
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Sheet1!A1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [['Date', 'Food Name', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)']],
          },
        });
      }
      (req.session as any).spreadsheetId = spreadsheetId;
    }

    // 2. Append Row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[date || new Date().toISOString(), foodName, calories, req.body.protein, req.body.carbs, req.body.fat]],
      },
    });

    // 3. Save to Local DB if user is logged in
    const userId = (req.session as any).userId;
    if (userId) {
      await db.insert(schema.logs).values({
        userId,
        foodName,
        calories,
        protein: req.body.protein,
        carbs: req.body.carbs,
        fat: req.body.fat,
        createdAt: date ? new Date(date) : new Date(),
      });
    }

    res.json({ success: true, spreadsheetId });
  } catch (error: any) {
    console.error("Sheets Sync Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Vite Middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CalorieLens running at http://localhost:${PORT}`);
  });
}

startServer();
