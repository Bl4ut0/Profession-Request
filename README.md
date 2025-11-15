# Profession-Request

A professional Discord bot for managing World of Warcraft profession requests within your guild. Built with Discord.js v14, featuring multi-profession support, hierarchical permissions, and flexible interaction modes.

> **📖 Looking for something specific?**
> - **Setting up the bot?** → See [Quick Start](#-quick-start) below
> - **Developer/Architecture docs?** → See [gemini.md](gemini.md)
> - **AI automation rules?** → See [AI-PROMPT.md](AI-PROMPT.md)
> - **Detailed technical docs?** → See [docs/](docs/) folder

---

## 🎯 Features

### For Guild Members
- **👤 Character Registration** - Register your main and alternate characters
- **📝 Request Submission** - Intuitive multi-step flow for submitting profession requests
- **📊 Status Tracking** - View your pending and completed requests
- **💬 Flexible Interactions** - Bot works in DMs or dedicated channels

### For Profession Masters
- **🎯 Request Management** - Claim, complete, or release requests
- **🔄 Multi-Profession Support** - Seamless switching between professions
- **📦 Material Tracking** - Track provided materials with quantities
- **🎮 Easy Controls** - Interactive menus and buttons

### For Administrators
- **🔐 Hierarchical Permissions** - Officers automatically inherit profession permissions
- **🧹 Smart Cleanup** - Automatic message cleanup prevents clutter
- **💾 Database Backups** - Automatic periodic backups with configurable retention
- **⚡ High Performance** - In-memory profession caching (800x faster)

---

## 🚀 Quick Start

### Prerequisites
- Node.js v16.9.0 or higher
- Discord bot application with bot token
- Discord server with Developer Mode enabled

### Dependencies
The bot uses the following npm packages (automatically installed with `npm install`):
- **discord.js** v14.19.2 - Discord API wrapper
- **sqlite** v5.1.1 & **sqlite3** v5.1.7 - Database storage
- **dotenv** v16.5.0 - Environment variable management
- **date-fns** v4.1.0 - Date/time utilities
- **puppeteer** v24.30.0 - Web automation (for advanced features)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Bl4ut0/Profession-Request.git
   cd Profession-Request
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure the bot**
   - Copy `config/config.js.example` to `config/config.js`
   - Fill in your Discord IDs (guild, roles, channels)
   - Update `enabledProfessions` and `roles.professions` as needed

4. **Set up environment**
   - Create a `.env` file in the root directory
   - Add your bot token:
     ```env
     DISCORD_BOT_TOKEN=your_bot_token_here
     ```

5. **Start the bot**
   ```bash
   node index.js
   ```

---

---

## 🎮 Bot Commands

### For Everyone
- **`/register`** - Register your characters with the bot
- **`/request`** - Submit a new profession request  
  Follow the interactive prompts to select your character, profession, and item
- **`/status`** - View your pending and completed requests  
  Track all your requests and their current status

### For Profession Masters
- **`/requests`** - Manage profession requests  
  Claim, complete, or release requests for your profession(s)

---

## ⚙️ Configuration

### Interaction Modes

**DM Mode** (Recommended)
- All interactions happen in user DMs
- Minimal permissions required
- Cleaner server experience
- Set `requestMode: "dm"` in config

**Channel Mode**
- Creates temporary channels for each user
- Better for guild-wide visibility
- Requires "Manage Channels" permission
- Set `requestMode: "channel"` in config

### Required Permissions

**DM Mode (Minimum):**
- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Messages

**Channel Mode (Additional):**
- All DM mode permissions
- Manage Channels (for temporary channel creation)

### Invite Links

**DM Mode (Recommended):**
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_CLIENT_ID&permissions=93184&scope=bot%20applications.commands
```

**Channel Mode:**
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_CLIENT_ID&permissions=93200&scope=bot%20applications.commands
```

Replace `YOUR_BOT_CLIENT_ID` with your bot's application ID from the Discord Developer Portal.

---

## 🔐 Permission System

The bot uses a hierarchical role system where higher roles automatically inherit lower permissions:

```
Admin/Officer → Profession Masters → Registered Users
```

**Role Setup:**
1. **Admin/Officer Role** - Full access to all bot features
2. **Profession Roles** (e.g., Enchanter, Tailor) - Can manage requests for their profession
3. **Register Role** - Can register characters and submit requests

**Key Features:**
- Officers don't need profession roles - they automatically have access
- Profession masters don't need the register role - they automatically have access
- Simple role assignment for your guild members

---

## 🛠️ Adding New Professions

Want to add Alchemy, Blacksmithing, or other professions?

1. Create a JSON file in `config/` directory (e.g., `alchemy.json`)
2. Structure your data by categories and items:
   ```json
   {
     "Consumables": {
       "Health Potion": {
         "name": "Health Potion",
         "materials": "Crystal Vial, Peacebloom"
       }
     }
   }
   ```
3. Add profession to `enabledProfessions` in `config/config.js`
4. Create a Discord role for the profession
5. Add the role ID to `roles.professions` in config
6. Restart the bot

**Currently Supported:**
- ⚔️ Enchanting (Classic WoW enchants)
- 🧵 Tailoring (Classic WoW recipes)

For detailed format guidelines, see the developer documentation.

---

## 🐛 Troubleshooting

### Bot won't start
- Check `.env` file has valid bot token
- Verify all required Discord IDs in `config/config.js`
- Ensure role IDs are strings (e.g., `"1234567890"` not `1234567890`)

### Commands not showing in Discord
- Ensure bot has `applications.commands` scope
- Wait 1-2 minutes for commands to register globally
- Try kicking and re-inviting the bot

### Permission errors
- Verify user has required role (check role hierarchy)
- Confirm role IDs are correct strings in config
- Check bot has required permissions in channel

### Database issues
- Check `data/` folder has write permissions
- Review `logs/bot.log` for error details
- Database backups are in `data/backups/`

---

## 📖 Documentation

### For Users
- **Setup Guide** - See the [Installation](#-quick-start) section above
- **Command Usage** - See the [Commands](#-bot-commands) section
- **Troubleshooting** - See the [Troubleshooting](#-troubleshooting) section

### For Developers
- **[gemini.md](gemini.md)** - Comprehensive developer & architecture reference
- **[AI-PROMPT.md](AI-PROMPT.md)** - AI automation rules and guidelines
- **[docs/](docs/)** - Detailed technical documentation
  - Flow architecture and patterns
  - Database schema
  - Development standards
  - Historical fixes and improvements

---

## 🤝 Contributing

Contributions are welcome! For development guidelines:

1. Read **[gemini.md](gemini.md)** for architecture overview
2. Review **[docs/FLOW_STANDARDS.md](docs/FLOW_STANDARDS.md)** for coding patterns
3. Test in both DM and channel modes
4. Update documentation for new features

---

## 📜 License

This project is licensed under the MIT License.

---

## 🙏 Acknowledgments

Built for the Wolves Guild with ❤️

Special thanks to:
- Discord.js community for excellent documentation
- Classic WoW community for profession data

---

## 📞 Support

- **Issues:** Submit via GitHub Issues
- **Documentation:** See [docs/](docs/) folder for detailed guides
- **Logs:** Check `logs/bot.log` for error details
