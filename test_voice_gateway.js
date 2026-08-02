const assert = require('assert');
const path = require('path');
const AIClientService = require('./services/aiClient.service');

async function testVoiceGateway() {
  console.log("Starting Node Voice Gateway Tests...");

  // Mock axios to avoid hitting real Python backend in CI/smoke testing unless it's running
  const axios = require('axios');
  const originalPost = axios.post;
  
  try {
    // 1. Test Valid Forwarding
    axios.post = async (url, data, config) => {
      if (url.endsWith('/voice/ask')) {
        return {
          data: {
            transcript: "Test Transcript",
            intent: "general_rag",
            spoken_answer: "Test Answer",
            audio_retained: false
          }
        };
      }
      throw new Error("Unexpected URL");
    };

    const validBuffer = Buffer.from("fake_audio_data");
    const validRes = await AIClientService.askVoiceAssistant(validBuffer, "test.webm", "audio/webm");
    assert.strictEqual(validRes.transcript, "Test Transcript");
    assert.strictEqual(validRes.audio_retained, false);
    console.log("✔ Valid forwarding passed");

    // 2. Test Timeout (503 translation)
    axios.post = async () => {
      const err = new Error("timeout");
      err.response = { status: 503, data: {} };
      throw err;
    };
    const timeoutRes = await AIClientService.askVoiceAssistant(validBuffer, "test.webm", "audio/webm");
    assert.strictEqual(timeoutRes.status, "error");
    assert.strictEqual(timeoutRes.statusCode, 503);
    assert.strictEqual(timeoutRes.message, "transcription_provider_unavailable");
    console.log("✔ Timeout 503 handling passed");

    // 3. Test File Too Large (413 translation)
    axios.post = async () => {
      const err = new Error("too large");
      err.response = { status: 413, data: {} };
      throw err;
    };
    const largeRes = await AIClientService.askVoiceAssistant(validBuffer, "test.webm", "audio/webm");
    assert.strictEqual(largeRes.status, "error");
    assert.strictEqual(largeRes.statusCode, 413);
    assert.strictEqual(largeRes.message, "audio_too_large");
    console.log("✔ File too large handling passed");

    // 4. Test 400 Validation Error
    axios.post = async () => {
      const err = new Error("bad req");
      err.response = { status: 400, data: { detail: "no_speech_detected" } };
      throw err;
    };
    const badReq = await AIClientService.askVoiceAssistant(validBuffer, "test.webm", "audio/webm");
    assert.strictEqual(badReq.status, "error");
    assert.strictEqual(badReq.statusCode, 400);
    assert.strictEqual(badReq.message, "no_speech_detected");
    console.log("✔ 400 Validation handling passed");

    console.log("All Node Voice Gateway Tests Passed!");
    process.exit(0);
  } catch (e) {
    console.error("Assertion Failed:", e);
    process.exit(1);
  } finally {
    axios.post = originalPost;
  }
}

testVoiceGateway();
