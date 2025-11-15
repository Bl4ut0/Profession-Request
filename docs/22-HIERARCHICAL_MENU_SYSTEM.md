# Hierarchical Menu Tracking System

**Document Version**: 1.0  
**Date**: November 14, 2025  
**Scope**: Menu-based navigation flows with persistent anchors  
**Status**: ✅ IMPLEMENTED - Character Management, Manage Requests (Crafter), Admin Flows

---

## 🎯 Overview

The Hierarchical Menu Tracking System is an extension of the cleanup service that enables **persistent anchor menus** during navigation. Instead of cleaning all messages on every action, it selectively cleans based on menu hierarchy levels.

### Problem Solved

**Before**: Switching between material views (Master/Per Character) cleared ALL menus, requiring users to start over.

**After**: Switching views keeps header and profession menu visible—only output content is cleaned.

### Key Benefit

Users can navigate freely through submenus while keeping their main navigation context visible, creating a **persistent menu experience**.

---

## 📊 Hierarchy Levels

The system uses **5 distinct levels** (0-4) to organize messages:

| Level | Name | Description | Example | Persistence |
|-------|------|-------------|---------|-------------|
| **0** | Primary | Main DM menu | Primary DM menu with all actions | Persists across all flows |
| **1** | Header | Flow entry point | "Manage Requests" header | Persists during flow |
| **2** | Anchor | Main navigation menu | Profession menu with buttons | **ANCHOR** - Always visible |
| **3** | Submenu | Action dropdowns/prompts | "Select request to claim" | Cleaned when switching actions |
| **4** | Output | Results/data display | Material lists, confirmation messages | Cleaned when refreshing |

### Visual Hierarchy

```
┌─────────────────────────────────────────┐
│  Level 0: Primary DM Menu               │  ← Always present (global)
└─────────────────────────────────────────┘

    ┌─────────────────────────────────────┐
    │  Level 1: Flow Header               │  ← Persists during flow
    │  "📋 Manage Requests"                │
    └─────────────────────────────────────┘
    
        ┌─────────────────────────────────┐
        │  Level 2: ANCHOR MENU           │  ← ALWAYS VISIBLE
        │  "# Enchanting Menu"             │
        │  [View My Work] [Claim] [etc.]   │
        └─────────────────────────────────┘
        
            ┌─────────────────────────────┐
            │  Level 3: Submenu           │  ← Cleaned on action change
            │  "Select request to claim:" │
            │  [Dropdown: 1, 2, 3...]      │
            └─────────────────────────────┘
            
                ┌─────────────────────────┐
                │  Level 4: Output        │  ← Cleaned on refresh
                │  "Materials Required:"   │
                │  • Nexus Crystal x4      │
                │  • Large Brilliant x8    │
                └─────────────────────────┘
```

---

## 🔧 Core Functions

### `trackMenuMessage(userId, level, messageId)`

**Purpose**: Records a message at a specific hierarchy level.

**Parameters**:
- `userId` (string): Discord user ID
- `level` (number): Hierarchy level (0-4)
- `messageId` (string): Discord message ID

**Usage**:
```javascript
const msg = await channel.send({ content: 'Profession menu' });
cleanupService.trackMenuMessage(userId, 2, msg.id); // Track at Level 2 (anchor)
```

**When to Use**:
- After sending any menu message that should persist
- Immediately after `channel.send()` or `interaction.reply()` returns

---

### `cleanupFromLevel(userId, client, fromLevel)`

**Purpose**: Deletes all messages at `fromLevel` and deeper (higher numbers).

**Parameters**:
- `userId` (string): Discord user ID
- `client` (Discord.Client): Bot client instance
- `fromLevel` (number): Starting level to clean (inclusive)

**Usage**:
```javascript
// Clean Level 3+ (keep header and anchor menu)
await cleanupService.cleanupFromLevel(userId, client, 3);
```

**Effect Examples**:
- `cleanupFromLevel(userId, client, 3)` → Deletes Level 3 and Level 4 messages (keeps 0-2)
- `cleanupFromLevel(userId, client, 4)` → Deletes only Level 4 messages (keeps 0-3)
- `cleanupFromLevel(userId, client, 2)` → Deletes Level 2, 3, 4 (keeps 0-1)

**When to Use**:
- **At function entry** for submenu handlers (clean Level 3+)
- **Before showing results** for output handlers (clean Level 4+)

---

### `clearMenuHierarchy(userId)`

**Purpose**: Clears ALL hierarchy tracking for a user (fresh start).

**Usage**:
```javascript
// User starts new flow - reset everything
cleanupService.clearMenuHierarchy(userId);
```

**When to Use**:
- At flow entry points (main menu handlers)
- When user switches to completely different flow
- **NOT** for submenu navigation (use `cleanupFromLevel` instead)

---

### `clearAllTracking()`

**Purpose**: Clears ALL tracking data for ALL users (bot restart).

**Usage**:
```javascript
// In index.js startup
const { clearAllTracking } = require('./utils/cleanupService');
clearAllTracking(); // Clear in-memory tracking on restart
```

**When to Use**:
- Bot startup/restart (already implemented in `index.js`)
- Never needed in flow handlers

---

## 🎨 Implementation Patterns

### Pattern 1: Flow Entry Point (Main Handler)

**When**: User enters the main flow (e.g., clicks "Manage Requests")

**Goal**: Clear hierarchy and establish header + anchor menu

```javascript
async function handleManageRequestsMain(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // STEP 1: Clear hierarchy (fresh start)
  cleanupService.clearMenuHierarchy(userId);
  
  // STEP 2: Send header (Level 1)
  const headerMsg = await channel.send({
    content: '📋 **Manage Requests**\n\nSelect your action below:'
  });
  cleanupService.trackMenuMessage(userId, 1, headerMsg.id);
  
  // STEP 3: Send profession menu (Level 2 - ANCHOR)
  const menuMsg = await channel.send({
    content: '# Enchanting Menu',
    components: [buttons]
  });
  cleanupService.trackMenuMessage(userId, 2, menuMsg.id);
  
  // STEP 4: Reply to interaction
  await interaction.reply({ content: 'Menu ready!', ephemeral: true });
}
```

**Key Points**:
- `clearMenuHierarchy()` at entry ensures clean slate
- Header tracked at Level 1
- Anchor menu tracked at Level 2
- **No cleanup needed** - establishing new hierarchy

---

### Pattern 2: Submenu Action (e.g., View My Work)

**When**: User clicks button for submenu (still keeps anchor visible)

**Goal**: Clean previous submenu content, show new submenu

```javascript
async function handleViewMyWork(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // STEP 1: Clean Level 3+ (keep header and anchor menu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  
  // STEP 2: Show submenu content (Level 3)
  const submenuMsg = await channel.send({
    content: '📋 **My Claimed Requests**\n\n1. Request A\n2. Request B',
    components: [actionButtons]
  });
  cleanupService.trackMenuMessage(userId, 3, submenuMsg.id);
  
  // STEP 3: Acknowledge interaction
  await interaction.deferUpdate();
}
```

**Key Points**:
- `cleanupFromLevel(3)` removes old submenu/output
- Anchor menu (Level 2) **stays visible**
- New submenu tracked at Level 3

---

### Pattern 3: Dropdown Selection (Show Results)

**When**: User selects from dropdown (e.g., claims a request)

**Goal**: Clean old results, show new results

```javascript
async function handleClaimRequest(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // STEP 1: Clean Level 3+ (remove old dropdown + results)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  
  // STEP 2: Show dropdown (Level 3)
  const dropdownMsg = await channel.send({
    content: 'Select request to claim:',
    components: [dropdown]
  });
  cleanupService.trackMenuMessage(userId, 3, dropdownMsg.id);
  
  await interaction.deferUpdate();
}

async function handleClaimDropdownSelection(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // STEP 1: Clean Level 4+ (keep dropdown visible)
  await cleanupService.cleanupFromLevel(userId, client, 4);
  
  // STEP 2: Show result (Level 4)
  const resultMsg = await channel.send({
    content: '✅ Request claimed successfully!'
  });
  cleanupService.trackMenuMessage(userId, 4, resultMsg.id);
  
  // STEP 3: Clean Level 3+ after delay (return to anchor menu)
  setTimeout(async () => {
    await cleanupService.cleanupFromLevel(userId, client, 3);
  }, 5000);
  
  await interaction.deferUpdate();
}
```

**Key Points**:
- First handler cleans Level 3+, shows dropdown at Level 3
- Selection handler cleans Level 4+, shows result at Level 4
- After delay, cleans Level 3+ (removes dropdown and result)
- Anchor menu (Level 2) **always visible**

---

### Pattern 4: Output Display with Refresh (Material Lists)

**When**: User toggles between views (Master/Per Character)

**Goal**: Keep menus visible, only refresh output

```javascript
async function handleMaterialLists(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // STEP 1: Clean Level 3+ (prepare for submenu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  
  // STEP 2: Show toggle menu (Level 3)
  const toggleMsg = await channel.send({
    content: '📦 **Material Lists**',
    components: [toggleButtons] // [Master View] [Per Character]
  });
  cleanupService.trackMenuMessage(userId, 3, toggleMsg.id);
  
  await interaction.deferUpdate();
}

async function handleMaterialsMaster(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // STEP 1: Clean Level 4+ (keep toggle menu visible)
  await cleanupService.cleanupFromLevel(userId, client, 4);
  
  // STEP 2: Show master view data (Level 4)
  const dataMsg = await channel.send({
    content: '🔧 **Master Material List**\n• Nexus Crystal x12\n• Large Brilliant x20'
  });
  cleanupService.trackMenuMessage(userId, 4, dataMsg.id);
  
  await interaction.deferUpdate();
}

async function handleMaterialsPerChar(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // STEP 1: Clean Level 4+ (keep toggle menu visible)
  await cleanupService.cleanupFromLevel(userId, client, 4);
  
  // STEP 2: Show per-character data (Level 4)
  const dataMsg = await channel.send({
    content: '👤 **Per Character**\nCharA: Nexus x4\nCharB: Nexus x8'
  });
  cleanupService.trackMenuMessage(userId, 4, dataMsg.id);
  
  await interaction.deferUpdate();
}
```

**Key Points**:
- Material Lists menu tracked at Level 3
- Each view (Master/Per Character) cleans Level 4+ **only**
- Toggle menu **stays visible** when switching views
- Profession menu (Level 2) and header (Level 1) also persist

---

### Pattern 5: Change Profession (Reset Anchor)

**When**: User clicks "Change Profession" button

**Goal**: Keep header, replace anchor menu

```javascript
async function handleChangeProfession(interaction, client) {
  const userId = interaction.user.id;
  
  // STEP 1: Clean Level 2+ (remove anchor and everything below)
  await cleanupService.cleanupFromLevel(userId, client, 2);
  
  // STEP 2: Show profession selector (tracked at Level 2 by showProfessionSelector)
  await interaction.reply({ content: 'Showing profession selector...', ephemeral: true });
  await showProfessionSelector(interaction, client);
}

async function showProfessionSelector(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Send selector menu
  const selectorMsg = await channel.send({
    content: 'Select profession:',
    components: [dropdown]
  });
  
  // Track at Level 2 (new anchor)
  cleanupService.trackMenuMessage(userId, 2, selectorMsg.id);
}
```

**Key Points**:
- `cleanupFromLevel(2)` removes old profession menu and submenus
- Header (Level 1) **persists**
- New profession menu tracked at Level 2 (new anchor)

---

## 🎯 Level Selection Guide

### How to Choose the Right Level

| Scenario | Level | Rationale |
|----------|-------|-----------|
| **Primary DM menu** | 0 | Global navigation, never cleaned |
| **Flow header ("Manage Requests")** | 1 | Establishes flow context |
| **Main action menu (profession menu)** | 2 | **ANCHOR** - visible during all actions |
| **Action dropdowns (Claim, Complete)** | 3 | Submenu - cleaned when switching actions |
| **Results/confirmations** | 4 | Output - cleaned when refreshing |

### Decision Tree

```
Is this the primary DM menu with all bot commands?
├─ Yes → Level 0
└─ No ↓

Is this the flow entry header/title?
├─ Yes → Level 1
└─ No ↓

Is this the main navigation menu users return to?
├─ Yes → Level 2 (ANCHOR)
└─ No ↓

Is this an action selection (dropdown/buttons)?
├─ Yes → Level 3 (Submenu)
└─ No ↓

Is this output/results/confirmation?
└─ Yes → Level 4 (Output)
```

---

## ✅ Implementation Checklist

When implementing hierarchical tracking in a new flow:

### Initial Setup
- [ ] Import cleanupService functions
- [ ] Identify hierarchy levels for your flow
- [ ] Map each handler to a level

### Entry Point Handler
- [ ] Call `clearMenuHierarchy(userId)` at flow entry
- [ ] Track header at Level 1 (if applicable)
- [ ] Track anchor menu at Level 2

### Submenu Handlers
- [ ] Call `cleanupFromLevel(userId, client, 3)` at handler entry
- [ ] Track submenu content at Level 3
- [ ] Use `interaction.deferUpdate()` or `interaction.reply()` appropriately

### Output Handlers
- [ ] Call `cleanupFromLevel(userId, client, 4)` before showing output
- [ ] Track output at Level 4
- [ ] Consider cleanup delay for confirmations (5 seconds typical)

### Navigation Handlers
- [ ] "Back to menu" handlers: `cleanupFromLevel(3)` (clear submenus)
- [ ] "Change context" handlers: `cleanupFromLevel(2)` (reset anchor)

### Testing
- [ ] Test navigation between submenus (anchor persists?)
- [ ] Test output refresh (toggle views - menus persist?)
- [ ] Test "Change Profession" (header persists, anchor resets?)
- [ ] Test flow exit and re-entry (clean slate?)

---

## 🔍 Debugging

### Common Issues

**Issue**: Menus disappearing when they shouldn't

**Cause**: Cleaning too aggressively (wrong level)

**Fix**: Use higher level number (e.g., `cleanupFromLevel(4)` instead of `cleanupFromLevel(3)`)

---

**Issue**: Old messages not cleaning

**Cause**: Not tracking messages or wrong level

**Fix**: Ensure `trackMenuMessage()` called after every `channel.send()`

---

**Issue**: Messages cleaning on bot restart

**Cause**: In-memory tracking lost

**Fix**: Already handled by `clearAllTracking()` in `index.js` - this is expected behavior

---

### Debugging Commands

```javascript
// Check what's tracked for a user
const userHierarchy = cleanupService.menuHierarchy.get(userId);
console.log('Tracked levels:', Array.from(userHierarchy.keys()));

// Check messages at specific level
const level3Messages = userHierarchy.get(3);
console.log('Level 3 messages:', level3Messages);
```

---

## 📚 Related Documentation

- **[FLOW_STANDARDS.md](FLOW_STANDARDS.md)** - Unified 4-step pattern (base architecture)
- **[02-FLOW_ARCHITECTURE.md](02-FLOW_ARCHITECTURE.md)** - Quick reference for flow patterns
- **[17-FLOW_MESSAGE_CLEANUP.md](17-FLOW_MESSAGE_CLEANUP.md)** - Flow-based cleanup system (different approach)

---

## 🎓 Real-World Example: Complete Flow

Here's a complete example showing all patterns in one flow:

```javascript
// Entry point - clear hierarchy, establish header + anchor
async function handleManageRequestsMain(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  cleanupService.clearMenuHierarchy(userId); // Fresh start
  
  const headerMsg = await channel.send({
    content: '📋 **Manage Requests**'
  });
  cleanupService.trackMenuMessage(userId, 1, headerMsg.id);
  
  const professionMsg = await channel.send({
    content: '# Enchanting Menu',
    components: [buttons]
  });
  cleanupService.trackMenuMessage(userId, 2, professionMsg.id);
  
  await interaction.reply({ content: 'Ready!', ephemeral: true });
}

// Submenu action - clean Level 3+, show submenu
async function handleClaimRequest(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  await cleanupService.cleanupFromLevel(userId, client, 3);
  
  const dropdownMsg = await channel.send({
    content: 'Select request:',
    components: [dropdown]
  });
  cleanupService.trackMenuMessage(userId, 3, dropdownMsg.id);
  
  await interaction.deferUpdate();
}

// Output display - clean Level 4+, show results
async function handleClaimSelection(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  await cleanupService.cleanupFromLevel(userId, client, 4);
  
  const resultMsg = await channel.send({
    content: '✅ Claimed!'
  });
  cleanupService.trackMenuMessage(userId, 4, resultMsg.id);
  
  // Clean submenu after delay
  setTimeout(async () => {
    await cleanupService.cleanupFromLevel(userId, client, 3);
  }, 5000);
  
  await interaction.deferUpdate();
}

// Material toggle - clean Level 4+, keep toggle menu
async function handleMaterialsMaster(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  await cleanupService.cleanupFromLevel(userId, client, 4);
  
  const dataMsg = await channel.send({
    content: '🔧 Master List\n• Item x5'
  });
  cleanupService.trackMenuMessage(userId, 4, dataMsg.id);
  
  await interaction.deferUpdate();
}
```

**Result**: 
- Header and profession menu **always visible**
- Submenus clean when switching actions
- Output refreshes without clearing menus
- Smooth, persistent navigation experience

---

**End of Document**
