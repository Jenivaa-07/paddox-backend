const assert = require('assert');
const axios = require('axios');
const AIClientService = require('./services/aiClient.service');

// Mock axios to intercept model_not_ready explicitly without breaking the real running server
const originalPost = axios.post;

async function runTests() {
  console.log("Starting Gateway Automated Tests...");
  let passed = 0;
  let failed = 0;
  
  function check(name, condition) {
    try {
      assert(condition);
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}`);
      failed++;
    }
  }

  // 1. Valid Race Request
  try {
    const res = await AIClientService.predictRace({
      recent_laps: [90000, 90000],
      features: { grid_position: 1, rolling_avg_finish: 2.0, field_size: 20 }
    });
    check("Valid Race Request success", res.status !== 'error');
    check("Race Request ID propagated", !!res.request_id);
  } catch (e) {
    check("Valid Race Request success", false);
  }

  // 2. Valid Batch Fantasy Request
  try {
    const res = await AIClientService.predictFantasy({
      drivers: [
        { driver_id: "VER", constructor_id: "Red Bull", qualifying_position: 1, features: { rolling_avg_finish: 1.0 } }
      ]
    });
    check("Valid Batch Fantasy success", res.status !== 'error');
    check("Fantasy Request ID propagated", !!res.request_id);
  } catch (e) {
    check("Valid Batch Fantasy success", false);
  }

  // 3. Malformed Input Handling
  try {
    const res = await AIClientService.predictRace({ bad_key: "value" });
    console.log("Malformed input response:", res);
    check("Malformed Input handled sanitarily", res.status === 'error' && res.details && !res.details.includes("Traceback"));
  } catch (e) {
    console.error("Malformed exception:", e);
    check("Malformed Input handled sanitarily", false);
  }

  // 4. Timeout Handling
  try {
    axios.post = () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout of 5000ms exceeded')), 10));
    const res = await AIClientService.predictRace({});
    check("Timeout Handling", res.status === 'error' && res.message.includes('Race prediction failed'));
  } catch (e) {
    check("Timeout Handling", false);
  }

  // 5. Model Not Ready Handling
  try {
    axios.post = () => Promise.reject({ response: { status: 503 } });
    const res = await AIClientService.predictFantasy({});
    check("Model Not Ready Handling", res.status === 'error' && res.details === 'model_not_ready');
  } catch (e) {
    check("Model Not Ready Handling", false);
  }

  // Restore axios
  axios.post = originalPost;

  console.log(`\nTests completed. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
