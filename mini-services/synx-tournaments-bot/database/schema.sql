-- Synx Tournaments - Split & Steal Game Database Schema
-- Run this SQL in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Games table to store active and completed games
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id VARCHAR(255) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  
  -- Players
  player1_id VARCHAR(255) NOT NULL,
  player1_username VARCHAR(255) NOT NULL,
  player2_id VARCHAR(255) NOT NULL,
  player2_username VARCHAR(255) NOT NULL,
  
  -- Prize details
  prize_name VARCHAR(500),
  prize_value VARCHAR(255),
  prize_description TEXT,
  
  -- Timer settings
  timer_seconds INTEGER NOT NULL DEFAULT 60,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ends_at TIMESTAMP WITH TIME ZONE,
  
  -- Result mode: 'timer_end' or 'both_clicked'
  result_mode VARCHAR(50) DEFAULT 'timer_end',
  
  -- Game status: 'waiting', 'in_progress', 'completed', 'cancelled'
  status VARCHAR(50) DEFAULT 'waiting',
  
  -- Player choices (null until they choose)
  player1_choice VARCHAR(20), -- 'split' or 'steal' or null
  player2_choice VARCHAR(20), -- 'split' or 'steal' or null
  player1_chosen_at TIMESTAMP WITH TIME ZONE,
  player2_chosen_at TIMESTAMP WITH TIME ZONE,
  
  -- Results
  winner_id VARCHAR(255),
  winner_username VARCHAR(255),
  result_type VARCHAR(50), -- 'split_split', 'steal_steal', 'split_steal', 'steal_split'
  player1_prize_share INTEGER, -- percentage or amount
  player2_prize_share INTEGER, -- percentage or amount
  
  -- Metadata
  created_by VARCHAR(255) NOT NULL,
  guild_id VARCHAR(255),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Interactions table for restart-safe button interactions
CREATE TABLE IF NOT EXISTS interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  
  -- Interaction identifiers for Discord API
  interaction_id VARCHAR(255) UNIQUE NOT NULL,
  interaction_token VARCHAR(255) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,
  guild_id VARCHAR(255),
  
  -- Player info
  user_id VARCHAR(255) NOT NULL,
  custom_id VARCHAR(100) NOT NULL, -- button identifier like 'split_p1', 'steal_p1'
  
  -- Status
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_channel ON games(channel_id);
CREATE INDEX IF NOT EXISTS idx_games_players ON games(player1_id, player2_id);
CREATE INDEX IF NOT EXISTS idx_interactions_game ON interactions(game_id);
CREATE INDEX IF NOT EXISTS idx_interactions_user ON interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_interactions_processed ON interactions(processed);

-- Row Level Security (optional - enable if needed)
-- ALTER TABLE games ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;

-- Function to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for automatic timestamp updates
DROP TRIGGER IF EXISTS update_games_updated_at ON games;
CREATE TRIGGER update_games_updated_at
    BEFORE UPDATE ON games
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_interactions_updated_at ON interactions;
CREATE TRIGGER update_interactions_updated_at
    BEFORE UPDATE ON interactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
