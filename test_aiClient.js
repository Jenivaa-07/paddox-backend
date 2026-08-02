const AIClientService = require('./services/aiClient.service.js');
const assert = require('assert');

async function runTests() {
  console.log("Starting Node Gateway Tests for Phase 4...");
  let passed = 0;
  let failed = 0;

  try {
    // 1. getRecommendations (catalog_featured_fallback)
    const recs = await AIClientService.getRecommendations("user_123");
    assert(recs.strategy === "catalog_featured_fallback", "Expected catalog_featured_fallback");
    assert(recs.request_id, "Expected request_id to propagate");
    passed++;
    console.log("Passed: getRecommendations catalog_featured_fallback");
  } catch (e) {
    failed++;
    console.error("Failed: getRecommendations", e.message);
  }

  try {
    // 2. rankHighlights (authorized_inventory_unavailable)
    const hl = await AIClientService.rankHighlights("user_123", "2023_1");
    assert(hl.status === "authorized_inventory_unavailable", "Expected authorized_inventory_unavailable");
    assert(hl.grounded === false, "Expected grounded to be false");
    passed++;
    console.log("Passed: rankHighlights authorized_inventory_unavailable");
  } catch (e) {
    failed++;
    console.error("Failed: rankHighlights", e.message);
  }

  try {
    // 3. malformed request handling
    const bad = await AIClientService.getRecommendations(); // No user_id
    assert(bad.status === "error", "Expected error for malformed request");
    passed++;
    console.log("Passed: malformed request handled gracefully");
  } catch (e) {
    failed++;
    console.error("Failed: malformed request", e.message);
  }

  try {
    // 4. offline / timeout handling (FastAPI is off during this step)
    // To simulate without stopping FastAPI midway, we can just assert that when an error occurs, it is sanitized
    const timeoutRes = await AIClientService.getRecommendations("u1", {}, 10, ["fail_me_now"]); 
    // Wait, since FastAPI is on during tests, let's just accept the earlier malformed test as proof of error handling, or mock axios here.
    // I will mock axios to simulate a timeout.
    const axios = require('axios');
    const originalPost = axios.post;
    axios.post = async () => { throw new Error('timeout of 5000ms exceeded'); };
    
    const errRes = await AIClientService.getRecommendations("u1");
    assert(errRes.status === "error", "Expected error status for timeout");
    assert(errRes.message === "Recommendation failed", "Expected sanitized message");
    passed++;
    console.log("Passed: timeout handling and sanitized errors");
    
    axios.post = originalPost;
  } catch (e) {
    failed++;
    console.error("Failed: timeout handling", e.message);
  }
  
  console.log(`\nTests Completed. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
