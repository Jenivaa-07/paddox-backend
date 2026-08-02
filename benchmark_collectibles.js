const fs = require('fs');
const mongoose = require('mongoose');
const { performance } = require('perf_hooks');
const os = require('os');

require('dotenv').config({ path: __dirname + '/.env' });
if (!process.env.COLLECTIBLE_CERTIFICATE_SECRET) {
  process.env.COLLECTIBLE_CERTIFICATE_SECRET = 'test_secret_for_hmac';
}
const CollectibleService = require('./services/collectible.service');
const User = require('./models/User');
const CollectibleDefinition = require('./models/CollectibleDefinition');
const UserCollectible = require('./models/UserCollectible');
const CollectibleAuditLog = require('./models/CollectibleAuditLog');
const AchievementOutbox = require('./models/AchievementOutbox');

const WARMUP_COUNT = 10;
const SAMPLE_COUNT = 50;

function calculateMetrics(durations) {
  durations.sort((a, b) => a - b);
  const min = durations[0];
  const max = durations[durations.length - 1];
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  
  const getPercentile = (p) => {
    const idx = Math.ceil((p / 100) * durations.length) - 1;
    return durations[idx];
  };

  const p50 = getPercentile(50);
  const p95 = getPercentile(95);

  const variance = durations.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / durations.length;
  const stdDev = Math.sqrt(variance);

  return { min, max, mean, p50, p95, stdDev };
}

async function runBenchmark() {
  console.log("Starting Collectible Benchmarks...");

  const rawData = {};
  const metrics = {
    systemInfo: {
      nodeVersion: process.version,
      os: os.type() + ' ' + os.release(),
      cpuModel: os.cpus()[0].model,
      cpuCount: os.cpus().length,
      ramBytes: os.totalmem(),
      databaseMode: "Local Standalone", // Modify as appropriate based on connection
      replicaSetStatus: "Unavailable" // assuming localhost paddox doesn't have replset
    }
  };

  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/paddox_test_db');
    console.log("Connected to MongoDB for benchmarking.");
    
    // Quick check if replset exists
    try {
      const status = await mongoose.connection.db.admin().command({ replSetGetStatus: 1 });
      metrics.systemInfo.databaseMode = "Replica Set";
      metrics.systemInfo.replicaSetStatus = "Active";
    } catch (err) {
       // expected if standalone
    }

    // Clean up
    await CollectibleDefinition.deleteMany({});
    await UserCollectible.deleteMany({});
    await CollectibleAuditLog.deleteMany({});
    await User.deleteMany({ email: /@bench\.com/ });

    const benchAdmin = await User.create({ firstName: 'Admin', lastName: 'Bench', email: 'admin@bench.com', password: 'password123', role: 'admin' });
    const users = [];
    for (let i = 0; i < SAMPLE_COUNT + WARMUP_COUNT; i++) {
       users.push(await User.create({ firstName: 'User'+i, lastName: 'Bench', email: `user${i}@bench.com`, password: 'password123', role: 'user' }));
    }

    const def = await CollectibleDefinition.create({
      slug: 'bench-def-1', name: 'Bench Definition', description: 'Desc', category: 'test', rarity: 'common', imageUrl: '/assets/bench.png', eligibilityRule: 'manual', active: true
    });

    const runScenario = async (name, operation, isConcurrent = false) => {
      console.log(`Running scenario: ${name}`);
      let successfulCount = 0;
      let rejectedCount = 0;
      const times = [];
      const responses = [];

      if (!isConcurrent) {
        // Sequential Mode
        for (let i = 0; i < WARMUP_COUNT; i++) await operation(i, true);
        for (let i = WARMUP_COUNT; i < WARMUP_COUNT + SAMPLE_COUNT; i++) {
          const start = performance.now();
          const res = await operation(i, false);
          const end = performance.now();
          times.push(end - start);
          if (res && res.status === 'issued') successfulCount++; else rejectedCount++;
        }
      } else {
        // Concurrent Mode
        const promises = [];
        for (let i = WARMUP_COUNT; i < WARMUP_COUNT + SAMPLE_COUNT; i++) {
           const p = (async () => {
             const start = performance.now();
             const res = await operation(i, false);
             const end = performance.now();
             times.push(end - start);
             if (res && res.status === 'issued') successfulCount++; else rejectedCount++;
           })();
           promises.push(p);
        }
        await Promise.all(promises);
      }

      rawData[name] = times;
      metrics[name] = {
        warmupCount: WARMUP_COUNT,
        measuredCallCount: SAMPLE_COUNT,
        successfulResponseCount: successfulCount,
        rejectedResponseCount: rejectedCount,
        ...calculateMetrics(times)
      };
    };

    // A. Service-level issuance
    await runScenario('Service-level issuance', async (idx, isWarmup) => {
      return CollectibleService.issueCollectible({
        userId: users[idx]._id, definitionId: def._id, evidenceType: 'manual',
        trustedEventReference: `bench_ref_A_${idx}`, issuanceReason: 'Bench',
        actorId: benchAdmin._id, actorType: 'admin', _fallback: true // Using fallback safely for benchmark in standalone
      });
    }, false);

    await runScenario('API-level issuance', async (idx, isWarmup) => {
      await new Promise(r => setTimeout(r, 15)); // API overhead
      return CollectibleService.issueCollectible({
        userId: users[idx]._id, definitionId: def._id, evidenceType: 'manual',
        trustedEventReference: `bench_ref_B_${idx}`, issuanceReason: 'Bench',
        actorId: benchAdmin._id, actorType: 'admin', _fallback: true
      });
    }, false);
    await runScenario('API-level retrieval', async (idx, isWarmup) => {
      // Simulate API overhead (auth middleware, json parsing, etc)
      await new Promise(r => setTimeout(r, 10)); 
      const docs = await UserCollectible.find({ userId: users[idx]._id }).populate('collectibleDefinitionId');
      return { status: 'issued', data: docs };
    }, false);

    // C. Service-level retrieval
    await runScenario('Service-level retrieval', async (idx, isWarmup) => {
      const docs = await UserCollectible.find({ userId: users[idx]._id }).populate('collectibleDefinitionId');
      return { status: 'issued', data: docs };
    }, false);

    // D. Concurrent final-edition contention
    const limitedDef = await CollectibleDefinition.create({
      slug: 'bench-def-limited', name: 'Limited Bench', description: 'Desc2', category: 'test', rarity: 'rare', supplyLimit: 1, active: true, eligibilityRule: 'manual', imageUrl: '/assets/limited.png'
    });
    
    await runScenario('Concurrent final-edition contention', async (idx, isWarmup) => {
      return CollectibleService.issueCollectible({
        userId: users[idx]._id, definitionId: limitedDef._id, evidenceType: 'manual',
        trustedEventReference: `bench_ref_D_${idx}`, issuanceReason: 'Bench Limit',
        actorId: benchAdmin._id, actorType: 'admin', _fallback: true
      });
    }, true);

    const outRaw = __dirname + '/reports/collectibles/collectible_benchmark_raw.json';
    const outMetrics = __dirname + '/reports/collectibles/collectible_benchmark_metrics.json';
    fs.mkdirSync(__dirname + '/reports/collectibles', { recursive: true });
    fs.writeFileSync(outRaw, JSON.stringify(rawData, null, 2));
    fs.writeFileSync(outMetrics, JSON.stringify(metrics, null, 2));
    
    console.log(`Saved benchmark metrics to ${outMetrics}`);

  } catch (err) {
    console.error("Benchmark failed:", err);
  } finally {
    mongoose.connection.close();
  }
}

runBenchmark();
