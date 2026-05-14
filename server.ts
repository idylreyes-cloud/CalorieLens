import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import session from "express-session";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

dotenv.config();

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
    
    // Store tokens in session for now
    (req.session as any).tokens = tokens;

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
  const tokens = (req.session as any).tokens;
  res.json({ isAuthenticated: !!tokens });
});

// Google Sheets Sync Endpoint
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
        
        // Initialize header
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Sheet1!A1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [['Date', 'Food Name', 'Calories']],
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
        values: [[date || new Date().toISOString(), foodName, calories]],
      },
    });

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
