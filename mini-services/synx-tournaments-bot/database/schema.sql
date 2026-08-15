-- ============================================================
-- SYNX TOURNAMENTS - Split & Steal Game Database Schema
-- Table Prefix: tournament_
-- ============================================================
-- 
-- 📋 SETUP INSTRUCTIONS:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Copy this entire SQL query
-- 3. Paste and click "Run"
-- 4. Tables will be created with tournament_ prefix
--
-- 🔗 TABLES CREATED:
--    • tournament_games (main game data)
--    • tournament_interactions (button clicks for restart safety)
--
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: tournament_games
-- Stores all active and completed game sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS tournament_games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Discord message identifiers
  channel_id VARCHAR(255) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  
  -- Player information
  player1_id VARCHAR(255) NOT NULL,
  player1_username VARCHAR(255) NOT NULL,
  player2_id VARCHAR(255) NOT NULL,
  player2_username VARCHAR(255) NOT NULL,
  
  -- Prize details (optional)
  prize_name VARCHAR(500),
  prize_value VARCHAR(255),
  prize_description TEXT,
  
  -- Timer settings
  timer_seconds INTEGER NOT NULL DEFAULT 60,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ends_at TIMESTAMP WITH TIME ZONE,
  
  -- Result mode configuration
  result_mode VARCHAR(50) DEFAULT 'timer_end', -- 'timer_end' or 'both_clicked'
  
  -- Game status tracking
  status VARCHAR(50) DEFAULT 'waiting', -- 'waiting' | 'in_progress' | 'completed' | 'cancelled'
  
  -- Player choices (NULL until chosen)
  player1_choice VARCHAR(20), -- 'split' or 'steal'
  player2_choice VARCHAR(20), -- 'split' or 'steal'
  player1_chosen_at TIMESTAMP WITH TIME ZONE,
  player2_chosen_at TIMESTAMP WITH TIME ZONE,
  
  -- Results (filled on completion)
  winner_id VARCHAR(255),
  winner_username VARCHAR(255),
  result_type VARCHAR(50), -- 'split_split' | 'steal_steal' | 'split_steal' | 'steal_split'
  player1_prize_share INTEGER, -- percentage (0-100)
  player2_prize_share INTEGER, -- percentage (0-100)
  
  -- Metadata
  created_by VARCHAR(255) NOT NULL,
  guild_id VARCHAR(255),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================
-- TABLE: tournament_interactions
-- Stores button interactions for restart safety
-- Ensures no duplicate processing after bot restart
-- ============================================================
CREATE TABLE IF NOT EXISTS tournament_interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Link to game
  game_id UUID REFERENCES tournament_games(id) ON DELETE CASCADE,
  
  -- Discord interaction identifiers
  interaction_id VARCHAR(255) UNIQUE NOT NULL,
  interaction_token VARCHAR(255) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,
  guild_id VARCHAR(255),
  
  -- Player who clicked
  user_id VARCHAR(255) NOT NULL,
  custom_id VARCHAR(100) NOT NULL, -- Button identifier like 'split_p1', 'steal_p1'
  
  -- Processing status
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================

-- Games table indexes
CREATE INDEX IF NOT EXISTS idx_tournament_games_status ON tournament_games(status);
CREATE INDEX IF NOT EXISTS idx_tournament_games_channel ON tournament_games(channel_id);
CREATE INDEX IF NOT EXISTS idx_tournament_games_players ON tournament_games(player1_id, player2_id);
CREATE INDEX IF NOT EXISTS idx_tournament_games_created ON tournament_games(created_at);

-- Interactions table indexes
CREATE INDEX IF NOT EXISTS idx_tournament_interactions_game ON tournament_interactions(game_id);
CREATE INDEX IF NOT EXISTS idx_tournament_interactions_user ON tournament_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tournament_interactions_processed ON tournament_interactions(processed);
CREATE INDEX IF NOT EXISTS idx_tournament_interactions_created ON tournament_interactions(created_at);

-- ============================================================
-- AUTOMATIC TIMESTAMP UPDATES
-- ============================================================

-- Function to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_tournament_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for games table
DROP TRIGGER IF EXISTS update_tournament_games_updated_at ON tournament_games;
CREATE TRIGGER update_tournament_games_updated_at
    BEFORE UPDATE ON tournament_games
    FOR EACH ROW
    EXECUTE FUNCTION update_tournament_updated_at_column();

-- Trigger for interactions table
DROP TRIGGER IF EXISTS update_tournament_interactions_updated_at ON tournament_interactions;
CREATE TRIGGER update_tournament_interactions_updated_at
    BEFORE UPDATE ON tournament_interactions
    FOR EACH ROW
    EXECUTE FUNCTION update_tournament_updated_at_column();

-- ============================================================
-- SAMPLE DATA (Optional - for testing)
-- Uncomment below to insert test data:
-- ============================================================

/*
-- Insert a sample game
INSERT INTO tournament_games (
  channel_id, message_id,
  player1_id, player1_username,
  player2_id, player2_username,
  prize_name, prize_value, prize_description,
  timer_seconds, ends_at,
  result_mode, status,
  created_by, guild_id
) VALUES (
  '123456789012345678',
  '987654321098765432',
  'user_1_id', 'PlayerOne',
  'user_2_id', 'PlayerTwo',
  'Nitro Premium', '1 Month', 'Discord Nitro subscription',
  60,
  NOW() + INTERVAL '60 seconds',
  'timer_end',
  'in_progress',
  'admin_user_id',
  'guild_123456'
);

-- Log sample interaction
INSERT INTO tournament_interactions (
  game_id, interaction_id, interaction_token,
  message_id, channel_id, guild_id,
  user_id, custom_id
) VALUES (
  (SELECT id FROM tournament_games LIMIT 1),
  'sample_interaction_id',
  'sample_token_here',
  '987654321098765432',
  '123456789012345678',
  'guild_123456',
  'user_1_id',
  'split_p1'
);
*/

-- ============================================================
-- VERIFICATION QUERIES
-- Run these to verify tables were created correctly:
-- ============================================================

-- Check tables exist
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'tournament_%';

-- Count rows in each table
-- SELECT 'tournament_games' as table_name, COUNT(*) as row_count FROM tournament_games
-- UNION ALL
-- SELECT 'tournament_interactions', COUNT(*) FROM tournament_interactions;

-- Show table structures
-- \d tournament_games
-- \d tournament_interactions

-- ============================================================
-- ✅ SCHEMA CREATION COMPLETE!
-- Tables: tournament_games, tournament_interactions
-- Prefix: tournament_
-- Ready to use! 🚀
-- ============================================================
