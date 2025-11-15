# AI Automation Rules & Guidelines

**⭐ AI Tool Reference: Core rules and guidelines for automated development on this project**

## 🚫 PRIMARY RULES FOR AI TOOLS

### Testing & Execution Policy

**❌ DO NOT:**
- Create test scripts or test loaders (e.g., `test-*.js` files)
- Run any `.js` files in the terminal
- Execute `node` commands
- Run the bot with `node index.js`
- Attempt to validate code by running it

**✅ HUMAN CHECKPOINT:**
- All application testing is performed by the human developer
- Code validation happens through human testing, not AI execution
- AI tools should focus on code implementation and documentation
- Trust that the human will test and report issues

### Why This Policy Exists
1. **Separation of Concerns**: AI implements, humans validate
2. **Efficient Workflow**: Reduces unnecessary back-and-forth
3. **Real-World Testing**: Humans test with actual Discord bot interactions
4. **Clear Feedback Loop**: Issues reported by humans are more actionable

---

## 📚 Documentation Structure

**All project documentation is organized in the `docs/` folder.**

### Root Directory Policy
- ✅ `package.json` - Dependencies and scripts
- ✅ `index.js` - Bot entry point
- ✅ `.env` - Environment variables (gitignored)
- ✅ `.gitignore` - Git configuration
- ✅ `README.md` - User-facing project overview
- ✅ `gemini.md` - Developer/architecture reference
- ✅ `AI-PROMPT.md` - This file (AI automation rules)
- ✅ `backups/` - Versioned backups directory

### Documentation Directory (`docs/`)
**ALL `.md` documentation files go here:**

**Required Reading:**
1. **[docs/FLOW_STANDARDS.md](docs/FLOW_STANDARDS.md)** - **AUTHORITATIVE** - Unified flow architecture standards (ALL NEW MODULES MUST FOLLOW)
2. **[docs/23-CLEANUP_FLOW_PROTOCOL.md](docs/23-CLEANUP_FLOW_PROTOCOL.md)** - **MANDATORY** - Cleanup flow protocol enforcement
3. **[docs/02-FLOW_ARCHITECTURE.md](docs/02-FLOW_ARCHITECTURE.md)** - Quick reference for flow patterns
4. **[docs/22-HIERARCHICAL_MENU_SYSTEM.md](docs/22-HIERARCHICAL_MENU_SYSTEM.md)** - Menu navigation patterns

**Other Documentation:**
- **[docs/INDEX.md](docs/INDEX.md)** - Complete documentation navigation
- **[docs/PROFESSION_DATA_FORMAT.md](docs/PROFESSION_DATA_FORMAT.md)** - Guide for adding professions
- **[docs/QUICK_REFERENCE.md](docs/QUICK_REFERENCE.md)** - 2-minute developer cheat sheet

**See [docs/INDEX.md](docs/INDEX.md) for the complete documentation index.**

---

## 🏗️ Architecture Standards

### Unified 4-Step Flow Pattern

All flows **MUST** follow this pattern:

1. **Resolve Response Channel** - Respects `requestMode` configuration (DM or channel)
2. **Send Interactive Content** - Sends all menus/dropdowns to response channel
3. **Reply with Navigation** - Guides user to interaction location
4. **Schedule Cleanup** - Automatic cleanup in channel mode

**Reference:** `docs/FLOW_STANDARDS.md` for detailed implementation

### 5-Level Menu Hierarchy

Menu-based flows use hierarchical tracking:

- **Level 0**: Persistent anchor menu (never cleaned)
- **Level 1**: Primary action menus
- **Level 2**: Sub-menus and selectors
- **Level 3**: Detail views and forms
- **Level 4**: Confirmation messages

**Reference:** `docs/22-HIERARCHICAL_MENU_SYSTEM.md` for implementation

---

## 🔧 Development Guidelines

### Configuration Management

**ALL configuration values MUST be in `config/config.js`**

**❌ Never hardcode:**
- Timeouts or delays
- Discord API limits
- User feedback timings
- Role IDs or channel IDs

**✅ Always reference:**
```javascript
const config = require('../config/config.js');
// Use config.timing.*, config.discord.*, etc.
```

### Database Operations

**Use provided database utilities:**
```javascript
const db = require('../utils/database.js');

// Character operations
await db.getUserCharacters(userId);
await db.saveCharacter(userId, characterData);

// Request operations
await db.saveRequest(requestData);
await db.getUserRequests(userId);
await db.claimRequest(requestId, claimerId);

// Session management
await db.saveSession(userId, sessionData);
await db.getSession(userId);
```

### Logging Standards

**Use the logging utility, not console.log:**
```javascript
const log = require('../utils/logWriter.js');

log.info('Operation completed', { userId, action });
log.debug('Debug details', { sessionData });
log.warn('Warning condition', { issue });
log.error('Error occurred', { error: err.message });
```

### Cleanup Management

**Use cleanupService for message cleanup:**
```javascript
const { scheduleCleanup, cleanupFlowMessages } = require('../utils/cleanupService.js');

// Schedule channel cleanup
await scheduleCleanup(channelId, userId);

// Clean previous flow messages
await cleanupFlowMessages(interaction, levelToClearFrom);
```

---

## 📦 Adding New Features

### Adding a New Slash Command

1. Create file in `commands/` directory
2. Export object with `data` (SlashCommandBuilder) and `execute` function
3. Follow 4-step flow pattern
4. Add to command registration in `index.js`
5. Document in `docs/`

### Adding a New Profession

1. Create JSON file in `config/` (e.g., `alchemy.json`)
2. Follow format in `docs/PROFESSION_DATA_FORMAT.md`
3. Add to `enabledProfessions` in `config/config.js`
4. Add profession role to `roles.professions` in config
5. Restart bot (profession loader will cache it)

### Adding a New Flow Handler

1. Create file in `interactions/shared/`
2. Follow unified 4-step pattern from `docs/FLOW_STANDARDS.md`
3. Implement hierarchical cleanup if menu-based
4. Add route to `interactions/interactionRouter.js`
5. Test in both DM and channel modes

---

## ✅ Pre-Implementation Checklist

Before implementing any new feature:

- [ ] Read relevant documentation in `docs/`
- [ ] Understand the 4-step flow pattern
- [ ] Check if similar functionality exists (avoid duplication)
- [ ] Plan hierarchical menu levels (if applicable)
- [ ] Identify configuration requirements
- [ ] Plan database schema changes (if needed)
- [ ] Consider both DM and channel modes

---

## 🐛 Debugging Guidelines

### When Issues Are Reported

1. **Read the logs**: Check `logs/bot.log` for error details
2. **Check configuration**: Verify `config/config.js` settings
3. **Verify database**: Check data integrity in SQLite
4. **Review flow pattern**: Ensure 4-step pattern is followed
5. **Test both modes**: DM and channel modes may behave differently

### Common Issues

**Commands not appearing:**
- Command registration may take 1-2 minutes
- Check bot has `applications.commands` scope
- Verify command structure follows Discord.js v14 format

**Permission errors:**
- Check role IDs are strings, not numbers
- Verify hierarchical permissions in `permissionChecks.js`
- Ensure bot has required permissions in channel

**Interaction timeouts:**
- Always defer complex interactions immediately
- Use `.deferReply()` or `.deferUpdate()` within 3 seconds
- Follow up with `.editReply()` or `.followUp()`

---

## 🔄 Backup Strategy

Before making significant code changes:

1. Create versioned backup in `backups/` directory
2. Use format: `vN_description_YYYY-MM-DD_HHMMSS/`
3. Copy all files that will be modified
4. Maintain directory structure in backup
5. Add backup to `.gitignore` (already configured)

Example:
```
backups/v6_new-feature-name_2025-11-15_123456/
```

---

## 📖 Quick Reference Links

- **Flow Standards**: `docs/FLOW_STANDARDS.md` (authoritative)
- **Menu Hierarchy**: `docs/22-HIERARCHICAL_MENU_SYSTEM.md`
- **Cleanup Protocol**: `docs/23-CLEANUP_FLOW_PROTOCOL.md`
- **Architecture Patterns**: `docs/02-FLOW_ARCHITECTURE.md`
- **Profession Format**: `docs/PROFESSION_DATA_FORMAT.md`
- **Complete Index**: `docs/INDEX.md`

---

**Last Updated:** November 15, 2025
