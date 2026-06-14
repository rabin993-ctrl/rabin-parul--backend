# Community Backend Workflow

## 1. Purpose

This document translates the current frontend Community feature into a backend implementation contract.

It covers:

- Community groups and discovery
- Joining, requesting access, invitations, leaving, and removal
- Roles and permissions
- Community posts, cross-posting, media, comments, reactions, saves, and sharing
- Lost and found post requirements
- General Community settings
- Per-group admin settings
- Member management, post approval, reports, and moderation
- Notifications, privacy, audit history, APIs, and edge cases

The frontend currently uses mock data and in-memory React state. Where the current behavior is inconsistent or incomplete, this document states that explicitly and then defines the corrected production workflow.

## 2. Frontend Source Map

The main frontend sources are:

- `src/navigation/CommunityNavigator.tsx`
- `src/context/CommunityGroupsContext.tsx`
- `src/context/CommunityFeedContext.tsx`
- `src/data/communityPosts.ts`
- `src/data/mockData.ts`
- `src/screens/community/CommunityFeedScreen.tsx`
- `src/screens/community/CommunityGroupScreen.tsx`
- `src/screens/community/CommunityDiscoverScreen.tsx`
- `src/screens/community/CommunitySearchScreen.tsx`
- `src/screens/community/CommunitySavedScreen.tsx`
- `src/screens/community/CommunityPostDetailScreen.tsx`
- `src/screens/community/CommunityCreatePostScreen.tsx`
- `src/screens/community/CommunityCreateScreen.tsx`
- `src/screens/community/CommunitySettingsScreen.tsx`
- `src/screens/community/CommunityAdminScreen.tsx`
- `src/screens/community/CommunityMembersScreen.tsx`
- `src/screens/community/CommunityGroupMembersScreen.tsx`
- `src/screens/community/CommunityPendingRequestsScreen.tsx`
- `src/screens/community/CommunityRulesScreen.tsx`
- `src/components/feed/PostComposer.tsx`
- `src/components/community/CommunityComposer.tsx`
- `src/components/community/CommunityCommentSheet.tsx`

## 3. Product Concepts

The backend should keep these concepts separate:

1. **Community**
   A user-created group with an identity, rules, members, roles, access policy, and posting settings.

2. **Membership**
   The relationship between a user and a community, including state and role.

3. **Community post**
   Content published into one community. It has its own moderation state, comments, reactions, and visibility.

4. **Cross-post batch**
   A record that relates posts created from one composer action across several destinations.

5. **User Community preferences**
   A user's general notification and experience settings for Community.

6. **Community admin settings**
   Rules that apply to one specific community.

7. **Formal Rescue case**
   A separate Rescue-domain workflow. A Community post with the `rescue` topic is only a discussion or awareness post unless it is explicitly linked to a Rescue case.

## 4. Current Frontend Data

The mock `Community` object includes:

- `id`
- `name`
- `members`, stored as display text such as `4.2k`
- `tint`
- `icon`
- `about`
- `joined`
- `role`

The mock `CommunityPost` includes:

- `id`
- `title`
- `body`
- `category`
- optional composer label
- optional lost/found metadata
- `authorId`
- optional companion IDs
- `communityId`
- `communityName`
- display time and location
- helpful count and `helpfulByMe`
- comments
- saved boolean
- optional image boolean/tint
- trending score
- comment threads

The production backend must not store formatted member counts, relative time strings, or user-specific booleans directly on shared records. It should store canonical values and derive display data for the authenticated user.

## 5. Source Of Truth

The frontend currently has several independent sources of Community state:

- `CommunityGroupsContext` for memberships and group settings
- `CommunityFeedContext` for posts, comments, helpful reactions, and saves
- static communities in `mockData.ts`
- a legacy Community hub with another local community list

This causes joined groups, composer destinations, member lists, counts, and settings to disagree.

The backend must be the canonical source of truth. Frontend contexts should become caches or query-state wrappers around backend responses, not independent authorities.

## 6. Roles And Authorization

Recommended roles:

- `owner`: the community creator or transferred owner
- `admin`: optional full administrator without ownership-transfer rights
- `moderator`: manages content and ordinary membership within granted capabilities
- `member`: participates under community rules

Membership state and role must be separate. A banned user is not simply a member with a different role.

Every sensitive operation must be authorized on the server. Hiding a button in the frontend is not authorization.

Suggested capability matrix:

| Capability | Owner | Admin | Moderator | Member |
| --- | --- | --- | --- | --- |
| View members-only content | Yes | Yes | Yes | Yes |
| Create posts | Yes | Yes | Yes | If settings allow |
| Moderate posts/comments | Yes | Yes | Yes | No |
| Review reports | Yes | Yes | Yes | No |
| Review join requests | Yes | Yes | Configurable | No |
| Remove ordinary members | Yes | Yes | Configurable | No |
| Promote/demote moderators | Yes | Yes | No | No |
| Edit identity/privacy | Yes | Configurable | No | No |
| Transfer ownership | Yes | No | No | No |
| Delete/archive community | Yes | No | No | No |

The API should return capabilities with the community response so the frontend can render actions consistently.

## 7. Community Lifecycle

Recommended community states:

- `active`
- `restricted`
- `suspended`
- `archived`
- `deleted`

Creation should produce an active community only after validation succeeds. Platform moderation may later restrict or suspend it.

Deleting a community should normally be a soft deletion with a retention period. During that period:

- posting is disabled
- invitations and requests are disabled
- content is hidden from ordinary users
- authorized administrators can restore or export data if policy allows

## 8. Create Community Workflow

The current form collects:

- name, 3 to 60 characters
- about text, 12 to 280 characters
- at least one topic
- a preset icon and tint
- join policy

Current frontend behavior:

- creates a `Date.now()` ID
- saves only to memory
- immediately makes the creator an Admin
- performs no uniqueness, abuse, duplicate, or server validation

Correct backend workflow:

1. Authenticate the user.
2. Check account status, rate limits, and community-creation eligibility.
3. Validate and normalize the name and about text.
4. Generate a stable ID and unique slug.
5. Check confusingly similar names and likely duplicates.
6. Validate selected topics against supported topic IDs.
7. Validate join policy.
8. Process any uploaded icon or cover asset.
9. Run text and media safety checks.
10. Create the community and owner membership in one transaction.
11. Create default settings and notification preferences.
12. Record an audit event.
13. Return the community, current membership, capabilities, and settings.

The creator should become `owner`, not merely `admin`.

Use an idempotency key so retries cannot create duplicate communities.

## 9. Community Identity And Media

Identity should include:

- name
- slug
- about
- icon or avatar asset
- cover asset
- theme/tint

The current admin screen edits only name and about. Tint exists in state but is not exposed there, and cover/icon upload is only represented by placeholders.

Production requirements:

- validate name uniqueness and reserved words
- version slug changes and preserve old links through redirects
- use purpose-specific media assets for icon and cover
- support preview, replacement, and removal
- crop icons to a square presentation
- validate cover dimensions and aspect ratio
- strip unsafe metadata such as unnecessary EXIF location
- retain asset history for moderation and rollback

Identity changes should be audited.

## 10. Real Media Selection

The current frontend does not perform real media selection. Composer buttons set `hasPhoto: true`, and the UI displays a mock `PhotoSlot`. No local URI, MIME type, file size, upload progress, or backend asset ID is handled.

The production frontend should use the Expo SDK 56 media APIs and send only successfully uploaded asset IDs when publishing.

Required selection flow:

1. User taps library or camera.
2. Request the relevant permission only when required.
3. Open the system picker or camera from a direct user action.
4. Handle cancellation without changing the draft.
5. Validate selected type, count, size, and dimensions.
6. Show a real local preview.
7. Let the user remove or replace an item before publishing.
8. Recover pending Android picker results after activity recreation.
9. Request an upload session from the backend.
10. Upload bytes directly to approved object storage.
11. Show upload and processing states.
12. Publish with the resulting ready asset IDs.

Current Community UI only promises photos. The backend should not silently assume video support. Video can be added later with explicit limits, transcoding, thumbnail, duration, and moderation rules.

## 11. Media Upload And Processing

Suggested asset states:

- `created`
- `uploading`
- `uploaded`
- `processing`
- `ready`
- `rejected`
- `expired`
- `deleted`

Suggested workflow:

1. `POST /media/upload-sessions` with purpose, MIME type, size, and checksum.
2. Backend validates limits and returns a signed upload target.
3. Client uploads directly to storage.
4. Client confirms completion.
5. Worker validates actual file signature, scans for malware, strips metadata, creates variants, and runs safety moderation.
6. Asset becomes `ready` or `rejected`.
7. A post or community may reference only a ready asset owned by the user or authorized upload session.

Use separate asset purposes such as:

- `community_post_image`
- `community_icon`
- `community_cover`
- `lost_found_evidence`

Orphaned uploads should expire automatically.

## 12. Discovery And Visibility

Admin settings currently include:

- discoverable
- members-only
- join policy

The Discover screen presently lists every nonjoined mock community as public and immediately joinable, regardless of those settings.

Correct behavior:

- `discoverable = false`: exclude from public discovery and ordinary search; direct access may still work for invited users or authorized links.
- `members_only = true`: nonmembers may see only the allowed preview, not posts or member-only details.
- `join_policy = open`: eligible users can join immediately.
- `join_policy = request`: eligible users create a pending request.
- `join_policy = invite`: joining requires a valid invitation or privileged administrator action.

Search and discovery indexes must update when these settings change. Authorization must still be checked when reading a result because search indexes may lag.

## 13. Membership State Machine

Recommended membership states:

- `requested`
- `invited`
- `active`
- `left`
- `declined`
- `removed`
- `banned`

A membership record should include:

- community ID
- user ID
- state
- role, when active
- request message, when applicable
- invited by and invitation ID
- approved, declined, removed, or banned by
- reason
- created, updated, and resolved timestamps
- version

Only one unresolved membership relationship should exist per user/community pair.

## 14. Open, Request, And Invite Joining

### Open

1. User taps Join.
2. Server checks block/ban state and eligibility.
3. Server creates or reactivates an active member relationship.
4. Member count updates transactionally.
5. A join event and optional notification are emitted.

### Request

1. User taps Request to Join.
2. Server validates eligibility and prevents duplicate pending requests.
3. Server creates a `requested` relationship.
4. Authorized reviewers receive a queue notification.
5. The frontend shows Requested and permits cancellation.

### Invite

1. An authorized user creates an invitation for a specific user.
2. Server records inviter, community, invitee, expiry, and status.
3. Invitee receives an in-app and optional push notification.
4. Acceptance checks that the invitation is still valid.
5. Acceptance activates membership transactionally.
6. Decline, revoke, and expiration remain recorded.

The current frontend immediately toggles membership for every policy. That behavior is incorrect for request and invite communities.

## 15. Pending Requests

The current request list is static mock data. Approve and decline are not implemented.

Production workflow:

1. Fetch a paginated queue visible only to authorized reviewers.
2. Include applicant summary, request message, mutual context if allowed, timestamps, and relevant safety status.
3. Approve or decline through a versioned, idempotent action.
4. Recheck reviewer permission and applicant eligibility during resolution.
5. On approval, activate membership and increment the count.
6. On decline, preserve the resolution record and optional reason.
7. Notify the applicant according to product policy.
8. Record an audit event.

Two reviewers acting on the same request must not create duplicate memberships or conflicting outcomes.

## 16. Invitations

The settings screen currently shows an "Invitations sent" row that only produces a toast.

The backend should support:

- create invitation
- list sent and received invitations
- accept or decline
- revoke by an authorized inviter
- expire automatically
- prevent inviting active members, banned users, or blocked relationships
- optional invitation limits and abuse controls

Invitation links should use opaque, single-purpose tokens. A token must not reveal private community or user data before authorization.

## 17. Leaving, Resigning, And Ownership

The current member Leave action immediately removes a group locally. Admin and moderator rows cannot leave because of a frontend guard.

Correct behavior:

- ordinary member: may leave, normally after confirmation
- moderator/admin: may resign their role and leave if policy permits
- owner: cannot leave until ownership is transferred or the community is archived/deleted
- pending requester: may cancel the request
- invited user: may decline the invitation

Leaving should:

1. Verify current membership and role.
2. Require an ownership resolution when necessary.
3. Set membership state to `left`.
4. Decrement the canonical member count.
5. Revoke member-only access immediately.
6. Preserve prior posts and comments unless a separate deletion policy applies.
7. Record the event.

## 18. Member Lists, Counts, And Search

Current member lists are static and can disagree with displayed counts such as `4.2k`. The all-members screen also displays mock users rather than the actual union of joined communities.

The backend should provide:

- canonical active member count
- paginated group member list
- role filtering
- server-side member search
- membership date and allowed public profile fields
- current viewer capabilities for each member action

Formatted counts are presentation values derived from integers.

Member visibility must honor account privacy, blocking, group privacy, and role permissions.

## 19. Removing And Banning Members

The current frontend removes users immediately, with no confirmation, reason, role hierarchy, ban state, or audit history.

Production actions should be distinct:

- **Remove**: deactivate membership; user may be allowed to rejoin.
- **Ban**: deactivate membership and prevent joining, requesting, or invitation acceptance until unbanned.
- **Suspend participation**: optional temporary restriction while membership remains.

Rules:

- moderators cannot remove owners or higher roles
- users cannot remove themselves through the moderation endpoint
- server checks authority at action time
- action accepts a reason and optional internal note
- sensitive actions may require confirmation
- notifications follow platform policy
- every action is audited

## 20. Role Management

The frontend stores one current-user role directly on each mock community. It has no real per-member role assignment.

The backend needs role-assignment records or versioned role fields on active memberships.

Required actions:

- promote member to moderator/admin
- demote moderator/admin
- transfer ownership
- list role history
- optionally grant scoped moderator capabilities

Role changes must be transactional, audited, and protected against removing the final owner.

## 21. Community Feed

The intended feed displays posts from communities the user has joined, filtered by group and topic.

Correct read workflow:

1. Authenticate user.
2. Resolve active memberships.
3. Query published posts from authorized communities.
4. Apply topic and group filters.
5. Exclude removed, quarantined, or unauthorized posts.
6. Enrich with author summary, community summary, media variants, counts, and the current user's reaction/save state.
7. Return cursor pagination and a stable sort key.

Do not rely on community IDs supplied by the client without checking membership and visibility.

## 22. Zero-Membership Feed Leak

The current filter applies joined-community filtering only when `joinedGroupIds.length` is nonzero. If the user belongs to zero groups, the caller can pass `undefined`, causing all community posts to appear.

Correct invariant:

- a joined-only feed for zero active memberships returns an empty list

The backend query should derive memberships itself. It should never interpret an empty authorization set as "no filter."

## 23. Topics And Categories

Frontend topics include:

- general
- rescue
- health
- lost-found
- tips
- events

Composer labels also include:

- discussion
- lost
- found
- rescue
- meme

The backend should define stable topic IDs and their mapping to composer modes. Do not use display labels as identifiers.

Per-community `enabled_topics` controls which new posts may be created. The server must reject a disabled topic even if an old client displays it.

When a topic is disabled:

- existing published posts remain readable unless separately moderated
- new posts and drafts cannot be submitted under it
- administrators may choose a replacement topic for affected drafts

The stored `defaultCategory` setting is currently unused. Either implement it as the initial composer selection or remove it from the contract.

## 24. Current Post Creation Paths

There are three frontend implementations:

1. The global Feed `PostComposer`, which can publish to Feed and multiple communities.
2. `CommunityComposer`, which supports multiple joined communities but appears unused.
3. `CommunityCreatePostScreen`, which supports one destination but is not currently reachable from visible Community controls.

They do not share one validation path.

Important inconsistency:

- the global composer reads joined destinations from static mock data
- Community membership changes use `CommunityGroupsContext`
- newly created, joined, or left communities may therefore not appear correctly in the actual composer

Production frontend code should use one composer domain service and live backend membership data.

## 25. Create Community Post Workflow

Recommended post states:

- `draft`
- `pending_approval`
- `published`
- `rejected`
- `removed_by_author`
- `removed_by_moderator`
- `quarantined`
- `archived`

Submission workflow:

1. Authenticate the user.
2. Validate active membership and posting capability.
3. Read the current community settings.
4. Validate title, body, topic, links, structured fields, and media assets.
5. Enforce topic, lost/found photo, link, and approval rules.
6. Run rate-limit, spam, text-safety, and media-safety checks.
7. Create the post with a server ID and server timestamp.
8. Set state to `pending_approval` or `published`.
9. Create outbox events for feeds, notifications, search, and analytics.
10. Return the post state and viewer capabilities.

Use an idempotency key so a retried submission cannot duplicate the post.

## 26. Cross-Posting

The global composer can select several destinations. The frontend currently creates independent records with generated IDs for every destination.

The production backend should explicitly represent this:

- one `crosspost_batch` records the user's single submission action
- one community post is created per selected community
- an optional separate main Feed post is created for the Feed destination
- uploaded assets may be reused by authorized placements
- comments, reactions, moderation state, and privacy remain separate per destination

Each selected community must independently pass:

- membership permission
- topic enablement
- media requirements
- link policy
- approval policy
- visibility and safety checks

Recommended transaction behavior:

- default to atomic validation: create all accepted placements only if every selected destination is valid
- if partial success is supported, make it explicit and return a result per destination

Never leak content from a private community through a public Feed placement or cross-post preview.

## 27. Lost And Found Posts

The composer currently collects:

- mode: lost or found
- area
- when
- optional contact
- optional "looks like" text for found animals
- photo represented only by a boolean

Correct backend requirements:

- mode is required
- area is required
- event date/time or an explicit unknown value is required
- photo is required when the community setting requires it
- contact information is private by default or displayed only through explicit consent
- precise coordinates should not be publicly returned unless specifically allowed
- status should support active, reunited/resolved, expired, and removed

The server must enforce the community's photo requirement. The frontend should upload a real asset and submit its ID; `hasPhoto: true` is not evidence of an uploaded image.

## 28. Rescue Topic Versus Rescue Case

A Community post categorized as `rescue` is ordinary Community content unless linked to the formal Rescue system.

If linking is supported, store:

- `linked_rescue_case_id`
- relationship type
- visibility permission snapshot

The backend must verify that the user may reference the Rescue case and must not expose private case details in Community responses.

Creating a Community rescue discussion should not automatically create, change, assign, or close a Rescue case.

## 29. Post Media

The current post model only stores `hasImage` and a tint. Production posts should reference real assets.

Suggested `post_media` fields:

- post ID
- asset ID
- position
- alt text
- optional caption
- moderation state

Requirements:

- media must be ready before publication
- ownership and purpose must match
- maximum count and size must be configured
- order is preserved
- deleted/rejected media cannot remain publicly addressable
- accessibility metadata should be supported

## 30. Post Approval

The admin screen has a `postApproval` toggle, but there is no approval queue and the composer ignores it.

Correct workflow:

1. Member submits a valid post.
2. Server creates it as `pending_approval`.
3. It is visible to its author and authorized reviewers, not the ordinary feed.
4. Reviewers approve, reject, or request changes.
5. Approval publishes with a server timestamp and emits feed/search/notification events.
6. Rejection stores a reason visible according to policy.
7. Every decision is audited.

Owner/admin/moderator posts may bypass approval only if the settings explicitly define that behavior.

## 31. Link Policy

The `allowLinks` setting is currently cosmetic.

The backend should parse and normalize URLs from title/body content. When links are disabled, reject prohibited external links with a field-level error.

When links are allowed:

- apply malicious URL checks
- prevent unsupported schemes
- consider warning or redirect handling
- fetch previews through a protected backend worker, not directly from arbitrary URLs in privileged infrastructure

## 32. Location And Contact Safety

`showLocation` exists in admin settings but currently does not affect post creation or rendering.

Recommended separation:

- required structured area for relevant lost/found workflows
- optional approximate display location
- optional private coordinates for matching or moderation
- user consent for public contact details

Turning off location display should hide public presentation without destroying internally required lost/found data.

Do not expose raw media EXIF coordinates, private addresses, phone numbers, or email addresses by default.

## 33. Editing And Deleting Posts

The feed context has an update function, but the visible workflow has no complete edit/delete controls.

Production requirements:

- author may edit within policy
- moderators may remove but should not silently rewrite author content
- edits increment a version and update `edited_at`
- important edits may rerun moderation and approval
- delete is normally a soft state change
- comments and notifications handle removed-parent content safely
- search and caches are invalidated
- audit history records actor and reason

Use optimistic concurrency so stale edits cannot overwrite newer content.

## 34. Helpful Reactions

The frontend toggles a local helpful count and `helpfulByMe`.

Backend model:

- unique relation on `(post_id, user_id, reaction_type)`
- aggregate count derived or transactionally maintained
- add/remove is idempotent
- response returns authoritative count and current-user state

The shared post record must not store one user's `helpfulByMe` value.

## 35. Comments, Replies, And Mentions

The frontend supports comments, one visible reply relationship, and text insertion from a mention picker. IDs and timestamps are generated locally.

Production workflow:

1. Verify the user can view and participate in the community.
2. Validate parent post and optional parent comment.
3. Enforce body limits, rate limits, blocks, and moderation.
4. Resolve mentions to structured user IDs rather than trusting typed handles.
5. Create the comment with a server timestamp.
6. Update counts.
7. Emit mention/reply notifications through an outbox.

Requirements:

- pagination
- stable thread ordering
- edit/delete policy
- report and moderator removal
- deleted-parent placeholders where needed
- no notification for invalid, blocked, or unauthorized mentions
- no media in comments unless product scope later adds and specifies it

The current comment-level "Paw" control has no action; do not infer it as a backend requirement until its product meaning is defined.

## 36. Saved Discussions

The frontend stores `saved` as a boolean on the shared in-memory post.

Production model:

- private unique bookmark relation `(user_id, post_id)`
- create/delete idempotently
- saved list paginated by save time
- removed or newly unauthorized posts are omitted or shown as unavailable

Saving does not increase a public post counter unless the product explicitly adds one.

## 37. Sharing, Links, And Paw Circle Forwarding

Current behavior is incomplete:

- Post Detail says "Link copied" without actually creating or copying a link
- Saved screen share navigates to Post Detail
- Feed forwarding may navigate to a Paw Circle but does not create a shared message

Production external sharing:

1. Backend provides a stable post URL or share token.
2. App invokes the system sharing flow.
3. Deep link opens the post.
4. Server rechecks visibility when the recipient opens it.
5. Private content never becomes public merely because a link exists.

Production Paw Circle forwarding:

1. User selects one or more authorized circles.
2. Backend creates a chat message with a typed `community_post_share` attachment.
3. Attachment stores post ID and a safe snapshot for deleted/unavailable states.
4. Recipient access is checked when rendering the live post.
5. Sender receives per-destination success/failure.

This should use the normal Paw Circle messaging and media/message-delivery workflow, not a toast-only action.

## 38. Search And Filtering

Current search is client-side substring matching over locally loaded posts. It has no pagination, server ranking, typo handling, or durable index.

Production search should:

- authorize communities before returning posts
- support query, topic, and community filters
- paginate results
- exclude removed/quarantined content
- respect block and privacy rules
- use stable ranking and cursor semantics
- handle index lag by rechecking source records

For zero joined communities, joined-only search must return no posts.

## 39. General Community Settings

The general Community settings screen includes:

- create community
- saved discussions
- groups the user runs
- joined groups and Leave
- pending requests
- invitations sent
- all group post alerts
- mentions and replies alerts
- guidelines

The two alert toggles currently use local component state and reset when the screen remounts. They do not affect backend or push notifications.

The backend should provide a user-level Community preference record, for example:

- `all_group_posts_enabled`
- `mentions_replies_enabled`
- optional `join_and_invite_updates_enabled`
- optional `moderation_updates_enabled`
- quiet hours or digest preference if supported
- version and updated timestamp

These preferences should sync across devices.

## 40. Per-Community Notification Preferences

User-level settings are not enough for large numbers of groups. Add per-membership notification preferences such as:

- all posts
- highlights only
- mentions and replies only
- muted
- moderator queue updates

Resolution should combine:

1. account-wide notification permission
2. general Community preference
3. per-community preference
4. event type
5. block/privacy rules
6. device push permission and valid token

Backend preferences and operating-system notification permission are separate. A user may enable notifications in the backend while push permission is denied; in-app notifications can still apply.

## 41. Group Admin Settings

Current settings fields include:

- name
- about
- tint
- default category
- enabled topics
- require photo for lost/found
- allow links
- post approval
- join policy
- members-only
- show location
- discoverable
- guidelines

All changes are currently local and most are not enforced elsewhere.

Backend requirements:

- return settings with a version
- validate changes by role and field
- apply changes transactionally
- reject stale versions or return a conflict
- create an audit entry per change set
- emit search, membership, and feed events as needed
- return the effective settings and capabilities

Moderators should not automatically receive identity and privacy controls merely because the frontend exposes a Manage button. Permissions must be field-specific.

## 42. Settings Transition Semantics

Settings changes must define what happens to existing data.

### Join policy

- Open to Request: future joins become requests; active memberships remain active.
- Request to Open: choose explicitly whether pending requests auto-approve or remain pending. Do not silently delete them.
- Any to Invite: future access requires invitations; preserve and explicitly resolve existing pending requests.

The current frontend hides pending requests when policy becomes Open. Production must retain their history.

### Members-only

- revoke nonmember post access immediately
- invalidate public caches and previews
- keep only an approved minimal community preview

### Discoverable

- remove/add the group in search and discovery asynchronously
- authorization remains authoritative during index lag

### Enabled topics

- block new submissions in disabled topics
- keep existing posts unless separately migrated or moderated

### Post approval

- normally applies to new submissions
- define treatment of existing drafts and already pending posts

### Allow links

- applies to new and edited content
- existing published posts remain unless a moderator reviews them

### Show location

- changes public rendering
- does not erase internally required structured fields

## 43. Guidelines And Rules

The frontend Rules screen currently shows global guidelines:

- be kind
- share accurate health and safety information
- no buying, selling, or breeding
- include location and a photo for lost/found posts
- stay respectful and on topic

Admin state also contains guidelines, but there is no real per-group editing workflow and the rules are not consulted during posting.

Recommended model:

- versioned platform Community guidelines
- optional versioned per-community rules
- rule title, body, order, active state, and updated-by metadata
- optional acknowledgement timestamp when joining or after significant changes

The join and composer UI should display the effective rules. The server still enforces machine-readable settings; text guidelines alone are not validation.

## 44. Reports And Moderation

The Admin Reports action currently only displays a toast.

Production moderation needs:

- report post
- report comment
- report community
- report member behavior
- reason category and optional explanation
- evidence snapshot
- triage status
- assigned reviewer
- resolution and action
- reporter safety and confidentiality
- appeal process where applicable

Suggested report states:

- `open`
- `under_review`
- `actioned`
- `dismissed`
- `appealed`
- `closed`

Moderation actions may include:

- remove content
- warn user
- restrict posting
- suspend or ban membership
- restrict or suspend community
- escalate to platform trust and safety

## 45. Health And Safety Content

Community includes health, rescue, and lost/found topics, so moderation has real-world safety implications.

The backend should support:

- prominent emergency guidance where appropriate
- detection and review of dangerous medical misinformation
- escalation for immediate animal harm or abuse
- fraud/spam controls for rescue or donation requests
- limits on exposing private contact and location data
- preservation of evidence for authorized safety investigations

Community content should not be represented as professional veterinary advice.

## 46. Notifications

Potential events include:

- join request received
- join request approved or declined
- invitation received, accepted, declined, revoked, or expired
- post approved, rejected, removed, or replied to
- comment reply
- valid mention
- moderator queue update
- role changed
- community settings/rules materially changed

Use a transactional outbox:

1. Domain transaction writes the state change and event.
2. Worker creates in-app notification records.
3. Worker evaluates user preferences.
4. Worker sends push notifications through valid Expo push tokens when allowed.
5. Delivery results update token and notification status.

Deep links must recheck current authorization. Notifications should avoid sensitive body/location/contact details on lock screens.

## 47. Events Boundary

A legacy Community hub displays static event cards, but the current canonical navigator does not provide a complete event creation or management workflow.

Do not infer a full event backend from those placeholders.

If events are later implemented, use separate records for:

- community
- organizer
- title and description
- start/end time and timezone
- approximate or private location
- capacity and RSVP state
- visibility
- moderation state
- cancellation

## 48. Legacy And Duplicate Frontend Paths

`CommunityHubScreen` maintains its own local community list and labels communities as public. It does not share the main context and should be treated as legacy or prototype UI.

The backend design should follow one official Community domain rather than preserving duplicate local behaviors.

Frontend cleanup should eventually:

- use one community membership query/cache
- use one community settings query/cache
- use one post creation service
- use one member list source
- remove or migrate legacy screens
- derive composer destinations from active memberships

## 49. Suggested Data Model

### communities

- `id`
- `owner_user_id`
- `name`
- `slug`
- `about`
- `icon_asset_id`
- `cover_asset_id`
- `tint`
- `status`
- `created_at`
- `updated_at`
- `version`

### community_settings

- `community_id`
- `join_policy`
- `members_only`
- `discoverable`
- `show_location`
- `allow_links`
- `post_approval_required`
- `require_photo_lost_found`
- `default_topic_id`
- `version`
- `updated_by`
- `updated_at`

### community_topics

- `community_id`
- `topic_id`
- `enabled`

### community_memberships

- `id`
- `community_id`
- `user_id`
- `state`
- `role`
- `request_message`
- `invited_by`
- `resolved_by`
- `resolution_reason`
- `joined_at`
- `created_at`
- `updated_at`
- `version`

### community_invitations

- `id`
- `community_id`
- `invitee_user_id`
- `invited_by_user_id`
- `token_hash`
- `status`
- `expires_at`
- `created_at`
- `resolved_at`

### community_posts

- `id`
- `community_id`
- `author_user_id`
- `crosspost_batch_id`
- `topic_id`
- `composer_mode`
- `title`
- `body`
- `state`
- `location_display`
- `location_private`
- `published_at`
- `created_at`
- `updated_at`
- `edited_at`
- `version`

### community_lost_found_details

- `post_id`
- `mode`
- `area`
- `event_at`
- `event_time_precision`
- `contact_visibility`
- encrypted/private contact fields
- `looks_like`
- `resolution_status`

### community_post_media

- `post_id`
- `asset_id`
- `position`
- `alt_text`

### community_post_reactions

- `post_id`
- `user_id`
- `reaction_type`
- `created_at`

### community_comments

- `id`
- `post_id`
- `author_user_id`
- `parent_comment_id`
- `body`
- `state`
- `created_at`
- `updated_at`
- `version`

### community_comment_mentions

- `comment_id`
- `mentioned_user_id`

### community_post_saves

- `user_id`
- `post_id`
- `created_at`

### community_rules

- `id`
- `community_id`, nullable for platform rules
- `title`
- `body`
- `position`
- `version`
- `active`

### community_user_preferences

- `user_id`
- general Community notification fields
- `version`
- `updated_at`

### community_membership_preferences

- `membership_id`
- notification level
- moderator notification fields
- `updated_at`

### community_reports

- `id`
- `reporter_user_id`
- target type and target ID
- `reason_code`
- `details`
- `state`
- `assigned_to`
- `resolution`
- timestamps

### community_audit_events

- `id`
- `community_id`
- `actor_user_id`
- action
- target type and target ID
- before/after summary
- reason
- request ID
- created timestamp

## 50. Suggested API Surface

Community:

- `POST /communities`
- `GET /communities/:id`
- `PATCH /communities/:id`
- `POST /communities/:id/archive`
- `DELETE /communities/:id`
- `GET /communities/discover`
- `GET /communities/search`

Settings and rules:

- `GET /communities/:id/settings`
- `PATCH /communities/:id/settings`
- `GET /communities/:id/rules`
- `PUT /communities/:id/rules`

Membership:

- `POST /communities/:id/join`
- `POST /communities/:id/join-requests`
- `DELETE /communities/:id/join-requests/me`
- `GET /communities/:id/join-requests`
- `POST /communities/:id/join-requests/:requestId/approve`
- `POST /communities/:id/join-requests/:requestId/decline`
- `POST /communities/:id/invitations`
- `GET /community-invitations`
- `POST /community-invitations/:id/accept`
- `POST /community-invitations/:id/decline`
- `POST /community-invitations/:id/revoke`
- `DELETE /communities/:id/membership`
- `GET /communities/:id/members`
- `PATCH /communities/:id/members/:userId/role`
- `POST /communities/:id/members/:userId/remove`
- `POST /communities/:id/members/:userId/ban`
- `POST /communities/:id/members/:userId/unban`
- `POST /communities/:id/transfer-ownership`

Posts:

- `GET /community-feed`
- `GET /communities/:id/posts`
- `POST /community-post-batches`
- `POST /communities/:id/posts`
- `GET /community-posts/:id`
- `PATCH /community-posts/:id`
- `DELETE /community-posts/:id`
- `POST /community-posts/:id/approve`
- `POST /community-posts/:id/reject`
- `POST /community-posts/:id/reactions/helpful`
- `DELETE /community-posts/:id/reactions/helpful`
- `POST /community-posts/:id/save`
- `DELETE /community-posts/:id/save`
- `GET /community-saved-posts`
- `GET /community-posts/search`

Comments and reports:

- `GET /community-posts/:id/comments`
- `POST /community-posts/:id/comments`
- `PATCH /community-comments/:id`
- `DELETE /community-comments/:id`
- `POST /community-reports`
- `GET /communities/:id/reports`
- `POST /community-reports/:id/resolve`

Preferences and media:

- `GET /me/community-preferences`
- `PATCH /me/community-preferences`
- `PATCH /communities/:id/my-notification-preferences`
- `POST /media/upload-sessions`
- `POST /media/upload-sessions/:id/complete`

## 51. Response Read Models

Community responses should return:

- canonical community fields
- formatted member count or raw count
- current membership state and role
- viewer capabilities
- effective settings needed by the current screen
- pending request/invitation state

Post responses should return:

- canonical post fields
- author and community summaries
- safe media variants
- public lost/found fields
- counts
- current-user reaction/save state
- moderation/publication state visible to the viewer
- viewer capabilities

This avoids separate frontend guesses such as `isMod`, `joined`, and locally stored booleans.

## 52. Concurrency, Offline Use, And Caching

Use:

- server-generated IDs and timestamps
- idempotency keys for creates and state transitions
- version fields or ETags for updates
- cursor pagination
- transactional count updates
- transactional outbox for side effects

Optimistic UI is appropriate for helpful reactions and saves. Membership decisions, role changes, settings, removals, and publishing should display pending state and reconcile with the server response.

Private/member content should use conservative cache headers. Membership changes must invalidate authorization-sensitive caches immediately.

## 53. Audit And Accountability

Audit at minimum:

- community creation, identity changes, archive/delete/restore
- settings and rules changes
- invitations
- request decisions
- role and ownership changes
- removals, bans, and unbans
- post approval/rejection and moderation
- report decisions

Audit data should include actor, target, action, reason, request ID, timestamp, and a safe before/after summary. Ordinary members should not receive internal moderation notes.

## 54. Core Invariants

1. Every active community has exactly one owner.
2. One user cannot have duplicate active membership in the same community.
3. Banned users cannot join, request, or accept invitations.
4. Member-only posts are never returned to unauthorized users.
5. A joined-only feed with zero memberships is empty.
6. Disabled topics cannot receive new posts.
7. Lost/found photo requirements are enforced using ready asset IDs.
8. Pending-approval posts are not visible in the public group feed.
9. Reaction and save relations are unique per user/post.
10. Member counts derive from active memberships.
11. Settings transitions preserve request and moderation history.
12. Client role labels and hidden buttons never replace server authorization.
13. Cross-posting cannot leak private community content.
14. Deep links and notifications recheck current access.
15. Every high-impact administrative action is auditable.

## 55. Current Frontend Gaps

The backend implementer should know these are current frontend gaps, not intended production behavior:

- all Community state is mock or in-memory
- membership ignores open/request/invite policy
- zero joined groups can expose all posts through the current filter
- composer destination data can become stale
- multiple posting paths use different validation
- photos are booleans/placeholders, not selected or uploaded assets
- enabled topics and all admin posting rules are unenforced
- members-only, discoverable, and location settings are unenforced
- post approval has no queue
- reports and invitations are toast-only
- member lists, counts, and requests are static
- saves and helpful reactions are shared local booleans/counts
- comments and mentions have no backend, permissions, or notifications
- share/link copy and Paw Circle forwarding do not perform the stated action
- notification toggles reset and have no effect
- no role hierarchy, ownership transfer, bans, or audit history
- no post edit/delete/report workflow
- no pagination, durable search, or server timestamps
- legacy Community UI has separate state

## 56. Backend Acceptance Checklist

- [ ] Creating a community creates exactly one owner membership.
- [ ] Community icon/cover and post photos use real uploaded assets.
- [ ] Open, request, and invite membership policies behave differently and correctly.
- [ ] Join requests and invitations are durable, idempotent, and auditable.
- [ ] Leaving and ownership transfer protect the final owner invariant.
- [ ] Member lists and counts come from canonical memberships.
- [ ] Role permissions are enforced by the server.
- [ ] Discoverability and members-only access affect all reads.
- [ ] A user with zero joined groups receives an empty joined-only feed.
- [ ] Every post destination is validated against its current community settings.
- [ ] Cross-post records preserve separate comments, reactions, moderation, and privacy.
- [ ] Lost/found posts enforce structured fields and real photo requirements.
- [ ] Post approval creates a reviewable pending state.
- [ ] Link, topic, and location rules are enforced.
- [ ] Helpful, saves, comments, replies, and mentions are user-scoped and durable.
- [ ] External sharing creates a real authorized link.
- [ ] Paw Circle forwarding creates a real chat message.
- [ ] User and per-community notification preferences persist across devices.
- [ ] Expo push delivery is driven by backend events and valid device tokens.
- [ ] Reports and moderation actions have queues and audit records.
- [ ] Settings transitions have explicit behavior for existing data.
- [ ] Search, feeds, and saved lists are paginated and authorization-safe.
- [ ] Every administrative mutation uses idempotency/concurrency protection where needed.

## 57. Expo SDK 56 Client Integration References

The backend contract above expects the mobile client to follow the exact Expo SDK 56 behavior:

- Media library: `ImagePicker.launchImageLibraryAsync`
- Camera: `ImagePicker.launchCameraAsync`
- Android interrupted-result recovery: `ImagePicker.getPendingResultAsync`
- Push permission/token and notification handling: `expo-notifications`
- Native external share sheet: `expo-sharing`
- Community/post deep-link creation and handling: Expo Linking

Official versioned references:

- <https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/>
- <https://docs.expo.dev/versions/v56.0.0/sdk/notifications/>
- <https://docs.expo.dev/versions/v56.0.0/sdk/sharing/>
- <https://docs.expo.dev/versions/v56.0.0/sdk/linking/>
