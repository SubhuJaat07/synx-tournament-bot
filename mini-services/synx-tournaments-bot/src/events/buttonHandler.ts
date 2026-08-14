import { ButtonInteraction, Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getGameById, recordPlayerChoice, saveInteraction, isInteractionProcessed } from '../database/operations.ts';
import { calculateAndShowResults } from '../utils/results.ts';
import { activeTimers } from '../index.ts';

export async function handleButtonInteraction(interaction: ButtonInteraction, client: Client) {
  const customId = interaction.customId;
  
  // Parse button custom ID format: action_gameId_player (e.g., split_uuid_p1)
  const parts = customId.split('_');
  if (parts.length !== 3) {
    await interaction.reply({ content: '❌ Invalid button interaction!', ephemeral: true });
    return;
  }

  const [action, gameId, player] = parts;
  
  // Validate action
  if (!['split', 'steal'].includes(action)) {
    await interaction.reply({ content: '❌ Invalid action!', ephemeral: true });
    return;
  }

  // Defer update to prevent timeout
  await interaction.deferUpdate();

  try {
    // Save interaction to database for restart safety
    await saveInteraction({
      game_id: gameId,
      interaction_id: interaction.id,
      interaction_token: interaction.token,
      message_id: interaction.message.id,
      channel_id: interaction.channelId,
      guild_id: interaction.guildId || undefined,
      user_id: interaction.user.id,
      custom_id: customId,
    });

    // Check again if already processed (double-check for race conditions)
    const processed = await isInteractionProcessed(interaction.id);
    if (processed) {
      console.log(`⏭️  Interaction already processed: ${interaction.id}`);
      return;
    }

    // Get game from database
    const game = await getGameById(gameId);
    
    if (!game) {
      await interaction.followUp({ 
        content: '❌ **Error:** Game not found! It may have been deleted or expired.', 
        ephemeral: true 
      });
      return;
    }

    // Check if game is still active
    if (game.status === 'completed') {
      await interaction.followUp({ 
        content: '⏰ **This game has already ended!** Check the results above.', 
        ephemeral: true 
      });
      return;
    }

    if (game.status === 'cancelled') {
      await interaction.followUp({ 
        content: '🚫 **This game has been cancelled.**', 
        ephemeral: true 
      });
      return;
    }

    // Validate player
    let playerId: string;
    let playerName: string;
    let playerNum: string;

    if (player === 'p1' && interaction.user.id === game.player1_id) {
      playerId = game.player1_id;
      playerName = game.player1_username;
      playerNum = 'Player 1';
    } else if (player === 'p2' && interaction.user.id === game.player2_id) {
      playerId = game.player2_id;
      playerName = game.player2_username;
      playerNum = 'Player 2';
    } else {
      await interaction.followUp({ 
        content: `❌ **Hey <@${interaction.user.id}>**, this button is not for you!\nOnly **${player === 'p1' ? game.player1_username : game.player2_username}** can click this button.`, 
        ephemeral: true 
      });
      return;
    }

    // Check if player already chose
    const existingChoice = player === 'p1' ? game.player1_choice : game.player2_choice;
    if (existingChoice) {
      await interaction.followUp({ 
        content: `⚠️ **${playerName}**, you've already chosen **${existingChoice.toUpperCase()}**!\nYou cannot change your choice.`, 
        ephemeral: true 
      });
      return;
    }

    // Record the choice
    const choice = action as 'split' | 'steal';
    const updatedGame = await recordPlayerChoice(gameId, playerId, choice);

    if (!updatedGame) {
      await interaction.followUp({ 
        content: '❌ **Error:** Failed to record your choice. Please try again.', 
        ephemeral: true 
      });
      return;
    }

    console.log(`✅ ${playerName} chose ${choice.toUpperCase()} in game ${gameId}`);

    // Send confirmation to the player
    const emoji = choice === 'split' ? '🤝' : '💀';
    await interaction.followUp({
      content: `${emoji} **${playerName}**, you chose **${choice.toUpperCase()}**!\nYour choice has been recorded.`,
      ephemeral: true
    });

    // Update embed to show current status
    await updateGameEmbed(interaction, updatedGame);

    // Check if we should show results now
    if (updatedGame.result_mode === 'both_clicked') {
      // Show results when both players have chosen
      if (updatedGame.player1_choice && updatedGame.player2_choice) {
        console.log(`🎯 Both players chosen! Showing results for game ${gameId}`);
        
        // Clear timer if running
        if (activeTimers.has(gameId)) {
          clearTimeout(activeTimers.get(gameId));
          activeTimers.delete(gameId);
          console.log(`⏰ Cleared timer for game ${gameId} (both clicked)`);
        }

        // Get config for results
        const config = {
          player1: { id: updatedGame.player1_id, username: updatedGame.player1_username },
          player2: { id: updatedGame.player2_id, username: updatedGame.player2_username },
          prizeName: updatedGame.prize_name,
          prizeValue: updatedGame.prize_value,
          prizeDescription: updatedGame.prize_description,
          timer: updatedGame.timer_seconds,
          resultMode: updatedGame.result_mode,
        };

        await calculateAndShowResults(interaction, updatedGame, config, false);
      }
    }

    // Mark interaction as processed
    await saveInteraction({
      game_id: gameId,
      interaction_id: interaction.id,
      interaction_token: interaction.token,
      message_id: interaction.message.id,
      channel_id: interaction.channelId,
      guild_id: interaction.guildId || undefined,
      user_id: interaction.user.id,
      custom_id: customId,
    });
    // Note: We don't mark as processed here because we want to track it
    // The actual processing logic handles this

  } catch (error) {
    console.error('Error handling button interaction:', error);
    
    try {
      await interaction.followUp({
        content: '❌ **Error:** An unexpected occurred while processing your choice.',
        ephemeral: true
      });
    } catch (followUpError) {
      console.error('Failed to send error follow-up:', followUpError);
    }
  }
}

async function updateGameEmbed(interaction: ButtonInteraction, game: any) {
  try {
    const p1Status = game.player1_choice ? `✅ Chose **${game.player1_choice.toUpperCase()}**` : '⏳ Waiting...';
    const p2Status = game.player2_choice ? `✅ Chose **${game.player2_choice.toUpperCase()}**` : '⏳ Waiting...';

    const embed = new EmbedBuilder()
      .setColor(0xffaa00)
      .setTitle('🎮 Split & Steal - In Progress')
      .setDescription(
        `**Choices are being made...**\n\n` +
        `💎 **Prize:** ${game.prize_name || 'Mystery Prize'}${game.prize_value ? ` (${game.prize_value})` : ''}\n\n` +
        `---`
      )
      .addFields(
        {
          name: `👤 ${game.player1_username}`,
          value: p1Status,
          inline: true,
        },
        {
          name: `👤 ${game.player2_username}`,
          value: p2Status,
          inline: true,
        },
        {
          name: '⏳ Status',
          value: game.result_mode === 'both_clicked' 
            ? (game.player1_choice && game.player2_choice 
              ? '🎯 Both players chosen! Calculating...' 
              : '⏳ Waiting for both players...')
            : '⏱️ Timer counting down...',
          inline: false,
        }
      )
      .setFooter({ text: 'Synx Tournaments © 2024' })
      .setTimestamp(new Date());

    // Update the original message
    await interaction.message.edit({
      embeds: [embed],
      components: interaction.message.components, // Keep buttons
    });
  } catch (error) {
    console.error('Error updating game embed:', error);
  }
}
