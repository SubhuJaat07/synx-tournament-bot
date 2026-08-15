import { 
  ChatInputCommandInteraction, 
  User, 
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} from 'discord.js';
import { gameCache, CachedGame } from '../cache/gameCache.ts';
import { createGameInCacheAndDb } from '../cache/cacheManager.ts';
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

    // Send the game message (PING PLAYERS OUTSIDE EMBED!)
    const message = await interaction.editReply({
      content: `🎮 **Split & Steal** started! <@${config.player1.id}> vs <@${config.player2.id}>\n👆 **Your turn! Choose SPLIT or STEAL!**`,
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
