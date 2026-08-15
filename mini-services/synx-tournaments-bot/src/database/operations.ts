import { supabase } from './client.ts';

export interface Game {
  id: string;
  channel_id: string;
  message_id: string;
  player1_id: string;
  player1_username: string;
  player2_id: string;
  player2_username: string;
  prize_name?: string;
  prize_value?: string;
  prize_description?: string;
  timer_seconds: number;
  started_at: string;
  ends_at?: string;
  result_mode: 'timer_end' | 'both_clicked';
  status: 'waiting' | 'in_progress' | 'completed' | 'cancelled';
  player1_choice?: 'split' | 'steal';
  player2_choice?: 'split' | 'steal';
  player1_chosen_at?: string;
  player2_chosen_at?: string;
  winner_id?: string;
  winner_username?: string;
  result_type?: 'split_split' | 'steal_steal' | 'split_steal' | 'steal_split';
  player1_prize_share?: number;
  player2_prize_share?: number;
  created_by: string;
  guild_id?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface Interaction {
  id: string;
  game_id: string;
  interaction_id: string;
  interaction_token: string;
  message_id: string;
  channel_id: string;
  guild_id?: string;
  user_id: string;
  custom_id: string;
  processed: boolean;
  processed_at?: string;
  created_at: string;
}

// Create a new game (table: tournament_games)
export async function createGame(gameData: Omit<Game, 'id' | 'status' | 'created_at' | 'updated_at'>): Promise<Game | null> {
  const { data, error } = await supabase
    .from('tournament_games')
    .insert([{
      ...gameData,
      status: 'waiting',
      ends_at: new Date(Date.now() + gameData.timer_seconds * 1000).toISOString()
    }])
    .select()
    .single();

  if (error) {
    console.error('Error creating game:', error);
    return null;
  }
  return data;
}

// Get game by ID (table: tournament_games)
export async function getGameById(gameId: string): Promise<Game | null> {
  const { data, error } = await supabase
    .from('tournament_games')
    .select('*')
    .eq('id', gameId)
    .single();

  if (error) {
    console.error('Error fetching game:', error);
    return null;
  }
  return data;
}

// Get active game in a channel (table: tournament_games)
export async function getActiveGameInChannel(channelId: string): Promise<Game | null> {
  const { data, error } = await supabase
    .from('tournament_games')
    .select('*')
    .eq('channel_id', channelId)
    .in('status', ['waiting', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching active game:', error);
    return null;
  }
  return data;
}

// Update game (table: tournament_games)
export async function updateGame(gameId: string, updates: Partial<Game>): Promise<Game | null> {
  const { data, error } = await supabase
    .from('tournament_games')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', gameId)
    .select()
    .single();

  if (error) {
    console.error('Error updating game:', error);
    return null;
  }
  return data;
}

// Record player choice (table: tournament_games)
export async function recordPlayerChoice(
  gameId: string, 
  playerId: string, 
  choice: 'split' | 'steal'
): Promise<Game | null> {
  const game = await getGameById(gameId);
  if (!game) return null;

  const updates: Partial<Game> = {};
  
  if (playerId === game.player1_id) {
    updates.player1_choice = choice;
    updates.player1_chosen_at = new Date().toISOString();
  } else if (playerId === game.player2_id) {
    updates.player2_choice = choice;
    updates.player2_chosen_at = new Date().toISOString();
  } else {
    return null; // Not a valid player
  }

  // Update status to in_progress if both players have chosen or first choice made
  if (game.status === 'waiting') {
    updates.status = 'in_progress';
  }

  return await updateGame(gameId, updates);
}

// Save interaction for restart safety (table: tournament_interactions)
export async function saveInteraction(interactionData: Omit<Interaction, 'id' | 'processed' | 'created_at'>): Promise<Interaction | null> {
  const { data, error } = await supabase
    .from('tournament_interactions')
    .insert([interactionData])
    .select()
    .single();

  if (error) {
    console.error('Error saving interaction:', error);
    return null;
  }
  return data;
}

// Mark interaction as processed (table: tournament_interactions)
export async function markInteractionProcessed(interactionId: string): Promise<void> {
  const { error } = await supabase
    .from('tournament_interactions')
    .update({ 
      processed: true, 
      processed_at: new Date().toISOString() 
    })
    .eq('interaction_id', interactionId);

  if (error) {
    console.error('Error marking interaction as processed:', error);
  }
}

// Check if interaction was already processed (table: tournament_interactions)
export async function isInteractionProcessed(interactionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('tournament_interactions')
    .select('processed')
    .eq('interaction_id', interactionId)
    .single();

  if (error || !data) {
    return false;
  }
  return data.processed;
}

// Get unprocessed interactions after restart (table: tournament_interactions)
export async function getUnprocessedInteractions(): Promise<Interaction[]> {
  const { data, error } = await supabase
    .from('tournament_interactions')
    .select('*')
    .eq('processed', false)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching unprocessed interactions:', error);
    return [];
  }
  return data || [];
}

// Complete game with results (table: tournament_games)
export async function completeGame(
  gameId: string, 
  resultData: {
    winner_id?: string;
    winner_username?: string;
    result_type: Game['result_type'];
    player1_prize_share: number;
    player2_prize_share: number;
  }
): Promise<Game | null> {
  return await updateGame(gameId, {
    ...resultData,
    status: 'completed',
    completed_at: new Date().toISOString()
  });
}

// Cancel game (table: tournament_games)
export async function cancelGame(gameId: string): Promise<Game | null> {
  return await updateGame(gameId, {
    status: 'cancelled',
    completed_at: new Date().toISOString()
  });
}

// Get all incomplete games for restart recovery (table: tournament_games)
export async function getIncompleteGames(): Promise<Game[]> {
  const { data, error } = await supabase
    .from('tournament_games')
    .select('*')
    .in('status', ['waiting', 'in_progress'])
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching incomplete games:', error);
    return [];
  }
  return data || [];
}
