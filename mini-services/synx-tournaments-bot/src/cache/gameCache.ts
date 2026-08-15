/**
 * High-Performance In-Memory Cache System
 * 
 * Architecture: Cache-First with Write-Through to Supabase
 * 
 * - READ operations: Cache only (0-1ms response)
 * - WRITE operations: Cache + DB parallel (async)
 * - Supabase used ONLY for:
 *   1. Initial load on bot restart
 *   2. Persistence/backup
 *   3. Recovery scenarios
 */

// Types
export interface CachedGame {
  id: string;
  channelId: string;
  messageId: string;
  
  // Players
  playerId1: string;
  playerName1: string;
  playerId2: string;
  playerName2: string;
  
  // Prize
  prizeName?: string;
  prizeValue?: string;
  prizeDescription?: string;
  
  // Timer
  timerSeconds: number;
  startedAt: Date;
  endsAt: Date;
  
  // Config
  resultMode: 'timer_end' | 'both_clicked';
  status: 'waiting' | 'in_progress' | 'completed' | 'cancelled';
  
  // Choices (mutable)
  choice1?: 'split' | 'steal';
  choice2?: 'split' | 'steal';
  chosenAt1?: Date;
  chosenAt2?: Date;
  
  // Choice history (tracks changes over time!)
  choiceHistory: Array<{
    playerId: string;
    playerName: string;
    choice: 'split' | 'steal';
    timestamp: Date;
  }>;
  
  // Results (filled on completion)
  winnerId?: string;
  winnerName?: string;
  resultType?: GameResultType;
  prizeShare1?: number;
  prizeShare2?: number;
  
  // Metadata
  createdBy: string;
  guildId?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export type GameResultType = 'split_split' | 'steal_steal' | 'split_steal' | 'steal_split';

// Cache Storage with O(1) lookups
class GameCache {
  private games: Map<string, CachedGame> = new Map();           // gameId -> game
  private channels: Map<string, string> = new Map();            // channelId -> gameId
  private players: Map<string, string> = new Map();             // userId -> gameId (active)
  private interactions: Set<string> = new Set();                // interactionId set
  
  // Statistics
  stats = {
    hits: 0,
    misses: 0,
    writes: 0,
    dbSyncs: 0,
  };

  /**
   * Get game by ID - O(1) lookup ~0.001ms
   */
  get(gameId: string): CachedGame | undefined {
    const game = this.games.get(gameId);
    if (game) {
      this.stats.hits++;
      return { ...game }; // Return copy to prevent external mutation
    }
    this.stats.misses++;
    return undefined;
  }

  /**
   * Get active game in channel - O(1) lookup
   */
  getByChannel(channelId: string): CachedGame | undefined {
    const gameId = this.channels.get(channelId);
    if (!gameId) {
      this.stats.misses++;
      return undefined;
    }
    return this.get(gameId);
  }

  /**
   * Get game by player ID - O(1) lookup
   */
  getByPlayer(playerId: string): CachedGame | undefined {
    const gameId = this.players.get(playerId);
    if (!gameId) {
      this.stats.misses++;
      return undefined;
    }
    return this.get(gameId);
  }

  /**
   * Check if interaction exists - O(1)
   */
  hasInteraction(interactionId: string): boolean {
    return this.interactions.has(interactionId);
  }

  /**
   * Add or update game in cache + indexes
   */
  set(game: CachedGame): void {
    // Remove old indexes if updating
    if (this.games.has(game.id)) {
      const oldGame = this.games.get(game.id)!;
      if (oldGame.channelId !== game.channelId || 
          oldGame.status === 'in_progress' || oldGame.status === 'waiting') {
        this.channels.delete(oldGame.channelId);
        this.players.delete(oldGame.playerId1);
        this.players.delete(oldGame.playerId2);
      }
    }

    // Store game (immutable copy)
    this.games.set(game.id, { ...game });
    
    // Update indexes only for active games
    if (game.status === 'in_progress' || game.status === 'waiting') {
      this.channels.set(game.channelId, game.id);
      this.players.set(game.playerId1, game.id);
      this.players.set(game.playerId2, game.id);
    } else {
      // Remove from active indexes when completed/cancelled
      this.channels.delete(game.channelId);
      this.players.delete(game.playerId1);
      this.players.delete(game.playerId2);
    }

    this.stats.writes++;
  }

  /**
   * Delete game from all indexes
   */
  delete(gameId: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;

    this.games.delete(gameId);
    this.channels.delete(game.channelId);
    this.players.delete(game.playerId1);
    this.players.delete(game.playerId2);

    return true;
  }

  /**
   * Track interaction ID (for deduplication)
   */
  addInteraction(interactionId: string): void {
    this.interactions.add(interactionId);
  }

  /**
   * Get all incomplete games (for recovery/stats)
   */
  getIncompleteGames(): CachedGame[] {
    const incomplete: CachedGame[] = [];
    for (const game of this.games.values()) {
      if (game.status === 'waiting' || game.status === 'in_progress') {
        incomplete.push({ ...game });
      }
    }
    return incomplete;
  }

  /**
   * Get all games (for debugging/admin)
   */
  getAll(): CachedGame[] {
    return Array.from(this.games.values()).map(g => ({ ...g }));
  }

  /**
   * Clear entire cache (on restart/shutdown)
   */
  clear(): void {
    this.games.clear();
    this.channels.clear();
    this.players.clear();
    this.interactions.clear();
    
    // Reset stats
    this.stats = { hits: 0, misses: 0, writes: 0, dbSyncs: 0 };
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.games.size;
  }

  /**
   * Get performance metrics
   */
  getPerformanceStats(): {
    size: number;
    hitRate: string;
    totalOps: number;
    cacheHits: number;
    cacheMisses: number;
  } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : '0.00';
    
    return {
      size: this.size,
      hitRate: `${hitRate}%`,
      totalOps: total,
      cacheHits: this.stats.hits,
      cacheMisses: this.stats.misses,
    };
  }
}

// Singleton instance - global cache
export const gameCache = new GameCache();

/**
 * Convert Supabase DB format → Cache format
 */
export function dbToCache(dbGame: any): CachedGame {
  return {
    id: dbGame.id,
    channelId: dbGame.channel_id,
    messageId: dbGame.message_id,
    playerId1: dbGame.player1_id,
    playerName1: dbGame.player1_username,
    playerId2: dbGame.player2_id,
    playerName2: dbGame.player2_username,
    prizeName: dbGame.prize_name || undefined,
    prizeValue: dbGame.prize_value || undefined,
    prizeDescription: dbGame.prize_description || undefined,
    timerSeconds: dbGame.timer_seconds,
    startedAt: new Date(dbGame.started_at),
    endsAt: new Date(dbGame.ends_at),
    resultMode: dbGame.result_mode,
    status: dbGame.status,
    choice1: dbGame.player1_choice || undefined,
    choice2: dbGame.player2_choice || undefined,
    chosenAt1: dbGame.player1_chosen_at ? new Date(dbGame.player1_chosen_at) : undefined,
    chosenAt2: dbGame.player2_chosen_at ? new Date(dbGame.player2_chosen_at) : undefined,
    choiceHistory: [], // Empty history for loaded games
    winnerId: dbGame.winner_id || undefined,
    winnerName: dbGame.winner_username || undefined,
    resultType: dbGame.result_type as GameResultType | undefined,
    prizeShare1: dbGame.player1_prize_share || undefined,
    prizeShare2: dbGame.player2_prize_share || undefined,
    createdBy: dbGame.created_by,
    guildId: dbGame.guild_id || undefined,
    createdAt: new Date(dbGame.created_at),
    updatedAt: new Date(dbGame.updated_at),
    completedAt: dbGame.completed_at ? new Date(dbGame.completed_at) : undefined,
  };
}

/**
 * Convert Cache format → Supabase DB format
 */
export function cacheToDb(cacheGame: CachedGame): any {
  return {
    id: cacheGame.id,
    channel_id: cacheGame.channelId,
    message_id: cacheGame.messageId,
    player1_id: cacheGame.playerId1,
    player1_username: cacheGame.playerName1,
    player2_id: cacheGame.playerId2,
    player2_username: cacheGame.playerName2,
    prize_name: cacheGame.prizeName || null,
    prize_value: cacheGame.prizeValue || null,
    prize_description: cacheGame.prizeDescription || null,
    timer_seconds: cacheGame.timerSeconds,
    started_at: cacheGame.startedAt.toISOString(),
    ends_at: cacheGame.endsAt.toISOString(),
    result_mode: cacheGame.resultMode,
    status: cacheGame.status,
    player1_choice: cacheGame.choice1 || null,
    player2_choice: cacheGame.choice2 || null,
    player1_chosen_at: cacheGame.chosenAt1?.toISOString() || null,
    player2_chosen_at: cacheGame.chosenAt2?.toISOString() || null,
    winner_id: cacheGame.winnerId || null,
    winner_username: cacheGame.winnerName || null,
    result_type: cacheGame.resultType || null,
    player1_prize_share: cacheGame.prizeShare1 || null,
    player2_prize_share: cacheGame.prizeShare2 || null,
    created_by: cacheGame.createdBy,
    guild_id: cacheGame.guildId || null,
    created_at: cacheGame.createdAt.toISOString(),
    updated_at: new Date().toISOString(), // Always update timestamp
    completed_at: cacheGame.completedAt?.toISOString() || null,
  };
}
