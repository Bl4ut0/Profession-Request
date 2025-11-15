# Flow Architecture Documentation

## Overview

This document defines the unified interaction flow pattern used throughout the request-wolves bot. All flows must follow this pattern to ensure consistency, maintainability, and correct behavior across different configuration modes.

---

## Unified Flow Pattern

### Standard Pattern: 4-Step Process

Every user-triggered flow must follow this exact pattern:

```
1. Command/Button Triggered
        ↓
2. Resolve Response Channel
   (respects config.requestMode)
        ↓
3. Send All Interactive Content
   (components, embeds, messages)
   to resolved channel
        ↓
4. Reply to Interaction
   (only with confirmation/navigation)
```

### In Code

```javascript
async function handleSomeFlow(interaction, client) {
  // STEP 1: (implicit - function already called)
  
  // STEP 2: Resolve channel based on configuration
  const channel = await resolveResponseChannel(interaction, client);
  
  // Optional: Schedule cleanup if in channel mode
  if (config.requestMode === 'channel') {
    cleanupService.scheduleChannelDeletion(channel);
  }
  
  // STEP 3: Send all interactive content to the channel
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('action_id')
      .setLabel('Action')
      .setStyle(ButtonStyle.Primary)
  );
  
  await channel.send({
    content: 'Your interactive content here',
    components: [row],
  });
  
  // STEP 4: Reply to interaction with ONLY a confirmation message
  const followUp = config.requestMode === 'dm'
    ? '✅ I\'ve sent you a DM—please check your direct messages.'
    : `✅ Continue in <#${channel.id}>.`;
  
  await interaction.reply({
    content: followUp,
    ephemeral: true,
  });
}
```

---

## Configuration Modes

### DM Mode: `config.requestMode === 'dm'`

- `resolveResponseChannel()` returns user's DM channel
- All interactive content sent to DM
- Reply: "✅ I've sent you a DM—please check your direct messages."
- Messages auto-cleanup after `config.tempChannelTTL`

### Channel Mode: `config.requestMode === 'channel'`

- `resolveResponseChannel()` creates temporary guild channel
- All interactive content sent to channel
- Reply: "✅ Continue in <#channel_id>."
- Channel scheduled for auto-deletion via `cleanupService`

---

## Advanced: Hierarchical Menu Tracking

**For menu-based navigation flows only** (Character Management, Manage Requests, Admin)

The Hierarchical Menu Tracking System enables **persistent anchor menus** during navigation:

### 5 Hierarchy Levels
- **Level 0**: Primary DM menu (global)
- **Level 1**: Flow header ("Manage Requests")
- **Level 2**: Anchor menu (profession menu) - **Always visible**
- **Level 3**: Submenus (action dropdowns) - Cleaned when switching
- **Level 4**: Output (results) - Cleaned when refreshing

### Core Pattern
```javascript
// Entry: Clear hierarchy and establish anchor
cleanupService.clearMenuHierarchy(userId);
cleanupService.trackMenuMessage(userId, 2, menuMsg.id); // Anchor

// Submenu: Clean Level 3+, keep anchor
await cleanupService.cleanupFromLevel(userId, client, 3);
cleanupService.trackMenuMessage(userId, 3, submenuMsg.id);

// Output: Clean Level 4+, keep anchor and submenu
await cleanupService.cleanupFromLevel(userId, client, 4);
cleanupService.trackMenuMessage(userId, 4, resultMsg.id);
```

### When to Use
✅ Menu navigation with persistent context  
✅ Toggling between views (Master/Per Character)  
✅ Multi-level navigation (profession → action → result)  

❌ Linear flows (request submission)  
❌ Simple status displays  

**Full Documentation**: [22-HIERARCHICAL_MENU_SYSTEM.md](22-HIERARCHICAL_MENU_SYSTEM.md)

---

## Pattern Variations

### Variation 1: Direct Modals
- Show modals inline (don't need full 4-step)
- Direct reply acceptable after modal submission
- Channel content comes AFTER modal

### Variation 2: State Machine Updates
- Use `interaction.update()` to prevent message spam
- All updates stay in same message
- Prevents duplicate dropdowns

### Variation 3: Direct Ephemeral Status
- Error messages with no recovery path
- Permission checks
- Read-only status checks
- Never use for interactive content

### Variation 4: Final Confirmation
- Update after multi-step flow completes
- Disable further interaction (`components: []`)
- Schedule cleanup after update

---

## Decision Matrix

| Scenario | Pattern | Resolves | Example |
|----------|---------|----------|---------|
| Main menu | Direct | No | Character management |
| Multi-step dropdowns | Standard + V2 | Yes | Request flow |
| Simple error | V3 | No | Permission denied |
| Modal step | V1 | No | Character name |
| Final confirmation | V4 | Yes | Request saved |
| Read-only status | Standard | Yes | Status command |

---

## Common Mistakes to Avoid

### ❌ Mistake 1: Mixing Channels
```javascript
// WRONG
const channel = await resolveResponseChannel(interaction, client);
await channel.send({ content: 'Part 1' });
await interaction.channel.send({ content: 'Part 2' });  // Different channel!
```

### ❌ Mistake 2: Interactive Content in Ephemeral
```javascript
// WRONG
await interaction.reply({
  content: 'Select:',
  components: [dropdown],
  ephemeral: true,
});
```

### ❌ Mistake 3: Ignoring config.requestMode
```javascript
// WRONG - Always ephemeral, doesn't respect preference
await interaction.reply({ content: 'Checking...', ephemeral: true });
```

### ❌ Mistake 4: Not Scheduling Cleanup
```javascript
// WRONG - Forgot channel cleanup!
const channel = await resolveResponseChannel(interaction, client);
if (config.requestMode === 'channel') {
  // Missing: cleanupService.scheduleChannelDeletion(channel);
}
```

### ❌ Mistake 5: Inline Dropdowns
```javascript
// WRONG - Works initially, fails after DM ephemeral timeout
await interaction.reply({
  content: 'Pick one:',
  components: [dropdown],
  ephemeral: false,
});
```

---

## Testing Checklist

For each new flow, verify:

- [ ] Works in DM mode
- [ ] Works in channel mode  
- [ ] Config.requestMode respected
- [ ] Ephemeral flags correct
- [ ] Channel cleanup scheduled (channel mode)
- [ ] Multi-step flows use same channel/DM
- [ ] State machine works correctly
- [ ] Final confirmation appears
- [ ] Permission errors handled
- [ ] Timeout errors handled

---

## Migration Guide

### Old Pattern
```javascript
await interaction.reply({
  content: 'Select:',
  components: [dropdown],
});
```

### New Pattern
```javascript
const channel = await resolveResponseChannel(interaction, client);
if (config.requestMode === 'channel') {
  cleanupService.scheduleChannelDeletion(channel);
}

await channel.send({
  content: 'Select:',
  components: [dropdown],
});

const followUp = config.requestMode === 'dm'
  ? '✅ I\'ve sent you a DM—please check your direct messages.'
  : `✅ Continue in <#${channel.id}>.`;

await interaction.reply({
  content: followUp,
  ephemeral: true,
});
```

---

## Summary

**The Rule:** Every user-triggered flow with interactive components must:

1. **Resolve** a channel based on config
2. **Send** all interactive content to that channel
3. **Reply** to the interaction with ONLY a navigation message
4. **Cleanup** the channel (if in channel mode)

**The Exception:** Direct error messages and final confirmations can reply directly, but never with interactive components.

**The Test:** "Would this work the same in DM mode and channel mode?" If not, it's wrong.

---

For full details and code examples, see the complete documentation at the end of this folder.
