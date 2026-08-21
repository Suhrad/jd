globalThis.crypto = require('crypto').webcrypto;
const express = require('express');
const router  = express.Router();
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// In-memory audio buffer cache (keyed by voiceId + text hash) for instant 5ms playback
const audioCache = new Map();

const AZURE_VOICE_CONFIG = {
  'neerja':         { voice: 'en-IN-NeerjaNeural',           pitch: '+0Hz', rate: '+0%' },
  'kavya':          { voice: 'en-IN-NeerjaNeural',           pitch: '+8Hz', rate: '+4%' },
  'ananya':         { voice: 'en-IN-NeerjaExpressiveNeural', pitch: '+2Hz', rate: '-2%' },
  'aashi':          { voice: 'en-IN-NeerjaNeural',           pitch: '+12Hz', rate: '+8%' },
  'prabhat':        { voice: 'en-IN-PrabhatNeural',          pitch: '+0Hz', rate: '+0%' },
  'aarav':          { voice: 'en-IN-PrabhatNeural',          pitch: '+10Hz', rate: '+6%' },
  'rehaan':         { voice: 'en-IN-PrabhatNeural',          pitch: '+3Hz', rate: '-2%' },
  'swara':          { voice: 'hi-IN-SwaraNeural',            pitch: '+0Hz', rate: '+0%' },
  'madhur':         { voice: 'hi-IN-MadhurNeural',           pitch: '+0Hz', rate: '+0%' },
  'rachel':         { voice: 'en-US-JennyNeural',            pitch: '+0Hz', rate: '+0%' },
  'cartesia_katie': { voice: 'en-US-AvaNeural',              pitch: '+0Hz', rate: '+5%' },
  'adam':           { voice: 'en-US-GuyNeural',              pitch: '+0Hz', rate: '+0%' },
  'alloy':          { voice: 'en-US-ChristopherNeural',      pitch: '+0Hz', rate: '+0%' }
};

const DEFAULT_SAMPLE_PHRASES = {
  'neerja': 'Hello, I am Neerja. I will be guiding your technical screening call today. Walk me through the architecture of your recent project.',
  'kavya': 'Hi there, I am Kavya. Excited to chat with you today! Tell me a bit about what you have been building recently.',
  'ananya': 'Hello, I am Ananya. I look forward to exploring your technical background and problem-solving approach.',
  'aashi': 'Hey, I am Aashi! Let us jump straight in. Walk me through the most challenging bug you solved recently.',
  'prabhat': 'Hello, I am Prabhat. I will be conducting your engineering evaluation today. Let us discuss the core design trade-offs in your stack.',
  'aarav': 'Hey, I am Aarav. Great to connect! Let us dive into your hands-on experience and system scaling challenges.',
  'rehaan': 'Hello, I am Rehaan. We will explore your system architecture decisions and production scaling depth today.',
  'swara': 'Namaste, main Swara. Main aapke technical screening call ko guide karungi. Let us get started whenever you are ready.',
  'madhur': 'Namaste, main Madhur. Today we will assess your core engineering depth and hands-on experience. Let us begin.',
  'rachel': "Hi there, I'm Rachel. I'll be guiding your voice interview today. Feel free to start whenever you're ready.",
  'cartesia_katie': "Hey, Katie here! Let's dive right in and talk through your recent technical projects.",
  'adam': "Hello, this is Adam. Let's discuss your technical background and architectural decisions.",
  'alloy': "Hello, I'm Alloy. I will be facilitating your technical interview evaluation today."
};

/**
 * GET /api/voice/preview
 * Query params:
 *   - voiceId: 'neerja', 'prabhat', 'kavya', 'aashi', 'swara', etc.
 *   - text (optional): Custom greeting text
 */
router.get('/preview', async (req, res) => {
  const voiceId = (req.query.voiceId || 'neerja').toLowerCase();
  const text = (req.query.text || DEFAULT_SAMPLE_PHRASES[voiceId] || 'Hello, I will be guiding your technical interview call today.').trim();
  const config = AZURE_VOICE_CONFIG[voiceId] || { voice: 'en-IN-NeerjaNeural', pitch: '+0Hz', rate: '+0%' };

  const cacheKey = `${voiceId}:::${config.voice}:::${text}`;
  if (audioCache.has(cacheKey)) {
    const cachedBuf = audioCache.get(cacheKey);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': cachedBuf.length,
      'Cache-Control': 'public, max-age=86400'
    });
    return res.end(cachedBuf);
  }

  let tts = null;
  try {
    tts = new MsEdgeTTS();
    await tts.setMetadata(config.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { pitch: config.pitch, rate: config.rate });

    const chunks = [];
    audioStream.on('data', chunk => chunks.push(chunk));
    audioStream.on('end', () => {
      const audioBuffer = Buffer.concat(chunks);
      audioCache.set(cacheKey, audioBuffer);

      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length,
        'Cache-Control': 'public, max-age=86400'
      });
      res.end(audioBuffer);
    });

    audioStream.on('error', (err) => {
      console.error('[Voice Preview Stream Error]:', err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'Audio synthesis stream failed' });
    });
  } catch (err) {
    console.error('[Voice Preview Generation Error]:', err?.message || err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to synthesize Azure voice audio' });
  }
});

module.exports = router;
