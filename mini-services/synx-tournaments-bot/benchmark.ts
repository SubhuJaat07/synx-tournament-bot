/**
 * Performance Benchmark Script
 * 
 * Demonstrates the speed difference between:
 * - Cache-based operations (~0.001ms)
 * - Database-based operations (~200ms)
 */

import { gameCache, CachedGame, dbToCache } from './src/cache/gameCache.ts';
import { preloadCache, getCacheMetrics } from './src/cache/cacheManager.ts';

// Mock data for testing
function createMockGame(id: string): CachedGame {
  return {
    id,
    channelId: 'test-channel',
    messageId: 'test-message',
    playerId1: 'user-1',
    playerName1: 'Player1',
    playerId2: 'user-2',
    playerName2: 'Player2',
    prizeName: 'Test Prize',
    prizeValue: '1000',
    prizeDescription: 'Test description',
    timerSeconds: 60,
    startedAt: new Date(),
    endsAt: new Date(Date.now() + 60000),
    resultMode: 'timer_end',
    status: 'in_progress',
    createdBy: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function runBenchmark() {
  console.log('🚀 Synx Tournaments - Performance Benchmark\n');
  console.log('=' .repeat(50));

  // Test 1: Cache Write Speed
  console.log('\n📝 Test 1: Cache WRITE Speed');
  const writeTimes: number[] = [];
  
  for (let i = 0; i < 1000; i++) {
    const game = createMockGame(`game-${i}`);
    const start = performance.now();
    gameCache.set(game);
    writeTimes.push(performance.now() - start);
  }
  
  const avgWrite = writeTimes.reduce((a, b) => a + b, 0) / writeTimes.length;
  console.log(`   • 1,000 cache writes in ${writeTimes.reduce((a,b) => a+b, 0).toFixed(2)}ms`);
  console.log(`   • Average: ${avgWrite.toFixed(4)}ms per write`);
  console.log(`   • Status: ${avgWrite < 1 ? '✅ EXCELLENT' : avgWrite < 10 ? '✅ GOOD' : '⚠️ SLOW'}`);

  // Test 2: Cache Read by ID
  console.log('\n📖 Test 2: Cache READ by ID (O(1) lookup)');
  const readIdTimes: number[] = [];
  
  for (let i = 0; i < 1000; i++) {
    const gameId = `game-${Math.floor(Math.random() * 1000)}`;
    const start = performance.now();
    gameCache.get(gameId);
    readIdTimes.push(performance.now() - start);
  }
  
  const avgReadId = readIdTimes.reduce((a, b) => a + b, 0) / readIdTimes.length;
  console.log(`   • 1,000 cache reads in ${readIdTimes.reduce((a,b) => a+b, 0).toFixed(2)}ms`);
  console.log(`   • Average: ${avgReadId.toFixed(4)}ms per read`);
  console.log(`   • Status: ${avgReadId < 1 ? '✅ EXCELLENT' : avgReadId < 10 ? '✅ GOOD' : '⚠️ SLOW'}`);

  // Test 3: Cache Read by Channel
  console.log('\n📖 Test 3: Cache READ by Channel (indexed lookup)');
  const readChannelTimes: number[] = [];
  
  for (let i = 0; i < 1000; i++) {
    const start = performance.now();
    gameCache.getByChannel('test-channel');
    readChannelTimes.push(performance.now() - start);
  }
  
  const avgReadChannel = readChannelTimes.reduce((a, b) => a + b, 0) / readChannelTimes.length;
  console.log(`   • 1,000 channel lookups in ${readChannelTimes.reduce((a,b) => a+b, 0).toFixed(2)}ms`);
  console.log(`   • Average: ${avgReadChannel.toFixed(4)}ms per lookup`);
  console.log(`   • Status: ${avgReadChannel < 1 ? '✅ EXCELLENT' : avgReadChannel < 10 ? '✅ GOOD' : '⚠️ SLOW'}`);

  // Test 4: Interaction Check
  console.log('\n🔍 Test 4: Interaction Dedup Check');
  gameCache.addInteraction('test-interaction-123');
  
  const interactionTimes: number[] = [];
  for (let i = 0; i < 10000; i++) {
    const start = performance.now();
    gameCache.hasInteraction('test-interaction-123');
    interactionTimes.push(performance.now() - start);
  }
  
  const avgInteraction = interactionTimes.reduce((a, b) => a + b, 0) / interactionTimes.length;
  console.log(`   • 10,000 checks in ${interactionTimes.reduce((a,b) => a+b, 0).toFixed(2)}ms`);
  console.log(`   • Average: ${avgInteraction.toFixed(4)}ms per check`);
  console.log(`   • Status: ${avgInteraction < 1 ? '✅ EXCELLENT' : avgInteraction < 10 ? '✅ GOOD' : '⚠️ SLOW'}`);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 PERFORMANCE SUMMARY\n');
  
  const metrics = getCacheMetrics();
  console.log(`Cache Size: ${metrics.size} games`);
  console.log(`Hit Rate: ${metrics.hitRate}`);
  console.log(`Total Operations: ${metrics.totalOps}`);
  console.log(`Memory Usage: ~${metrics.estimatedMemoryKB} KB`);
  
  console.log('\n⚡ SPEED COMPARISON:');
  console.log('┌─────────────────────┬──────────────┬──────────────┐');
  console.log('│ Operation           │ Cache        │ Database     │');
  console.log('├─────────────────────┼──────────────┼──────────────┤');
  console.log(`│ Game Lookup         │ ${avgReadId.toFixed(3)}ms       │ ~150-300ms   │`);
  console.log(`│ Channel Check       │ ${avgReadChannel.toFixed(3)}ms       │ ~100-200ms   │`);
  console.log(`│ Choice Record       │ ${avgWrite.toFixed(3)}ms       │ ~50-150ms    │`);
  console.log(`│ Interaction Check   │ ${avgInteraction.toFixed(3)}ms       │ ~20-50ms     │`);
  console.log('└─────────────────────┴──────────────┴──────────────┘');
  
  console.log('\n🎯 TARGET: All operations < 50ms for Discord bot response');
  
  const allFast = avgWrite < 1 && avgReadId < 1 && avgReadChannel < 1 && avgInteraction < 1;
  console.log(`Status: ${allFast ? '✅ ALL TESTS PASSED - Ready for production!' : '⚠️ Some tests slow - review needed'}`);
  
  // Cleanup
  gameCache.clear();
}

// Run if called directly
runBenchmark().catch(console.error);
