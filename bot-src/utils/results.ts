import { ButtonInteraction, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { CachedGame, GameResultType } from '../cache/gameCache.ts';
import { completeGameInCacheAndDb } from '../cache/cacheManager.ts';

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
  result_type: 'split_split' | 'steal_steal' | 'split_steal' | 'steal_split';
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
      result_type: 'steal_steal',
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
        result_type: 'split_steal',
        player1_prize_share: 0,
        player2_prize_share: 100,
        description: `🏆 <@${game.playerName2}> wins by default! <@${game.playerName1}> didn't respond in time.`,
        emoji: '🏆',
      };
    } else {
      return {
        winner_id: null,
        winner_username: null,
        result_type: 'split_split',
        player1_prize_share: 50,
        player2_prize_share: 50,
        description: `⚖️ **Fair Split!** <@${game.playerName2}> chose to SPLIT, but <@${game.playerName1}> didn't respond.`,
        emoji: '⚖️',
      };
    }
  }

  if (p1Choice && !p2Choice) {
    if (p1Choice === 'steal') {
      return {
        winner_id: game.playerId1,
        winner_username: game.playerName1,
        result_type: 'steal_split',
        player1_prize_share: 100,
        player2_prize_share: 0,
        description: `🏆 <@${game.playerName1}> wins by default! <@${game.playerName2}> didn't respond in time.`,
        emoji: '🏆',
      };
    } else {
      return {
        winner_id: null,
        winner_username: null,
        result_type: 'split_split',
        player1_prize_share: 50,
        player2_prize_share: 50,
        description: `⚖️ **Fair Split!** <@${game.playerName1}> chose to SPLIT, but <@${game.playerName2}> didn't respond.`,
        emoji: '⚖️',
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
      description: `💀 <@${game.playerName1}> chose to **SPLIT**, but <@${game.playerName2}> chose to **STEAL**!\n🏆 **<@${game.playerName2}> takes everything!**`,
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
    description: `💀 <@${game.playerName2}> chose to **SPLIT**, but <@${game.playerName1}> chose to **STEAL**!\n🏆 **<@${game.playerName1}> takes everything!**`,
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

    // Create results embed (from cache data)
    const embed = createResultsEmbedFromCache(game, config, result, isTimerExpiry);

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
 * Create results embed from cached data
 */
function createResultsEmbedFromCache(
  game: CachedGame,
  config: GameConfig,
  result: GameResult,
  isTimerExpiry: boolean
): EmbedBuilder {
  const prizeText = game.prizeName 
    ? `**${game.prizeName}**${game.prizeValue ? ` (${game.prizeValue})` : ''}`
    : '**Mystery Prize**';

  const p1ChoiceEmoji = game.choice1 === 'split' ? '🤝' : game.choice1 === 'steal' ? '💀' : '❓';
  const p2ChoiceEmoji = game.choice2 === 'split' ? '🤝' : game.choice2 === 'steal' ? '💀' : '❓';
  
  const p1ChoiceText = game.choice1 ? `${p1ChoiceEmoji} **${game.choice1.toUpperCase()}**` : '❓ **No Choice**';
  const p2ChoiceText = game.choice2 ? `${p2ChoiceEmoji} **${game.choice2.toUpperCase()}**` : '❓ **No Choice**';

  // Determine color based on result
  let color: number;
  switch (result.result_type) {
    case 'split_split':
      color = 0x00ff00; // Green for cooperation
      break;
    case 'steal_steal':
      color = 0xff0000; // Red for mutual betrayal
      break;
    case 'split_steal':
    case 'steal_split':
      color = 0xffaa00; // Orange for betrayal
      break;
    default:
      color = 0x00ff88; // Default
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${result.emoji} Split & Steal - RESULTS`)
    .setDescription(result.description)
    .addFields(
      {
        name: `💎 Prize`,
        value: prizeText,
        inline: false,
      },
      {
        name: `👤 ${game.playerName1}'s Choice`,
        value: p1ChoiceText,
        inline: true,
      },
      {
        name: `👤 ${game.playerName2}'s Choice`,
        value: p2ChoiceText,
        inline: true,
      },
      {
        name: '📊 Prize Distribution',
        value: 
          `• <@${game.playerName1}>: **${result.player1_prize_share}%**\n` +
          `• <@${game.playerName2}>: **${result.player2_prize_share}%**`,
        inline: false,
      }
    );

  // Add winner field if there's a winner
  if (result.winner_id) {
    embed.addFields({
      name: '🏆 Winner',
      value: `<@${result.winner_username}> takes home the entire prize!`,
      inline: false,
    });
  }

  // Add timer info
  embed.addFields({
    name: '⏱️ Game Info',
    value: 
      `• **Duration:** ${game.timerSeconds} seconds\n` +
      `• **Mode:** ${game.resultMode === 'both_clicked' ? '⚡ Both Click' : '🕐 Timer End'}\n` +
      `• **End Reason:** ${isTimerExpiry ? '⏰ Time Expired' : '🎯 All Choices Made'}`,
    inline: false,
  });

  // Add prize description if exists
  if (game.prizeDescription) {
    embed.addFields({
      name: '📝 Prize Details',
      value: game.prizeDescription,
      inline: false,
    });
  }

  embed
    .setFooter({ text: 'Synx Tournaments © 2024 | Game Complete' })
    .setTimestamp(new Date());

  return embed;
}

/**
 * Create announcement message from cached data
 */
function createAnnouncementMessageFromCache(game: CachedGame, result: GameResult): string {
  const prizeName = game.prizeName || 'the prize';
  
  switch (result.result_type) {
    case 'split_split':
      return (
        `🎉 **Split & Steal Result!**\n\n` +
        `✅ <@${game.playerName1}> and <@${game.playerName2}> both chose to **SPLIT**!\n` +
        `📦 **${prizeName}** has been divided equally (**50-50**) between both players!\n\n` +
        `Congratulations to both players for their cooperation! 🤝`
      );
    
    case 'steal_steal':
      return (
        `💥 **Split & Steal Result!**\n\n` +
        `❌ <@${game.playerName1}> and <@${game.playerName2}> both tried to **STEAL**!\n` +
        `😢 **Nobody wins ${prizeName}!** Both players leave empty-handed.\n\n` +
        `Next time, maybe trust each other? 💔`
      );
    
    case 'split_steal':
      return (
        `🔪 **Split & Steal Result!**\n\n` +
        `💀 <@${game.playerName1}> chose to **SPLIT**...\n` +
        `💀 But <@${game.playerName2}> chose to **STEAL**!\n\n` +
        `🏆 **<@${game.playerName2}> takes all of ${prizeName}!**\n\n` +
        `A brutal betrayal! Better luck next time, <@${game.playerName1}>...`
      );
    
    case 'steal_split':
      return (
        `🔪 **Split & Steal Result!**\n\n` +
        `💀 <@${game.playerName2}> chose to **SPLIT**...\n` +
        `💀 But <@${game.playerName1}> chose to **STEAL**!\n\n` +
        `🏆 **<@${game.playerName1}> takes all of ${prizeName}!**\n\n` +
        `A brutal betrayal! Better luck next time, <@${game.playerName2}>...`
      );
    
    default:
      return `🎮 **Split & Steal game completed!** Check above for results.`;
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
