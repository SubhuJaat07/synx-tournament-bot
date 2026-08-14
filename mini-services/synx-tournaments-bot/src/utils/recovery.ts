import { Client, EmbedBuilder } from 'discord.js';
import { getIncompleteGames, updateGame, completeGame } from '../database/operations.ts';
import { calculateAndShowResults } from './results.ts';
import { activeTimers } from '../index.ts';

interface RecoveryConfig {
  player1: { id: string; username: string };
  player2: { id: string; username: string };
  prizeName?: string | null;
  prizeValue?: string | null;
  prizeDescription?: string | null;
  timer?: number;
  resultMode?: string;
}

export async function recoverActiveGames(client: Client): Promise<void> {
  try {
    console.log('🔄 Checking for incomplete games after restart...');
    
    const incompleteGames = await getIncompleteGames();
    
    if (incompleteGames.length === 0) {
      console.log('✅ No incomplete games found');
      return;
    }

    console.log(`📋 Found ${incompleteGames.length} incomplete game(s)`);

    for (const game of incompleteGames) {
      try {
        await recoverGame(client, game);
      } catch (error) {
        console.error(`❌ Failed to recover game ${game.id}:`, error);
        
        // Cancel games that can't be recovered
        await cancelFailedGame(game.id);
      }
    }

    console.log(`✅ Game recovery completed`);

  } catch (error) {
    console.error('Error during game recovery:', error);
  }
}

async function recoverGame(client: Client, game: any): Promise<void> {
  const now = new Date();
  const endsAt = new Date(game.ends_at);
  
  console.log(`\n🔄 Recovering game: ${game.id}`);
  console.log(`   Players: ${game.player1_username} vs ${game.player2_username}`);
  console.log(`   Status: ${game.status}`);
  console.log(`   Ends at: ${endsAt.toISOString()}`);

  // Check if game has already expired
  if (now >= endsAt) {
    console.log(`⏰ Game ${game.id} has expired, showing results...`);
    
    // Show results for expired game
    const config: RecoveryConfig = {
      player1: { id: game.player1_id, username: game.player1_username },
      player2: { id: game.player2_id, username: game.player2_username },
      prizeName: game.prize_name,
      prizeValue: game.prize_value,
      prizeDescription: game.prize_description,
      timer: game.timer_seconds,
      resultMode: game.result_mode,
    };

    // Try to fetch the original channel and message
    try {
      const channel = await client.channels.fetch(game.channel_id);
      
      if (channel && 'send' in channel) {
        // Send recovery notification
        await channel.send({
          content: `🔄 **Bot Restart Detected!**\nShowing results for game between <@${game.player1_id}> and <@${game.player2_id}>...`,
          embeds: [createRecoveryEmbed(game)],
        });

        // Complete the game with current choices
        if (!game.player1_choice && !game.player2_choice) {
          // Nobody chose - both lose
          await completeGame(game.id, {
            result_type: 'steal_steal',
            player1_prize_share: 0,
            player2_prize_share: 0,
          });
        } else {
          // Use calculateResults logic
          const { calculateResult } = await import('./results.ts');
          const result = calculateResult(game);
          
          await completeGame(game.id, {
            winner_id: result.winner_id || undefined,
            winner_username: result.winner_username || undefined,
            result_type: result.result_type,
            player1_prize_share: result.player1_prize_share,
            player2_prize_share: result.player2_prize_share,
          });
        }

        console.log(`✅ Expired game ${game.id} completed`);
      } else {
        // Channel not found - just mark as completed in DB
        console.warn(`⚠️ Channel ${game.channel_id} not found for game ${game.id}`);
        await cancelFailedGame(game.id);
      }
    } catch (channelError) {
      console.error(`❌ Failed to access channel for game ${game.id}:`, channelError);
      await cancelFailedGame(game.id);
    }

    return;
  }

  // Game hasn't expired yet - restart the timer
  const remainingTime = Math.max(0, endsAt.getTime() - now.getTime());
  const remainingSeconds = Math.ceil(remainingTime / 1000);

  console.log(`⏰ Restarting timer for game ${game.id}: ${remainingSeconds}s remaining`);

  // Set up new timer
  const timer = setTimeout(async () => {
    try {
      console.log(`⏰ Recovery timer ended for game: ${game.id}`);
      
      const updatedGame = await (await import('../database/operations.ts')).getGameById(game.id);
      
      if (updatedGame && updatedGame.status !== 'completed' && updatedGame.status !== 'cancelled') {
        const config: RecoveryConfig = {
          player1: { id: updatedGame.player1_id, username: updatedGame.player1_username },
          player2: { id: updatedGame.player2_id, username: updatedGame.player2_username },
          prizeName: updatedGame.prize_name,
          prizeValue: updatedGame.prize_value,
          prizeDescription: updatedGame.prize_description,
          timer: updatedGame.timer_seconds,
          resultMode: updatedGame.result_mode,
        };

        // Create a mock interaction-like object for the channel
        const channel = await client.channels.fetch(updatedGame.channel_id);
        if (channel && 'send' in channel) {
          // We need to show results but we don't have a real interaction
          // So we'll send a new message with results
          const { calculateResult } = await import('./results.ts');
          const result = calculateResult(updatedGame);
          
          await completeGame(updatedGame.id, {
            winner_id: result.winner_id || undefined,
            winner_username: result.winner_username || undefined,
            result_type: result.result_type,
            player1_prize_share: result.player1_prize_share,
            player2_prize_share: result.player2_prize_share,
          });

          await channel.send({
            content: `⏰ **Time's Up!** (Recovered after restart)\n${result.description}`,
            embeds: [createRecoveryResultEmbed(updatedGame, result)],
          });
        }
      }
    } catch (error) {
      console.error(`Error in recovery timer for game ${game.id}:`, error);
    }
  }, remainingSeconds);

  activeTimers.set(game.id, timer);

  // Notify channel about recovery
  try {
    const channel = await client.channels.fetch(game.channel_id);
    if (channel && 'send' in channel) {
      await channel.send({
        content: `🔄 **Bot Restarted!**\nThe Split & Steal game between <@${game.player1_id}> and <@${game.player2_id}> is still active!\n⏱️ **${remainingSeconds} seconds** remaining.`,
        embeds: [createRecoveryEmbed(game)],
      });
    }
  } catch (notifyError) {
    console.error(`Failed to notify about recovery for game ${game.id}:`, notifyError);
  }
}

function createRecoveryEmbed(game: any): EmbedBuilder {
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
          `• <@${game.player1_id}>\n` +
          `• <@${game.player2_id}>`,
        inline: true,
      },
      {
        name: 'Choices',
        value:
          `• P1: ${game.player1_choice ? `${game.player1_choice.toUpperCase()} ✅` : 'Not chosen ⏳'}\n` +
          `• P2: ${game.player2_choice ? `${game.player2_choice.toUpperCase()} ✅` : 'Not chosen ⏳'}`,
        inline: true,
      },
      {
        name: 'Status',
        value: `⏱️ Timer will end at <t:${Math.floor(new Date(game.ends_at).getTime() / 1000)}:R>`,
        inline: false,
      }
    )
    .setFooter({ text: 'Synx Tournaments - Auto Recovery' })
    .setTimestamp(new Date());
}

function createRecoveryResultEmbed(game: any, result: any): EmbedBuilder {
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
          `• <@${game.player1_username}>: **${result.player1_prize_share}%**\n` +
          `• <@${game.player2_username}>: **${result.player2_prize_share}%**`,
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

async function cancelFailedGame(gameId: string): Promise<void> {
  try {
    await updateGame(gameId, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    });
    console.log(`🚫 Game ${gameId} cancelled due to recovery failure`);
  } catch (error) {
    console.error(`Failed to cancel game ${gameId}:`, error);
  }
}
