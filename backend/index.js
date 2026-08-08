require('dotenv').config();
require('dns').setDefaultResultOrder('ipv4first');
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { initDb } = require('./db/database');

const app = express();

app.use(cors());
app.use(express.json());

// Root path: always redirect to login page (must be BEFORE static middleware)
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Serve frontend static files (with index:false so / doesn't auto-serve index.html)
// No-cache for JS/CSS so browser always gets latest during dev
app.use(express.static(path.join(__dirname, '../frontend'), {
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// API Routes
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/companies',  require('./routes/companies'));
app.use('/api/admin',      require('./routes/admin'));
app.use('/api/jobs',       require('./routes/jobs'));
app.use('/api/candidates', require('./routes/candidates'));

// Serve the Vapi public key safely (key lives in .env, never in frontend code)
app.get('/api/config', (req, res) => {
  if (!process.env.VAPI_PUBLIC_KEY || process.env.VAPI_PUBLIC_KEY === 'your_vapi_public_key_here') {
    return res.status(503).json({ error: 'VAPI_PUBLIC_KEY not configured. Please edit your .env file.' });
  }
  res.json({ vapiPublicKey: process.env.VAPI_PUBLIC_KEY });
});

// Catch-all: serve the frontend app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});


// Boot: init DB first, then start server
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await initDb();
    console.log('✓ Database ready');
    app.listen(PORT, () => {
      console.log('\n🎙  AI Interview Caller is running!');
      console.log(`   → Open http://localhost:${PORT} in your browser\n`);
      if (!process.env.VAPI_PUBLIC_KEY || process.env.VAPI_PUBLIC_KEY === 'your_vapi_public_key_here') {
        console.warn('⚠️  WARNING: VAPI_PUBLIC_KEY is not set in .env');
        console.warn('   → Get your keys from https://dashboard.vapi.ai → Org Settings → API Keys\n');
      }
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
