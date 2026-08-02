const axios = require('axios');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';

class AIClientService {
  /**
   * Health check for the paddox-ai microservice
   */
  static async checkHealth() {
    try {
      const response = await axios.get(`${AI_SERVICE_URL}/health`, { timeout: 3000 });
      return response.data;
    } catch (error) {
      console.error('AI Service Health Check Failed:', error.message);
      return { status: 'error', message: 'AI microservice unreachable', details: error.message };
    }
  }

  /**
   * TM-BERT Sentiment Analysis
   * @param {string} text - Fan Hub post text
   * @returns {Promise<Object>} { sentiment: 'positive'|'neutral'|'negative' }
   */
  static async analyzeSentiment(text) {
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/analyze-sentiment`, { text }, { timeout: 5000 });
      return response.data;
    } catch (error) {
      console.error('Sentiment Analysis Failed:', error.message);
      return { status: 'error', message: 'Model not ready', details: error.message };
    }
  }

  /**
   * LSTM Race Predictor
   * @param {Object} telemetryData - Live telemetry object
   */
  static async predictRace(telemetryData) {
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/predict-race`, telemetryData, { timeout: 5000 });
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 503) {
        return { status: 'error', message: 'Model not ready', details: 'model_not_ready' };
      }
      return { status: 'error', message: 'Race prediction failed', details: error.message };
    }
  }

  /**
   * Random Forest Fantasy Predictor
   * @param {Object} batchData - Batch of driver features
   */
  static async predictFantasy(batchData) {
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/predict-fantasy`, batchData, { timeout: 5000 });
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 503) {
        return { status: 'error', message: 'Model not ready', details: 'model_not_ready' };
      }
      return { status: 'error', message: 'Fantasy prediction failed', details: error.message };
    }
  }

  /**
   * Hybrid Deep Recommender
   */
  static async getRecommendations(userId, context = {}, k = 10, excludeItemIds = []) {
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/recommend`, { user_id: userId, context, k, exclude_item_ids: excludeItemIds }, { timeout: 5000 });
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 503) {
        return { status: 'error', message: 'Model not ready', details: 'model_not_ready' };
      }
      return { status: 'error', message: 'Recommendation failed', details: error.message };
    }
  }

  /**
   * Personalized Highlight Ranker
   */
  static async rankHighlights(userId, raceId, candidateHighlightIds = [], k = 10) {
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/rank-highlights`, { user_id: userId, race_id: raceId, candidate_highlight_ids: candidateHighlightIds, k }, { timeout: 5000 });
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 503) {
        return { status: 'error', message: 'Model not ready', details: 'model_not_ready' };
      }
      return { status: 'error', message: 'Highlight ranking failed', details: error.message };
    }
  }

  /**
   * RAG Chatbot
   * @param {String} query - User question
   * @param {Object} context - Race context or user state
   */
  static async chat(query, context = {}) {
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/chat`, { query, context }, { timeout: 10000 });
      return response.data;
    } catch (error) {
      console.error('Chat Failed:', error.message);
      return { status: 'error', message: 'Model not ready', details: error.message };
    }
  }
  /**
   * Voice Assistant
   * @param {Buffer} fileBuffer
   * @param {String} filename
   * @param {String} mimetype
   * @param {String} language
   * @param {String} raceId
   */
  static async askVoiceAssistant(fileBuffer, filename, mimetype, language = null, raceId = null) {
    try {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('file', fileBuffer, { filename, contentType: mimetype });
      
      if (language) form.append('language', language);
      if (raceId) form.append('race_id', raceId);

      const response = await axios.post(`${AI_SERVICE_URL}/voice/ask`, form, {
        headers: form.getHeaders(),
        timeout: 30000 // Transcription can take time, max 30s as per requirement
      });
      return response.data;
    } catch (error) {
      if (error.response) {
        if (error.response.status === 400) return { status: 'error', statusCode: 400, message: error.response.data.detail || 'invalid_request' };
        if (error.response.status === 413) return { status: 'error', statusCode: 413, message: 'audio_too_large' };
        if (error.response.status === 429) return { status: 'error', statusCode: 429, message: 'voice_rate_limited' };
        if (error.response.status === 503) return { status: 'error', statusCode: 503, message: 'transcription_provider_unavailable' };
      }
      return { status: 'error', statusCode: 500, message: 'Internal Server Error' };
    }
  }

  static async checkVoiceHealth() {
    return this.checkHealth();
  }
}

module.exports = AIClientService;
