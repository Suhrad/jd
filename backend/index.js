require('dotenv').config();
require('dns').setDefaultResultOrder('ipv4first');
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { initDb } = require('./db/database');

const app = express();

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

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

// Catch-all: serve the frontend
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
