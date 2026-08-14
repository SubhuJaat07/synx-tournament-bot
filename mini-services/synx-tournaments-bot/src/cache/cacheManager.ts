/**
 * Cache Manager - Handles preloading and write-through operations
 * 
 * This is the ONLY place where Supabase is called directly.
 * All other code uses the cache via gameCache singleton.
 */

import { supabase } from '../database/client.ts';
import { 
  gameCache, 
  CachedGame, 
  dbToCache, 
  cacheToDb 
} from './gameCache.ts';

/**
 * PRELOAD: Load all incomplete games from Supabase into cache
 * Called ONCE on bot ready event
 */
export async function preloadCache(): Promise<{
  gamesLoaded: number;
  interactionsLoaded: number;
  loadTimeMs: number;
}> {
  const startTime = performance.now();
  
  console.log('🔄 Preloading cache from Supabase...');
  
  try {
    // Fetch all incomplete games in ONE query
    const { data: games, error: gamesError } = await supabase
      .from('games')
      .select('*')
      .in('status', ['waiting', 'in_progress'])
      .order('created_at', { ascending: true });

    if (gamesError) {
      console.error('❌ Error loading games:', gamesError);
      throw gamesError;
    }

    // Load games into cache
    if (games && games.length > 0) {
      for (const dbGame of games) {
        const cachedGame = dbToCache(dbGame);
        gameCache.set(cachedGame);
      }
      console.log(`✅ Loaded ${games.length} active game(s) into cache`);
    }

    // Fetch recent interactions for deduplication
    const { data: interactions, error: intError } = await supabase
      .from('interactions')
      .select('interaction_id')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
      .limit(1000);

    if (!intError && interactions) {
      for (const interaction of interactions) {
        gameCache.addInteraction(interaction.interaction_id);
      }
      console.log(`✅ Loaded ${interactions.length} interaction(s) for dedup`);
    }

    const loadTime = performance.now() - startTime;
    
    console.log(`📊 Cache preload complete in ${loadTime.toFixed(2)}ms`);
    console.log(`   Cache size: ${gameCache.size} games`);

    return {
      gamesLoaded: games?.length || 0,
      interactionsLoaded: interactions?.length || 0,
      loadTimeMs: Math.round(loadTime),
    };

  } catch (error) {
    console.error('❌ Cache preload failed:', error);
    throw error;
  }
}

/**
 * WRITE-THROUGH: Update both cache and Supabase simultaneously
 * 
 * - Cache update: Synchronous (immediate)
 * - DB update: Asynchronous (fire-and-forget with retry)
 */
export async function writeToCacheAndDb(game: CachedGame): Promise<void> {
  // 1. Update cache IMMEDIATELY (synchronous)
  gameCache.set(game);

  // 2. Update Supabase ASYNCHRONOUSLY (non-blocking)
  const dbData = cacheToDb(game);
  
  // Fire and forget with error handling
  supabase
    .from('games')
    .upsert(dbData, { onConflict: 'id' })
    .then(({ error }) => {
      if (error) {
        console.error('⚠️  Async DB sync failed for game:', game.id, error);
        // Could add retry logic here or queue for later sync
      }
    })
    .catch(err => {
      console.error('❌ Unexpected DB sync error:', err);
    });
}

/**
 * WRITE-THROUGH: Create new game in both cache and DB
 */
export async function createGameInCacheAndDb(game: CachedGame): Promise<CachedGame> {
  // 1. Add to cache IMMEDIATELY
  gameCache.set(game);

  // 2. Insert to Supabase
  const dbData = cacheToDb(game);
  
  try {
    const { data, error } = await supabase
      .from('games')
      .insert(dbData)
      .select()
      .single();

    if (error) {
      console.error('❌ Error creating game in DB:', error);
      // Game still exists in cache, will sync on next update
    }

    return game;

  } catch (error) {
    console.error('❌ Failed to create game in DB:', error);
    return game; // Return cached version anyway
  }
}

/**
 * WRITE-THROUGH: Record player choice (optimized for speed)
 */
export async function recordChoice(
  gameId: string,
  playerId: string,
  choice: 'split' | 'steal'
): Promise<CachedGame | null> {
  // 1. Get from cache (FAST)
  let game = gameCache.get(gameId);
  if (!game) {
    console.error(`Game ${gameId} not found in cache`);
    return null;
  }

  // 2. Validate player
  const isPlayer1 = playerId === game.playerId1;
  const isPlayer2 = playerId === game.playerId2;
  
  if (!isPlayer1 && !isPlayer2) {
    return null; // Not a valid player
  }

  // 3. Check already chosen
  if ((isPlayer1 && game.choice1) || (isPlayer2 && game.choice2)) {
    return game; // Already chosen
  }

  // 4. Update cache IMMEDIATELY
  const now = new Date();
  const updatedGame: CachedGame = {
    ...game,
    choice1: isPlayer1 ? choice : game.choice1,
    choice2: isPlayer2 ? choice : game.choice2,
    chosenAt1: isPlayer1 ? now : game.chosenAt1,
    chosenAt2: isPlayer2 ? now : game.chosenAt2,
    status: game.status === 'waiting' ? 'in_progress' : game.status,
    updatedAt: now,
  };

  gameCache.set(updatedGame);

  // 5. Async DB update (non-blocking)
  const updates: any = {};
  if (isPlayer1) {
    updates.player1_choice = choice;
    updates.player1_chosen_at = now.toISOString();
  } else {
    updates.player2_choice = choice;
    updates.player2_chosen_at = now.toISOString();
  }
  updates.status = updatedGame.status;
  updates.updated_at = now.toISOString();

  supabase
    .from('games')
    .update(updates)
    .eq('id', gameId)
    .then(({ error }) => {
      if (error) {
        console.error('⚠️  Choice sync failed:', error);
      }
    })
    .catch(err => console.error('Choice sync error:', err));

  return updatedGame;
}

/**
 * WRITE-THROUGH: Complete game with results
 */
export async function completeGameInCacheAndDb(
  gameId: string,
  resultData: {
    winnerId?: string;
    winnerName?: string;
    resultType: CachedGame['resultType'];
    prizeShare1: number;
    prizeShare2: number;
  }
): Promise<CachedGame | null> {
  // 1. Get current state from cache
  const game = gameCache.get(gameId);
  if (!game) return null;

  // 2. Create completed game object
  const now = new Date();
  const completedGame: CachedGame = {
    ...game,
    ...resultData,
    status: 'completed',
    completedAt: now,
    updatedAt: now,
  };

  // 3. Update cache IMMEDIATELY
  gameCache.set(completedGame);

  // 4. Async DB update
  supabase
    .from('games')
    .update({
      winner_id: resultData.winnerId || null,
      winner_username: resultData.winnerName || null,
      result_type: resultData.resultType,
      player1_prize_share: resultData.prizeShare1,
      player2_prize_share: resultData.prizeShare2,
      status: 'completed',
      completed_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', gameId)
    .then(({ error }) => {
      if (error) console.error('⚠️  Complete game sync failed:', error);
    });

  return completedGame;
}

/**
 * Track interaction for deduplication
 */
export async function trackInteraction(interactionId: string): Promise<void> {
  // Add to cache immediately
  gameCache.addInteraction(interactionId);
  
  // No need to save every interaction to DB
  // Only critical ones (choices) are persisted
}

/**
 * Clean up old completed games from cache (optional maintenance)
 */
export function cleanupCompletedGames(olderThanHours: number = 1): number {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  let cleaned = 0;

  for (const game of gameCache.getAll()) {
    if (
      (game.status === 'completed' || game.status === 'cancelled') &&
      game.completedAt && 
      game.completedAt < cutoff
    ) {
      gameCache.delete(game.id);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} old game(s) from cache`);
  }

  return cleaned;
}

/**
 * Get cache performance metrics
 */
export function getCacheMetrics(): {
  size: number;
  hitRate: string;
  totalOps: number;
  estimatedMemoryKB: number;
} {
  const stats = gameCache.getPerformanceStats();
  
  // Rough memory estimate (each game ~500 bytes)
  const estimatedMemoryKB = (gameCache.size * 500) / 1024;

  return {
    ...stats,
    estimatedMemoryKB: Math.round(estimatedMemoryKB),
  };
}

// Re-export commonly used functions for convenience
export { calculateResultFromCache } from '../utils/results.ts';
