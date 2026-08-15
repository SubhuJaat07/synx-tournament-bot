import { ButtonInteraction, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { CachedGame, GameResultType } from '../cache/gameCache.ts';
import { completeGameInCacheAndDb } from '../cache/cacheManager.ts';
import { activeIntervals } from '../index.ts';

// Types for cache-based operations
interface PlayerConfig {
  id: string;
  username: string;
}

interface GameConfig {
  player1: PlayerConfig | { id: string; username: string };
  player2: PlayerConfig | { id: string; username: string };
  prizeName?: string | null | undefined;
  prizeValue?: string | null | undefined;
  prizeDescription?: string | null | undefined;
  timer?: number | null | undefined;
  resultMode?: string | null | undefined;
}

export interface GameResult {
  winner_id: string | null;
  winner_username: string | null;
  result_type: 'split_split' | 'steal_steal' | 'split_steal' | 'steal_split' | 'no_choice_no_choice' | 'no_choice_split' | 'no_choice_steal' | 'split_no_choice' | 'steal_no_choice';
  player1_prize_share: number;
  player2_prize_share: number;
  description: string;
  emoji: string;
}

/**
 * ⚡ Calculate result from CACHED game data (no DB call!)
 */
export function calculateResultFromCache(game: CachedGame): GameResult {
  const p1Choice = game.choice1;
  const p2Choice = game.choice2;

  // Handle case where one or both players didn't choose (timer expired)
  if (!p1Choice && !p2Choice) {
    return {
      winner_id: null,
      winner_username: null,
      result_type: 'no_choice_no_choice',
      player1_prize_share: 0,
      player2_prize_share: 0,
      description: '⏰ **Time Up!** Neither player made a choice in time.',
      emoji: '⏰',
    };
  }

  if (!p1Choice && p2Choice) {
    if (p2Choice === 'steal') {
      return {
        winner_id: game.playerId2,
        winner_username: game.playerName2,
        result_type: 'no_choice_steal',
        player1_prize_share: 0,
        player2_prize_share: 100,
        description: `🏆 <@${game.playerId2}> wins by default! <@${game.playerId1}> **didn't choose anything**.`,
        emoji: '🏆',
      };
    } else {
      return {
        winner_id: null,
        winner_username: null,
        result_type: 'no_choice_split',
        player1_prize_share: 0,
        player2_prize_share: 100,
        description: `🤝 <@${game.playerId2}> chose to **SPLIT**, but <@${game.playerId1}> **didn't choose anything**.\n📦 <@${game.playerId2}> gets the full prize!`,
        emoji: '🤝',
      };
    }
  }

  if (p1Choice && !p2Choice) {
    if (p1Choice === 'steal') {
      return {
        winner_id: game.playerId1,
        winner_username: game.playerName1,
        result_type: 'steal_no_choice',
        player1_prize_share: 100,
        player2_prize_share: 0,
        description: `🏆 <@${game.playerId1}> wins by default! <@${game.playerId2}> **didn't choose anything**.`,
        emoji: '🏆',
      };
    } else {
      return {
        winner_id: null,
        winner_username: null,
        result_type: 'split_no_choice',
        player1_prize_share: 100,
        player2_prize_share: 0,
        description: `🤝 <@${game.playerId1}> chose to **SPLIT**, but <@${game.playerId2}> **didn't choose anything**.\n📦 <@${game.playerId1}> gets the full prize!`,
        emoji: '🤝',
      };
    }
  }

  // Both players chose - main logic
  if (p1Choice === 'split' && p2Choice === 'split') {
    return {
      winner_id: null,
      winner_username: null,
      result_type: 'split_split',
      player1_prize_share: 50,
      player2_prize_share: 50,
      description: '✅ **Both players chose to SPLIT!** The prize is split equally!',
      emoji: '✅',
    };
  }

  if (p1Choice === 'steal' && p2Choice === 'steal') {
    return {
      winner_id: null,
      winner_username: null,
      result_type: 'steal_steal',
      player1_prize_share: 0,
      player2_prize_share: 0,
      description: '❌ **Both players tried to STEAL!** Nobody wins anything!',
      emoji: '❌',
    };
  }

  if (p1Choice === 'split' && p2Choice === 'steal') {
    return {
      winner_id: game.playerId2,
      winner_username: game.playerName2,
      result_type: 'split_steal',
      player1_prize_share: 0,
      player2_prize_share: 100,
      description: `💀 <@${game.playerId1}> chose to **SPLIT**, but <@${game.playerId2}> chose to **STEAL**!\n🏆 **<@${game.playerId2}> takes everything!**`,
      emoji: '💀',
    };
  }

  // p1 steal, p2 split
  return {
    winner_id: game.playerId1,
    winner_username: game.playerName1,
    result_type: 'steal_split',
    player1_prize_share: 100,
    player2_prize_share: 0,
    description: `💀 <@${game.playerId2}> chose to **SPLIT**, but <@${game.playerId1}> chose to **STEAL**!\n🏆 **<@${game.playerId1}> takes everything!**`,
    emoji: '💀',
  };
}

/**
 * ⚡ Show results using CACHE + async DB completion
 * This is the FAST version - no blocking DB calls!
 */
export async function calculateAndShowResultsFromCache(
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  game: CachedGame,
  config: GameConfig,
  isTimerExpiry: boolean = false
): Promise<void> {
  try {
    const result = calculateResultFromCache(game);

    // ⚡ Complete in cache IMMEDIATELY + async DB sync
    await completeGameInCacheAndDb(game.id, {
      winnerId: result.winner_id || undefined,
      winnerName: result.winner_username || undefined,
      resultType: result.result_type,
      prizeShare1: result.player1_prize_share,
      prizeShare2: result.player2_prize_share,
    });

    console.log(`🎮 Game ${game.id} completed with result: ${result.result_type}`);

    // ⏱️ Clear live countdown interval if running
    if (activeIntervals.has(game.id)) {
      clearInterval(activeIntervals.get(game.id));
      activeIntervals.delete(game.id);
      console.log(`⏱️ Cleared live countdown for game ${game.id}`);
    }

    // Create results embed (from cache data)
    const embed = createResultsEmbedFromCache(game, config, result, isTimerExpiry);

    // Update the original message with results and remove buttons
    const message = interaction.isButton() 
      ? interaction.message 
      : await interaction.fetchReply();

    const editedMessage = await message.edit({
      content: `${result.emoji} **GAME OVER!** ${isTimerExpiry ? '(Time\'s up!)' : ''}`,
      embeds: [embed],
      components: [], // Remove all buttons
    });

    // Send announcement as REPLY to the result message!
    if (interaction.channel) {
      await editedMessage.reply({
        content: createAnnouncementMessageFromCache(game, result),
      });
    }

  } catch (error) {
    console.error('Error showing results:', error);
    
    try {
      if (interaction.isButton()) {
        await interaction.followUp({
          content: '❌ **Error:** Failed to show results. Please check bot logs.',
          ephemeral: true,
        });
      }
    } catch (followUpError) {
      console.error('Failed to send error message:', followUpError);
    }
  }
}

/**
 * Create results embed with CHOICE HISTORY TIMELINE!
 */
function createResultsEmbedFromCache(
  game: CachedGame,
  config: GameConfig,
  result: GameResult,
  isTimerExpiry: boolean
): EmbedBuilder {
  const p1ChoiceEmoji = game.choice1 === 'split' ? '🤝' : game.choice1 === 'steal' ? '💀' : '⏰';
  const p2ChoiceEmoji = game.choice2 === 'split' ? '🤝' : game.choice2 === 'steal' ? '💀' : '⏰';
  
  // Show actual choice or "didn't choose"
  const p1ChoiceText = game.choice1 
    ? `${p1ChoiceEmoji} **${game.choice1.toUpperCase()}**` 
    : '⏰ **Did not choose**';
  const p2ChoiceText = game.choice2 
    ? `${p2ChoiceEmoji} **${game.choice2.toUpperCase()}**` 
    : '⏰ **Did not choose**';

  // Determine color based on result
  let color: number;
  switch (result.result_type) {
    case 'split_split':
      color = 0x00ff00; // Green
      break;
    case 'steal_steal':
      color = 0xff0000; // Red
      break;
    case 'split_steal':
    case 'steal_split':
      color = 0xffaa00; // Orange
      break;
    case 'no_choice_no_choice':
      color = 0x808080; // Gray - both didn't choose
      break;
    case 'no_choice_steal':
    case 'steal_no_choice':
      color = 0xffaa00; // Orange - someone stole, other didn't choose
      break;
    case 'no_choice_split':
    case 'split_no_choice':
      color = 0x00ff88; // Light green - someone split, other didn't choose
      break;
    default:
      color = 0x00ff88;
  }

  // Build choice history - ONLY SHOW FINAL CHOICE for each player!
  let historyText = '';
  
  if (game.choiceHistory && game.choiceHistory.length > 0) {
    // Get ONLY the last (final) choice for each player
    const finalChoices: { [playerId: string]: typeof game.choiceHistory[0] } = {};
    
    for (const entry of game.choiceHistory) {
      finalChoices[entry.playerId] = entry; // Overwrite with latest
    }
    
    // Convert to array and format
    const finalTimeline = Object.values(finalChoices).map((h) => {
      const time = h.timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `**<@${h.playerId}>** chose **${h.choice.toUpperCase()}** (${time})`;
    });
    
    historyText = finalTimeline.join('\n');
  }
  
  // If no choices at all
  if (!historyText) {
    historyText = 'No choices recorded';
  }

  // Build simple embed with choices + history
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${result.emoji} Game Over!`)
    .addFields(
      {
        name: `<@${game.playerId1}>`,
        value: p1ChoiceText,
        inline: true,
      },
      {
        name: `<@${game.playerId2}>`,
        value: p2ChoiceText,
        inline: true,
      }
    );

  // Add winner field only if there's a winner
  if (result.winner_id) {
    embed.addFields({
      name: '🏆 Winner',
      value: `<@${result.winner_id}> takes all!`,
      inline: false,
    });
  }

  // Add choice history timeline
  embed.addFields({
    name: '📜 Choice Timeline',
    value: historyText,
    inline: false,
  });

  embed.setFooter({ text: 'Synx Tournaments' })
    .setTimestamp(new Date());

  return embed;
}

/**
 * Create SIMPLE announcement message from cached data
 */
function createAnnouncementMessageFromCache(game: CachedGame, result: GameResult): string {
  // Combine prize value + name: "100K SGX Coins"
  const prizeDisplay = game.prizeValue && game.prizeName 
    ? `${game.prizeValue} ${game.prizeName}` 
    : game.prizeName || game.prizeValue || 'the prize';
  
  switch (result.result_type) {
    case 'split_split':
      return `🤝 **<@${game.playerId1}>** and **<@${game.playerId2}>** both chose to **SPLIT**!\n\n📦 **${prizeDisplay}** has been divided equally (**50-50**) between both players!`;
    
    case 'steal_steal':
      return `💀 Both **<@${game.playerId1}>** and **<@${game.playerId2}>** tried to **STEAL**!\n\n😢 **Nobody wins!** Both players were too greedy!\n\n💰 **${prizeDisplay}** will be used in the next tournament!`;
    
    case 'split_steal':
      return `🏆 **<@${game.playerId2}>** stole **${prizeDisplay}**!\n\n💀 **<@${game.playerId1}>** chose to SPLIT but got betrayed!`;
    
    case 'steal_split':
      return `🏆 **<@${game.playerId1}>** stole **${prizeDisplay}**!\n\n💀 **<@${game.playerId2}>** chose to SPLIT but got betrayed!`;
    
    // New no-choice cases
    case 'no_choice_no_choice':
      return `⏰ **Time's up!** Neither **<@${game.playerId1}>** nor **<@${game.playerId2}>** made a choice!\n\n😴 Everyone was sleeping on the job! **${prizeDisplay}** carries over to next time.`;
    
    case 'no_choice_steal':
      return `🏆 **<@${game.playerId2}>** takes **${prizeDisplay}** by default!\n\n⚠️ **<@${game.playerId1}>** didn't choose anything - auto-forfeit!`;
    
    case 'no_choice_split':
      return `🤝 **<@${game.playerId2}>** gets the full **${prizeDisplay}**!\n\n⚠️ **<@${game.playerId1}>** didn't choose anything - they chose SPLIT so you get it all by default!`;
    
    case 'steal_no_choice':
      return `🏆 **<@${game.playerId1}>** takes **${prizeDisplay}** by default!\n\n⚠️ **<@${game.playerId2}>** didn't choose anything - auto-forfeit!`;
    
    case 'split_no_choice':
      return `🤝 **<@${game.playerId1}>** gets the full **${prizeDisplay}**!\n\n⚠️ **<@${game.playerId2}>** didn't choose anything - they chose SPLIT so you get it all by default!`;
    
    default:
      return `🎮 **Game Over!** Check the embed above for results.`;
  }
}

// Keep old DB-based functions for backward compatibility (if needed)
// These are NOT used in optimized path

import { Game, completeGame as dbCompleteGame } from '../database/operations.ts';

export function calculateResult(game: Game): GameResult {
  // Convert to cache format and use cache-based calculation
  const cached: CachedGame = {
    id: game.id,
    channelId: game.channel_id,
    messageId: game.message_id,
    playerId1: game.player1_id,
    playerName1: game.player1_username,
    playerId2: game.player2_id,
    playerName2: game.player2_username,
    prizeName: game.prize_name,
    prizeValue: game.prize_value,
    prizeDescription: game.prize_description,
    timerSeconds: game.timer_seconds,
    startedAt: new Date(game.started_at),
    endsAt: new Date(game.ends_at || ''),
    resultMode: game.result_mode,
    status: game.status,
    choice1: game.player1_choice,
    choice2: game.player2_choice,
    chosenAt1: game.player1_chosen_at ? new Date(game.player1_chosen_at) : undefined,
    chosenAt2: game.player2_chosen_at ? new Date(game.player2_chosen_at) : undefined,
    winnerId: game.winner_id,
    winnerName: game.winner_username,
    resultType: game.result_type as GameResultType,
    prizeShare1: game.player1_prize_share,
    prizeShare2: game.player2_prize_share,
    createdBy: game.created_by,
    guildId: game.guild_id,
    createdAt: new Date(game.created_at),
    updatedAt: new Date(game.updated_at),
    completedAt: game.completed_at ? new Date(game.completed_at) : undefined,
  };

  return calculateResultFromCache(cached);
}

export async function calculateAndShowResults(
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  game: Game,
  config: GameConfig,
  isTimerExpiry: boolean = false
): Promise<void> {
  try {
    const result = calculateResult(game);

    // Complete the game in database
    await dbCompleteGame(game.id, {
      winner_id: result.winner_id || undefined,
      winner_username: result.winner_username || undefined,
      result_type: result.result_type,
      player1_prize_share: result.player1_prize_share,
      player2_prize_share: result.player2_prize_share,
    });

    console.log(`🎮 Game ${game.id} completed with result: ${result.result_type}`);

    // Create results embed
    const embed = createResultsEmbedDB(game, config, result, isTimerExpiry);

    // Update the original message with results and remove buttons
    const message = interaction.isButton() 
      ? interaction.message 
      : await interaction.fetchReply();

    await message.edit({
      content: `${result.emoji} **GAME OVER!** ${isTimerExpiry ? '(Time\'s up!)' : ''}`,
      embeds: [embed],
      components: [], // Remove all buttons
    });

    // Send announcement in channel
    if (interaction.channel) {
      await interaction.channel.send({
        content: createAnnouncementMessageDB(game, result),
      });
    }

  } catch (error) {
    console.error('Error showing results:', error);
    
    try {
      if (interaction.isButton()) {
        await interaction.followUp({
          content: '❌ **Error:** Failed to show results. Please check bot logs.',
          ephemeral: true,
        });
      }
    } catch (followUpError) {
      console.error('Failed to send error message:', followUpError);
    }
  }
}

function createResultsEmbedDB(
  game: Game,
  config: GameConfig,
  result: GameResult,
  isTimerExpiry: boolean
): EmbedBuilder {
  // Convert to cached format and use cache-based embed creation
  const cached: CachedGame = {
    id: game.id,
    channelId: game.channel_id,
    messageId: game.message_id,
    playerId1: game.player1_id,
    playerName1: game.player1_username,
    playerId2: game.player2_id,
    playerName2: game.player2_username,
    prizeName: game.prize_name,
    prizeValue: game.prize_value,
    prizeDescription: game.prize_description,
    timerSeconds: game.timer_seconds,
    startedAt: new Date(game.started_at),
    endsAt: new Date(game.ends_at || ''),
    resultMode: game.result_mode,
    status: game.status,
    choice1: game.player1_choice,
    choice2: game.player2_choice,
    chosenAt1: game.player1_chosen_at ? new Date(game.player1_chosen_at) : undefined,
    chosenAt2: game.player2_chosen_at ? new Date(game.player2_chosen_at) : undefined,
    winnerId: game.winner_id,
    winnerName: game.winner_username,
    resultType: game.result_type as GameResultType,
    prizeShare1: game.player1_prize_share,
    prizeShare2: game.player2_prize_share,
    createdBy: game.created_by,
    guildId: game.guild_id,
    createdAt: new Date(game.created_at),
    updatedAt: new Date(game.updated_at),
    completedAt: game.completed_at ? new Date(game.completed_at) : undefined,
  };

  return createResultsEmbedFromCache(cached, config, result, isTimerExpiry);
}

function createAnnouncementMessageDB(game: Game, result: GameResult): string {
  const cached: CachedGame = {
    id: game.id,
    channelId: game.channel_id,
    messageId: game.message_id,
    playerId1: game.player1_id,
    playerName1: game.player1_username,
    playerId2: game.player2_id,
    playerName2: game.player2_username,
    prizeName: game.prize_name,
    prizeValue: game.prize_value,
    prizeDescription: game.prize_description,
    timerSeconds: game.timer_seconds,
    startedAt: new Date(game.started_at),
    endsAt: new Date(game.ends_at || ''),
    resultMode: game.result_mode,
    status: game.status,
    choice1: game.player1_choice,
    choice2: game.player2_choice,
    winnerId: game.winner_id,
    winnerName: game.winner_username,
    resultType: game.result_type as GameResultType,
    prizeShare1: game.player1_prize_share,
    prizeShare2: game.player2_prize_share,
    createdBy: game.created_by,
    guildId: game.guild_id,
    createdAt: new Date(game.created_at),
    updatedAt: new Date(game.updated_at),
    completedAt: game.completed_at ? new Date(game.completed_at) : undefined,
  };

  return createAnnouncementMessageFromCache(cached, result);
}
