const express = require('express');
const router = express.Router();
const multer = require('multer');
const AIClientService = require('../services/aiClient.service');
const { protect } = require('../middleware/auth.middleware');

// Limit audio uploads to 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB
  },
  fileFilter: (req, file, cb) => {
    // Only accept valid audio mimetypes
    const validMimes = ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg'];
    if (validMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('unsupported_audio'));
    }
  }
});

// We catch Multer errors inside the route
router.post('/ask', protect, (req, res, next) => {
  upload.single('audio')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'audio_too_large' });
      }
      if (err.message === 'unsupported_audio') {
        return res.status(400).json({ error: 'unsupported_audio' });
      }
      return res.status(400).json({ error: 'upload_error' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'empty_audio' });
    }

    try {
      const { language, race_id } = req.body;
      
      const response = await AIClientService.askVoiceAssistant(
        req.file.buffer,
        req.file.originalname || 'recording.webm',
        req.file.mimetype,
        language,
        race_id
      );

      if (response.status === 'error') {
        return res.status(response.statusCode || 500).json({ error: response.message });
      }

      res.status(200).json(response);
    } catch (e) {
      console.error("Voice Gateway Error:", e);
      res.status(500).json({ error: 'internal_gateway_error' });
    }
  });
});

module.exports = router;
