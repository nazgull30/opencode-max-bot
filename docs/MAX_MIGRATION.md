# MAX migration

This branch replaces the previous messenger transport with the official MAX
Bot API (`@maxhub/max-bot-api`). The old SDK is no longer a dependency and no
old-messenger-specific feature remains in the runtime.

## Architecture

- `src/max/compat.ts` is a small MAX-backed framework that keeps the shape the
  application already used (`Bot`, `Context`, `Api`, `InlineKeyboard`, `Keyboard`,
  `InputFile`). It normalizes MAX updates into the internal message shape and
  maps message ids to strings.
- `src/bot/messages/max-text.ts` sends and edits MAX HTML/plain text.
- `src/bot/events/max-event-delivery.ts` delivers session events to MAX.
- `src/bot/render/blocks-to-html.ts` renders the shared markdown block model to
  MAX HTML. The parser, splitter, chunker and streamers are reused.
- `src/config.ts` now reads `MAX_BOT_TOKEN` and `MAX_ALLOWED_USER_ID`.
- `src/runtime/paths.ts` uses `OPENCODE_MAX_HOME` and the app directory
  `opencode-max-bot`.

## Behavior differences imposed by MAX

- **No persistent reply keyboard.** MAX has inline keyboards attached to
  messages. The old bottom keyboard buttons are delivered as inline buttons;
  the command menu is available through `PATCH /me/commands`.
- **No DM pinning.** MAX documents pinning only for group chats and channels
  where the bot is an administrator. In a DM the dashboard is a normal message
  that is edited in place; in a group it is pinned as well.
- **No rich block / draft APIs.** MAX accepts Markdown or HTML. Tables are
  rendered as aligned preformatted text; draft streaming is replaced by the
  ordinary edit stream.
- **4000 characters per message.** Long replies are split below that limit.
- **Production delivery.** MAX documents webhooks for production; this bot uses
  long polling because it is designed to run locally without inbound ports.
  Long polling is documented by MAX for development and testing.
- **Bot registration.** Creating a MAX bot requires a verified Russian legal
  entity, ИП, or self-employed profile and passes moderation.

## Configuration

```env
MAX_BOT_TOKEN=
MAX_ALLOWED_USER_ID=
```

Outside Russia, add the Mincifry root certificate to Node's trust store with
`NODE_EXTRA_CA_CERTS`; the API host is `platform-api2.max.ru`.

## Verification

The migration is covered by the existing suite:

```bash
npm run build
npm run typecheck
npm run lint
npm test
```
