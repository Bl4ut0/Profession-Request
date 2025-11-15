# Cleanup System Decision Guide

**Quick Reference**: Which cleanup system should I use?

---

## 🎯 Two Cleanup Systems

### 1. Flow-Based Cleanup (Original)

**What**: Cleans all messages when transitioning between flows

**When to Use**:
- ✅ Linear flows (request submission, status check)
- ✅ One-way interactions (user completes, flow ends)
- ✅ Non-navigable menus
- ✅ Simple command responses

**Examples**:
- `/request` command (character → profession → slot → enchant)
- `/status` command (show status, done)
- `/requests` overview (display list, done)

**Key Functions**:
```javascript
cleanupService.trackFlowMessage(userId, channelId, messageId, flowType);
await cleanupService.cleanupFlowMessages(userId, client);
cleanupService.clearFlowTracking(userId);
```

**Documentation**: [17-FLOW_MESSAGE_CLEANUP.md](17-FLOW_MESSAGE_CLEANUP.md)

---

### 2. Hierarchical Menu Tracking (Advanced)

**What**: Selective cleanup based on 5 hierarchy levels (0-4)

**When to Use**:
- ✅ Menu navigation with persistent context
- ✅ Multi-level menus (profession menu → actions → results)
- ✅ Toggle views (Master/Per Character)
- ✅ Back/forth navigation patterns

**Examples**:
- Character Management (menu → register/delete → back to menu)
- Manage Requests - Crafter (profession menu → claim/complete/release → results)
- Admin flow (admin menu → by profession/crafter/lookup → results)

**Key Functions**:
```javascript
cleanupService.trackMenuMessage(userId, level, messageId);
await cleanupService.cleanupFromLevel(userId, client, fromLevel);
cleanupService.clearMenuHierarchy(userId);
```

**Documentation**: [22-HIERARCHICAL_MENU_SYSTEM.md](22-HIERARCHICAL_MENU_SYSTEM.md)

---

## 🔍 Decision Tree

```
Does your flow have users navigating back and forth between menus?
│
├─ YES: Does the main menu need to stay visible during navigation?
│   │
│   ├─ YES → Use Hierarchical Menu Tracking
│   │         (Track anchor at Level 2, submenus at Level 3, output at Level 4)
│   │
│   └─ NO → Use Flow-Based Cleanup
│             (Clean all when transitioning to new flow)
│
└─ NO: Is this a linear, one-way flow?
    │
    └─ YES → Use Flow-Based Cleanup
              (Clean all when flow ends or transitions)
```

---

## 📊 Comparison Table

| Aspect | Flow-Based | Hierarchical |
|--------|------------|--------------|
| **Cleanup Scope** | All messages | Selective by level |
| **Navigation** | Linear/One-way | Back and forth |
| **Persistent Menus** | No | Yes (anchor) |
| **Complexity** | Simple | Advanced |
| **Use Case** | Request submission | Menu navigation |
| **Example Flows** | `/request`, `/status` | Character Management, Manage Requests |

---

## 🎨 Visual Comparison

### Flow-Based Cleanup
```
User starts /request
├─ Message 1: Select character
├─ Message 2: Select profession
├─ Message 3: Select slot
├─ Message 4: Select enchant
└─ Message 5: Confirmation
    [ALL CLEANED when flow ends]
```

### Hierarchical Menu Tracking
```
User opens Character Management
├─ Level 1: Header "Character Management"
├─ Level 2: Main menu [ANCHOR - PERSISTS]
│   └─ User clicks "Register"
│       ├─ Level 3: Register form
│       └─ Level 4: Confirmation
│           [Levels 3-4 CLEANED, Level 2 STAYS]
```

---

## 🔧 Implementation Patterns

### Flow-Based Pattern (Simple)

```javascript
async function handleRequestFlow(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean previous flow messages
  await cleanupService.cleanupFlowMessages(userId, client);
  
  // Send new content
  const msg = await channel.send({ content: 'Select...' });
  
  // Track for future cleanup
  cleanupService.trackFlowMessage(userId, channel.id, msg.id, 'request');
  
  await interaction.reply({ content: 'Check DM!', ephemeral: true });
}
```

### Hierarchical Pattern (Advanced)

```javascript
async function handleCharacterManagement(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clear hierarchy (fresh start)
  cleanupService.clearMenuHierarchy(userId);
  
  // Send main menu (anchor)
  const menuMsg = await channel.send({ content: 'Menu', components: [buttons] });
  cleanupService.trackMenuMessage(userId, 2, menuMsg.id); // Level 2 = anchor
  
  await interaction.reply({ content: 'Ready!', ephemeral: true });
}

async function handleRegisterButton(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 3+ (keep anchor at Level 2)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  
  // Show form (Level 3)
  const formMsg = await channel.send({ content: 'Form...' });
  cleanupService.trackMenuMessage(userId, 3, formMsg.id);
  
  await interaction.deferUpdate();
}
```

---

## ✅ Quick Checklist

### I should use Flow-Based Cleanup if:
- [ ] My flow is linear (A → B → C → Done)
- [ ] Users don't navigate back to previous steps
- [ ] No persistent menus needed
- [ ] Simple request/response pattern

### I should use Hierarchical Tracking if:
- [ ] My flow has a main menu users return to
- [ ] Users navigate between submenus
- [ ] I want menus to persist during actions
- [ ] Multiple levels of navigation exist

---

## 🚨 Common Mistakes

### Mistake 1: Using Flow-Based for Navigation Menus
**Problem**: Main menu disappears when user performs action

**Fix**: Use hierarchical tracking with anchor at Level 2

---

### Mistake 2: Using Hierarchical for Linear Flows
**Problem**: Over-complicated for simple flows

**Fix**: Use flow-based cleanup—it's simpler and appropriate

---

### Mistake 3: Mixing Both Systems
**Problem**: Conflicts and unexpected cleanup behavior

**Fix**: Choose ONE system per flow type. Don't mix.

---

## 📚 Full Documentation

- **Flow-Based**: [17-FLOW_MESSAGE_CLEANUP.md](17-FLOW_MESSAGE_CLEANUP.md)
- **Hierarchical**: [22-HIERARCHICAL_MENU_SYSTEM.md](22-HIERARCHICAL_MENU_SYSTEM.md)
- **Core Standards**: [FLOW_STANDARDS.md](FLOW_STANDARDS.md)
- **Quick Lookup**: [02-FLOW_ARCHITECTURE.md](02-FLOW_ARCHITECTURE.md)

---

## 🎯 Summary

**Flow-Based**: Clean ALL messages when done (simple, linear flows)

**Hierarchical**: Clean SELECTIVELY by level (menu navigation with persistent anchors)

**Rule of Thumb**: If users see a persistent menu they return to, use hierarchical. Otherwise, use flow-based.

---

**End of Guide**
