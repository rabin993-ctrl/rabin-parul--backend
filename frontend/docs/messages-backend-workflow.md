# Messages Backend Workflow

## 1. Purpose

This document translates the current frontend Messages feature into a backend implementation contract.

It covers:

- The general direct-message inbox
- Starting a direct conversation
- Adoption-linked conversations
- Text and media messages
- Conversation ordering, unread counts, delivery, and read receipts
- Message privacy, requests, blocking, reporting, and moderation
- Mute and notification preferences
- Realtime delivery, offline retries, pagination, search, and retention
- Adoption actions launched from chat
- Suggested schemas, APIs, events, invariants, and acceptance criteria

The frontend currently uses mock data and in-memory React state. This document separates that current behavior from the corrected production workflow.

## 2. Frontend Source Map

Primary Messages sources:

- `src/screens/MessagesScreen.tsx`
- `src/screens/ChatThreadScreen.tsx`
- `src/components/messages/ChatPeerOptionsSheet.tsx`
- `src/context/AdoptionContext.tsx`
- `src/context/AdoptionFeedContext.tsx`
- `src/utils/chatThreadMeta.ts`
- `src/components/adoption/AdoptionChatsList.tsx`
- `src/components/adoption/AdoptionPosterInbox.tsx`
- `src/components/adoption/ChatAdoptionPanel.tsx`
- `src/screens/adoption/AdoptionListingScreen.tsx`
- `src/context/UserPrivacyContext.tsx`
- `src/screens/profile/ProfilePrivacyScreen.tsx`
- `src/screens/profile/ProfileBlockedUsersScreen.tsx`
- `src/screens/pawCircles/UserProfileScreen.tsx`
- `src/screens/NotificationsScreen.tsx`
- `src/navigation/AppNavigator.tsx`
- `src/navigation/GlassTabBar.tsx`

## 3. Scope Boundaries

The app currently contains several chat-like systems:

1. **General direct messages**
   One-to-one conversations shown in the Messages tab.

2. **Adoption conversations**
   One-to-one conversations tied to an adoption listing/request. They use the same `ChatThreadScreen`, but are shown inside Adoption rather than the general Messages inbox.

3. **Paw Circle chat**
   Group chat tied to a Paw Circle. This has separate membership, admin, shared-media, and pinned-message behavior.

4. **Vet chat**
   Chat tied to a veterinary consultation and its session lifecycle.

The backend may reuse a common messaging transport, attachment pipeline, and notification system. However, each conversation type must keep its own authorization and lifecycle rules.

This document focuses on general direct messages and the adoption-linked use of the shared chat screen. Paw Circle and Vet workflows should not be inferred from the direct-message model.

## 4. Current Frontend Message Model

The frontend `ChatThread` contains:

- `id`
- one `participantId`
- preview text
- display time such as `2m` or `Now`
- unread count
- optional adoption post ID
- optional adoption record ID

The frontend `ChatMessage` contains:

- `id`
- thread ID
- kind: text, system, or update request
- optional sender ID
- text
- display time
- optional adoption record ID

This is sufficient for mock rendering but not production messaging.

Production records need:

- server-generated IDs
- participant membership records
- absolute timestamps
- message state
- attachment references
- sender authorization
- per-user read state
- edit/delete state
- moderation state
- idempotency key
- optional domain attachment such as an adoption request or record

## 5. Canonical Conversation Types

Recommended conversation types:

- `direct`
- `adoption`
- `paw_circle`
- `vet_consult`
- optional future `support`

A conversation should have exactly one type and a typed domain reference where required.

Examples:

- Direct conversation: no domain reference
- Adoption conversation: listing ID and request ID
- Paw Circle conversation: circle ID
- Vet conversation: consultation ID

The client should not infer type from whether an optional field happens to be present.

## 6. Source Of Truth

Current chat data lives inside `AdoptionContext`, including ordinary direct messages. This makes general messaging dependent on an Adoption provider and mixes unrelated domain actions.

The production source of truth should be a messaging service or messaging domain API.

The frontend should receive:

- conversation summaries
- participant summaries
- messages
- per-user conversation state
- capabilities
- typed domain context

Adoption, Paw Circle, and Vet services should create or reference conversations through explicit integration contracts.

## 7. Messages Inbox

The current Messages tab:

- calls `groupThreads`
- removes every adoption-related thread
- displays only the `general` group
- opens a selected thread in a modal
- shows an empty state reading "No general chats yet"

The inbox does not currently:

- fetch from a backend
- paginate
- search
- sort general conversations after new messages
- mark conversations read
- show message requests
- show archived conversations
- show a tab badge

Correct inbox workflow:

1. Authenticate the user.
2. Query conversations in which the user has active participation.
3. Filter by inbox category and per-user state.
4. Apply block, deletion, and moderation visibility.
5. Sort by the latest visible message or domain event.
6. Return a cursor-paginated list.
7. Include unread count, mute state, request state, peer summary, last-message summary, and capabilities.

## 8. General And Adoption Inbox Split

Current routing intentionally separates:

- general direct chats into the Messages tab
- adoption chats into Adoption, divided into Rehoming and Adopting

The backend should support this through typed conversation queries rather than frontend inspection of optional IDs.

Suggested queries:

- Messages tab: `type=direct`
- Adoption chats: `type=adoption`
- Adoption role filter: listing owner versus requester/adopter
- Adoption action filter: conversations with a required action

An adoption conversation must not appear in the general list merely because its domain record is temporarily unavailable.

## 9. Conversation Summary Read Model

Each inbox row should return:

- conversation ID and type
- peer or group summary
- domain summary, when applicable
- last visible message ID
- last-message preview
- last activity timestamp
- unread count for the current user
- muted state
- request/accepted state
- archived state
- current viewer capabilities

Relative time and preview text are presentation values. Store absolute timestamps and canonical message content.

## 10. Starting A General Conversation

Current frontend gaps:

- the edit/compose icon in Messages has no action
- a user's profile Message button only navigates to the Messages tab
- it does not identify the selected user
- it does not create or open a conversation

Correct workflow:

1. User taps Message from a profile or New Message from the inbox.
2. Client sends the intended recipient ID.
3. Server validates recipient existence, account state, messaging policy, blocks, and abuse limits.
4. Server finds an existing eligible direct conversation between the pair.
5. If one exists, return it.
6. Otherwise create one conversation and two participant records.
7. If recipient approval is required, create it in a request state.
8. Return the conversation and allowed composer capabilities.

The create operation must be idempotent and protected by a uniqueness constraint so repeated taps cannot create duplicate one-to-one conversations.

## 11. Direct Conversation Identity

For ordinary one-to-one chat, there should normally be at most one active direct conversation for an unordered pair of users.

Suggested uniqueness key:

- normalized lower user ID
- normalized higher user ID
- conversation type

Adoption conversations are different. The same two users may have several separate adoption conversations because each is tied to a specific listing/request.

## 12. Who Can Message You

Profile privacy currently offers:

- everyone
- circles
- no one

The setting is persisted only to device storage and is not consulted when opening or sending a conversation.

The backend must define and enforce each policy:

- `everyone`: eligible users may initiate, normally through message requests if they are not trusted contacts
- `circles`: only users with a qualifying active Paw Circle relationship may initiate
- `none`: no new ordinary direct conversations may be initiated

Product must define what "circles" means precisely. Recommended meaning:

- both users share at least one active Paw Circle membership

Do not confuse this with Community membership.

## 13. Existing Conversation Exceptions

Changing message policy should primarily control new ordinary direct conversations.

Recommended behavior:

- existing accepted direct conversations remain usable unless the user blocks, restricts, or closes them
- existing pending requests can be declined automatically or left for review according to product policy
- adoption conversations remain governed by adoption participation rather than ordinary direct-message initiation policy
- platform safety restrictions always override user preferences

These transition rules must be explicit and auditable.

## 14. Message Requests

The current frontend has no general message-request inbox.

For safe implementation, users outside the recipient's trusted relationship should enter a request workflow rather than the main inbox.

Recommended states:

- `pending`
- `accepted`
- `declined`
- `expired`
- `spam`

While pending:

- sender may be limited to one initial message
- recipient can preview limited profile information
- read receipts and online presence should be withheld
- sender should not receive a strong read signal
- media and links may be disabled
- recipient may accept, decline, report, or block

Acceptance moves the conversation into both users' normal inboxes.

## 15. Adoption Conversation Creation

The only implemented frontend thread-creation path is tied to an adoption request.

Current workflow:

1. An adoption request exists.
2. Opening chat calls `ensureAdoptionRequestThread`.
3. It finds a thread by supplied ID or by listing and peer.
4. If missing, it creates a local thread and empty message list.
5. It separately attaches the thread ID to the request.

Correct backend workflow:

1. Authenticate the requester or listing owner.
2. Load the adoption request and listing.
3. Verify that the actor is one of the two authorized participants.
4. Reject closed, rejected, canceled, or unauthorized relationships as policy requires.
5. Find or create the adoption conversation using the request ID as the uniqueness boundary.
6. Link conversation and request in one transaction.
7. Return the typed conversation and current adoption capabilities.

The client must not choose arbitrary peer, listing, or request combinations.

## 16. Adoption Inbox Grouping

The Adoption frontend groups conversations by listing and then separates:

- pets the user listed
- pets the user is adopting
- conversations requiring the user's action

It also groups several applicants under the same listed pet.

The backend should return enough structured metadata to support this without parsing labels:

- listing ID and pet summary
- request ID and status
- current user's adoption role
- placement/adoption record ID
- next required action
- action due timestamp
- unread count
- counterpart summary

Status labels such as "New request", "In chat", "Adopted", and "Post home update" should be derived from canonical states.

## 17. Opening A Conversation

Current behavior opens the shared chat screen and scrolls to the latest message. It does not mark the thread read.

Correct workflow:

1. Fetch the conversation summary and recent message page.
2. Verify current participation and domain authorization.
3. Mark visible messages as read or advance the participant read cursor.
4. Subscribe to realtime conversation events.
5. Clear or update the app badge.
6. Load older messages when the user scrolls upward.
7. Unsubscribe when the screen closes or the session changes.

Opening a conversation must not authorize a user who lost access after the inbox was loaded.

## 18. Sending A Text Message

Current behavior:

- trims text
- rejects an empty string
- limits the input to 2,000 characters
- generates an ID with `Date.now()`
- appends the message in memory
- sets preview and time to the message

Correct send workflow:

1. Client creates a stable local ID and idempotency key.
2. Client submits conversation ID, message type, text, attachment IDs, and reply reference if supported.
3. Server authenticates the sender.
4. Server checks conversation membership, block state, request state, domain state, rate limits, and content limits.
5. Server normalizes and validates text.
6. Server verifies every attachment.
7. Server writes the message and updates conversation activity in one transaction.
8. Server emits an outbox event.
9. Realtime delivery sends the authoritative message to participants.
10. Client reconciles the pending local message with the server record.

The server timestamp determines canonical ordering.

## 19. Message Types

Recommended initial message types:

- `text`
- `image`
- `system`
- `adoption_event`
- `shared_post`

Optional future types should be added explicitly:

- file
- video
- audio/voice note
- location
- contact

The current Messages UI explicitly shows image and camera controls. The plus control has no defined action. Do not assume file, voice-note, location, or contact support until the product defines those options.

## 20. Real Media Selection

The image, camera, and plus buttons currently have no `onPress` behavior. No media is selected, previewed, uploaded, or sent.

For image/library and camera support, the production client should:

1. Open the relevant system picker from a direct user action.
2. Request only the required permission.
3. Handle cancellation without changing the draft.
4. Validate selected type, size, count, and dimensions.
5. Show a real local preview.
6. Allow removal before send.
7. Recover interrupted Android picker results when applicable.
8. Request an upload session.
9. Upload directly to approved object storage.
10. Wait for the asset to become ready.
11. Send the message using the ready asset ID.

If the plus menu later supports files, use the system document picker and an explicit MIME allowlist.

## 21. Media Upload Pipeline

Suggested asset states:

- `created`
- `uploading`
- `uploaded`
- `processing`
- `ready`
- `rejected`
- `expired`
- `deleted`

Backend workflow:

1. Validate declared MIME type, size, purpose, and conversation eligibility.
2. Return a short-lived signed upload target.
3. Client uploads bytes directly to storage.
4. Client confirms completion.
5. Worker validates file signature, scans for malware, strips unsafe metadata, creates display variants, and runs media moderation.
6. Asset becomes ready or rejected.
7. Message creation accepts only a ready asset authorized for that sender.

Use a purpose such as `direct_message_attachment`. Do not accept client-controlled storage URLs as trusted attachments.

## 22. Image And File Safety

Production requirements:

- strip unnecessary EXIF location
- never trust filename extensions
- validate actual file signatures
- enforce file-size and image-dimension limits
- create safe thumbnails
- prevent executable or dangerous document types
- serve downloads with safe content headers
- authorize every media read
- support moderation quarantine and takedown
- expire abandoned uploads

Private message attachments must not become public merely because their storage URL is known.

## 23. Attachment Send States

The frontend should distinguish:

- selecting
- compressing/preparing
- uploading
- processing
- ready to send
- sending
- sent
- failed
- rejected

A message should not appear as fully sent while its required asset is still unavailable.

Retries must reuse the same message idempotency key to avoid duplicate attachments or messages.

## 24. Delivery States

The UI currently shows one check icon on every outgoing text message regardless of real state.

Recommended message states:

- `pending_local`
- `accepted`
- `delivered`
- `read`
- `failed`
- `removed`

Meaning:

- accepted: server durably stored the message
- delivered: at least one active recipient device/session acknowledged delivery, if this level is implemented
- read: recipient read cursor passed the message

Do not claim delivered or read based only on a successful HTTP request.

## 25. Read State And Unread Counts

Current unread counts are seeded numbers and never change when a conversation opens.

Recommended model:

- each participant has `last_read_message_id` and `last_read_at`
- unread count is derived efficiently or transactionally maintained
- opening/viewing advances the read cursor
- read updates are idempotent and monotonic
- sender's own messages never increase sender unread count
- hidden system events increase unread only when product policy says they should

The backend should return one authoritative total unread count for the Messages tab, plus category counts where useful.

## 26. Messages Tab Badge

The current bottom tab shows a badge only for Paw Circle join requests. Messages receives no badge even when general threads contain unread values.

Production behavior:

- badge count represents unread accepted direct conversations/messages according to product choice
- adoption unread may appear on Adoption rather than Messages to preserve the current information architecture
- message-request count may be shown separately
- muted conversations may still count as unread unless the product explicitly excludes them
- counts update through realtime events and app refresh

## 27. Conversation Ordering

General threads currently preserve seed-array order. Sending updates preview/time but does not move the conversation to the top.

Production inbox ordering should use:

1. pinned state, if supported
2. latest visible activity timestamp
3. stable conversation ID tie-breaker

Adoption may additionally prioritize required actions, but it should still use absolute timestamps rather than parsing display strings such as `2h` or `3d`.

## 28. Message Pagination And Date Groups

The current chat loads every in-memory message and always shows a single "Today" date pill, even for mock messages marked days or months old.

Correct behavior:

- fetch newest messages first with cursor pagination
- load older pages upward
- group messages by the user's local calendar date
- preserve stable order when late events arrive
- handle deleted and system messages without shifting cursors incorrectly
- use server timestamps and include timezone-safe values

## 29. Realtime Delivery

Recommended realtime events:

- conversation created/updated
- message created
- message updated/removed
- read cursor advanced
- typing started/stopped
- participant muted/archived
- request accepted/declined
- block or access revoked
- adoption domain state changed

WebSocket is the usual transport, with authenticated subscriptions and reconnect support. Server-sent events or a managed realtime service are also valid.

Realtime delivery is an optimization. Every screen must recover authoritative state through normal APIs after reconnect.

## 30. Offline Sending And Retry

For temporary network failure:

- keep a local pending message with stable local ID
- retry with the same idempotency key
- show failure after retry policy is exhausted
- allow manual retry or removal
- preserve draft text and selected attachments
- reconcile server ID and timestamp after success

Do not create a second message when the first request succeeded but the response was lost.

## 31. Drafts

The current draft exists only in component state and is lost when the modal closes.

Recommended behavior:

- store one local draft per conversation
- optionally sync drafts across devices only if explicitly desired
- preserve text and ready attachment references
- expire abandoned temporary uploads
- clear the draft after confirmed send

Drafts are private client data and should not trigger typing or notification events by themselves.

## 32. Typing Indicators

The frontend has no typing indicator.

If added:

- typing events are ephemeral and not stored as messages
- throttle updates
- expire automatically after a short timeout
- send only to authorized active participants
- do not expose typing in pending message requests unless product policy allows
- stop broadcasting after block or access revocation

## 33. Presence And Online Privacy

Profile privacy has a "Show when you're online" toggle, but chat does not display or enforce presence.

If presence is implemented:

- return online/last-seen data only when the target user permits it
- use coarse last-seen values where appropriate
- do not expose presence to blocked users or unaccepted requests
- keep presence ephemeral
- avoid using presence as a guarantee that a message was delivered or read

## 34. Muting A Conversation

Current mute behavior:

- stored in `ChatThreadScreen` local state
- resets after closing/remounting
- only displays a toast
- does not affect notifications

Production mute should be a per-user conversation setting:

- `muted_until`, nullable for indefinite mute
- optional notification level
- updated timestamp

Muting:

- does not block sending or receiving
- does not delete unread state
- suppresses push/sound according to preference
- may still allow in-app badge counts
- must sync across the user's devices

## 35. Notification Preferences

The profile has an "Adoption updates" toggle with the hint "Milestones, approvals, and messages", but it is local component state and resets on remount.

The backend should support:

- direct-message push enabled
- message-request notifications
- adoption-message notifications
- adoption lifecycle notifications
- message preview visibility
- sound/vibration preference where supported
- per-conversation mute

Operating-system push permission is separate from backend preference. In-app unread state still works when push permission is denied.

## 36. Push Notification Workflow

For an accepted incoming message:

1. Message transaction writes an outbox event.
2. Worker determines eligible recipient devices.
3. Worker applies block, mute, notification, active-session, and privacy rules.
4. Worker creates an in-app notification/unread event.
5. Worker sends push through valid Expo push tokens.
6. Delivery receipts update token health.
7. Invalid tokens are disabled.

Push payload should contain:

- conversation ID
- safe sender display
- message type
- optional privacy-safe preview
- deep-link target

Do not include sensitive adoption, contact, or media content on a lock screen unless the user enabled previews.

## 37. Deep Linking From Notifications

When a notification is opened:

1. App parses the typed route data.
2. App authenticates or resumes the session.
3. App fetches the conversation.
4. Server rechecks participant and domain access.
5. App opens the correct direct or adoption destination.
6. App advances read state only when the message is actually displayed.

A notification payload is not authorization.

## 38. Blocking A User

Current blocking:

- saves a user ID in local AsyncStorage
- displays a toast
- does not update the server
- does not disable the open composer
- does not remove or restrict existing conversations
- is not checked during send

Production block workflow:

1. User confirms block.
2. Server creates a durable directional block relation.
3. New direct-message initiation is denied in both directions according to policy.
4. Existing direct conversations become non-interactive or hidden for the blocker.
5. Pending requests are declined.
6. Presence and profile visibility are restricted.
7. Push and realtime delivery stop.
8. Safety/audit metadata is recorded.

Adoption, Vet, or safety-critical workflows may require a protected support path even when users block each other. The ordinary direct composer must still be disabled.

## 39. Unblocking

The frontend can unblock from Profile settings.

Production behavior:

- remove or deactivate the block relation
- do not automatically accept old requests
- do not automatically restore deleted/hidden inbox state unless product policy says so
- allow a new eligible request or resume an existing conversation according to privacy policy
- record the transition

Unblocking should not notify the other user.

## 40. Reporting A Conversation Or User

Current Report only displays "Report submitted" and stores nothing.

Production report workflow:

1. User chooses a reason.
2. Client submits conversation ID, optional message IDs, explanation, and block choice.
3. Server verifies reporter access.
4. Server stores immutable evidence snapshots needed for review.
5. Report enters a moderation queue.
6. User receives a safe confirmation.
7. Moderator actions are audited.

Suggested reasons:

- harassment
- spam or scam
- unsafe adoption behavior
- sexual or graphic content
- impersonation
- threat or animal harm
- other

Reporting and blocking are separate actions, though the UI may offer them together.

## 41. Message Moderation

Private messages require careful access controls. Moderators should not casually browse conversations.

Recommended rules:

- automated abuse scanning operates under documented policy
- human access requires a valid report, safety escalation, or legal basis
- evidence access is role-restricted and audited
- attachments can be quarantined
- severe threats or animal harm can escalate to trust and safety
- retention and disclosure follow applicable policy and law

The product should clearly state whether private messages use end-to-end encryption. The current frontend gives no indication that they do, so the backend document must not promise E2EE.

## 42. Links And Scam Protection

Messages can contain arbitrary text, so URLs should be parsed and safety-checked.

Recommended controls:

- block dangerous schemes
- detect known malicious URLs
- rate-limit repeated link sending
- add warnings for suspicious or newly registered destinations
- never fetch previews from internal/private network addresses
- apply stricter limits to pending message requests

Adoption conversations deserve additional fraud and payment-scam monitoring.

## 43. System Messages

The frontend inserts system messages such as:

- pet marked as adopted
- adoption confirmed
- home update posted

Only trusted backend services should create system/domain messages. Clients must not submit arbitrary content with `type=system`.

A system message should store:

- typed event code
- actor
- domain reference
- structured payload
- rendered fallback text
- server timestamp

The client can localize display from the event code while retaining a safe fallback.

## 44. Hidden Update-Request Messages

The frontend message model includes `update_request`, but `ChatThreadScreen` filters it out and displays only text and system messages. Adoption action panels are derived from the adoption record instead.

Correct approach:

- the adoption record and milestone are the source of truth
- the chat may receive a typed adoption event for history
- the action panel uses current domain capabilities
- a hidden message record must not be the only durable representation of a required action

## 45. Poster First Reply And Request Approval

Current behavior automatically approves a submitted adoption request when the listing owner sends a message in that thread.

This product rule must be explicit.

If retained, production send workflow should:

1. Verify sender is the listing owner.
2. Verify request is still submitted.
3. Approve the request and create the first message in one transaction, or through an atomic domain command.
4. Emit one coherent notification/event set.
5. Return the new request status and message.

Do not let the frontend perform two unrelated mutations that can partially fail.

If approval should require an explicit action, remove the automatic transition and keep messaging/request status separate.

## 46. Mark As Adopted From Chat

The chat panel allows the listing owner to mark a pet adopted after the owner has sent at least one text message.

Current frontend performs several local changes separately:

- creates an adoption record
- marks the listing adopted
- appends system messages
- does not consistently update the selected adoption request through the same operation

Correct backend command:

1. Verify actor owns the listing.
2. Verify the selected request and conversation belong to that listing.
3. Verify request/placement eligibility.
4. Mark the selected request adopted.
5. Reject or close competing active requests according to policy.
6. mark the listing adopted.
7. create the adoption/placement record.
8. schedule update milestones.
9. append trusted adoption event messages.
10. emit notifications and audit events.

All domain changes should commit transactionally or through a durable saga with compensating behavior.

## 47. Post Home Update From Chat

The adoption panel can open a home-update form. The update is stored on the adoption record, then the chat receives a system message saying an update was posted.

Correct workflow:

1. Load the active milestone and verify the adopter.
2. Select and upload required media.
3. Validate text and ready asset IDs.
4. Create the home update.
5. mark the milestone completed.
6. recompute the next due milestone/status.
7. append a typed adoption event to the conversation.
8. notify the original poster.

The update media belongs to the adoption update, not merely to the chat message. The chat event links to it.

## 48. Relisting From Chat

Current relist behavior closes the adoption record and then removes the entire thread and its messages from local state.

Production should not hard-delete conversation history during relisting.

Recommended behavior:

- close the placement with reason
- return the listing to an available state
- resolve the linked request
- archive or lock the old adoption conversation
- append a typed relist/placement-ended event
- preserve history for participants and authorized safety review under retention policy
- create a new request/conversation for future applicants

The frontend may hide archived history from the default inbox without physically deleting it.

## 49. Adoption Conversation Closure

Conversation capability should derive from domain state.

Examples:

- submitted request: limited according to request policy
- approved/in chat: both participants may message
- adopted placement: both may continue for updates
- rejected/canceled request: composer disabled; conversation hidden or archived
- relisted/closed placement: composer disabled or limited according to support policy
- blocked participant: ordinary messaging disabled

The server should return `can_send`, reason code, and allowed actions.

## 50. Editing, Unsend, And Deletion

The current UI has no message edit, unsend, conversation delete, or archive behavior.

If implemented:

- edit only eligible user-authored messages within a defined window
- increment message version and store `edited_at`
- rerun safety checks
- unsend creates a tombstone rather than silently erasing audit evidence
- delete conversation is per-user hiding, not global deletion
- archive is per-user inbox state
- legal/safety retention may outlive user-visible deletion

System and adoption-event messages should not be user-editable.

## 51. Replies, Reactions, Forwarding, And Sharing

The direct-message UI currently does not support:

- reply-to-message
- reactions
- forwarding
- copying
- sharing a profile/post inside direct chat

Do not infer these as implemented features.

If added, use typed references:

- reply stores `reply_to_message_id`
- reaction is a unique user/message/type relation
- shared post stores a typed attachment and safe snapshot
- forwarding creates a new message while preserving origin metadata allowed by privacy policy

## 52. Search

The Messages tab currently has no conversation or message search.

Recommended search:

- conversation search by authorized participant display fields
- optional message-content search within conversations the user can access
- pagination and stable ranking
- block, deletion, and moderation filtering
- encrypted/private search design consistent with the product's encryption claims

Never expose results from conversations the user no longer has permission to access.

## 53. Participant And Conversation Settings

Suggested per-user conversation state:

- conversation ID
- user ID
- role
- state: pending, active, left, removed
- accepted timestamp
- last-read message ID/time
- mute-until
- archived timestamp
- hidden/deleted timestamp
- notification level
- last-accessed timestamp

Shared conversation state must not contain one user's mute, unread, or archive preference.

## 54. Suggested Data Model

### conversations

- `id`
- `type`
- `domain_type`
- `domain_id`
- `state`
- `last_message_id`
- `last_activity_at`
- `created_by_user_id`
- `created_at`
- `updated_at`
- `version`

### direct_conversation_pairs

- `conversation_id`
- normalized user A ID
- normalized user B ID
- unique pair/type constraint

### conversation_participants

- `conversation_id`
- `user_id`
- `state`
- `role`
- `request_state`
- `last_read_message_id`
- `last_read_at`
- `muted_until`
- `archived_at`
- `hidden_at`
- `joined_at`
- `updated_at`

### messages

- `id`
- `conversation_id`
- `sender_user_id`, nullable for trusted system events
- `type`
- `text`
- `reply_to_message_id`
- `client_idempotency_key`
- `state`
- `moderation_state`
- `created_at`
- `edited_at`
- `removed_at`
- `version`

### message_attachments

- `message_id`
- `asset_id`
- `attachment_type`
- `position`
- optional structured metadata

### message_delivery_receipts

- `message_id`
- `user_id`
- `delivered_at`
- `read_at`

Use participant read cursors instead of per-message read rows if that better fits scale. Per-message delivery rows are optional.

### user_message_preferences

- `user_id`
- direct-message notifications
- request notifications
- adoption-message notifications
- preview policy
- quiet hours/digest fields if supported
- `version`
- `updated_at`

### user_blocks

- `blocker_user_id`
- `blocked_user_id`
- `reason_code`
- `created_at`
- `removed_at`

### message_reports

- `id`
- `reporter_user_id`
- `reported_user_id`
- `conversation_id`
- `message_id`
- `reason_code`
- `details`
- `state`
- `evidence_snapshot`
- moderator fields and timestamps

### messaging_device_tokens

- `id`
- `user_id`
- `device_id`
- push provider/token
- platform
- active state
- last success/failure timestamps

## 55. Suggested API Surface

Inbox and conversations:

- `GET /conversations?type=direct`
- `GET /conversations?type=adoption`
- `POST /conversations/direct`
- `GET /conversations/:id`
- `POST /conversations/:id/accept`
- `POST /conversations/:id/decline`
- `POST /conversations/:id/archive`
- `DELETE /conversations/:id/me`

Messages:

- `GET /conversations/:id/messages`
- `POST /conversations/:id/messages`
- `PATCH /messages/:id`
- `DELETE /messages/:id`
- `POST /conversations/:id/read`
- `POST /conversations/:id/typing`

Settings and safety:

- `PATCH /conversations/:id/preferences`
- `GET /me/message-preferences`
- `PATCH /me/message-preferences`
- `POST /users/:id/block`
- `DELETE /users/:id/block`
- `GET /me/blocked-users`
- `POST /message-reports`

Media:

- `POST /media/upload-sessions`
- `POST /media/upload-sessions/:id/complete`

Adoption integration:

- `POST /adoption-requests/:id/conversation`
- `POST /adoption-requests/:id/owner-reply`
- `POST /adoption-requests/:id/mark-adopted`
- `POST /adoption-records/:id/home-updates`
- `POST /adoption-records/:id/relist`

## 56. Events And Outbox

Recommended durable events:

- `conversation.created`
- `conversation.requested`
- `conversation.accepted`
- `conversation.declined`
- `message.created`
- `message.edited`
- `message.removed`
- `conversation.read_cursor_advanced`
- `conversation.muted`
- `user.blocked`
- `message.reported`
- `adoption.request_approved`
- `adoption.marked_adopted`
- `adoption.home_update_posted`
- `adoption.relisted`

Write domain state and outbox records in the same transaction. Consumers can update:

- realtime streams
- push notifications
- unread counters
- search indexes
- moderation queues
- analytics
- audit logs

## 57. Authorization Rules

Every message read/send must verify:

- authenticated active account
- active conversation participation
- correct conversation type/domain access
- no applicable block
- request state allows the operation
- sender has not been restricted
- conversation/domain is not closed
- message/attachment belongs to the conversation

The client-supplied sender ID must never determine identity.

## 58. Rate Limits And Abuse Controls

Apply limits by:

- account
- recipient
- conversation
- IP/device risk signal
- message request
- attachment volume

Controls should cover:

- rapid new-conversation creation
- repeated unsolicited messages
- duplicate spam
- abusive links
- oversized attachment uploads
- report abuse
- block/unblock cycling used to harass

Trusted adoption communication may have different initiation limits, but it still requires safety controls.

## 59. Retention And Privacy

Define:

- user-visible delete behavior
- inactive conversation retention
- attachment retention
- report evidence retention
- account deletion handling
- legal hold behavior
- backup deletion schedule
- export policy

Transport should use TLS, and sensitive data should be encrypted at rest. Secrets and private attachment URLs must not be logged.

The backend should minimize message content in analytics and operational logs.

## 60. Current Frontend Gaps

These are current gaps, not intended production behavior:

- ordinary messages are stored inside Adoption context
- all conversations/messages are mock or in-memory
- New Message compose icon does nothing
- profile Message only opens the tab
- no direct-conversation creation flow
- message privacy policy is not enforced
- blocking is device-local and does not stop sending
- reporting is toast-only
- muting is screen-local and resets
- media buttons do nothing
- no file/voice/location attachment definition
- outgoing check icon is not a real receipt
- opening a conversation does not mark it read
- unread counts never update
- Messages tab has no unread badge
- general inbox does not reorder after sending
- all messages load at once
- every nonempty chat displays "Today"
- no realtime transport
- no offline retry/idempotency
- no typing indicator
- no message requests
- no search, archive, delete, edit, or unsend
- no durable notification preferences
- no direct-message push notifications
- system messages can be generated by local client state
- adoption request approval and first reply are separate local mutations
- mark-adopted changes are not one backend transaction
- relisting deletes local conversation history

## 61. Core Invariants

1. One active direct conversation exists per eligible unordered user pair.
2. One adoption conversation exists per adoption request unless explicitly versioned.
3. Only authorized active participants can read a conversation.
4. Only eligible participants can send.
5. Blocked users cannot initiate or continue ordinary direct messaging.
6. User message policy is enforced for new conversations.
7. System messages can be created only by trusted backend services.
8. Message IDs and timestamps are server-authoritative.
9. Send retries with one idempotency key create at most one message.
10. Attachments must be ready, authorized, and safe before message acceptance.
11. Read cursors move forward only.
12. Unread counts exclude the user's own messages.
13. Mute/archive/read state is per user.
14. Adoption actions verify the linked listing, request, record, and participants.
15. Relisting does not silently destroy required safety history.
16. Push/deep links recheck conversation access.
17. Reports preserve controlled evidence and are auditable.

## 62. Backend Acceptance Checklist

- [ ] General conversations load from a paginated backend inbox.
- [ ] Adoption conversations remain typed and separately queryable.
- [ ] New Message and profile Message find or create the correct direct conversation.
- [ ] Everyone, Circles, and No one policies are enforced.
- [ ] Unknown senders use the defined request workflow.
- [ ] Adoption thread creation is transactional with the request link.
- [ ] Text sending is idempotent and server-authorized.
- [ ] Image/camera attachments use real selected and uploaded assets.
- [ ] Undefined plus-menu attachment types are not silently accepted.
- [ ] Message status distinguishes pending, accepted, delivered, read, and failed.
- [ ] Opening a conversation updates its read cursor.
- [ ] Inbox and tab unread counts update correctly.
- [ ] Inbox order changes when new activity arrives.
- [ ] Message history uses cursor pagination and correct date groups.
- [ ] Realtime reconnect recovers authoritative state.
- [ ] Offline retries cannot duplicate messages.
- [ ] Per-conversation drafts survive navigation locally.
- [ ] Mute and notification preferences persist across devices.
- [ ] Push notifications honor blocks, mute, privacy, and preview settings.
- [ ] Blocking stops ordinary messaging and presence delivery.
- [ ] Reporting creates a durable moderation case.
- [ ] System/adoption events cannot be forged by clients.
- [ ] Poster first-reply approval follows one explicit atomic rule.
- [ ] Mark as adopted updates request, listing, record, chat events, and notifications coherently.
- [ ] Home-update media belongs to the adoption update and is linked from chat.
- [ ] Relisting archives/locks history rather than hard-deleting it.
- [ ] Every media read and conversation deep link rechecks authorization.
- [ ] High-impact safety and domain transitions are auditable.

## 63. Expo SDK 56 Client Integration References

The mobile implementation should follow the exact Expo SDK 56 behavior:

- Media library: `ImagePicker.launchImageLibraryAsync`
- Camera: `ImagePicker.launchCameraAsync`
- Interrupted Android picker recovery: `ImagePicker.getPendingResultAsync`
- Optional file attachment picker: `DocumentPicker.getDocumentAsync`
- For immediate file reads after document selection, use the documented `copyToCacheDirectory` behavior when appropriate
- Push token, permission, receipt interaction, and notification response handling: `expo-notifications`
- Conversation deep links: Expo Linking and React Navigation integration

The current `package.json` does not include `expo-image-picker`, `expo-document-picker`, or `expo-notifications`. They must be installed with Expo-compatible versions before those client workflows can be implemented.

Official versioned references:

- <https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/>
- <https://docs.expo.dev/versions/v56.0.0/sdk/document-picker/>
- <https://docs.expo.dev/versions/v56.0.0/sdk/notifications/>
- <https://docs.expo.dev/versions/v56.0.0/sdk/linking/>
