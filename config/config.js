// config/config.js
// For detailed documentation, see: docs/FLOW_STANDARDS.md and docs/17-FLOW_MESSAGE_CLEANUP.md

module.exports = {
  // ========================================
  // DISCORD SERVER CONFIGURATION
  // ========================================
  
  // Your Discord Server ID (Guild ID)
  // Where: Right-click server icon → Copy Server ID (requires Developer Mode enabled)
  guildId: "1367398107314389055",
  
  // Category ID where request channels will be created (channel mode only)
  // Where: Right-click category → Copy Category ID
  requestCategoryId: "1367730167484518510",
  
  // The main requests channel ID (set to null to auto-create in channel mode)
  // Where: Right-click channel → Copy Channel ID
  requestChannelId: "1438754721434304543",
  
  // Name for the main request channel (used when creating the channel)
  requestChannelName: "requests",

  // ========================================
  // INTERACTION MODE CONFIGURATION
  // ========================================
  
  // How requests are delivered to users
  // Options: "dm" (Direct Messages) or "channel" (Temporary Channels)
  // See: docs/02-FLOW_ARCHITECTURE.md for mode comparison
  requestMode: "dm",
  
  // Show navigation messages when users trigger flows from guild channels
  // When true: Shows "I've sent you a DM" or "Continue in <#channel>" messages
  // When false: Silently handles interaction (cleaner UX)
  showNavigationMessages: false,

  // ========================================
  // MESSAGE CLEANUP CONFIGURATION
  // See: docs/17-FLOW_MESSAGE_CLEANUP.md
  // ========================================
  
  // Cleanup timeouts for different message types (in milliseconds)
  // These control automatic cleanup timing for inactive flows
  // Strategy: Submenus expire first (90s), giving user time to return to primary menu (5min)
  //           before final cleanup removes all bot messages and temp channels
  cleanupTimeouts: {
    // PRIMARY MENU: ONLY the main DM welcome menu with 4 buttons
    // Buttons: Create Request | Manage Requests | My Requests | Manage Characters
    // This is the ONLY message that gets the long timeout (5 minutes)
    // Why: After submenus clean up, users still have 3.5 minutes to interact via primary menu
    //      before complete cleanup (removes all bot DM messages or deletes temp channels)
    primaryMenu: 300000,  // 5 minutes (300000ms)
    
    // SUBMENU: ALL other menus, including Manage Requests crafter/admin menus
    // Applies to: 
    //   - Manage Requests menu (crafter profession menu, admin menu)
    //   - All dropdowns (claim, complete, release, profession selector)
    //   - All lists (my claimed requests, material lists, admin views)
    //   - All selection interfaces
    // Why: Cleans up interaction menus while keeping primary menu available
    //      Prevents channel/DM clutter from abandoned flows
    submenu: 90000,       // 90 seconds (90000ms)
    
    // COMPLETION: Final confirmation messages after state changes
    // Applies to: Request submitted, character added/removed, request claimed/completed/released
    // Why: Quick cleanup of "success" messages to keep DMs clean
    completion: 30000     // 30 seconds (30000ms)
  },
  
  // Cleanup old messages/channels on bot startup
  // DM mode: Cleans all bot messages from DMs (except main menu)
  // Channel mode: Deletes all temporary request channels
  cleanupOnStartup: true,

  // ========================================
  // DISCORD API CONFIGURATION
  // ========================================
  
  // Message fetching configuration
  messageFetchLimit: 100,           // How many messages to fetch when searching/cleaning
  messageFetchDelay: 100,           // Delay (ms) after cleanup before fetching messages
  
  // Message deletion rate limiting (prevents Discord API rate limits)
  messageDeleteDelay: 50,           // Delay (ms) between individual message deletes in DMs
  
  // Startup cleanup delays (prevents race conditions)
  startupDMCleanupDelay: 100,       // Delay (ms) between DM cleanup operations
  startupChannelCleanupDelay: 500,  // Delay (ms) between channel deletion operations
  
  // User feedback delays (how long to show confirmation messages)
  confirmationMessageDelay: 3000,   // Delay (ms) for "Request claimed/completed/released" messages
  characterConfirmationDelay: 2000, // Delay (ms) for "Character added/removed" messages
  
  // Message search limits (for finding specific recent messages)
  recentMessageSearchLimit: 10,     // How many recent messages to search when looking for flow context

  // ========================================
  // ROLE & PERMISSION CONFIGURATION
  // ========================================
  
  // Role IDs for permission checks
  // IMPORTANT: Must be strings to avoid JavaScript number precision issues
  // Where: Server Settings → Roles → Right-click role → Copy Role ID
  // Set to null to disable role-based permission checks
  
  roles: {
    // HIERARCHICAL PERMISSION SYSTEM
    // Officers inherit permissions from profession and register roles automatically
    // Hierarchy: admin > professions > register
    
    // Admin/Officer Role (HIGHEST PERMISSION)
    // - Full admin access to all request management
    // - Automatically inherits profession permissions (can claim/complete any profession)
    // - Automatically inherits register permissions (can create characters/requests)
    admin: "1367636017779048478",
    
    // Profession Roles (MIDDLE PERMISSION)
    // - Can claim/complete requests for their profession
    // - Automatically inherits register permissions (can create characters/requests)
    // - Must match profession names in enabledProfessions array
    professions: {
      enchanting: "1367635981171429446",
      tailoring: "1438803242439020584"
    },
    
    // Register Role (BASE PERMISSION)
    // - Required to use /register command and create requests
    // - Base level access
    register: "1367635913324232704",
    
    // Core Role (SPECIAL PERMISSION)
    // - Required to request guild-provided materials (Guild Craft)
    // - Allows "Guild Craft" option where guild provides all materials
    core: "1439093663434014790"  // Set to role ID to enable Core member guild crafting
  },
  
  // Legacy role accessors (for backward compatibility)
  // TODO: Update all code to use roles.register / roles.admin / roles.professions[name]
  get requiredRegisterRoleId() { return this.roles.register; },
  get adminRoleId() { return this.roles.admin; },
  get professionRoles() { return this.roles.professions; },
  get coreRoleId() { return this.roles.core; },

  // ========================================
  // PROFESSION CONFIGURATION
  // See: docs/PROFESSION_DATA_FORMAT.md
  // See: docs/19-MULTI_PROFESSION_SYSTEM.md
  // ========================================
  
  // Enabled professions (must have corresponding JSON files in config/)
  // Format: ["profession1", "profession2"]
  // Files: config/enchanting.json, config/tailoring.json, etc.
  enabledProfessions: ["enchanting", "tailoring"],
  
  // Gear slots available for requests
  // Must match slot names in profession JSON files (case-sensitive)
  // See: docs/PROFESSION_DATA_FORMAT.md for slot naming standards
  enabledGearSlots: [
    // --- Standard Gear ---
    "Head", 
    "Neck", 
    "Shoulders", 
    "Back", 
    "Chest", 
    "Wrist",
    "Hands", 
    "Waist", 
    "Legs", 
    "Feet", 
    "Ring", 
    "Trinket",
    
    // --- Weapons & Off-hands ---
    "Weapon",      // 1H Weapons / Daggers
    "2H Weapon", 
    "Shield", 
    "Off-Hand", 
    "Ranged",      // Bows, Guns, Wands

    // --- Consumables (Top Level) ---
    "Potion", 
    "Flask", 
    "Elixir", 
    "Food", 
    "Drums",

    // --- Enhancements (Unattached) ---
    "Gem",         // Cut Gems (Red, Blue, Yellow, etc.)
    "Meta Gem",    // Skyfire/Earthstorm diamonds (Alchemy transmute + JC Cut)
    "Leg Armor",   // LW/Tailoring specific patches
    "Scope",       // Engineering specific
    
    // --- Trade & Misc ---
    "Cooldown",    // Transmutes (Alch) & Cloth (Tailoring: Spellcloth, etc.)
    "Ammo",        // Arrows/Bullets (Engineering makes the best ammo)
    "Bag",         // Tailoring bags & LW Quivers/Ammo pouches
    "Bombs",       // Engineering Explosives  
    "Device"       // Jumper Cables, Repair Bots, etc.
  ],
  // ========================================
  // REQUEST DISPLAY CONFIGURATION
  // ========================================
  
  // Which request statuses are shown by default in /requests command
  // Options: "open", "claimed", "in_progress", "completed", "cancelled"
  defaultVisibleStatuses: ["open", "claimed", "in_progress"],
  
  // How many completed/cancelled requests to show in history
  // Applies to: /requests command history view
  requestHistoryLimit: 10,

  // ========================================
  // NOTIFICATION CONFIGURATION
  // ========================================
  
  // Notification settings for request status changes
  // Users receive DMs when their requests change status
  notificationSettings: {
    enabled: true,           // Master switch for all notifications
    notifyOnClaim: true,     // When a crafter claims the request
    notifyOnProgress: true,  // When status changes to "in_progress"
    notifyOnComplete: true,  // When request is marked complete
    notifyOnRelease: true,   // When crafter releases request back to open
    notifyOnCancel: true     // When admin cancels the request
  },

  // ========================================
  // DATABASE BACKUP CONFIGURATION
  // ========================================
  
  // Automatic database backup settings
  databaseBackup: {
    enabled: true,              // Master switch for automatic backups
    backupOnStartup: false,      // Create backup when bot starts
    intervalHours: 12,           // How often to create backups (in hours)
    maxBackups: 28,             // Maximum number of backups to retain (oldest deleted first)
    // Backups saved to: data/backups/guild-requests_YYYY-MM-DDTHH-MM-SS.sqlite
  },

  // ========================================
  // DEBUGGING CONFIGURATION
  // ========================================
  
  // Enable verbose console logging for development
  // When true: Logs detailed flow information, cleanup operations, database queries
  // When false: Only logs warnings and errors
  debugMode: true,

  // ========================================
  // PRIMARY MENU MESSAGE CONFIGURATION
  // ========================================
  primaryMenuMessage: `# 📌 **Welcome to the Guild Request System!**

**🔨 Manage Requests** — For crafters and admins to manage the crafting queue

Use the buttons below to interact with the bot:
• **🧵 Create New Request** — Start a new profession request
• **📋 My Requests** — Check your personal requests
• **👤 Manage Characters** — Register or manage your characters

You can also use these slash commands (server only, won't work in DM):
• **/request** — Start a new profession request
• **/status** — Check your personal requests
• **/register** — Manage your main and alt characters
• **/requests** — View all profession requests by status/profession

Please follow guild rules and have all required materials ready.`
};
