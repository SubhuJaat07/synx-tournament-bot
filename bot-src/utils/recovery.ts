import { Client, EmbedBuilder } from 'discord.js';
import { gameCache, CachedGame } from '../cache/gameCache.ts';
import { activeTimers } from '../index.ts';

/**
 * ⚡ OPTIMIZED Recovery System - Uses CACHE only!
 * 
 * After bot restart:
 * 1. Cache is already preloaded (from index.ts ready event)
 * 2. This function only restores timers for active games
 * 3. NO additional DB calls needed!
 */

interface RecoveryConfig {
  player1: { id: string; username: string };
  player2: { id: string; username: string };
  prizeName?: string | null;
  prizeValue?: string | null;
  prizeDescription?: string | null;
  timer?: number;
  resultMode?: string;
}

/**
 * Recover active games from CACHE (called after preload)
 * This is FAST because all data is already in memory!
 */
export async function recoverActiveGamesFromCache(client: Client): Promise<void> {
  try {
    console.log('🔄 Checking cache for incomplete games...');
    
    // ⚡ Get incomplete games from CACHE (not DB!)
    const incompleteGames = gameCache.getIncompleteGames();
    
    if (incompleteGames.length === 0) {
      console.log('✅ No incomplete games in cache');
      return;
    }

    console.log(`📋 Found ${incompleteGames.length} incomplete game(s) in cache`);

    const now = new Date();
    
    for (const game of incompleteGames) {
      try {
        await recoverGameFromCache(client, game, now);
      } catch (error) {
        console.error(`❌ Failed to recover game ${game.id}:`, error);
        
        // Mark as cancelled in cache
        gameCache.set({
          ...game,
          status: 'cancelled',
          completedAt: now,
          updatedAt: now,
        });
      }
    }

    console.log(`✅ Game recovery completed from cache`);

  } catch (error) {
    console.error('Error during game recovery:', error);
  }
}

/**
 * Recover a single game from cached data
 */
async function recoverGameFromCache(
  client: Client, 
  game: CachedGame, 
  now: Date
): Promise<void> {
  const endsAt = game.endsAt;
  
  console.log(`\n🔄 Recovering game: ${game.id}`);
  console.log(`   Players: ${game.playerName1} vs ${game.playerName2}`);
  console.log(`   Status: ${game.status}`);
  console.log(`   Ends at: ${endsAt.toISOString()}`);

  // Check if game has already expired
  if (now >= endsAt) {
    console.log(`⏰ Game ${game.id} has expired, scheduling result...`);
    
    // Schedule immediate result calculation (short delay to allow bot to fully start)
    setTimeout(async () => {
      try {
        const updatedGame = gameCache.get(game.id);
        if (!updatedGame || updatedGame.status === 'completed') return;

        // Calculate results from cached choices
        const { calculateResultFromCache, completeGameInCacheAndDb } = await import('../cache/cacheManager.ts');
        const { calculateAndShowResultsFromCache } = await import('../utils/results.ts');
        
        const result = calculateResultFromCache(updatedGame);
        
        // Complete in cache + async DB
        await completeGameInCacheAndDb(game.id, {
          winnerId: result.winner_id || undefined,
          winnerName: result.winner_username || undefined,
          resultType: result.result_type,
          prizeShare1: result.player1_prize_share,
          prizeShare2: result.player2_prize_share,
        });

        // Try to notify channel
        const channel = await client.channels.fetch(game.channelId).catch(() => null);
        if (channel && 'send' in channel) {
          const config: RecoveryConfig = {
            player1: { id: updatedGame.playerId1, username: updatedGame.playerName1 },
            player2: { id: updatedGame.playerId2, username: updatedGame.playerName2 },
            prizeName: updatedGame.prizeName,
            prizeValue: updatedGame.prizeValue,
            prizeDescription: updatedGame.prizeDescription,
            timer: updatedGame.timerSeconds,
            resultMode: updatedGame.resultMode,
          };

          await channel.send({
            content: `🔄 **Bot Restart Detected!**\nShowing results for game between <@${updatedGame.playerId1}> and <@${updatedGame.playerId2}>...`,
            embeds: [createRecoveryEmbed(updatedGame, result)],
          });
          
          await channel.send({
            content: createRecoveryAnnouncement(updatedGame, result),
          });
        }

        console.log(`✅ Expired game ${game.id} completed`);
        
      } catch (timerError) {
        console.error(`Error processing expired game ${game.id}:`, timerError);
      }
    }, 2000); // 2 second delay after startup

    return;
  }

  // Game hasn't expired yet - restart the timer
  const remainingTime = Math.max(0, endsAt.getTime() - now.getTime());
  const remainingSeconds = Math.ceil(remainingTime / 1000);

  console.log(`⏰ Restarting timer for game ${game.id}: ${remainingSeconds}s remaining`);

  // Set up new timer using cached data
  const timer = setTimeout(async () => {
    try {
      console.log(`⏰ Recovery timer ended for game: ${game.id}`);
      
      // Get latest state from cache
      const currentGame = gameCache.get(game.id);
      
      if (currentGame && currentGame.status !== 'completed' && currentGame.status !== 'cancelled') {
        const { calculateResultFromCache, completeGameInCacheAndDb } = await import('../cache/cacheManager.ts');
        
        const result = calculateResultFromCache(currentGame);
        
        // Complete in cache + async DB
        await completeGameInCacheAndDb(currentGame.id, {
          winnerId: result.winner_id || undefined,
          winnerName: result.winner_username || undefined,
          resultType: result.result_type,
          prizeShare1: result.player1_prize_share,
          prizeShare2: result.player2_prize_share,
        });

        // Notify channel
        const channel = await client.channels.fetch(currentGame.channelId).catch(() => null);
        if (channel && 'send' in channel) {
          await channel.send({
            content: `⏰ **Time's Up!** (Recovered after restart)\n${result.description}`,
            embeds: [createRecoveryResultEmbed(currentGame, result)],
          });
        }
      }
    } catch (error) {
      console.error(`Error in recovery timer for game ${game.id}:`, error);
    }
  }, remainingTime);

  activeTimers.set(game.id, timer);

  // Silent recovery - NO message to users (they won't even notice!)
  console.log(`🔄 Game ${game.id} silently recovered - ${remainingSeconds}s remaining`);
}

function createRecoveryStatusEmbed(game: CachedGame): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xffaa00)
    .setTitle('🔄 Game Recovery')
    .setDescription(
      `This game was interrupted by a bot restart.\n` +
      `All progress has been preserved!`
    )
    .addFields(
      {
        name: 'Players',
        value: 
          `• <@${game.playerId1}>\n` +
          `• <@${game.playerId2}>`,
        inline: true,
      },
      {
        name: 'Choices',
        value:
          `• P1: ${game.choice1 ? `${game.choice1.toUpperCase()} ✅` : 'Not chosen ⏳'}\n` +
          `• P2: ${game.choice2 ? `${game.choice2.toUpperCase()} ✅` : 'Not chosen ⏳'}`,
        inline: true,
      },
      {
        name: 'Status',
        value: `⏱️ Timer will end at <t:${Math.floor(game.endsAt.getTime() / 1000)}:R>`,
        inline: false,
      }
    )
    .setFooter({ text: 'Synx Tournaments - Auto Recovery' })
    .setTimestamp(new Date());
}

function createRecoveryEmbed(game: CachedGame, result: any): EmbedBuilder {
  let color: number;
  switch (result.result_type) {
    case 'split_split':
      color = 0x00ff00;
      break;
    case 'steal_steal':
      color = 0xff0000;
      break;
    default:
      color = 0xffaa00;
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${result.emoji} Split & Steal - RESULTS`)
    .setDescription(result.description)
    .addFields(
      {
        name: 'Prize Distribution',
        value:
          `• <@${game.playerName1}>: **${result.player1_prize_share}%**\n` +
          `• <@${game.playerName2}>: **${result.player2_prize_share}%**`,
        inline: false,
      },
      {
        name: 'Note',
        value: 'This result was calculated automatically after a bot restart.',
        inline: false,
      }
    )
    .setFooter({ text: 'Synx Tournaments © 2024' })
    .setTimestamp(new Date());
}

function createRecoveryResultEmbed(game: CachedGame, result: any): EmbedBuilder {
  let color: number;
  switch (result.result_type) {
    case 'split_split':
      color = 0x00ff00;
      break;
    case 'steal_steal':
      color = 0xff0000;
      break;
    default:
      color = 0xffaa00;
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${result.emoji} Split & Steal - RESULTS`)
    .setDescription(result.description)
    .addFields(
      {
        name: 'Prize Distribution',
        value:
          `• <@${game.playerName1}>: **${result.player1_prize_share}%**\n` +
          `• <@${game.playerName2}>: **${result.player2_prize_share}%**`,
        inline: false,
      },
      {
        name: 'Note',
        value: 'This result was calculated automatically after a bot restart.',
        inline: false,
      }
    )
    .setFooter({ text: 'Synx Tournaments © 2024' })
    .setTimestamp(new Date());
}

function createRecoveryAnnouncement(game: CachedGame, result: any): string {
  const prizeName = game.prizeName || 'the prize';
  
  switch (result.result_type) {
    case 'split_split':
      return (
        `🎉 **Split & Steal Result (Auto-Recovered)**\n\n` +
        `✅ <@${game.playerName1}> and <@${game.playerName2}> both chose to **SPLIT**!\n` +
        `📦 **${prizeName}** has been divided equally (**50-50**) between both players!`
      );
    
    case 'steal_steal':
      return (
        `💥 **Split & Steal Result (Auto-Recovered)**\n\n` +
        `❌ Both players tried to **STEAL**!\n😢 **Nobody wins ${prizeName}!**`
      );
    
    case 'split_steal':
      return (
        `🔪 **Split & Steal Result (Auto-Recovered)**\n\n` +
        `💀 <@${game.playerName1}> chose to SPLIT, but <@${game.playerName2}> chose to STEAL!\n` +
        `🏆 **<@${game.playerName2}> takes all of ${prizeName}!**`
      );
    
    case 'steal_split':
      return (
        `🔪 **Split & Steal Result (Auto-Recovered)**\n\n` +
        `💀 <@${game.playerName2}> chose to SPLIT, but <@${game.playerName1}> chose to STEAL!\n` +
        `🏆 **<@${game.playerName1}> takes all of ${prizeName}!**`
      );
    
    default:
      return `🎮 **Split & Steal game completed!** (Auto-recovered after restart)`;
  }
}
