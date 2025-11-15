# Cleanup Flow Protocol - Mandatory Standards

**Date Created:** November 14, 2025  
**Status:** ✅ MANDATORY - All flows MUST comply  
**Priority:** CRITICAL

---

## 📋 Overview

This document defines the **mandatory cleanup flow protocol** that ALL bot flows must follow. Non-compliance will result in:
- Stale hierarchy tracking data
- Memory leaks
- Message cleanup failures
- Unpredictable user experience

**This protocol is ENFORCED and NON-NEGOTIABLE.**

---

## 🎯 Core Principle

**Every flow entry point MUST initialize cleanup state before starting new tracking.**

This ensures:
- No orphaned message IDs from previous flows
- Clean slate for hierarchy tracking
- Predictable cleanup behavior
- No memory accumulation

---

## 📐 The Unified Pattern

### Flow Entry Point (REQUIRED)

**ALL flows starting a new user interaction MUST follow this exact sequence:**

```javascript
async function handleFlowEntry(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // ========================================
  // MANDATORY CLEANUP INITIALIZATION
  // ========================================
  
  // STEP 1: Track channel (so cleanup knows where to clean)
  cleanupService.trackUserChannel(userId, channel.id);
  
  // STEP 2: Clean all old messages (except primary menu)
  await cleanupService.cleanupAllFlowMessages(userId, client);
  
  // STEP 3: Clear hierarchy tracking (fresh start)
  cleanupService.clearMenuHierarchy(userId);
  
  // ========================================
  // Now safe to start new flow
  // ========================================
  
  // ... your flow logic here ...
}
```

---

## 📊 Two Flow Types

### Type 1: Linear Flows (Simple)

**Use Case:** One-way flows without navigation menus

**Examples:** Request submission, simple status display

**Pattern:**
```javascript
// Entry
cleanupService.trackUserChannel(userId, channel.id);
await cleanupService.cleanupAllFlowMessages(userId, client);
cleanupService.clearMenuHierarchy(userId);

// Flow logic (no hierarchy tracking needed)
const msg = await channel.send({ content: 'Step 1' });

// Completion (schedule final cleanup)
if (config.requestMode === 'dm') {
  cleanupService.scheduleDMCleanup(channel, client, timeout, userId);
}
```

**Files Using This Pattern:**
- ✅ `interactions/shared/requestFlow.js`
- ✅ `interactions/shared/requestsFlow.js`

---

### Type 2: Hierarchical Flows (Advanced)

**Use Case:** Menu-based flows with navigation and persistent anchors

**Examples:** Character Management, Manage Requests, Status with navigation

**Pattern:**
```javascript
// Entry
cleanupService.trackUserChannel(userId, channel.id);
await cleanupService.cleanupAllFlowMessages(userId, client);
cleanupService.clearMenuHierarchy(userId); // ← CRITICAL

// Build hierarchy
const headerMsg = await channel.send({ content: 'Header' });
cleanupService.trackMenuMessage(userId, 1, headerMsg.id);

const menuMsg = await channel.send({ content: 'Menu', components: [buttons] });
cleanupService.trackMenuMessage(userId, 2, menuMsg.id);

// Submenu actions
async function handleAction(interaction, client) {
  await cleanupService.cleanupFromLevel(userId, client, 3); // Keep Level 0-2
  const actionMsg = await channel.send({ content: 'Action' });
  cleanupService.trackMenuMessage(userId, 3, actionMsg.id);
}
```

**Files Using This Pattern:**
- ✅ `interactions/shared/manageCraftsFlow.js`
- ✅ `interactions/shared/statusFlow.js`
- ✅ `interactions/shared/characterFlow.js`
- ✅ `interactions/shared/adminCraftsFlow.js`

---

## 🔴 Critical Rule: clearMenuHierarchy()

### ⚠️ MANDATORY at Flow Entry

**EVERY flow that uses `cleanupFromLevel()` or `trackMenuMessage()` MUST call `clearMenuHierarchy()` at entry.**

**Why This Matters:**

Without `clearMenuHierarchy()`, the system will:
1. Keep stale message IDs from previous flows
2. Try to clean messages that don't exist
3. Fail to clean new messages properly
4. Accumulate memory over time

### ✅ Correct Pattern

```javascript
// Entry point - ALWAYS clear hierarchy
cleanupService.trackUserChannel(userId, channel.id);
await cleanupService.cleanupAllFlowMessages(userId, client);
cleanupService.clearMenuHierarchy(userId); // ← MUST BE HERE

// Now safe to build new hierarchy
cleanupService.trackMenuMessage(userId, 2, menuMsg.id);
```

### ❌ WRONG - Missing clearMenuHierarchy()

```javascript
// Entry point - BROKEN
cleanupService.trackUserChannel(userId, channel.id);
await cleanupService.cleanupAllFlowMessages(userId, client);
// ❌ Missing clearMenuHierarchy() - WILL CAUSE BUGS

// Hierarchy tracking will use stale data
cleanupService.trackMenuMessage(userId, 2, menuMsg.id); // ← BROKEN
```

---

## 📝 Implementation Checklist

### For New Flows

- [ ] Identify flow type (Linear or Hierarchical)
- [ ] Add entry point cleanup initialization
- [ ] Include all 3 steps: track → clean → clear
- [ ] If hierarchical, track messages at correct levels
- [ ] Test flow switching (enter flow A → flow B → flow A)

### For Existing Flows

- [ ] Verify entry point has all 3 cleanup calls
- [ ] Check for `clearMenuHierarchy()` if using hierarchy
- [ ] Ensure `trackMenuMessage()` calls use correct levels
- [ ] Test memory cleanup (no orphaned tracking)

---

## 🔍 Verification Steps

### 1. Entry Point Check

**Find the main handler:**
```javascript
async function handleYourFlow(interaction, client) {
  // Must have these 3 lines:
  cleanupService.trackUserChannel(userId, channel.id);
  await cleanupService.cleanupAllFlowMessages(userId, client);
  cleanupService.clearMenuHierarchy(userId); // ← VERIFY THIS
}
```

### 2. Hierarchy Usage Check

**If flow uses any of these functions:**
- `cleanupFromLevel()`
- `trackMenuMessage()`

**Then entry MUST have:**
- `clearMenuHierarchy(userId)`

### 3. Testing Protocol

```javascript
// Test sequence:
1. User enters Flow A (track messages)
2. User switches to Flow B (should clear Flow A tracking)
3. User returns to Flow A (should start fresh, not reuse old tracking)
4. Verify no message IDs leak between flows
```

---

## 📚 Related Documentation

- **[FLOW_STANDARDS.md](FLOW_STANDARDS.md)** - Complete flow architecture standards
- **[22-HIERARCHICAL_MENU_SYSTEM.md](22-HIERARCHICAL_MENU_SYSTEM.md)** - Hierarchical tracking details
- **[17-FLOW_MESSAGE_CLEANUP.md](17-FLOW_MESSAGE_CLEANUP.md)** - Cleanup system architecture
- **[CLEANUP_DECISION_GUIDE.md](CLEANUP_DECISION_GUIDE.md)** - Choosing cleanup approach
- **[02-FLOW_ARCHITECTURE.md](02-FLOW_ARCHITECTURE.md)** - Quick reference

---

## 🚨 Common Mistakes

### Mistake 1: Missing clearMenuHierarchy()

**Problem:** Stale hierarchy data causes cleanup failures

**Fix:** Add `cleanupService.clearMenuHierarchy(userId)` after `cleanupAllFlowMessages()`

---

### Mistake 2: Calling clearMenuHierarchy() Too Late

**Problem:** Hierarchy cleared AFTER starting to track new messages

**Fix:** Clear BEFORE any `trackMenuMessage()` calls

```javascript
// ✅ CORRECT ORDER
cleanupService.clearMenuHierarchy(userId);
cleanupService.trackMenuMessage(userId, 2, msg.id);

// ❌ WRONG ORDER
cleanupService.trackMenuMessage(userId, 2, msg.id);
cleanupService.clearMenuHierarchy(userId); // ← Too late!
```

---

### Mistake 3: Inconsistent Entry Points

**Problem:** Some entry paths skip cleanup initialization

**Fix:** ALL entry points must use the same pattern

```javascript
// Flow has multiple entry points:
async function handleMainEntry() {
  // ✅ Has cleanup
  cleanupService.clearMenuHierarchy(userId);
}

async function handleBackToFlow() {
  // ❌ Missing cleanup - BROKEN
}
```

---

## 🔧 Function Reference

### Required Functions

```javascript
// Track where messages are sent
cleanupService.trackUserChannel(userId, channelId);

// Clean all old messages (except primary menu)
await cleanupService.cleanupAllFlowMessages(userId, client);

// Clear hierarchy tracking (mandatory for hierarchical flows)
cleanupService.clearMenuHierarchy(userId);
```

### Optional Functions (Hierarchical Flows)

```javascript
// Track message at specific level
cleanupService.trackMenuMessage(userId, level, messageId);

// Clean from specific level and deeper
await cleanupService.cleanupFromLevel(userId, client, fromLevel);
```

---

## 📋 Compliance Status

### ✅ Compliant Flows

| Flow | File | Entry Point | Compliance |
|------|------|-------------|------------|
| Manage Requests | `manageCraftsFlow.js` | `handleManageRequestsMain()` | ✅ Full |
| Manage Requests (Back) | `manageCraftsFlow.js` | `handleBackToMenu()` | ✅ Full |
| Status | `statusFlow.js` | `handleStatusCommand()` | ✅ Full |
| Character Management | `characterFlow.js` | `handleCharacterButtons()` | ✅ Full |
| Request Submission | `requestFlow.js` | `handleRequestFlow()` | ✅ Full |
| Requests Overview | `requestsFlow.js` | `handleRequestsOverview()` | ✅ Full |
| Admin Flows | `adminCraftsFlow.js` | All handlers | ✅ Full |

### Compliance Date

**All flows verified compliant:** November 14, 2025

---

## 🎓 Training Guide

### For New Developers

1. **Read this document first**
2. Read [FLOW_STANDARDS.md](FLOW_STANDARDS.md)
3. Choose your flow type (Linear or Hierarchical)
4. Copy the appropriate pattern from this document
5. Follow the implementation checklist

### For Code Reviewers

1. **Check for 3-line cleanup initialization at entry**
2. If hierarchical flow, verify `clearMenuHierarchy()` exists
3. Verify all entry points use same pattern
4. Test flow switching scenarios

---

## ⚖️ Enforcement

**This protocol is MANDATORY. Code that violates it will:**
- ❌ Fail code review
- ❌ Not be merged to main branch
- ❌ Require immediate refactoring if found

**No exceptions.**

---

## 🔄 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-14 | Initial protocol documentation |

---

**Last Updated:** November 14, 2025  
**Status:** ✅ ACTIVE - All flows compliant  
**Next Review:** When adding new flows

---

## 📞 Questions?

**See also:**
- [FLOW_STANDARDS.md](FLOW_STANDARDS.md) - Comprehensive standards
- [INDEX.md](INDEX.md) - Documentation navigation
- [gemini.md](../gemini.md) - AI tool reference

**Remember: This protocol exists to prevent bugs, not to add complexity. Follow it consistently and your flows will work flawlessly.**
