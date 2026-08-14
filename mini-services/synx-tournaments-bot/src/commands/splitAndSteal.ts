import { 
  ChatInputCommandInteraction, 
  User, 
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} from 'discord.js';
import { createGame, getActiveGameInChannel } from '../database/operations.ts';
import { v4 as uuidv4 } from 'uuid';
import { activeTimers } from '../index.ts';

interface GameConfig {
  player1: User;
  player2: User;
  prizeName?: string | null;
  prizeValue?: string | null;
  prizeDescription?: string | null;
  timer?: number | null;
  resultMode?: string | null;
}

export async function handleSplitStealCommand(interaction: ChatInputCommandInteraction) {
  // Defer reply to give time for processing
  await interaction.deferReply();

  try {
    // Extract command options
    const config: GameConfig = {
      player1: interaction.options.getUser('player1', true),
      player2: interaction.options.getUser('player2', true),
      prizeName: interaction.options.getString('prize_name'),
      prizeValue: interaction.options.getString('prize_value'),
      prizeDescription: interaction.options.getString('prize_description'),
      timer: interaction.options.getInteger('timer'),
      resultMode: interaction.options.getString('result_mode'),
    };

    // Validate players are different
    if (config.player1.id === config.player2.id) {
      await interaction.editReply({
        content: '❌ **Error:** Both players must be different users!',
      });
      return;
    }

    // Check for existing active game in channel
    const existingGame = await getActiveGameInChannel(interaction.channelId);
    if (existingGame) {
      await interaction.editReply({
        content: `❌ **Error:** There's already an active game in this channel!\nPlease wait for it to complete or cancel it.`,
      });
      return;
    }

    // Set default values
    const timerSeconds = config.timer || parseInt(process.env.DEFAULT_TIMER_SECONDS || '60');
    const resultMode = (config.resultMode as 'timer_end' | 'both_clicked') || 'timer_end';

    // Generate unique game ID
    const gameId = uuidv4();

    // Create initial embed message
    const embed = createGameEmbed(config, timerSeconds, resultMode);

    // Create buttons for both players
    const actionRow = createActionRow(gameId);

    // Send the game message
    const message = await interaction.editReply({
      content: '🎮 **Split & Steal** game started!',
      embeds: [embed],
      components: [actionRow],
    });

    // Save game to database
    const gameData = await createGame({
      id: gameId,
      channel_id: interaction.channelId,
      message_id: message.id,
      player1_id: config.player1.id,
      player1_username: `${config.player1.username}`,
      player2_id: config.player2.id,
      player2_username: `${config.player2.username}`,
      prize_name: config.prizeName || undefined,
      prize_value: config.prizeValue || undefined,
      prize_description: config.prizeDescription || undefined,
      timer_seconds: timerSeconds,
      started_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + timerSeconds * 1000).toISOString(),
      result_mode: resultMode,
      status: 'in_progress',
      created_by: interaction.user.id,
      guild_id: interaction.guildId || undefined,
    });

    if (!gameData) {
      await interaction.editReply({
        content: '❌ **Error:** Failed to create game. Please try again.',
        components: [],
      });
      return;
    }

    console.log(`✅ Game created: ${gameId}`);
    console.log(`   Players: ${config.player1.username} vs ${config.player2.username}`);
    console.log(`   Timer: ${timerSeconds}s | Mode: ${resultMode}`);

    // Start the timer
    startGameTimer(gameId, interaction, config, timerSeconds, resultMode);

  } catch (error) {
    console.error('Error in splitandsteal command:', error);
    
    try {
      await interaction.editReply({
        content: '❌ **Error:** An unexpected error occurred. Please try again.',
      });
    } catch (editError) {
      console.error('Failed to edit reply:', editError);
    }
  }
}

function createGameEmbed(config: GameConfig, timerSeconds: number, resultMode: string): EmbedBuilder {
  const prizeInfo = config.prizeName 
    ? `\n💎 **Prize:** ${config.prizeName}${config.prizeValue ? ` (${config.prizeValue})` : ''}`
    : '';
  
  const prizeDesc = config.prizeDescription 
    ? `\n📝 ${config.prizeDescription}`
    : '';

  const modeText = resultMode === 'both_clicked' 
    ? '⚡ Results when both players choose'
    : '🕐 Results after timer ends';

  return new EmbedBuilder()
    .setColor(0x00ff88)
    .setTitle('🎮 Split & Steal Tournament')
    .setDescription(
      `**Choose your fate!**${prizeInfo}${prizeDesc}\n\n` +
      `⏱️ **Timer:** ${timerSeconds} seconds\n` +
      `${modeText}\n\n` +
      `---\n\n` +
      `👤 **Player 1:** <@${config.player1.id}>\n` +
      `👤 **Player 2:** <@${config.player2.id}>`
    )
    .addFields(
      {
        name: '📖 How it Works',
        value: 
          '• ✅ **Both SPLIT** → Prize split **50-50**\n' +
          '• ❌ **Both STEAL** → **Nobody wins!**\n' +
          '• 🏆 **One Splits, One Steals** → **Stealer takes ALL!**',
        inline: false,
      },
      {
        name: '⏳ Status',
        value: '⏳ **Waiting for choices...**',
        inline: false,
      }
    )
    .setFooter({ text: 'Synx Tournaments © 2024' })
    .setTimestamp(new Date());
}

function createActionRow(gameId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`split_${gameId}_p1`)
        .setLabel('🤝 SPLIT')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🤝'),
      new ButtonBuilder()
        .setCustomId(`steal_${gameId}_p1`)
        .setLabel('💀 STEAL')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('💀'),
      new ButtonBuilder()
        .setCustomId(`split_${gameId}_p2`)
        .setLabel('🤝 SPLIT')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🤝'),
      new ButtonBuilder()
        .setCustomId(`steal_${gameId}_p2`)
        .setLabel('💀 STEAL')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('💀')
    );
}

async function startGameTimer(
  gameId: string,
  interaction: ChatInputCommandInteraction,
  config: GameConfig,
  timerSeconds: number,
  resultMode: string
) {
  // Clear any existing timer for this game
  if (activeTimers.has(gameId)) {
    clearTimeout(activeTimers.get(gameId));
  }

  // Only set timer if mode is 'timer_end'
  if (resultMode !== 'timer_end') {
    console.log(`⏸️  No auto-timer for game ${gameId} (mode: ${resultMode})`);
    return;
  }

  const timer = setTimeout(async () => {
    try {
      console.log(`⏰ Timer ended for game: ${gameId}`);
      
      // Import here to avoid circular dependency
      const { getGameById, completeGame } = await import('../database/operations.ts');
      const { calculateAndShowResults } = await import('../utils/results.ts');
      
      const game = await getGameById(gameId);
      
      if (!game || game.status === 'completed' || game.status === 'cancelled') {
        console.log(`Game ${gameId} already completed or cancelled, skipping...`);
        return;
      }

      // Show results (handle cases where one or both didn't choose)
      await calculateAndShowResults(interaction, game, config, true);
      
    } catch (error) {
      console.error('Error in timer callback:', error);
    }
  }, timerSeconds * 1000);

  activeTimers.set(gameId, timer);
  console.log(`⏰ Timer started for game ${gameId}: ${timerSeconds}s`);
}
