#!/bin/bash

# Synx Tournaments Bot - Setup Script
# This script helps you set up the bot with GitHub and Supabase

set -e

echo "🎮 Synx Tournaments - Split & Steal Bot Setup"
echo "================================================"
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install git first."
    exit 1
fi

# Check if gh CLI is installed (for GitHub operations)
if command -v gh &> /dev/null; then
    echo "✅ GitHub CLI found"
    
    # Ask if user wants to create a new repo
    read -p "📦 Create a new GitHub repository? (y/n): " create_repo
    
    if [ "$create_repo" = "y" ] || [ "$create_repo" = "Y" ]; then
        echo ""
        echo "Creating GitHub repository 'Synx-tournaments'..."
        
        # Initialize git if needed
        if [ ! -d ".git" ]; then
            git init
            echo "✅ Git repository initialized"
        fi
        
        # Create repo on GitHub
        gh repo create Synx-tournaments \
            --public \
            --description "🎮 Discord bot for Split & Steal tournament games" \
            --source=. \
            --push
        
        echo ""
        echo "✅ Repository created: https://github.com/$(gh auth status --hostname github.com 2>&1 | grep 'Logged in to' | awk '{print $4}')/Synx-tournaments"
    fi
else
    echo "⚠️  GitHub CLI not found. You can install it from: https://cli.github.com/"
    echo "   Or manually create a repo at: https://github.com/new"
fi

echo ""
echo "🔧 Next Steps:"
echo "==============="
echo ""
echo "1️⃣  Set up Supabase:"
echo "   • Go to https://supabase.com and create a free project"
echo "   • Copy database/schema.sql content to SQL Editor"
echo "   • Run the SQL to create tables"
echo "   • Get your Project URL and Anon Key from Settings → API"
echo ""
echo "2️⃣  Set up Discord Bot:"
echo "   • Go to https://discord.com/developers/applications"
echo "   • Create a new application"
echo "   • Go to 'Bot' section and copy the token"
echo "   • Enable Message Content Intent under Privileged Gateway Intents"
echo "   • Go to OAuth2 → URL Generator"
echo "   • Select scopes: bot, applications.commands"
echo "   • Select permissions: Send Messages, Use Slash Commands, Embed Links, Add Reactions"
echo "   • Copy the invite link and invite your bot to server"
echo ""
echo "3️⃣  Configure Environment:"
echo "   cp .env.example .env"
echo "   # Edit .env with your credentials"
echo ""
echo "4️⃣  Install Dependencies:"
echo "   bun install"
echo ""
echo "5️⃣  Run the Bot:"
echo "   bun run dev"
echo ""
echo "📖 For detailed instructions, see README.md"
echo ""
echo "🎉 Setup complete! Happy gaming!"
