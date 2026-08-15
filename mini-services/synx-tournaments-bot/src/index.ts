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
const GUILD_ID = process.env.GUILD_ID;

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

    if (interaction.isButtonInteraction()) {
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
          description: 'Timer duration in seconds (default: 60)',
          type: 4, // INTEGER type
          required: false,
          min_value: 10,
          max_value: 300,
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
    
    if (GUILD_ID) {
      // Guild-specific commands (faster updates during development)
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Commands registered for guild: ${GUILD_ID}`);
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

// Help command handler
async function handleHelpCommand(interaction: any) {
  const helpEmbed = {
    color: 0x00ff88,
    title: '🎮 Synx Tournaments - Help',
    description: 'Welcome to **Split & Steal** game bot! Here are the available commands:',
    fields: [
      {
        name: '`/splitandsteal`',
        value: 'Start a new Split & Steal game\n**Required:** Player 1, Player 2\n**Optional:** Prize Name, Value, Description, Timer (10-300s), Result Mode',
        inline: false,
      },
      {
        name: '🎯 How to Play',
        value: '1. Use `/splitandsteal` with two players\n2. Each player chooses **SPLIT** or **STEAL**\n3. Results depend on both choices:\n   • ✅ Both SPLIT → 50-50 split!\n   • ❌ Both STEAL → Nobody wins!\n   • 🏆 One Splits, one Steals → Stealer takes ALL!',
        inline: false,
      },
      {
        name: '⏱️ Timer Modes',
        value: '**After Timer Ends:** Results shown when timer expires\n**When Both Click:** Results shown as soon as both players choose',
        inline: false,
      },
      {
        name: '💡 Tips',
        value: '• Trust your opponent... or don\'t!\n• The choice is yours: cooperate or betray\n• Games are saved even if bot restarts!',
        inline: false,
      },
    ],
    footer: {
      text: 'Synx Tournaments © 2024 | Made with ❤️',
    },
    timestamp: new Date().toISOString(),
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
