import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { testConnection } from './database/client.ts';
import { gameCache } from './cache/gameCache.ts';
import { preloadCache, getCacheMetrics } from './cache/cacheManager.ts';
import { handleSplitStealCommand } from './commands/splitAndSteal.ts';
import { handleButtonInteraction } from './events/buttonHandler.ts';
import { recoverActiveGamesFromCache } from './utils/recovery.ts';

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
// Support multiple guilds (comma-separated)
const GUILD_IDS = process.env.GUILD_ID?.split(',').map(g => g.trim()).filter(Boolean) || [];

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN not found in environment variables');
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error('❌ CLIENT_ID not found in environment variables');
  process.exit(1);
}

// Create Discord client with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

// Store active game timers
export const activeTimers = new Map<string, NodeJS.Timeout>();

// When bot is ready - PRELOAD CACHE for <50ms response
client.once('ready', async () => {
  const startTime = performance.now();
  
  console.log(`✅ Bot logged in as ${client.user?.tag}`);
  
  // Test Supabase connection
  await testConnection();
  
  // Register slash commands
  await registerCommands();
  
  // 🔥 CRITICAL: Preload ALL data into cache from Supabase
  // This is the ONLY time we do bulk DB reads!
  const preloadResult = await preloadCache();
  
  // Recover timers for active games (uses cache, not DB!)
  await recoverActiveGamesFromCache(client);
  
  const readyTime = performance.now() - startTime;
  
  // Log cache metrics
  const metrics = getCacheMetrics();
  console.log(`📊 Cache Performance Metrics:`);
  console.log(`   • Games loaded: ${preloadResult.gamesLoaded}`);
  console.log(`   • Interactions tracked: ${preloadResult.interactionsLoaded}`);
  console.log(`   • Cache size: ${metrics.size} games`);
  console.log(`   • Memory usage: ~${metrics.estimatedMemoryKB} KB`);
  console.log(`   • Ready time: ${readyTime.toFixed(0)}ms`);
  
  console.log('\n🎮 Synx Tournaments Bot is READY! 🚀');
  console.log('   All operations now use CACHE (<1ms) instead of DB (~200ms)\n');
});

// Handle slash command interactions - OPTIMIZED with cache
client.on('interactionCreate', async (interaction) => {
  const interactStart = performance.now();
  
  try {
    // ⚡ FAST: Check cache first for dedup (0.001ms vs 200ms DB call)
    if (interaction.isChatInputCommand() || interaction.isButton()) {
      if (gameCache.hasInteraction(interaction.id)) {
        console.log(`⏭️  Skipping cached interaction: ${interaction.id}`);
        return;
      }
    }

    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'splitandsteal':
          await handleSplitStealCommand(interaction);
          break;
        case 'synx-help':
          await handleHelpCommand(interaction);
          break;
        default:
          await interaction.reply({ 
            content: 'Unknown command! Use `/synx-help` for available commands.', 
            ephemeral: true 
          });
      }
    }

    if (interaction.isButton()) {
      await handleButtonInteraction(interaction, client);
    }
    
    // Log slow operations (>50ms)
    const duration = performance.now() - interactStart;
    if (duration > 50) {
      console.warn(`⚠️  Slow interaction (${duration.toFixed(0)}ms): ${interaction.id}`);
    }
    
  } catch (error) {
    console.error('Error handling interaction:', error);
    
    // Try to reply to user if possible
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ 
          content: '❌ An error occurred while processing your request.', 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: '❌ An error occurred while processing your request.', 
          ephemeral: true 
        });
      }
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
});

// Register slash commands
async function registerCommands() {
  const commands = [
    {
      name: 'splitandsteal',
      description: 'Start a Split & Steal game between two players!',
      options: [
        {
          name: 'player1',
          description: 'First player to participate',
          type: 6, // USER type
          required: true,
        },
        {
          name: 'player2',
          description: 'Second player to participate',
          type: 6, // USER type
          required: true,
        },
        {
          name: 'prize_name',
          description: 'Name of the prize (e.g., "Nitro", "Cash", "Role")',
          type: 3, // STRING type
          required: false,
        },
        {
          name: 'prize_value',
          description: 'Value of the prize (e.g., "₹1000", "1 Month", "Premium")',
          type: 3, // STRING type
          required: false,
        },
        {
          name: 'prize_description',
          description: 'Additional details about the prize',
          type: 3, // STRING type
          required: false,
        },
        {
          name: 'timer',
          description: 'Timer duration (e.g., 30s, 2m, 1h, 1d). Default: 60s',
          type: 3, // STRING type (for flexible formats!)
          required: false,
        },
        {
          name: 'result_mode',
          description: 'When to show results',
          type: 3, // STRING type
          required: false,
          choices: [
            { name: '🕐 After Timer Ends', value: 'timer_end' },
            { name: '⚡ When Both Click', value: 'both_clicked' },
          ],
        },
      ],
    },
    {
      name: 'synx-help',
      description: 'Show help and available commands for Synx Tournaments',
    },
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('📝 Registering slash commands...');
    
    if (GUILD_IDS.length > 0) {
      // Register for multiple guilds (comma-separated support)
      for (const guildId of GUILD_IDS) {
        await rest.put(
          Routes.applicationGuildCommands(CLIENT_ID, guildId),
          { body: commands }
        );
        console.log(`✅ Commands registered for guild: ${guildId}`);
      }
    } else {
      // Global commands
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );
      console.log('✅ Global commands registered');
    }
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// Help command handler (SHORT version!)
async function handleHelpCommand(interaction: any) {
  const helpEmbed = {
    color: 0x00ff88,
    title: '🎮 Synx Tournaments',
    description: '**Split & Steal** Tournament Bot\n\n`/splitandsteal @player1 @player2 [timer: 60s]`\n\n✅ Both Split → 50-50\n❌ Both SteAL → 0-0\n🏆 One Steals → Takes ALL!',
    footer: { text: 'Timer formats: 30s, 2m, 1h, 1d | No limits!' },
  };

  await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
}

// Login to Discord
client.login(TOKEN);

// Graceful shutdown - sync cache before exit
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Clear all active timers
  for (const [gameId, timer] of activeTimers) {
    clearTimeout(timer);
    console.log(`⏰ Cleared timer for game: ${gameId}`);
  }
  activeTimers.clear();
  
  // Final stats
  const finalMetrics = getCacheMetrics();
  console.log('\n📊 Final Cache Stats:');
  console.log(`   Total games handled: ${finalMetrics.totalOps}`);
  console.log(`   Cache hit rate: ${finalMetrics.hitRate}`);
  
  // Clear cache
  gameCache.clear();
  
  client.destroy();
  console.log('👋 Bot disconnected');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
