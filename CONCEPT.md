# Concept

This document defines the current product concept and boundaries for OpenCode MAX Bot.

## Vision

OpenCode MAX Bot is designed as a **single OpenCode CLI window in MAX**.

The goal is to provide a simple, reliable, mobile-friendly way to run and monitor OpenCode workflows from MAX while keeping behavior predictable.

## Core Concept

- Primary mode is a private dialog (DM) with the bot.
- The bot favors a single active interaction context for reliable flows.
- MAX inline keyboards and the bot command menu are the primary UI. MAX has no persistent reply keyboard, so controls live on the message they belong to.

## Non-Goals (for now)

The following are intentionally out of scope at this stage:

- Group-first usage model
- Parallel multi-session operation across multiple threads
- Multi-user access model
- Full forum-thread orchestration as a primary interaction design

## Why This Direction

This direction is intentional and practical:

- It keeps behavior predictable and easier to stabilize.
- It reduces race conditions in interactive flows (questions, permissions, confirmations).
- It preserves a compact command surface plus inline controls.
- It avoids over-expanding slash commands and fragmented inline-only navigation.

MAX platform constraints are also practical constraints:

- Text messages hold up to 4000 characters.
- Inline keyboards are attached to messages; there is no persistent reply keyboard.
- The API recommends up to 30 requests per second.
- Bot creation requires a verified Russian organization, ИП, or self-employed profile and passes moderation.
- Production MAX delivery uses HTTPS webhooks; this local-first bot uses long polling, which MAX documents for development and testing.

## Current Priorities

The project priorities are intentionally long-term and concept-aligned:

- Keep the bot stable and behavior predictable in daily use
- Expand functionality within the current concept boundaries
- Improve test coverage and maintainability for safe iteration
- Evolve the architecture without changing the core interaction model

## Change Policy

If a proposal changes this concept (for example, making group threads a primary mode), open an issue/discussion first and wait for maintainer alignment before implementation.

## Revisit Conditions

This concept can be revisited later after major stability, test, and architecture milestones are completed.
