# FLOW STANDARDS: Unified Bot Interaction Architecture

**Document Version**: 1.1  
**Date**: November 14, 2025  
**Scope**: All command flows, interaction handlers, and button/dropdown flows  
**Authority**: This is the authoritative reference for all flow development in request-wolves. All AI tools building new modules MUST follow these standards.

---

## 🎯 Golden Rule: The Unified 4-Step Pattern

**Every user-triggered flow must follow this exact pattern, no exceptions:**

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

This pattern ensures:
- ✅ Configuration is ALWAYS respected
- ✅ Consistent user experience across all flows
- ✅ Proper cleanup and resource management
- ✅ Clear message architecture
- ✅ Maintainable and testable code

**Note**: For menu-based navigation flows with persistent anchors, see **Part 4B: Hierarchical Menu Tracking** (below) and [22-HIERARCHICAL_MENU_SYSTEM.md](22-HIERARCHICAL_MENU_SYSTEM.md) for advanced cleanup patterns.

---

## Part 1: Flow Implementations

### Pattern 1: Simple Command Flow (No Dropdowns)

**Use Case**: Commands that gather data and return results without multi-step interactions.

**Examples**: `/status`, `/requests` overview

**Code Template**:

```javascript
const { SlashCommandBuilder } = require('discord.js');
const { resolveResponseChannel } = require('../utils/requestChannel');
const cleanupService = require('../utils/cleanupService');
const config = require('../config/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mycommand')
    .setDescription('Does something'),

  async execute(interaction, client) {
    try {
      // STEP 1: Collect permission/prerequisite checks
      if (!hasPrerequisites(interaction)) {
        return interaction.reply({
          content: '❌ Prerequisites not met.',
          ephemeral: true
        });
      }

      // STEP 2: Resolve response channel (MUST HAPPEN before any data is sent)
      const channel = await resolveResponseChannel(interaction, client);
      
      // Schedule cleanup IMMEDIATELY if in channel mode
      if (config.requestMode === 'channel') {
        cleanupService.scheduleChannelDeletion(channel);
      }

      // Gather data
      const data = await gatherData(interaction);

      // STEP 3: Send all interactive content to resolved channel
      await channel.send({
        content: formatData(data),
        embeds: [createEmbed(data)],
        // components if needed
      });

      // STEP 4: Reply to interaction with ONLY confirmation message
      const confirmation = config.requestMode === 'dm'
        ? '✅ I\'ve sent the data via DM—please check your direct messages.'
        : `✅ Results posted in <#${channel.id}>.`;

      await interaction.reply({
        content: confirmation,
        ephemeral: true
      });

    } catch (error) {
      log.error('Error:', error);
      await interaction.reply({
        content: '❌ An error occurred.',
        ephemeral: true
      });
    }
  }
};
```

**Key Points**:
- ✅ Prerequisite checks use ephemeral early-exit replies
- ✅ `resolveResponseChannel()` called EARLY
- ✅ Cleanup scheduled IMMEDIATELY after resolution
- ✅ All output goes to resolved channel
- ✅ Confirmation reply is ephemeral with navigation message
- ✅ Try-catch with appropriate error handling

---

### Pattern 2: Multi-Step Dropdown Flow

**Use Case**: Commands that require multiple user selections (character → profession → item, etc.).

**Examples**: `/request`, character registration

**Architecture**: 
- Command handler initiates flow
- Separate flow handler manages the multi-step process
- State machine using dropdowns and interaction.update()

**Code Template** (Command):

```javascript
// commands/mycommand.js
const { SlashCommandBuilder } = require('discord.js');
const { handleMyFlow } = require('../interactions/shared/myFlow');
const log = require('../utils/logWriter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mycommand')
    .setDescription('Multi-step flow'),

  async execute(interaction, client) {
    try {
      // Delegate to flow handler (clean separation)
      await handleMyFlow(interaction, client);
    } catch (error) {
      log.error('Error:', error);
      await interaction.reply({
        content: '❌ Error starting flow.',
        ephemeral: true
      });
    }
  }
};
```

**Code Template** (Flow Handler):

```javascript
// interactions/shared/myFlow.js
const { resolveResponseChannel } = require('../../utils/requestChannel');
const cleanupService = require('../../utils/cleanupService');
const config = require('../../config/config');
const db = require('../../utils/database');

/**
 * Main entry point for multi-step flow.
 * Follows 4-step pattern:
 * 1. Prepare (validate prerequisites)
 * 2. Resolve channel
 * 3. Send initial interactive content
 * 4. Reply with navigation
 */
async function handleMyFlow(interaction, client) {
  // STEP 1: Prerequisites
  const userId = interaction.user.id;
  const data = await db.fetchUserData(userId);
  
  if (!data) {
    return interaction.reply({
      content: '❌ No data found.',
      ephemeral: true
    });
  }

  // STEP 2: Resolve channel
  const channel = await resolveResponseChannel(interaction, client);
  
  if (config.requestMode === 'channel') {
    cleanupService.scheduleChannelDeletion(channel);
  }

  // STEP 3: Send initial interactive content
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('myflow_step1')
      .setPlaceholder('Choose option')
      .addOptions(data.options)
  );

  await channel.send({
    content: 'Select an option:',
    components: [row]
  });

  // STEP 4: Reply with navigation
  const followUp = config.requestMode === 'dm'
    ? '✅ I\'ve sent you the options via DM.'
    : `✅ Continue in <#${channel.id}>.`;

  await interaction.reply({
    content: followUp,
    ephemeral: true
  });
}

/**
 * Handles dropdown selections (state machine).
 * Uses interaction.update() to maintain single message.
 * NEVER creates new messages from dropdowns—update existing.
 */
async function handleMyFlowDropdowns(interaction, client) {
  const { customId, values } = interaction;

  try {
    // VALIDATION: Always check member context
    if (!interaction.member) {
      return interaction.reply({
        content: '❌ Guild context required.',
        ephemeral: true
      });
    }

    if (customId === 'myflow_step1') {
      const selected = values[0];
      
      // Fetch next step options
      const nextOptions = await getNextStepOptions(selected);
      
      // Update the existing message (state machine)
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('myflow_step2')
          .setPlaceholder('Next selection')
          .addOptions(nextOptions)
      );

      await interaction.update({
        content: 'Select the next option:',
        components: [row]
      });

    } else if (customId === 'myflow_step2') {
      // Final step: collect data and finalize
      await finalizeMyFlow(interaction, client);
    }

  } catch (err) {
    log.error('Dropdown error:', err);
    if (!interaction.replied) {
      await interaction.reply({
        content: '❌ Error processing selection.',
        ephemeral: true
      });
    }
  }
}

/**
 * Finalizes multi-step flow.
 * Can use interaction.update() or resolve channel for final message.
 */
async function finalizeMyFlow(interaction, client) {
  // Resolve channel to send final confirmation
  const channel = await resolveResponseChannel(interaction, client);
  
  // Send final message to resolved channel
  await channel.send({
    content: '✅ Flow completed successfully!'
  });

  // Update dropdown message
  await interaction.update({
    content: 'Complete!',
    components: []
  });
}

module.exports = {
  handleMyFlow,
  handleMyFlowDropdowns,
};
```

**Handler Registration** (interactionRouter.js):

```javascript
if (interaction.isStringSelectMenu()) {
  if (interaction.customId.startsWith('myflow_')) {
    await handleMyFlowDropdowns(interaction, client);
  } else {
    // other flows...
  }
}
```

**Key Points**:
- ✅ Clear separation: command initiates, flow handler manages
- ✅ Each handler has clear documentation of its step
- ✅ State machine using `interaction.update()` (no duplicate messages)
- ✅ Final message can use resolved channel
- ✅ ALL error handling defensive against missing context

---

### Pattern 3: Modal + Flow Integration

**Use Case**: Flows that require text input via modal, then need to resolve to a channel.

**Architecture**:
- Button/dropdown triggers modal (modals go to user directly - Discord limitation)
- Modal submission handler resolves channel and sends confirmation
- Use `interaction.deferReply()` to give time for resolution

**Code Template**:

```javascript
// Dropdown that shows modal (modal shows to user, no channel needed)
async function handleMyFlowDropdowns(interaction, client) {
  if (customId === 'myflow_type_select') {
    const type = values[0];
    
    const modal = new ModalBuilder()
      .setCustomId(`myflow_modal_${type}`)
      .setTitle('Enter Details');

    const input = new TextInputBuilder()
      .setCustomId('my_input')
      .setLabel('Your input')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    
    // Show modal (goes to user, not channel)
    await interaction.showModal(modal);
  }
}

// Modal submission: resolve channel and send confirmation
async function handleMyFlowModal(interaction, client) {
  if (interaction.customId.startsWith('myflow_modal_')) {
    // Defensive check
    if (!interaction.member) {
      return interaction.reply({
        content: '❌ Guild context required.',
        ephemeral: true
      });
    }

    try {
      // STEP 1: Defer reply early
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Get input
      const input = interaction.fields.getTextInputValue('my_input');
      const type = interaction.customId.split('_').pop();

      // STEP 2: Resolve channel (modal submission needs confirmation somewhere)
      const channel = await resolveResponseChannel(interaction, client);
      
      if (config.requestMode === 'channel') {
        cleanupService.scheduleChannelDeletion(channel);
      }

      // STEP 3: Send confirmation to resolved channel
      await channel.send({
        content: `✅ Received: **${input}** (Type: ${type})`
      });

      // STEP 4: Reply with navigation
      const followUp = config.requestMode === 'dm'
        ? '✅ Confirmation sent via DM.'
        : `✅ Confirmation in <#${channel.id}>.`;

      await interaction.editReply({ content: followUp });

    } catch (err) {
      log.error('Modal error:', err);
      const msg = '❌ Error processing input.';
      if (interaction.deferred) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    }
  }
}
```

**Key Points**:
- ✅ Modal shown to user (Discord API limitation)
- ✅ Modal submission immediately defers reply
- ✅ Deferred reply gives time to resolve channel
- ✅ Confirmation sent to resolved channel
- ✅ Navigation reply from interaction
- ✅ Error handling checks deferred state

---

## Part 2: Configuration Respecting

### The `resolveResponseChannel()` Function

**Purpose**: Centralized logic for determining where content should be sent.

**Location**: `utils/requestChannel.js`

**Behavior**:

```javascript
async function resolveResponseChannel(interaction, client) {
  const user = interaction.user;

  // 1️⃣ DM Mode: Try DM first
  if (config.requestMode === 'dm') {
    try {
      const dm = await user.createDM();
      log.debug(`[REQUEST] Opened DM for ${user.tag}`);
      return dm;  // ← Returns DM channel
    } catch (err) {
      log.warn(`[REQUEST] DM failed, falling back to channel: ${err.message}`);
      // Fall through to channel mode
    }
  }

  // 2️⃣ Channel Mode: Create/reuse temp channel
  const channel = await createTempChannel(interaction, client);
  return channel;  // ← Returns guild channel
}
```

**Config Options**:

```javascript
// config/config.js
{
  requestMode: "dm"        // 'dm' or 'channel'
  tempChannelTTL: 90000    // milliseconds
}
```

**Cleanup Scheduling**:

```javascript
// ALWAYS schedule cleanup immediately after resolving
if (config.requestMode === 'channel') {
  cleanupService.scheduleChannelDeletion(channel);
}

// OR for DM mode message cleanup
if (config.requestMode === 'dm') {
  setTimeout(() => sent.delete().catch(() => {}), config.tempChannelTTL);
}
```

### Configuration Responses

**DM Mode Response**:

```javascript
const followUp = '✅ I\'ve sent you the content via DM—please check your direct messages.';

await interaction.reply({
  content: followUp,
  ephemeral: true
});
```

**Channel Mode Response**:

```javascript
const followUp = `✅ Continue in <#${channel.id}>.`;
// or
const followUp = `✅ Results posted in <#${channel.id}>.`;

await interaction.reply({
  content: followUp,
  ephemeral: true
});
```

**NEVER DO**:
```javascript
❌ await interaction.reply({
  content: 'Check my message above' // Vague, doesn't tell user where
});

❌ if (config.requestMode === 'dm') {
  // Send content to main channel anyway
  await mainChannel.send(content);  // WRONG! Violates policy
}
```

---

## Part 3: Message Architecture

### Message Types by Flow Stage

| Stage | Message Type | Ephemeral | Location | Purpose |
|-------|-------------|-----------|----------|---------|
| Initial prerequisites check | Reply | ✅ Yes | User's interaction | Early exit validation |
| Initial interactive content | Send | ❌ No | Resolved channel | Dropdown/button menu |
| Dropdown state update | Update | N/A | Same message | State machine progression |
| Final confirmation | Send | ❌ No | Resolved channel | Show successful completion |
| Navigation to user | Reply | ✅ Yes | User's interaction | Tell user where to look |
| Errors | Reply | ✅ Yes | User's interaction | Notify of problems |

### Embeds vs Plain Content

**Use Embeds When**:
- Formatting complex information (requests, status, overviews)
- Displaying structured data (fields, user info, timestamps)
- Need color coding for status (requests state)

**Example**:
```javascript
const embed = new EmbedBuilder()
  .setColor(0x5865f2)
  .setTitle('Request Status')
  .setDescription('Here\'s what we found')
  .addFields(
    { name: 'Character', value: 'MyChar', inline: true },
    { name: 'Status', value: 'Open', inline: true }
  )
  .setTimestamp();

await channel.send({ embeds: [embed] });
```

**Use Plain Content When**:
- Simple confirmations or lists
- State machine dropdowns
- Error messages
- Navigation instructions

---

## Part 4: Permissions & Context

### Defensive Checks Pattern

**Every interaction handler must check context**:

```javascript
async function handleSomething(interaction, client) {
  // ✅ ALWAYS check member context first
  if (!interaction.member) {
    return interaction.reply({
      content: '❌ This requires a guild context.',
      flags: MessageFlags.Ephemeral
    });
  }

  // ✅ For permission-protected flows
  if (!isAdmin(interaction.member) && !hasRole(interaction.member, 'required_role')) {
    return interaction.reply({
      content: '❌ You lack required permissions.',
      ephemeral: true
    });
  }

  // Continue with flow...
}
```

### Permission Checking

**Location**: `utils/permissionChecks.js`

**Available Checks**:
```javascript
hasRegisterRole(member)        // Can use /register
isAdmin(member)                 // Has admin role
getUserProfessionRoles(member)  // What professions can they manage
```

**Pattern**:
```javascript
// Early exit if permissions missing
if (!isAdmin(interaction.member)) {
  return interaction.reply({
    content: '❌ Admin access required.',
    ephemeral: true
  });
}

// Continue with flow...
```

---

## Part 4B: Hierarchical Menu Tracking (Advanced)

**When to Use**: Menu-based navigation flows where users navigate between submenus while keeping main menus visible.

**Examples**: Character Management, Manage Requests (Crafter), Admin flows

### Overview

The Hierarchical Menu Tracking System extends the cleanup service with 5 levels (0-4) of message tracking:
- **Level 0**: Primary DM menu (global)
- **Level 1**: Flow header ("Manage Requests")
- **Level 2**: Anchor menu (profession menu) - **ALWAYS VISIBLE**
- **Level 3**: Submenus (action dropdowns)
- **Level 4**: Output (results, confirmations)

### Key Functions

```javascript
// Track message at specific level
cleanupService.trackMenuMessage(userId, level, messageId);

// Clean from level X and deeper (higher numbers)
await cleanupService.cleanupFromLevel(userId, client, fromLevel);

// Clear all tracking for user (flow entry)
cleanupService.clearMenuHierarchy(userId);
```

### Quick Patterns

**Flow Entry** (establish hierarchy):
```javascript
cleanupService.clearMenuHierarchy(userId);
const headerMsg = await channel.send({ content: 'Header' });
cleanupService.trackMenuMessage(userId, 1, headerMsg.id);
const menuMsg = await channel.send({ content: 'Menu', components: [buttons] });
cleanupService.trackMenuMessage(userId, 2, menuMsg.id);
```

**Submenu Action** (keep anchor visible):
```javascript
await cleanupService.cleanupFromLevel(userId, client, 3); // Clean old submenu
const submenuMsg = await channel.send({ content: 'Action', components: [dropdown] });
cleanupService.trackMenuMessage(userId, 3, submenuMsg.id);
```

**Output Display** (refresh results only):
```javascript
await cleanupService.cleanupFromLevel(userId, client, 4); // Keep menus
const resultMsg = await channel.send({ content: 'Results' });
cleanupService.trackMenuMessage(userId, 4, resultMsg.id);
```

### When NOT to Use

Use flow-based cleanup (`cleanupFlowMessages`) for:
- Linear, non-navigable flows (request submission)
- Simple status displays
- Flows without persistent menus

**Full Documentation**: See [22-HIERARCHICAL_MENU_SYSTEM.md](22-HIERARCHICAL_MENU_SYSTEM.md) for complete implementation guide, patterns, and examples.

---

## Part 5: Error Handling

### Comprehensive Error Handling Pattern

```javascript
async function handleFlow(interaction, client) {
  try {
    // Defensive prerequisites check
    if (!interaction.member) {
      return interaction.reply({
        content: '❌ Guild context required.',
        ephemeral: true
      });
    }

    // Main flow logic...
    await interaction.reply({ content: 'Success!', ephemeral: true });

  } catch (err) {
    log.error('[FLOW_NAME] Error:', err);
    
    // Respond based on deferred state
    const options = {
      content: '❌ An error occurred. Please try again.',
      ephemeral: true
    };
    
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(options);
    } else {
      await interaction.reply(options);
    }
  }
}
```

### Logging Standards

```javascript
const log = require('../../utils/logWriter');

// Use consistent tags for grep-ability
log.debug('[FLOW_NAME] Starting flow for user: ' + userId);
log.debug('[FLOW_NAME] Resolved to channel: ' + channel.id);
log.info('[FLOW_NAME] Successfully processed request');
log.warn('[FLOW_NAME] Missing data, falling back to default');
log.error('[FLOW_NAME] Critical error:', err);
```

---

## Part 6: Testing Checklist

**Before submitting a new flow, verify**:

### ✅ DM Mode Tests
- [ ] Flow starts in DM
- [ ] All interactive content appears in DM
- [ ] Navigation reply shows "check your direct messages"
- [ ] Messages auto-delete after TTL
- [ ] No messages in guild channel

### ✅ Channel Mode Tests
- [ ] Flow starts in guild
- [ ] Temp channel is created with user-specific name
- [ ] All interactive content appears in temp channel
- [ ] Navigation reply shows `<#channel_id>`
- [ ] Temp channel is scheduled for deletion
- [ ] Channel auto-deletes after TTL

### ✅ Error Handling Tests
- [ ] Missing prerequisites → ephemeral error reply
- [ ] Missing permissions → ephemeral error reply
- [ ] Exception during flow → appropriate error message
- [ ] Modal submission errors → handled gracefully

### ✅ User Experience Tests
- [ ] User knows where to look (reply tells them)
- [ ] No confusing message duplication
- [ ] State machine dropdowns use `update()` not `send()`
- [ ] Final confirmations clear and visible

### ✅ Code Quality Tests
- [ ] 4-step pattern followed exactly
- [ ] `resolveResponseChannel()` called early
- [ ] Cleanup scheduled IMMEDIATELY in channel mode
- [ ] All handlers have defensive checks
- [ ] Logging is comprehensive and grep-able
- [ ] No hardcoded main channel references
- [ ] Config values used consistently

---

## Part 7: Common Mistakes (Anti-Patterns)

### ❌ MISTAKE 1: Ignoring Configuration

```javascript
❌ WRONG:
async function handleFlow(interaction, client) {
  // Doesn't check config.requestMode
  const mainChannel = guild.channels.cache.get(config.requestChannelId);
  await mainChannel.send(content);  // Always sends to main channel!
}

✅ CORRECT:
async function handleFlow(interaction, client) {
  // Respects configuration
  const channel = await resolveResponseChannel(interaction, client);
  await channel.send(content);
}
```

### ❌ MISTAKE 2: Multiple Dropout Messages

```javascript
❌ WRONG:
if (customId === 'select_step1') {
  // Creates NEW message instead of updating
  await interaction.channel.send({
    content: 'Next step:',
    components: [row]
  });
}

✅ CORRECT:
if (customId === 'select_step1') {
  // Updates existing message (state machine)
  await interaction.update({
    content: 'Next step:',
    components: [row]
  });
}
```

### ❌ MISTAKE 3: No Cleanup Scheduling

```javascript
❌ WRONG:
async function handleFlow(interaction, client) {
  const channel = await resolveResponseChannel(interaction, client);
  // Forgot to schedule cleanup!
  
  await channel.send(content);
}

✅ CORRECT:
async function handleFlow(interaction, client) {
  const channel = await resolveResponseChannel(interaction, client);
  
  // Schedule cleanup IMMEDIATELY
  if (config.requestMode === 'channel') {
    cleanupService.scheduleChannelDeletion(channel);
  }
  
  await channel.send(content);
}
```

### ❌ MISTAKE 4: Confusing Navigation Replies

```javascript
❌ WRONG:
await interaction.reply({
  content: 'Done!',  // User has no idea where to look
  ephemeral: true
});

✅ CORRECT:
const followUp = config.requestMode === 'dm'
  ? '✅ I\'ve sent you the results via DM.'
  : `✅ Check your results in <#${channel.id}>.`;

await interaction.reply({
  content: followUp,
  ephemeral: true
});
```

### ❌ MISTAKE 5: Missing Member Context Check

```javascript
❌ WRONG:
async function handleButton(interaction, client) {
  const member = interaction.member;
  const roles = member.roles.cache;  // CRASHES if not in guild!
}

✅ CORRECT:
async function handleButton(interaction, client) {
  if (!interaction.member) {
    return interaction.reply({
      content: '❌ Guild context required.',
      ephemeral: true
    });
  }
  
  const roles = interaction.member.roles.cache;
}
```

---

## Part 8: Quick Reference Checklist

### New Flow Development Checklist

- [ ] **Architecture**: Does it follow the 4-step pattern?
- [ ] **Configuration**: Does it call `resolveResponseChannel()`?
- [ ] **Cleanup**: Is `cleanupService.scheduleChannelDeletion()` called in channel mode?
- [ ] **Messages**: Is all content sent to resolved channel?
- [ ] **Navigation**: Is reply message clear about where content was sent?
- [ ] **Errors**: Are prerequisites checked early with ephemeral replies?
- [ ] **Context**: Are all handlers defensive against missing member context?
- [ ] **Logging**: Is every major step logged with `[FLOW_NAME]` tags?
- [ ] **Testing**: Have both DM and channel modes been tested?
- [ ] **Documentation**: Is the code commented with the 4-step pattern?

---

## Part 9: Files & References

### Core Files

| File | Purpose |
|------|---------|
| `utils/requestChannel.js` | Centralized channel resolution logic |
| `utils/cleanupService.js` | Channel & message cleanup scheduling |
| `config/config.js` | Runtime configuration (requestMode, TTL) |
| `interactions/interactionRouter.js` | Route all interactions to handlers |
| `docs/02-FLOW_ARCHITECTURE.md` | Quick reference (less detailed than this doc) |

### Example Flows

| File | Complexity | Best For Learning |
|------|-----------|-------------------|
| `interactions/shared/statusFlow.js` | Simple | 4-step pattern basics |
| `interactions/shared/requestsFlow.js` | Simple | Permission checking + 4-step |
| `interactions/shared/requestFlow.js` | Complex | Multi-step state machine |
| `interactions/shared/characterFlow.js` | Complex | Modal integration + all patterns |

### Command Files

| File | Pattern Used |
|------|--------------|
| `commands/request.js` | Delegates to flow (clean) |
| `commands/status.js` | Inline 4-step + cleanup |
| `commands/requests.js` | Inline 4-step + cleanup |
| `commands/register.js` | Simple ephemeral (no flow) |

---

## Part 10: Policy for AI Development Tools

**IMPORTANT**: When using AI tools to create new flows:

1. **Reference This Document**: Point AI tools to FLOW_STANDARDS.md
2. **Be Specific**: Tell AI exactly which pattern to use (Simple, Multi-Step, or Modal)
3. **Verify Compliance**: Review generated code against checklist
4. **Test Both Modes**: Ensure DM and channel modes work
5. **Update Index**: Add new flows to `docs/INDEX.md`

**Template Prompt for AI**:
```
Create a new flow called [flow_name] following the FLOW_STANDARDS pattern.

Pattern Type: [Simple/Multi-Step/Modal]

Requirements:
- Follows the 4-step pattern exactly
- Calls resolveResponseChannel() appropriately
- Schedules cleanup if in channel mode
- All content goes to resolved channel
- Navigation reply is clear and config-aware
- Has comprehensive error handling
- Includes defensive member context checks

Reference: See docs/FLOW_STANDARDS.md sections [X] for pattern template.
```

---

## Part 11: Future Enhancements

**Potential Improvements** (out of scope for v1):

- TypeScript types for better type safety
- Utility wrapper for common 4-step pattern
- Linting rule to detect configuration violations
- Message architecture validation
- Cleanup verification test suite

**Deprecation Notice**: This document is the authoritative reference for all discord.js v14+ development in request-wolves. Any future version updates should update this document first before changing code.

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Nov 12, 2025 | System | Initial comprehensive standards document |

---

**Last Updated**: November 12, 2025  
**Next Review**: When adding new flow patterns or major refactors
