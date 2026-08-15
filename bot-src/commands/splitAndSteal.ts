import { 
  ChatInputCommandInteraction, 
  User, 
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  TextChannel
} from 'discord.js';
import { gameCache, CachedGame } from '../cache/gameCache.ts';
import { createGameInCacheAndDb } from '../cache/cacheManager.ts';
import { v4 as uuidv4 } from 'uuid';
import { activeTimers, activeIntervals } from '../index.ts';

interface GameConfig {
  player1: User;
  player2: User;
  prizeName?: string | null;
  prizeValue?: string | null;
  prizeDescription?: string | null;
  timer?: number | null;
  resultMode?: string | null;
}

// Parse flexible timer format: "30s", "2m", "1h", "1d", or just seconds
function parseTimerDuration(timerStr: string | null | undefined): number {
  if (!timerStr) return 60; // Default 60 seconds
  
  const str = timerStr.trim().toLowerCase();
  
  // Match patterns like "30s", "2m", "1h", "1d"
  const match = str.match(/^(\d+)(s|m|h|d)?$/);
  
  if (!match) return 60; // Default if invalid format
  
  const value = parseInt(match[1]);
  const unit = match[2] || 's'; // Default to seconds
  
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return value;
  }
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
      timer: parseTimerDuration(interaction.options.getString('timer')),
      resultMode: interaction.options.getString('result_mode'),
    };

    // Validate players are different
    if (config.player1.id === config.player2.id) {
      await interaction.editReply({
        content: '❌ **Error:** Both players must be different users!',
      });
      return;
    }

    // ⚡ FAST: Check cache for existing active game (0.001ms vs 200ms DB call)
    const existingGame = gameCache.getByChannel(interaction.channelId);
    if (existingGame) {
      await interaction.editReply({
        content: `❌ **Error:** There's already an active game in this channel!\nPlease wait for it to complete or cancel it.`,
      });
      return;
    }

    // Set default values (timer already parsed!)
    const timerSeconds = config.timer || 60;
    const resultMode = (config.resultMode as 'timer_end' | 'both_clicked') || 'timer_end';

    // Generate unique game ID
    const gameId = uuidv4();
    const now = new Date();

    // Create initial embed message
    const embed = createGameEmbed(config, timerSeconds, resultMode);

    // Create buttons for both players
    const actionRow = createActionRow(gameId);

    // Send the game message (minimal format)
    const message = await interaction.editReply({
      content: `🎮 **Split & Steal** <@${config.player1.id}> vs <@${config.player2.id}>`,
      embeds: [embed],
      components: [actionRow],
    });

    // ⚡ Create CachedGame object (IMMEDIATE - no DB wait)
    const cachedGame: CachedGame = {
      id: gameId,
      channelId: interaction.channelId,
      messageId: message.id,
      playerId1: config.player1.id,
      playerName1: `${config.player1.username}`,
      playerId2: config.player2.id,
      playerName2: `${config.player2.username}`,
      prizeName: config.prizeName || undefined,
      prizeValue: config.prizeValue || undefined,
      prizeDescription: config.prizeDescription || undefined,
      timerSeconds: timerSeconds,
      startedAt: now,
      endsAt: new Date(now.getTime() + timerSeconds * 1000),
      resultMode: resultMode,
      status: 'in_progress',
      choiceHistory: [], // Track choice changes!
      createdBy: interaction.user.id,
      guildId: interaction.guildId || undefined,
      createdAt: now,
      updatedAt: now,
    };

    // ⚡ Write to cache IMMEDIATELY + async DB sync (non-blocking)
    await createGameInCacheAndDb(cachedGame);

    console.log(`✅ Game created: ${gameId}`);
    console.log(`   Players: ${config.player1.username} vs ${config.player2.username}`);
    console.log(`   Timer: ${timerSeconds}s | Mode: ${resultMode}`);

    // Start the timer
    startGameTimer(gameId, interaction, config, timerSeconds, resultMode);
    
    // ⏱️ Start LIVE countdown timer (updates every 4 seconds)
    startLiveCountdown(gameId, interaction.channelId, message.id);

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
    ? '⚡ Results when both choose'
    : '⏱️ Timer running...';

  return new EmbedBuilder()
    .setColor(0x00ff88)
    .setTitle('🎮 Split & Steal Tournament')
    .setDescription(
      `**Choose your fate!**${prizeInfo}${prizeDesc}\n\n` +
      `${modeText}\n\n` +
      `---\n\n` +
      `👤 **Player 1:** \`${config.player1.username}\`\n` +
      `👤 **Player 2:** \`${config.player2.username}\``
    )
    .addFields(
      {
        name: '⏳ Status',
        value: '⏳ Waiting for choices...',
        inline: false,
      }
    )
    .setFooter({ text: 'Synx Tournaments' })
    .setTimestamp(new Date());
}

function createActionRow(gameId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`split_${gameId}`)
        .setLabel('🤝 SPLIT')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`steal_${gameId}`)
        .setLabel('💀 STEAL')
        .setStyle(ButtonStyle.Danger)
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
      
      // ⚡ Get from CACHE (not DB!)
      const game = gameCache.get(gameId);
      
      if (!game || game.status === 'completed' || game.status === 'cancelled') {
        console.log(`Game ${gameId} already completed or cancelled, skipping...`);
        return;
      }

      // Import results handler
      const { calculateAndShowResultsFromCache } = await import('../utils/results.ts');
      
      // Show results (handle cases where one or both didn't choose)
      await calculateAndShowResultsFromCache(interaction, game, config, true);
      
    } catch (error) {
      console.error('Error in timer callback:', error);
    }
  }, timerSeconds * 1000);

  activeTimers.set(gameId, timer);
  console.log(`⏰ Timer started for game ${gameId}: ${timerSeconds}s`);
}

/**
 * ⏱️ LIVE Countdown Timer - Updates embed every 4 seconds with remaining time
 */
async function startLiveCountdown(
  gameId: string,
  channelId: string,
  messageId: string
) {
  // Clear any existing interval for this game
  if (activeIntervals.has(gameId)) {
    clearInterval(activeIntervals.get(gameId));
  }

  // Get client for fetching channel/message
  const { client } = await import('../index.ts');
  
  const interval = setInterval(async () => {
    try {
      // Get game from cache
      const game = gameCache.get(gameId);
      
      if (!game || game.status === 'completed' || game.status === 'cancelled') {
        // Game ended - clear this interval
        clearInterval(interval);
        activeIntervals.delete(gameId);
        console.log(`⏱️ Stopped live countdown for game ${gameId} (game ended)`);
        return;
      }

      // Calculate time remaining
      const now = new Date();
      const timeRemaining = Math.max(0, Math.floor((game.endsAt.getTime() - now.getTime()) / 1000));
      
      if (timeRemaining <= 0) {
        // Time's up - clear interval (timer callback will handle results)
        clearInterval(interval);
        activeIntervals.delete(gameId);
        console.log(`⏱️ Stopped live countdown for game ${gameId} (time up)`);
        return;
      }

      // Format time display
      const minutes = Math.floor(timeRemaining / 60);
      const seconds = timeRemaining % 60;
      const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      
      // Get player status (secret!)
      const p1Status = game.choice1 ? '✅ **Chosen!** 🤫' : '⏳ Waiting...';
      const p2Status = game.choice2 ? '✅ **Chosen!** 🤫' : '⏳ Waiting...';
      const choiceCount = (game.choice1 ? 1 : 0) + (game.choice2 ? 1 : 0);

      // Create updated embed with live timer
      const liveEmbed = new EmbedBuilder()
        .setColor(0xffaa00)
        .setTitle('🎮 Split & Steal - In Progress')
        .setDescription(
          `**Choices are being made...**\n\n` +
          `💎 **Prize:** ${game.prizeName || 'Mystery Prize'}${game.prizeValue ? ` (${game.prizeValue})` : ''}\n\n` +
          `---`
        )
        .addFields(
          {
            name: `<@${game.playerId1}>`,
            value: p1Status,
            inline: true,
          },
          {
            name: `<@${game.playerId2}>`,
            value: p2Status,
            inline: true,
          },
          {
            name: '⏱️ Time Left',
            value: `⏳ **${timeDisplay}** remaining`,
            inline: false,
          },
          {
            name: '📊 Progress',
            value: `${'🟩'.repeat(choiceCount)}${'⬜'.repeat(2 - choiceCount)} ${choiceCount}/2 chosen`,
            inline: false,
          }
        )
        .setFooter({ text: 'Synx Tournaments • Live countdown' })
        .setTimestamp(new Date());

      // Fetch channel and update message
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel && channel.isTextBased()) {
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (msg) {
          await msg.edit({ embeds: [liveEmbed] }).catch(err => 
            console.error('Failed to update live countdown:', err?.message)
          );
        }
      }
    } catch (error) {
      console.error('Error in live countdown update:', error);
    }
  }, 4000); // Update every 4 seconds

  activeIntervals.set(gameId, interval);
  console.log(`⏱️ Live countdown started for game ${gameId} (updates every 4s)`);
}
