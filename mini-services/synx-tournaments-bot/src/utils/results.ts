import { ButtonInteraction, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Game, completeGame, updateGame } from '../database/operations.ts';

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

export function calculateResult(game: Game): GameResult {
  const p1Choice = game.player1_choice;
  const p2Choice = game.player2_choice;

  // Handle case where one or both players didn't choose (timer expired)
  if (!p1Choice && !p2Choice) {
    return {
      winner_id: null,
      winner_username: null,
      result_type: 'steal_steal', // Treat as both "lost"
      player1_prize_share: 0,
      player2_prize_share: 0,
      description: '⏰ **Time Up!** Neither player made a choice in time.',
      emoji: '⏰',
    };
  }

  if (!p1Choice && p2Choice) {
    // P1 didn't choose, P2 chose
    if (p2Choice === 'steal') {
      return {
        winner_id: game.player2_id,
        winner_username: game.player2_username,
        result_type: 'split_steal',
        player1_prize_share: 0,
        player2_prize_share: 100,
        description: `🏆 <@${game.player2_username}> wins by default! <@${game.player1_username}> didn't respond in time.`,
        emoji: '🏆',
      };
    } else {
      return {
        winner_id: null,
        winner_username: null,
        result_type: 'split_split',
        player1_prize_share: 50,
        player2_prize_share: 50,
        description: `⚖️ **Fair Split!** <@${game.player2_username}> chose to SPLIT, but <@${game.player1_username}> didn't respond.`,
        emoji: '⚖️',
      };
    }
  }

  if (p1Choice && !p2Choice) {
    // P1 chose, P2 didn't choose
    if (p1Choice === 'steal') {
      return {
        winner_id: game.player1_id,
        winner_username: game.player1_username,
        result_type: 'steal_split',
        player1_prize_share: 100,
        player2_prize_share: 0,
        description: `🏆 <@${game.player1_username}> wins by default! <@${game.player2_username}> didn't respond in time.`,
        emoji: '🏆',
      };
    } else {
      return {
        winner_id: null,
        winner_username: null,
        result_type: 'split_split',
        player1_prize_share: 50,
        player2_prize_share: 50,
        description: `⚖️ **Fair Split!** <@${game.player1_username}> chose to SPLIT, but <@${game.player2_username}> didn't respond.`,
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
      winner_id: game.player2_id,
      winner_username: game.player2_username,
      result_type: 'split_steal',
      player1_prize_share: 0,
      player2_prize_share: 100,
      description: `💀 <@${game.player1_username}> chose to **SPLIT**, but <@${game.player2_username}> chose to **STEAL**!\n🏆 **<@${game.player2_username}> takes everything!**`,
      emoji: '💀',
    };
  }

  // p1 steal, p2 split
  return {
    winner_id: game.player1_id,
    winner_username: game.player1_username,
    result_type: 'steal_split',
    player1_prize_share: 100,
    player2_prize_share: 0,
    description: `💀 <@${game.player2_username}> chose to **SPLIT**, but <@${game.player1_username}> chose to **STEAL**!\n🏆 **<@${game.player1_username}> takes everything!**`,
    emoji: '💀',
  };
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
    await completeGame(game.id, {
      winner_id: result.winner_id || undefined,
      winner_username: result.winner_username || undefined,
      result_type: result.result_type,
      player1_prize_share: result.player1_prize_share,
      player2_prize_share: result.player2_prize_share,
    });

    console.log(`🎮 Game ${game.id} completed with result: ${result.result_type}`);

    // Create results embed
    const embed = createResultsEmbed(game, config, result, isTimerExpiry);

    // Update the original message with results and remove buttons
    const message = interaction.isButtonInteraction() 
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
        content: createAnnouncementMessage(game, result),
      });
    }

  } catch (error) {
    console.error('Error showing results:', error);
    
    try {
      if (interaction.isButtonInteraction()) {
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

function createResultsEmbed(
  game: Game,
  config: GameConfig,
  result: GameResult,
  isTimerExpiry: boolean
): EmbedBuilder {
  const prizeText = game.prize_name 
    ? `**${game.prize_name}**${game.prize_value ? ` (${game.prize_value})` : ''}`
    : '**Mystery Prize**';

  const p1ChoiceEmoji = game.player1_choice === 'split' ? '🤝' : game.player1_choice === 'steal' ? '💀' : '❓';
  const p2ChoiceEmoji = game.player2_choice === 'split' ? '🤝' : game.player2_choice === 'steal' ? '💀' : '❓';
  
  const p1ChoiceText = game.player1_choice ? `${p1ChoiceEmoji} **${game.player1_choice.toUpperCase()}**` : '❓ **No Choice**';
  const p2ChoiceText = game.player2_choice ? `${p2ChoiceEmoji} **${game.player2_choice.toUpperCase()}**` : '❓ **No Choice**';

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
        name: `👤 ${game.player1_username}'s Choice`,
        value: p1ChoiceText,
        inline: true,
      },
      {
        name: `👤 ${game.player2_username}'s Choice`,
        value: p2ChoiceText,
        inline: true,
      },
      {
        name: '📊 Prize Distribution',
        value: 
          `• <@${game.player1_username}>: **${result.player1_prize_share}%**\n` +
          `• <@${game.player2_username}>: **${result.player2_prize_share}%**`,
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
      `• **Duration:** ${game.timer_seconds} seconds\n` +
      `• **Mode:** ${game.result_mode === 'both_clicked' ? '⚡ Both Click' : '🕐 Timer End'}\n` +
      `• **End Reason:** ${isTimerExpiry ? '⏰ Time Expired' : '🎯 All Choices Made'}`,
    inline: false,
  });

  // Add prize description if exists
  if (game.prize_description) {
    embed.addFields({
      name: '📝 Prize Details',
      value: game.prize_description,
      inline: false,
    });
  }

  embed
    .setFooter({ text: 'Synx Tournaments © 2024 | Game Complete' })
    .setTimestamp(new Date());

  return embed;
}

function createAnnouncementMessage(game: Game, result: GameResult): string {
  const prizeName = game.prize_name || 'the prize';
  
  switch (result.result_type) {
    case 'split_split':
      return (
        `🎉 **Split & Steal Result!**\n\n` +
        `✅ <@${game.player1_username}> and <@${game.player2_username}> both chose to **SPLIT**!\n` +
        `📦 **${prizeName}** has been divided equally (**50-50**) between both players!\n\n` +
        `Congratulations to both players for their cooperation! 🤝`
      );
    
    case 'steal_steal':
      return (
        `💥 **Split & Steal Result!**\n\n` +
        `❌ <@${game.player1_username}> and <@${game.player2_username}> both tried to **STEAL**!\n` +
        `😢 **Nobody wins ${prizeName}!** Both players leave empty-handed.\n\n` +
        `Next time, maybe trust each other? 💔`
      );
    
    case 'split_steal':
      return (
        `🔪 **Split & Steal Result!**\n\n` +
        `💀 <@${game.player1_username}> chose to **SPLIT**...\n` +
        `💀 But <@${game.player2_username}> chose to **STEAL**!\n\n` +
        `🏆 **<@${game.player2_username}> takes all of ${prizeName}!**\n\n` +
        `A brutal betrayal! Better luck next time, <@${game.player1_username}>...`
      );
    
    case 'steal_split':
      return (
        `🔪 **Split & Steal Result!**\n\n` +
        `💀 <@${game.player2_username}> chose to **SPLIT**...\n` +
        `💀 But <@${game.player1_username}> chose to **STEAL**!\n\n` +
        `🏆 **<@${game.player1_username}> takes all of ${prizeName}!**\n\n` +
        `A brutal betrayal! Better luck next time, <@${game.player2_username}>...`
      );
    
    default:
      return `🎮 **Split & Steal game completed!** Check above for results.`;
  }
}
