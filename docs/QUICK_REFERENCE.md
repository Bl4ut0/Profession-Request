# ⚡ QUICK REFERENCE: The 4-Step Flow Pattern

> **This is THE pattern. All flows MUST follow it. No exceptions.**

**📊 For menu-based navigation flows**: See [22-HIERARCHICAL_MENU_SYSTEM.md](22-HIERARCHICAL_MENU_SYSTEM.md) for persistent anchor menu patterns.

---

## The Pattern (Copy/Paste Ready)

```javascript
async function handleMyFlow(interaction, client) {
  try {
    // ============================================
    // STEP 1: Validate Prerequisites
    // ============================================
    if (!interaction.member) {
      return interaction.reply({
        content: '❌ Guild context required.',
        ephemeral: true
      });
    }

    // Get any required data
    const userId = interaction.user.id;
    const data = await db.fetchData(userId);
    
    if (!data) {
      return interaction.reply({
        content: '❌ No data found.',
        ephemeral: true
      });
    }

    // ============================================
    // STEP 2: Resolve Response Channel
    // ============================================
    const channel = await resolveResponseChannel(interaction, client);
    
    // IMMEDIATELY schedule cleanup in channel mode
    if (config.requestMode === 'channel') {
      cleanupService.scheduleChannelDeletion(channel);
    }

    // ============================================
    // STEP 3: Send All Content to Resolved Channel
    // ============================================
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('myflow_select')
        .setPlaceholder('Choose option')
        .addOptions(data.options)
    );

    await channel.send({
      content: 'Select an option:',
      components: [row]
    });

    // ============================================
    // STEP 4: Reply with Navigation
    // ============================================
    const followUp = config.requestMode === 'dm'
      ? '✅ I\'ve sent you the options via DM.'
      : `✅ Continue in <#${channel.id}>.`;

    await interaction.reply({
      content: followUp,
      ephemeral: true
    });

  } catch (err) {
    log.error('[FLOW_NAME] Error:', err);
    const msg = '❌ An error occurred.';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  }
}
```

---

## 3 Pattern Types

### Pattern 1: Simple (No Dropdowns)
```javascript
// Get data → Resolve channel → Send results → Reply with nav
// Use for: /status, /requests overview, simple displays
// File: commands/status.js (example)
```

### Pattern 2: Multi-Step (Dropdowns)
```javascript
// Entry → Dropdowns (state machine with update()) → Final message
// Use for: /request, multi-selection flows
// File: interactions/shared/requestFlow.js (example)
```

### Pattern 3: Modal + Flow
```javascript
// Button → Show modal → Modal handler → Resolve channel → Send confirmation
// Use for: Character registration, text input flows
// File: interactions/shared/characterFlow.js (example)
```

---

## The MUST DO's

✅ **MUST** call `resolveResponseChannel(interaction, client)`  
✅ **MUST** schedule cleanup if `config.requestMode === 'channel'`  
✅ **MUST** send all content to the resolved channel  
✅ **MUST** tell user where content was sent (in reply)  
✅ **MUST** use `interaction.update()` for dropdown state machines  
✅ **MUST** check `if (!interaction.member)` at start  
✅ **MUST** have try-catch with proper error handling  

---

## The DON'Ts

❌ **DON'T** hardcode `mainChannel` or ignore config  
❌ **DON'T** create multiple messages from dropdown (use `update()`)  
❌ **DON'T** forget cleanup scheduling  
❌ **DON'T** have vague replies like "Check above"  
❌ **DON'T** skip member context checks  
❌ **DON'T** use direct message format variations  

---

## Response Format

### DM Mode Reply
```javascript
'✅ I\'ve sent you [the content/your request/results] via DM—please check your direct messages.'
```

### Channel Mode Reply
```javascript
`✅ [Continue/View/Check] [your request/results] in <#${channel.id}>.`
```

---

## Testing Checklist

- [ ] Works in DM mode (content in DM, user knows to check DMs)
- [ ] Works in Channel mode (temp channel created, auto-deletes)
- [ ] Handles missing prerequisites (ephemeral error)
- [ ] Handles permission errors (ephemeral error)
- [ ] Handles exceptions gracefully
- [ ] No hardcoded channel references
- [ ] Cleanup scheduled in channel mode
- [ ] Response tells user where content was sent

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/FLOW_STANDARDS.md` | Detailed standards (AUTHORITATIVE) |
| `docs/02-FLOW_ARCHITECTURE.md` | Quick patterns reference |
| `utils/requestChannel.js` | Channel resolution logic |
| `utils/cleanupService.js` | Cleanup scheduling |
| `config/config.js` | requestMode config |

---

## The Golden Rule

```
Every. Single. Flow.
Must follow the 4-step pattern.
NO EXCEPTIONS.

1. Validate prerequisites (early exit)
2. Resolve channel (respects config)
3. Send content to channel
4. Reply with navigation

That's it. That's the rule.
```

---

## For AI Tools

When creating a flow:
1. Tell me your pattern type (Simple, Multi-Step, Modal)
2. Tell me what your flow does
3. I'll reference docs/FLOW_STANDARDS.md
4. I'll use the appropriate template
5. I'll follow the testing checklist
6. I'll ensure config is respected

---

**Last Updated**: November 12, 2025  
**Document Version**: 1.0  
**Status**: AUTHORITATIVE REFERENCE
