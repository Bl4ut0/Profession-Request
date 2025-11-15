# Request Wolves Bot - Documentation

Welcome to the **Request Wolves Bot** documentation! This Discord bot manages profession request workflows for World of Warcraft guilds.

---

## 🚀 Quick Start

### For New Users
1. **Project Overview** → Read `../gemini.md` (AI tool reference)
2. **Setup Guide** → Follow setup instructions below
3. **Documentation Index** → Browse `INDEX.md` for all guides

### For Developers
1. **Flow Standards** → Read `FLOW_STANDARDS.md` (MUST READ)
2. **Quick Reference** → Check `QUICK_REFERENCE.md` (2-min cheat sheet)
3. **Flow Architecture** → Reference `02-FLOW_ARCHITECTURE.md`

---

## 📦 Installation

### Prerequisites
- Node.js v16.9.0 or higher
- Discord bot application with bot token
- Discord server with Developer Mode enabled

### Setup Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/request-wolves-bot.git
   cd request-wolves-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure the bot**
   - Copy `config/config.js.example` to `config/config.js`
   - Fill in your Discord IDs (guild, roles, channels, categories)
   - Get IDs by right-clicking in Discord (requires Developer Mode)

4. **Set up environment variables**
   - Create a `.env` file in the root directory
   - Add your bot token:
     ```
     DISCORD_BOT_TOKEN=your_bot_token_here
     ```

5. **Start the bot**
   ```bash
   node index.js
   ```

---

## 🎯 Features

- **Character Registration** - Users register main and alt characters
- **Request Submission** - Multi-step flow for submitting profession requests
- **Request Management** - Profession masters claim, complete, or release requests
- **Status Tracking** - Users view their pending and completed requests
- **Multi-Profession Support** - Users can switch between multiple professions
- **DM or Channel Mode** - Flexible interaction modes
- **Hierarchical Permissions** - Officers inherit profession permissions
- **Material Tracking** - Track provided materials with quantity
- **Automatic Cleanup** - Smart message cleanup prevents clutter
- **Database Backups** - Automatic periodic backups with retention

---

## 📚 Documentation Structure

| Document | Description |
|----------|-------------|
| `INDEX.md` | Complete documentation navigation guide |
| `FLOW_STANDARDS.md` | Authoritative flow development standards (MUST READ) |
| `QUICK_REFERENCE.md` | 2-minute cheat sheet for developers |
| `02-FLOW_ARCHITECTURE.md` | Flow patterns quick reference |
| `04-BUG_FIX_CRITICAL.md` | Critical bug fixes documentation |
| `05-ENV_SETUP_FIXES.md` | Environment and deprecation fixes |
| `06-IMPROVEMENTS_PHASE1.md` | Code improvements applied |
| `07-DEPRECATION_STRATEGY.md` | Discord.js v15/v16 compatibility |
| `10-REDUNDANCY_ANALYSIS.md` | Root cause analysis of flow issues |
| `11-FLOW_UNIFICATION_COMPLETE.md` | Flow unification project |
| `13-MATERIAL_FLOW_IMPLEMENTATION.md` | Material tracking system |
| `16-PROFESSION_LOADER_SYSTEM.md` | Profession caching (800x faster) |
| `17-FLOW_MESSAGE_CLEANUP.md` | Message cleanup system |
| `19-MULTI_PROFESSION_SYSTEM.md` | Multi-profession support |
| `22-HIERARCHICAL_MENU_SYSTEM.md` | Menu navigation system |
| `PROFESSION_DATA_FORMAT.md` | Guide for profession JSON files |
| `CLEANUP_DECISION_GUIDE.md` | Cleanup system decision tree |

See `INDEX.md` for complete list and navigation.

---

## 🛠️ Configuration

### Required Discord IDs

You'll need to configure these in `config/config.js`:

- **Guild ID** - Your Discord server ID
- **Category ID** - Category where request channels live
- **Channel ID** - Main requests channel (or set to null to auto-create)
- **Role IDs** - Admin, profession, and register roles

### Configuration Modes

**DM Mode** (`requestMode: "dm"`)
- All interactions happen in user DMs
- Minimal permissions required
- Cleaner server channels

**Channel Mode** (`requestMode: "channel"`)
- Creates temporary channels for each request
- Better for tracking in guild
- Requires "Manage Channels" permission

---

## 🔐 Permissions

### DM Mode (Minimal)
- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Messages

### Channel Mode
- All DM mode permissions
- Manage Channels (for temp channel creation)

---

## 🎮 Commands

- `/register` - Register your characters with the bot
- `/request` - Submit a new profession request
- `/status` - View your pending and completed requests
- `/requests` - (Profession masters) Manage profession requests

---

## 📖 Development

### Creating New Flows
1. Read `FLOW_STANDARDS.md` (authoritative guide)
2. Choose your pattern type (Simple/Multi-Step/Modal)
3. Follow the 4-step unified pattern
4. Test with both DM and channel modes
5. Implement cleanup scheduling

### Adding New Professions
1. Create profession JSON file in `config/` (e.g., `alchemy.json`)
2. Follow format in `PROFESSION_DATA_FORMAT.md`
3. Add profession to `enabledProfessions` in config
4. Add role to `roles.professions` in config
5. Restart bot to load new profession

---

## 📊 Project Status

**Version:** 1.0  
**Status:** Production Ready  
**Last Updated:** November 14, 2025

### Recent Updates
- ✅ Hierarchical permission system
- ✅ Multi-profession support with switching
- ✅ Material tracking system
- ✅ Profession caching (800x performance improvement)
- ✅ Smart message cleanup
- ✅ Automatic database backups
- ✅ Documentation cleanup for GitHub release

---

## 🐛 Troubleshooting

### Bot won't start
- Check `.env` file has valid bot token
- Verify all required IDs in `config/config.js`
- Check console for error messages

### Commands not showing
- Ensure bot has `applications.commands` scope
- Wait 1-2 minutes for commands to register
- Try kicking and re-inviting the bot

### Permission errors
- Verify role IDs are strings (e.g., `"1234567890"`)
- Check user has required roles
- Review hierarchical permission system (officers inherit permissions)

See `INDEX.md` FAQ section for more help.

---

## 📞 Support

- Review `logs/bot.log` for error details
- Check relevant documentation in this folder
- All common patterns documented in `02-FLOW_ARCHITECTURE.md`
- Common mistakes in `FLOW_STANDARDS.md` Part 7

---

## 📜 License

This project is licensed under the MIT License.

---

**For complete documentation navigation, see `INDEX.md` in this folder.**
