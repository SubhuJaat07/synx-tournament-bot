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

    // 🎭 Get Server Nicknames (if in guild, otherwise use username)
    let player1DisplayName = config.player1.username;
    let player2DisplayName = config.player2.username;
    
    if (interaction.guild) {
      try {
        const member1 = await interaction.guild.members.fetch(config.player1.id).catch(() => null);
        const member2 = await interaction.guild.members.fetch(config.player2.id).catch(() => null);
        
        if (member1) player1DisplayName = member1.displayName;
        if (member2) player2DisplayName = member2.displayName;
      } catch (error) {
        console.log('⚠️ Could not fetch guild members, using usernames');
      }
    }

    // Set default values (timer already parsed!)
    const timerSeconds = config.timer || 60;
    const resultMode = (config.resultMode as 'timer_end' | 'both_clicked') || 'timer_end';

    // Generate unique game ID
    const gameId = uuidv4();
    const now = new Date();

    // Create buttons for both players
    const actionRow = createActionRow(gameId);

    // ❤️ Select ONE heartbeat GIF for this ENTIRE game (consistent!)
    const heartbeatGifs = [
      'https://media.giphy.com/media/JQRfa8kPwx5xgc51jG/giphy.gif', // User's 2D heartbeat
      'https://media.giphy.com/media/ZOStzpF9H5syI/giphy.gif',      // Crush butterflies
      'https://media.giphy.com/media/6UsPdACZamjok/giphy.gif',       // Heart pulse
      'https://media.giphy.com/media/YAIOuXv2zYDW8/giphy.gif',       // Heartbeat line
      'https://media.giphy.com/media/S9E88u47Lxc3uqhsse/giphy.gif',  // Health visuals ECG
      'https://media.giphy.com/media/Oozt5b5IIWWUKJjknH/giphy.gif',   // Love heartbeat
      'https://media.giphy.com/media/oStBM1ANst52U/giphy.gif'        // Biology science art
    ];
    const selectedHeartbeatGif = heartbeatGifs[Math.floor(Math.random() * heartbeatGifs.length)];

    // 🎯 Build INITIAL embed DIRECTLY (no flicker, no edit later!)
    const minutes = Math.floor(timerSeconds / 60);
    const secs = timerSeconds % 60;
    const initialTimeDisplay = minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
    
    // Prize text
    let prizeText = '';
    if (config.prizeName || config.prizeValue) {
      prizeText = `💎 **Prize:** ${config.prizeValue || ''} ${config.prizeName || ''}`.trim();
      if (config.prizeDescription) {
        prizeText += `\n📝 *${config.prizeDescription}*`;
      }
    }

    // Player names on separate lines
    const playerLines = `👤 **${player1DisplayName}** ⏳\n👤 **${player2DisplayName}** ⏳`;

    // Build initial embed WITH GIF!
    const initialEmbed = new EmbedBuilder()
      .setColor(0xffaa00)
      .setTitle('🎮 Split & Steal - In Progress')
      .setThumbnail(selectedHeartbeatGif) // ❤️ Heartbeat from start!
      .setDescription(
        `${prizeText}${prizeText ? '\n\n' : ''}${playerLines}\n\n⏳ **${initialTimeDisplay} remaining**`
      )
      .setFooter({ text: 'Synx Tournaments' })
      .setTimestamp(new Date());

    // ✅ Send DIRECTLY with embed (NO plain text → edit flicker!)
    const message = await interaction.editReply({
      content: `🎮 **Split & Steal** <@${config.player1.id}> vs <@${config.player2.id}>`,
      embeds: [initialEmbed],
      components: [actionRow],
    });

    // ⚡ Create CachedGame object (IMMEDIATE - no DB wait) - Store nicknames!
    const cachedGame: CachedGame = {
      id: gameId,
      channelId: interaction.channelId,
      messageId: message.id,
      playerId1: config.player1.id,
      playerName1: player1DisplayName, // ✅ Nickname stored!
      playerId2: config.player2.id,
      playerName2: player2DisplayName, // ✅ Nickname stored!
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
    
    // ⏱️ Start LIVE countdown timer (updates every 1 second) - PASS BUTTONS + GIF!
    startLiveCountdown(gameId, interaction.channelId, message.id, actionRow, selectedHeartbeatGif);

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
 * ⏱️ LIVE Countdown Timer - Updates embed every 1 second with remaining time
 */
async function startLiveCountdown(
  gameId: string,
  channelId: string,
  messageId: string,
  actionRow: ActionRowBuilder<ButtonBuilder>,
  selectedHeartbeatGif: string // ❤️ Pre-selected GIF (consistent for entire game!)
) {
  // Clear any existing interval for this game
  if (activeIntervals.has(gameId)) {
    clearInterval(activeIntervals.get(gameId));
  }

  // Get client for fetching channel/message
  const { client } = await import('../index.ts');
  
  // 🚀 IMMEDIATE first update (no 1s wait!) - prevents flicker!
  const doCountdownUpdate = async () => {
    try {
      // Get game from cache
      const game = gameCache.get(gameId);
      
      if (!game || game.status === 'completed' || game.status === 'cancelled') {
        // Game ended - clear this interval
        clearInterval(activeIntervals.get(gameId));
        activeIntervals.delete(gameId);
        console.log(`⏱️ Stopped live countdown for game ${gameId} (game ended)`);
        return;
      }

      // Calculate time remaining
      const now = new Date();
      const timeRemaining = Math.max(0, Math.floor((game.endsAt.getTime() - now.getTime()) / 1000));
      
      if (timeRemaining <= 0) {
        // Time's up - clear interval (timer callback will handle results)
        clearInterval(activeIntervals.get(gameId));
        activeIntervals.delete(gameId);
        console.log(`⏱️ Stopped live countdown for game ${gameId} (time up)`);
        return;
      }

      // Format time display
      const minutes = Math.floor(timeRemaining / 60);
      const seconds = timeRemaining % 60;
      const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      
      // Get player status (secret!)
      const p1Status = game.choice1 ? '✅' : '⏳';
      const p2Status = game.choice2 ? '✅' : '⏳';
      const choiceCount = (game.choice1 ? 1 : 0) + (game.choice2 ? 1 : 0);
      
      // 🎨 ANIMATED COUNTDOWN - Color urgency changes, but SAME GIF always!
      let embedColor = 0xffaa00; // Default orange
      let timerText = `⏳ **${timeDisplay} remaining**`;
      let progressBar = '';
      
      // Color intensity based on time (NO GIF switching!)
      if (timeRemaining <= 5) {
        // 💀 Last 5s-1s - Critical red!
        embedColor = timeRemaining % 2 === 0 ? 0xff0000 : 0xaa0000;
        progressBar = `\n💀💀💀💀💀 **${timeRemaining}** 💀💀💀💀💀`;
        timerText = `⏰ **${timeDisplay}**${progressBar}`;
      } else if (timeRemaining <= 10) {
        // 🔥 Last 10s-6s - Urgent red/orange
        embedColor = timeRemaining % 2 === 0 ? 0xff0000 : 0xff3333;
        const progress = Math.floor((timeRemaining / 10) * 10);
        const filled = '🔴'.repeat(Math.ceil(progress / 2));
        const empty = '⬜'.repeat(5 - Math.ceil(progress / 2));
        progressBar = `\n${filled}${empty} **${timeRemaining}s**`;
        timerText = `🔥 **${timeDisplay} remaining**${progressBar}`;
      } else if (timeRemaining <= 30) {
        // ⚡ Last 30s-11s - Warning yellow
        embedColor = 0xffcc00;
        const progress = Math.floor((timeRemaining / 30) * 10);
        const filled = '█'.repeat(progress);
        const empty = '░'.repeat(10 - progress);
        progressBar = `\n\`${filled}${empty}\` **${timeRemaining}s**`;
        timerText = `⚡ **${timeDisplay} remaining**${progressBar}`;
      }
      
      // ❤️ Use SAME heartbeat GIF for ENTIRE countdown (no switching!)
      const thumbnailUrl = selectedHeartbeatGif;

      // 🎯 Build prize display - ONLY if prize exists, no "Mystery Prize"!
      let prizeText = '';
      if (game.prizeValue || game.prizeName) {
        prizeText = `💎 **Prize:** ${game.prizeValue || ''} ${game.prizeName || ''}`.trim();
        // Add description on next line if exists
        if (game.prizeDescription) {
          prizeText += `\n📝 *${game.prizeDescription}*`;
        }
      }

      // 👥 Player names on SEPARATE lines in description
      const playerLines = `👤 **${game.playerName1}** ${p1Status}\n👤 **${game.playerName2}** ${p2Status}`;

      // Create updated embed with live timer (timer in content, not footer!)
      // 🛡️ ERROR HANDLING: Try with GIF first, fallback without if fails
      let liveEmbed: EmbedBuilder;
      
      try {
        // ✅ Try WITH heartbeat GIF
        liveEmbed = new EmbedBuilder()
          .setColor(embedColor)
          .setTitle('🎮 Split & Steal - In Progress')
          .setThumbnail(thumbnailUrl) // ❤️ Heartbeat GIF
          .setDescription(
            `${prizeText}${prizeText ? '\n\n' : ''}${playerLines}\n\n${timerText}`.trim()
          )
          .setFooter({ text: 'Synx Tournaments' })
          .setTimestamp(new Date());
      } catch (gifError) {
        // ⚠️ GIF failed - send WITHOUT thumbnail (still works!)
        console.log(`⚠️ GIF load failed, sending plain embed:`, gifError instanceof Error ? gifError.message : 'Unknown');
        liveEmbed = new EmbedBuilder()
          .setColor(embedColor)
          .setTitle('🎮 Split & Steal - In Progress')
          .setDescription(
            `${prizeText}${prizeText ? '\n\n' : ''}${playerLines}\n\n${timerText}`.trim()
          )
          .setFooter({ text: 'Synx Tournaments' })
          .setTimestamp(new Date());
      }

      // Fetch channel and update message (KEEP BUTTONS!)
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel && channel.isTextBased()) {
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (msg) {
          await msg.edit({ 
            embeds: [liveEmbed],
            components: [actionRow] // IMPORTANT: Keep buttons visible!
          }).catch(err => 
            console.error('Failed to update live countdown:', err?.message)
          );
        }
      }
    } catch (error) {
      console.error('Error in live countdown update:', error);
    }
  };

  // 🚀 Run immediately FIRST, then set interval
  await doCountdownUpdate();
  
  const interval = setInterval(doCountdownUpdate, 1000); // Then every 1s

  activeIntervals.set(gameId, interval);
  console.log(`⏱️ Live countdown started for game ${gameId} (updates every 1s)`);
}
