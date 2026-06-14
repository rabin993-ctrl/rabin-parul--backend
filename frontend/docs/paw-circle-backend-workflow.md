# Paw Circle Backend Workflow

## 1. Purpose

This document translates the current Paw Circle frontend into a backend-ready
product and engineering specification.

It covers:

- first-time Paw Circle onboarding
- local circle discovery
- creating and editing circles
- open and approval-based membership
- join requests and tab badges
- member and owner permissions
- group chat and shared posts
- media and file uploads
- pinned messages and shared media
- mentions, forwarding, profiles, and privacy
- notifications, unread state, and activity status
- leaving, removing members, transferring ownership, and deleting a circle
- reports, moderation, audit history, and backend invariants

The frontend is a prototype. Some actions persist in local device storage, some
only change screen-local state, and some only show a toast. The backend must
implement the intended workflow, not reproduce those limitations.

## 2. Frontend Source Map

The main Paw Circle behavior is currently spread across:

- `src/context/PawCircleContext.tsx`
  - onboarding completion
  - created circle records
  - joined circle IDs
  - join, leave, create, and limited edit actions
  - AsyncStorage persistence
- `src/data/pawCircles.ts`
  - circle shape
  - local and Explore circle catalog
  - open/request privacy values
- `src/data/pawCircleChat.ts`
  - mock members
  - mock messages
  - mock unread previews
  - mock join requests
  - mock pinned messages, photos, and files
- `src/screens/CirclesScreen.tsx`
  - onboarding
  - circle hub
  - create-circle form
- `src/screens/ExploreCirclesScreen.tsx`
  - discovery, search, filters, and join buttons
- `src/screens/pawCircles/CirclesManageSection.tsx`
  - circle cards
  - privacy selector
  - pending-request sheet
  - member preview and local removal
- `src/screens/pawCircles/CircleChatScreen.tsx`
  - text chat
  - shared feed-post cards
  - member activity display
- `src/screens/pawCircles/CircleMembersScreen.tsx`
  - member search and sorting
  - join request approval/decline controls
  - member removal controls
- `src/screens/pawCircles/CircleSettingsScreen.tsx`
  - mute setting
  - pinned content
  - shared media/files
  - reports
  - owner editing and member leave
- `src/screens/pawCircles/CircleAdminScreen.tsx`
  - owner-only details, privacy, member removal, ownership transfer, and delete
- `src/navigation/GlassTabBar.tsx`
  - pending join-request badge
- `src/components/ForwardSheet.tsx`
  - forwarding posts to circles, communities, or members
- `src/components/MentionPicker.tsx`
  - mentioning circles and their members
- `src/components/feed/PostComposer.tsx`
  - mentions can use Paw Circles, but posting destinations currently include
    Feed and Communities only
- `src/screens/NotificationsScreen.tsx`
  - mock circle-request notifications with local Accept/Ignore behavior
- `src/context/UserPrivacyContext.tsx`
  - profile, post, and message visibility values containing `circles`
- `src/screens/pawCircles/UserProfileScreen.tsx`
  - member public profiles and an unwired `Add to circle` button

## 3. Terminology

### Paw Circle

A local or interest-based group with members, one or more administrators, a
chat, shared content, and optional approval-based membership.

### Owner

The user who created the circle. The frontend identifies an owner by checking
whether the circle appears in `createdCircles`.

The backend should store ownership explicitly.

### Admin

A member with circle-management permissions. The current frontend only models
`admin` and `member`, and treats the creator as the effective owner/admin.

### Member

A user with an active membership who may view and participate in the circle.

### Applicant

A user with a pending request to join an approval-based circle.

### Open circle

A circle that a discoverable user may join immediately.

Frontend value: `privacy = open`.

### Request-to-join circle

A circle where joining creates a pending request that an owner/admin must
approve.

Frontend value: `privacy = request`.

### Shared post

A reference to an existing feed or community post placed into circle chat. It
should not duplicate the source post.

### Circle-only post

A post whose audience is a circle. The mock data contains a `circle` Boolean
and `circleId`, but the active composer does not currently publish directly to
a Paw Circle.

## 4. Current Frontend State Model

The locally persisted Paw Circle state contains:

```ts
{
  onboardingComplete: boolean;
  created: PawCircle[];
  joinedIds: string[];
}
```

Each `PawCircle` currently contains:

```ts
{
  id: string;
  name: string;
  location: string;
  memberCount: number;
  icon: string;
  tint: string;
  iconBg: string;
  tagline?: string;
  bio?: string;
  tags?: string[];
  privacy?: "open" | "request";
}
```

Only the following are meaningfully persisted:

- onboarding completion
- locally created circle objects
- joined catalog circle IDs
- edited name and bio for locally created circles
- per-device mute settings under a separate AsyncStorage key

The following are mock or screen-local:

- members
- join requests
- chat messages
- last-message previews
- unread counts
- active/away state
- approved or declined request results
- member removals
- privacy changes from the hub card
- location and privacy changes from Admin
- pinned messages
- shared media and files
- reports
- ownership transfer
- circle deletion
- circle-related notifications

## 5. Recommended Backend Data Model

Use server-generated UUIDs and real timestamps. Human-readable strings such as
`Yesterday`, `2h ago`, and `Jan 2024` are display values, not database values.

### `circles`

Recommended fields:

- `id`
- `owner_user_id`
- `name`
- `slug`
- `bio`
- `location_label`
- `location_area_id`
- `latitude`
- `longitude`
- `privacy`: `open`, `request`
- `visibility`: `discoverable`, `unlisted`, `hidden`
- `status`: `active`, `archived`, `deleting`, `deleted`, `suspended`
- `icon_key`
- `theme_tint`
- `theme_background`
- `member_count`
- `pending_request_count`
- `created_at`
- `updated_at`
- `deleted_at`

`member_count` and `pending_request_count` may be maintained counters, but the
membership and request tables remain authoritative.

### `circle_memberships`

Recommended fields:

- `id`
- `circle_id`
- `user_id`
- `role`: `owner`, `admin`, `member`
- `status`: `active`, `left`, `removed`, `banned`
- `joined_at`
- `left_at`
- `removed_by_user_id`
- `removal_reason`
- `created_from_request_id`
- `last_read_message_id`
- `last_read_at`
- `muted_until`
- `notifications_enabled`

Constraints:

- only one current membership row per circle/user
- exactly one active owner per active circle
- an owner is always an active member

### `circle_join_requests`

Recommended fields:

- `id`
- `circle_id`
- `requester_user_id`
- `note`
- `status`: `pending`, `approved`, `declined`, `canceled`, `expired`
- `reviewed_by_user_id`
- `reviewed_at`
- `created_at`
- `updated_at`

Constraint:

- only one pending request per circle/requester pair

Keep resolved requests for audit and abuse prevention instead of deleting them.

### `circle_invitations`

This supports the public-profile `Add to circle` action.

Recommended fields:

- `id`
- `circle_id`
- `inviter_user_id`
- `invitee_user_id`
- `status`: `pending`, `accepted`, `declined`, `canceled`, `expired`
- `message`
- `expires_at`
- `responded_at`
- `created_at`

### `circle_messages`

Recommended fields:

- `id`
- `circle_id`
- `sender_user_id`
- `type`: `text`, `shared_post`, `image`, `video`, `file`, `system`
- `text`
- `source_post_id`
- `reply_to_message_id`
- `status`: `active`, `edited`, `removed_by_sender`, `removed_by_moderator`
- `created_at`
- `edited_at`
- `deleted_at`
- `client_idempotency_key`

System messages should use structured event data in addition to rendered text:

- `system_event_type`
- `system_actor_user_id`
- `system_target_user_id`
- `system_metadata`

Examples:

- member joined
- request approved
- member removed
- ownership transferred
- circle renamed

### `circle_message_attachments`

Recommended fields:

- `id`
- `message_id`
- `media_asset_id`
- `sort_order`
- `created_at`

### `media_assets`

Use the shared production media model described in the adoption workflow.

Recommended fields:

- `id`
- `owner_user_id`
- `purpose`: `circle_message`, `circle_avatar`, `circle_report`
- `media_type`: `image`, `video`, `document`
- `status`: `pending`, `uploading`, `uploaded`, `processing`, `ready`,
  `failed`, `rejected`, `deleted`
- `storage_key`
- `original_filename`
- `mime_type`
- `byte_size`
- `width`
- `height`
- `duration_ms`
- `checksum`
- `thumbnail_storage_key`
- `moderation_status`
- `created_at`
- `ready_at`
- `deleted_at`

### `circle_message_pins`

Recommended fields:

- `id`
- `circle_id`
- `message_id`
- `pinned_by_user_id`
- `pinned_at`
- `removed_by_user_id`
- `removed_at`

Use a unique active pin per circle/message pair.

### `circle_reports`

Recommended fields:

- `id`
- `circle_id`
- `reporter_user_id`
- `message_id`
- `reported_user_id`
- `reason_code`
- `note`
- `status`: `submitted`, `triaged`, `actioned`, `dismissed`
- `reviewer_user_id`
- `resolution`
- `created_at`
- `resolved_at`

### `circle_notification_preferences`

This may be merged into membership.

Recommended fields:

- `circle_id`
- `user_id`
- `mode`: `all`, `mentions`, `none`
- `muted_until`
- `updated_at`

### `circle_events`

Store or emit domain events through a transactional outbox:

- `circle.created`
- `circle.updated`
- `circle.joined`
- `circle.join_requested`
- `circle.join_request_approved`
- `circle.join_request_declined`
- `circle.member_left`
- `circle.member_removed`
- `circle.owner_transferred`
- `circle.deleted`
- `circle.message_sent`
- `circle.message_pinned`
- `circle.report_submitted`

## 6. Roles and Authorization

### Non-member

May:

- discover a discoverable circle
- view public summary data
- join an open circle
- request access to a request-based circle
- cancel their own pending request
- accept a valid invitation
- report a public circle

May not:

- read member chat
- list private members
- access shared media/files
- send messages
- see admin controls

### Applicant

May:

- view their own pending request
- cancel it
- receive approval/decline notification

May not participate until approved.

### Member

May:

- read circle chat
- send allowed messages and attachments
- view active member list
- view pinned/shared content
- mute notifications
- leave the circle
- report content or the circle

May not:

- approve requests
- remove members
- change circle details/privacy
- transfer ownership
- delete the circle

### Admin

May:

- perform member actions
- approve or decline join requests
- remove or ban members
- edit permitted circle details
- pin/unpin messages
- moderate messages and files

Whether admins can invite users, change privacy, or delete a circle should be an
explicit product permission, not inferred by the client.

### Owner

May:

- perform all admin actions
- transfer ownership
- delete/archive the circle

An owner may not leave until ownership is transferred or the circle is deleted.

All authorization must be checked by the backend for every mutation.

## 7. First-Time Onboarding

Current frontend flow:

1. Paw Circle opens.
2. If `onboardingComplete` is false, the user sees the local Dhanmondi circle.
3. `Join Circle` immediately adds its ID to local joined state.
4. `Not Now` only marks onboarding complete.
5. The hub is shown on future visits.

Production flow:

1. Fetch onboarding state and a server-selected local circle recommendation.
2. Recommendation should use the user's location permission or profile area
   only when available and allowed.
3. Do not silently expose exact coordinates.
4. If the user chooses Join:
   - open circle: atomically create active membership
   - request circle: create a pending join request
5. If the user skips, store only the onboarding completion preference.
6. Return the resulting circle/membership/request read model.
7. The action must be idempotent across retries.

The backend should not hard-code Dhanmondi as every user's local circle.

## 8. Creating a Circle

Current form fields:

- name, required after trimming
- location, defaults to `Dhaka` if blank
- privacy: `open` or `request`

Current frontend behavior:

- creates a local object
- generates a slug-like ID on the device
- gives it one member
- uses fixed icon and theme colors
- does not validate duplicates against other users
- does not create a real owner membership or chat

Production workflow:

1. Authenticated user submits name, location, privacy, and optional bio/icon.
2. Backend validates:
   - normalized name length and allowed characters
   - location/area validity
   - privacy value
   - per-user creation limits
   - abuse/rate limits
3. Backend generates an immutable ID and unique slug.
4. In one transaction:
   - create circle
   - create owner membership
   - initialize notification preferences
   - write a structured `circle.created` system message
   - emit `circle.created`
5. Return the full owner read model.

Suggested validation:

- name: 3-80 characters
- bio: maximum 500 characters
- location label: maximum 120 characters
- note and text fields must be sanitized for display, not stored as rendered HTML

## 9. Explore, Search, and Discovery

Current frontend search matches:

- circle name
- location
- tagline

Current filters:

- `All`
- `Nearby`: mock `nearby` tag only
- `Popular`: member count at least 200 or mock `popular` tag

Production discovery should support:

- query
- area or distance radius
- privacy/visibility eligibility
- popular/trending score
- pagination/cursor
- membership/request state for the current user

Each result should return:

- circle summary
- current member count
- `relationship`: `none`, `member`, `owner`, `request_pending`,
  `invited`, `banned`
- `join_action`: `join`, `request`, `cancel_request`, `joined`, `unavailable`
- optional social context such as mutual members, subject to privacy

Nearby must be computed from normalized area/location data, not a manually
assigned tag.

Popular should use a backend-defined score. Member count alone is vulnerable to
spam and does not reflect current activity.

## 10. Joining a Circle

### Open circle

1. User taps Join.
2. Backend verifies the circle is active, discoverable to the user, and open.
3. Backend rejects banned or restricted users.
4. In one transaction:
   - create/reactivate active membership
   - increment/recompute member count
   - resolve any pending invitation
   - add a system message if join announcements are enabled
   - emit `circle.joined`
5. Return membership and circle read models.

### Request-to-join circle

1. User taps Request to join.
2. Optional note is trimmed and validated.
3. Backend verifies no active membership, ban, or existing pending request.
4. Create a pending request.
5. Notify eligible owner/admin users.
6. Update pending-request counters and badges.
7. Return `request_pending`; do not create membership yet.

### Current frontend mismatch

`joinCircle(id)` immediately inserts every circle ID into `joinedIds`.
It does not inspect `privacy`.

The backend must enforce open versus request behavior even if an old client
calls the immediate-join endpoint incorrectly.

## 11. Join Request Review

Current request controls exist in:

- hub cards
- member screen
- notification screen
- tab-bar badge

These controls are not connected to one shared state.

Current Approve/Decline actions only remove a request from that component's
local array. Approval does not add a member. The notification action only marks
the notification handled and says `Connected with ...`.

Production approval:

1. Owner/admin opens pending requests.
2. Backend returns cursor-paginated pending requests with requester profile
   summaries, note, created time, and moderation/risk indicators.
3. Reviewer approves one request.
4. In one transaction:
   - lock and re-check request is pending
   - verify reviewer permission
   - verify requester is still eligible
   - set request to approved
   - create active membership
   - update counts
   - create a join system message
   - create requester notification
   - emit approval and joined events
5. Return updated request, membership, and counters.

Production decline:

- mark request declined with reviewer and timestamp
- do not create membership
- notify requester according to product policy
- retain audit history

Accept all:

- process a bounded list, not an unlimited table
- return success/failure per request
- do not partially hide failures
- use one authorization check and safe row locking

Concurrent review must be idempotent. A second reviewer should receive the
already-resolved result, not create duplicate memberships.

## 12. Members, Search, and Activity

Current member screens support:

- alphabetical sorting
- newest/date-added sorting
- name/handle search
- role label
- profile navigation
- local member removal for owners

Production member list:

- use real `joined_at` timestamps
- paginate large circles
- search only fields allowed by user privacy
- return viewer-specific actions such as `can_remove`
- distinguish owner, admin, member, banned, and former members

### Active/Away logic

The current chat screen infers activity from human-readable message times such
as `Now`, `2h ago`, `AM`, `PM`, `Today`, or `Yesterday`. It also always marks
the current user active.

Production activity must use:

- real presence sessions or a `last_active_at` timestamp
- the user's `showOnline` privacy setting
- a defined activity window, such as active within five minutes

Do not infer presence from message labels.

## 13. Removing, Leaving, and Banning

### Member leaves

1. Member confirms leave.
2. Backend verifies the user is an active non-owner member.
3. Mark membership `left`.
4. Update member count.
5. Revoke future chat/media authorization immediately.
6. Preserve historical messages unless product/legal policy requires removal.
7. Emit `circle.member_left`.

Mute and read state may be retained if rejoining should restore preferences.

### Owner/admin removes a member

1. Reviewer selects Remove.
2. Require confirmation and optional reason.
3. Backend verifies reviewer outranks the target and target is not owner.
4. Mark membership `removed`.
5. Revoke access and update counts.
6. Emit a system/audit event.
7. Notify the removed user according to policy.

### Ban

Removal and ban should be separate actions.

A ban prevents:

- open rejoin
- new join request
- invitation acceptance

Store actor, reason, duration, and appeal/moderation information.

### Current frontend limitation

Removal only filters a local array in the current screen. It does not update
the hub, other member screens, counts, chat access, or persistent state.

## 14. Editing Circle Details and Privacy

Current behavior:

- name and bio updates from `EditCircleSheet` persist for locally created
  circles
- Admin name, location, and privacy fields show a success toast but do not save
- the hub privacy chip changes only its card-local state

Production update rules:

- owner/admin authorization is required
- apply an allowlist of editable fields by role
- validate name, bio, location, icon, and privacy
- return the canonical updated object
- emit a structured system message for meaningful changes
- preserve an audit record

Changing `open` to `request` affects future joins only.

Changing `request` to `open` should not silently approve all pending requests.
Pending requests remain pending unless the product explicitly offers an
admin-confirmed bulk approval action.

## 15. Ownership Transfer and Circle Deletion

### Ownership transfer

The current button only shows `coming soon`.

Production workflow:

1. Owner chooses an active member.
2. Require recent authentication for this high-risk action.
3. Selected member accepts transfer, unless immediate transfer is an explicit
   product decision.
4. In one transaction:
   - promote new owner
   - demote old owner to admin/member
   - update `owner_user_id`
   - create system message and notifications
   - emit `circle.owner_transferred`
5. Keep an immutable audit record.

Exactly one active owner must exist after commit.

### Circle deletion

The current Delete action only shows a toast and returns to Hub.

Production deletion should normally be a soft-delete/archive workflow:

1. Require owner role and recent authentication.
2. Show the impact: members, messages, media, pending requests.
3. Mark circle `deleting` or `archived`.
4. Block new joins and messages immediately.
5. Notify members.
6. Revoke discovery and access.
7. Retain or purge messages/media according to policy.
8. Complete asynchronous cleanup, then mark `deleted`.

Do not physically delete all related rows in a single request.

## 16. Circle Chat

Current message types:

- `text`
- `system`
- `shared_post`

Current composer:

- text only
- trimmed non-empty text
- maximum 2,000 characters
- local ID based on `Date.now()`
- local `Now` timestamp
- local state disappears after leaving/reloading the screen
- plus button only displays `Share a post from your feed`

Production send workflow:

1. Client sends `circleId`, message payload, and a client idempotency key.
2. Backend verifies active membership and circle status.
3. Validate text/attachment/source-post rules.
4. Apply rate limits, block rules, and content moderation.
5. Store message with server timestamp.
6. Fan out through realtime delivery.
7. Update chat preview and unread counters.
8. Create push notifications according to member preferences.
9. Return canonical message.

Required chat behavior:

- cursor pagination
- reconnect and missed-message sync
- delivery ordering by server sequence/timestamp
- idempotent retries
- edit/delete policy
- reply references
- report and moderation actions
- handling for removed source posts

System messages must be generated by trusted backend actions. Clients must not
be allowed to submit arbitrary `system` messages.

## 17. Sharing Feed and Community Posts

The Forward sheet allows selecting:

- one or more Paw Circles
- one or more Communities
- one or more individual circle members

Current Feed behavior:

- increments the source post's local forward count
- shows a success toast
- if exactly one destination is a circle, opens that chat
- does not append a shared-post message to the chat

Community forwarding behaves similarly and does not create a real circle
message.

Production circle share:

1. Verify the sender can view the source post.
2. Verify sender is an active destination-circle member.
3. Verify the source post may be reshared to that audience.
4. Create one `shared_post` message per selected circle.
5. Store only the source post ID plus optional sender comment.
6. Increment forward/share metrics idempotently.
7. Deliver chat updates and notifications.

If the source post is later deleted or visibility changes:

- the message remains as an audit shell
- the card becomes unavailable
- private content must never continue to render from a stale cache

Sharing to an individual member belongs to direct messaging, not circle chat.
The backend should route it through the messaging service.

## 18. Circle-Only Posts and Feed Integration

The mock post model includes:

- `circle: boolean`
- `circleId?: string`

Some seed posts carry a `circleId`, and one seed post has `circle = true`.

However:

- the active post destination picker supports Feed and Communities, not Paw
  Circles
- the selected Paw Circle in the Feed lens changes the displayed label/drawer
  state but does not filter the feed by `circleId`
- profile post grids intentionally hide posts where `circle` is true

Recommended production model:

- use explicit post-audience records rather than a Boolean
- allow a post to target Feed, one or more Communities, or one or more Circles
- enforce membership when publishing to a circle
- return posts only when the viewer is allowed to see at least one audience
- exclude circle-only posts from public profiles
- show them in the selected circle feed and/or circle chat according to product
  design

Do not use `circle = true` as the authorization rule.

## 19. Real Media and File Sharing

### Current frontend behavior

Paw Circle does not currently perform real attachment selection or upload:

- chat plus button only shows an informational toast
- shared photos/files come from static mock arrays
- `getSharedMedia(circleId)` ignores the circle ID and returns the same global
  items for every circle
- opening a photo/file only shows a toast
- `expo-image-picker` and `expo-document-picker` are not installed

### Production picker workflow

For Expo SDK 56:

- use `expo-image-picker` for photos, camera, and video
- use `expo-document-picker` for documents
- use the exact versioned documentation:
  - `https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/`
  - `https://docs.expo.dev/versions/v56.0.0/sdk/document-picker/`

1. User taps the chat attachment button.
2. Show allowed actions:
   - share existing post
   - choose photo/video
   - take photo/record video
   - choose file
3. Ask for camera/media permissions only when needed.
4. Preserve the draft if permission is denied or selection is canceled.
5. On web, launch the system picker directly from the user's tap.
6. On Android, recover image-picker results with
   `ImagePicker.getPendingResultAsync()` after activity recreation.
7. Read filename, MIME type, size, dimensions, and duration.
8. Show local previews and allow remove/retry before sending.
9. Never send a local device URI as the permanent backend reference.

Suggested limits:

- images: JPEG, PNG, HEIC, or WebP; 10 MB each
- video: MP4 or MOV; 60 seconds and 100 MB
- documents: PDF, DOC/DOCX, and selected safe formats; 25 MB
- maximum attachments per message: product-defined, such as 10 images or one
  video/file combination

The server is authoritative for file signatures, sizes, and allowed types.

### Upload workflow

1. Client requests an upload session.
2. Backend verifies membership, circle status, media policy, and rate limits.
3. Backend creates a pending `media_assets` row.
4. Return short-lived signed object-storage upload details.
5. Client uploads with progress, retry, and cancel controls.
6. Client calls upload complete.
7. Backend verifies the actual object and content signature.
8. Scan for malware and moderate/transcode as needed.
9. Mark asset `ready`.
10. Send the chat message with ready asset IDs.
11. Atomically create message and attachment rows.
12. Clean up unattached assets after a short expiry.

The Send button should be disabled while selected attachments are not ready.
Repeated send attempts with the same idempotency key must create one message.

### Media privacy

- use private storage keys
- authorize every download against current membership and moderation state
- use expiring signed/CDN URLs for private media
- strip or ignore public EXIF/location metadata
- immediately revoke access after leave/removal
- retain moderated evidence according to policy

## 20. Pinned Messages and Shared Media

Current settings display:

- pinned message count
- shared item count
- photo grid
- file list

Production pinned workflow:

1. Authorized admin pins a message.
2. Backend verifies the message belongs to the same circle and is active.
3. Create an active pin record.
4. Emit realtime update and audit event.
5. Unpin by closing the active pin record.

Production shared-media view:

- derive from active circle message attachments
- filter by media type
- paginate
- respect deleted/moderated messages
- return thumbnails and authorized download URLs
- preserve original message ID and sender context

Do not maintain a separate unconnected global mock list.

## 21. Mentions and Member Selection

The Mention picker can insert:

- Community token
- Paw Circle token
- Circle member handle

Current behavior inserts plain text such as `@Dhanmondi` or `@handle`.
It does not store a target ID or create a mention notification.

Production mentions should use structured ranges:

```json
{
  "text": "Thanks @omar.k",
  "mentions": [
    {
      "type": "user",
      "targetId": "user-id",
      "start": 7,
      "length": 7
    }
  ]
}
```

Rules:

- resolve targets by stable IDs, not display text
- only expose mentionable circles/members the author may access
- validate ranges server-side
- block mentions of blocked or inaccessible users
- create mention notifications subject to preferences
- render safely if handle/name changes later

## 22. Public Profiles and `Add to Circle`

Circle member rows open the shared public profile screen.

The public profile currently includes an `Add to circle` button with no action.

Production action:

1. Show only circles where the viewer can invite members.
2. Exclude circles where the target is already active, banned, or invited.
3. Create a pending invitation.
4. Notify the target.
5. Target accepts or declines.
6. On acceptance, atomically create membership and resolve invitation.

Do not immediately add another user without consent.

The mock user fields `circle` and `circleCount` are not connected to Paw Circle
membership. Backend profile counts should be derived from real relationships,
with privacy rules applied.

## 23. `Circles` Privacy Meaning

Profile privacy supports:

- who can see profile: `everyone`, `circles`, `only_me`
- who can see posts: `everyone`, `circles`, `only_me`
- who can message: `everyone`, `circles`, `none`

The backend must define `circles` precisely.

Recommended meaning:

Two users are circle-connected when they share at least one active Paw Circle
membership.

Authorization query:

- viewer has an active membership in circle X
- profile owner has an active membership in the same circle X
- neither relationship is blocked/restricted

This rule must be used consistently by:

- profile reads
- post reads
- direct-message initiation
- search/discovery
- mention/member selection

The current frontend stores privacy settings but does not enforce them against
public profile routes.

## 24. Notifications, Unread Counts, and Badges

### Current badge logic

The bottom Paw Circle tab badge equals:

```ts
sum(getJoinRequests(circleId).length for each locally created circle)
```

This means:

- only created circles count
- all mock requests count
- approvals from another screen do not reliably reduce the global badge
- the count is not tied to notification read state

Circle chat card unread counts also come from static preview data.

The Paw Circle subheader bell displays a fixed count of `2`.

### Production badge model

Return separate counters:

- `pendingJoinRequests`
- `unreadCircleMessages`
- `unreadCircleNotifications`
- optional `mentions`

The UI may combine them, but API names must preserve their meaning.

### Notification events

Create notifications for:

- join request received
- request approved/declined
- invitation received/accepted/declined
- member removed
- ownership transfer requested/completed
- mention
- pinned announcement
- report resolution, where appropriate

Notification actions must invoke the same membership/request service used by
the circle screens. They must not maintain independent local state.

Push notifications should follow Expo SDK 56 notification requirements:

`https://docs.expo.dev/versions/v56.0.0/sdk/notifications/`

Use a transactional outbox so database state and emitted notifications cannot
silently disagree.

## 25. Chat Preview, Unread, and Read State

Current preview data contains:

- last-message text
- display time
- unread integer

Production preview should return:

- last visible message ID/type/text summary
- sender summary
- server timestamp
- unread count for current member
- mention count
- muted state
- pending request count for admins

Unread rules:

1. A member has a per-circle `last_read_message_id` or read sequence.
2. Messages after that point, excluding the member's own messages and hidden
   messages, are unread.
3. Opening a chat does not automatically mark everything read until the client
   confirms the latest visible message.
4. Mark-read mutations are monotonic.
5. Muting affects notifications, not unread calculation.

## 26. Reporting and Moderation

Current report reasons:

- spam or misleading content
- harassment or bullying
- inappropriate media
- circle safety concern
- other

Current Submit only closes the sheet and shows a toast.

Production report flow:

1. Validate reporter can identify the circle/content being reported.
2. Accept reason plus optional note.
3. Snapshot stable references, not private rendered content in client logs.
4. Create moderation case.
5. Acknowledge without exposing reviewer/private details.
6. Apply rate limits and abuse controls.
7. Preserve evidence even if a message is later deleted.
8. Notify reporter on resolution only when policy allows.

Moderation actions may:

- hide/remove a message
- quarantine an attachment
- suspend a member
- suspend/archive a circle
- restrict discovery or invitations

## 27. Suggested API Surface

```text
GET    /paw-circles/onboarding
POST   /paw-circles/onboarding/complete

GET    /paw-circles
POST   /paw-circles
GET    /paw-circles/:circleId
PATCH  /paw-circles/:circleId
DELETE /paw-circles/:circleId

GET    /paw-circles/explore
POST   /paw-circles/:circleId/join
POST   /paw-circles/:circleId/leave

GET    /paw-circles/:circleId/join-requests
POST   /paw-circles/:circleId/join-requests
DELETE /paw-circles/:circleId/join-requests/me
POST   /paw-circle-join-requests/:requestId/approve
POST   /paw-circle-join-requests/:requestId/decline
POST   /paw-circles/:circleId/join-requests/approve-batch

GET    /paw-circles/:circleId/members
PATCH  /paw-circles/:circleId/members/:userId
DELETE /paw-circles/:circleId/members/:userId
POST   /paw-circles/:circleId/members/:userId/ban
DELETE /paw-circles/:circleId/bans/:userId

POST   /paw-circles/:circleId/invitations
GET    /paw-circle-invitations
POST   /paw-circle-invitations/:invitationId/accept
POST   /paw-circle-invitations/:invitationId/decline

POST   /paw-circles/:circleId/ownership-transfers
POST   /paw-circle-ownership-transfers/:transferId/accept
POST   /paw-circle-ownership-transfers/:transferId/cancel

GET    /paw-circles/:circleId/messages
POST   /paw-circles/:circleId/messages
PATCH  /paw-circle-messages/:messageId
DELETE /paw-circle-messages/:messageId
POST   /paw-circles/:circleId/read

POST   /paw-circle-messages/:messageId/pin
DELETE /paw-circle-messages/:messageId/pin
GET    /paw-circles/:circleId/pins
GET    /paw-circles/:circleId/media

POST   /paw-circles/:circleId/share-post

POST   /media/upload-sessions
POST   /media/:mediaAssetId/complete
GET    /media/:mediaAssetId/status
DELETE /media/:mediaAssetId

GET    /paw-circles/:circleId/notification-preferences
PATCH  /paw-circles/:circleId/notification-preferences

POST   /paw-circles/:circleId/reports
POST   /paw-circle-messages/:messageId/reports

GET    /paw-circles/summary
```

## 28. Recommended Read Models

### Hub summary

```json
{
  "onboardingComplete": true,
  "counters": {
    "pendingJoinRequests": 3,
    "unreadMessages": 7,
    "mentions": 1
  },
  "circles": [
    {
      "id": "uuid",
      "name": "Dhanmondi Paw Circle",
      "location": "Dhanmondi, Dhaka",
      "privacy": "request",
      "viewerRole": "owner",
      "memberCount": 25,
      "pendingRequestCount": 3,
      "unreadCount": 2,
      "muted": false,
      "lastMessage": {
        "id": "uuid",
        "type": "text",
        "senderName": "Omar",
        "preview": "Morning walk at the lake?",
        "createdAt": "2026-06-14T08:30:00Z"
      }
    }
  ]
}
```

### Explore relationship

```json
{
  "circle": {
    "id": "uuid",
    "name": "Cat Parents",
    "privacy": "request",
    "memberCount": 186
  },
  "relationship": "request_pending",
  "joinAction": "cancel_request"
}
```

### Message

```json
{
  "id": "uuid",
  "circleId": "uuid",
  "type": "shared_post",
  "sender": {
    "id": "uuid",
    "name": "Aisha Rahman",
    "handle": "aisharahman"
  },
  "sourcePost": {
    "id": "uuid",
    "available": true
  },
  "attachments": [],
  "createdAt": "2026-06-14T08:30:00Z",
  "viewerCanDelete": true,
  "viewerCanPin": true
}
```

## 29. Backend Invariants

- An active circle has exactly one active owner.
- An owner has an active membership in their circle.
- A user cannot have duplicate active memberships in one circle.
- A user cannot have both active membership and a pending join request.
- Only active members can read or send circle chat.
- Request-based circles never create membership before approval.
- Open-circle join is idempotent.
- Approval creates membership and resolves the request atomically.
- Counts cannot be trusted from clients.
- Message sender and server timestamp come from authenticated server context.
- Clients cannot create system messages.
- Shared posts must be authorized at send and read time.
- Message attachments must be ready, owned by the sender, and intended for the
  same circle/message purpose.
- Unread/read progression is monotonic.
- Removing/leaving immediately revokes future private content access.
- A deleted/suspended circle accepts no new joins or messages.
- Notification events and state-changing transactions use an outbox or
  equivalent reliable mechanism.

## 30. Current Frontend Gaps the Backend Must Not Copy

- Membership and created circles are local-device state.
- Joining ignores circle privacy and always joins immediately.
- Request approval/decline only removes rows from local component state.
- Approval does not add the requester as a member.
- Join requests exist only for hard-coded mock circle IDs.
- The tab badge is computed from static request arrays.
- Notification Accept/Ignore is independent from circle request screens.
- Chat messages are local, text-only, and disappear on reload.
- Shared-post forwarding does not create a chat message.
- Unread previews are static and do not clear on chat open.
- Active/away status is inferred from display strings.
- Member removals do not persist or revoke access.
- Name/bio editing persists, but Admin location/privacy Save only shows a
  toast.
- Hub privacy changes are card-local.
- Transfer ownership is not implemented.
- Delete circle only shows a toast.
- Reports only show a toast.
- Pinned and shared media are mock data.
- Shared media ignores the requested circle ID.
- Chat attachment selection/upload is not implemented.
- Circle mentions are plain text without target IDs or notifications.
- `Add to circle` on public profiles has no action.
- Feed's selected circle does not filter posts.
- Normal post creation cannot target Paw Circles.
- Mock `circle`/`circleId` post fields are not a real audience model.
- Profile privacy values containing `circles` are stored but not enforced.
- Mock user `circleCount` is unrelated to real membership.
- IDs and times use client-generated/display values.

## 31. Minimum Acceptance Scenarios

1. First-time user joins an open local circle and receives an active
   membership.
2. First-time user skips and can explore/join later.
3. User creates a circle and becomes its sole owner in one transaction.
4. Open circle joins immediately; request circle creates only a pending request.
5. Duplicate join/request taps do not create duplicate rows.
6. Owner sees pending request counts on hub, settings, members, notification,
   and tab badge from one source of truth.
7. Approval atomically resolves request, creates membership, updates counts,
   emits system chat entry, and notifies requester.
8. Decline resolves request without creating membership.
9. Member search/sort uses real profile data and timestamps.
10. Removed or departed member immediately loses chat and private media access.
11. Owner cannot leave until transferring ownership or deleting the circle.
12. Ownership transfer leaves exactly one owner and creates audit history.
13. Updating name/location/privacy returns canonical values to every screen.
14. Text message persists, appears through realtime delivery, and survives app
    restart.
15. Retried message send with the same idempotency key creates one message.
16. Forwarding a feed/community post creates a real shared-post chat message.
17. Source-post deletion or privacy loss makes the shared card unavailable.
18. User can select allowed photos/videos/files, preview them, upload with
    progress, retry failures, and send only ready assets.
19. Permission denial, picker cancellation, Android activity recreation,
    network loss, expired upload URL, invalid MIME, oversized file, failed scan,
    and processing failure preserve a recoverable draft and clear error.
20. Shared media and pins are scoped to the correct circle.
21. Opening/reading chat advances read state and updates unread counters across
    devices.
22. Muting suppresses notifications but does not erase unread counts.
23. Mentions store stable target IDs and notify only eligible users.
24. `Add to circle` sends an invitation; it does not silently add the user.
25. `circles` profile/post/message privacy is enforced through shared active
    membership.
26. Circle report creates a moderation case with evidence and audit history.
27. Delete/archive blocks new joins/messages and performs policy-based cleanup.
28. Suspended or banned users cannot bypass restrictions through old clients.
