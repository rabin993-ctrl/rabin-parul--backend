# Rescue Cases, Updates, Feed, and Profile Backend Workflow

## 1. Purpose

This document translates the current Rescues frontend into a backend-ready
product and engineering specification.

It covers:

- formal rescue cases
- ordinary rescue-tagged feed posts
- case creation and case IDs
- rescue status and status transitions
- Browse, Following, and My Cases
- search, nearby results, and filters
- followers and update notifications
- `I Can Help` offers
- case updates and timelines
- initial case photos, update photos, and optional video
- signed media uploads and processing
- case sharing and linked feed posts
- My Profile and public-profile Rescue sections
- sensitive locations, contact details, reports, and moderation
- APIs, read models, invariants, and acceptance scenarios

The frontend is a prototype. Some Rescue behavior is stored only in one
in-memory React provider, some profile screens use a separate static dataset,
and several buttons only show a toast. The backend must implement the intended
workflow, not reproduce those limitations.

## 2. Frontend Source Map

The current Rescue behavior is spread across:

- `src/context/RescueFeedContext.tsx`
  - in-memory cases
  - followed case IDs
  - create case
  - append update
- `src/data/profileData.ts`
  - Rescue case and update types
  - static profile Rescue cases
  - status metadata
  - profile Rescue counts
- `src/data/rescueData.ts`
  - community cases
  - Browse/Following/My Cases filtering
  - nearby matching
  - rescue-tagged feed-post filtering
  - case/post linking through `postId`
- `src/components/rescue/RescueOpenCaseForm.tsx`
  - formal case form
  - required photo mock controls
- `src/screens/rescue/RescueCreateCaseScreen.tsx`
  - full-screen case creation
- `src/navigation/RescueOpenCaseModal.tsx`
  - case creation from the main Feed composer menu
  - a separate Rescue provider instance
- `src/screens/rescue/RescueListingScreen.tsx`
  - mixed case and rescue-post listing
  - Browse, Following, and My Cases
- `src/screens/rescue/RescueSearchScreen.tsx`
  - case search and species filter
- `src/screens/profile/RescueCaseDetailScreen.tsx`
  - public/owner case detail
  - Follow, I Can Help, Share, and Post Update
- `src/screens/rescue/RescuePostUpdateScreen.tsx`
  - required photo update form
  - optional video mock control
- `src/components/rescue/RescueCaseUI.tsx`
  - status labels
  - detail timeline
  - profile cards
- `src/screens/profile/RescuesScreen.tsx`
  - My Profile Rescue summary and status filters
- `src/hooks/useProfileViewData.ts`
  - profile Rescue data source
- `src/components/profile/ProfileChrome.tsx`
  - Rescue profile grid
- `src/components/feed/PostComposer.tsx`
  - ordinary rescue-tagged feed posts
- `src/screens/FeedScreen.tsx`
  - Rescues hub
  - `Open a case` versus `New post -> Rescue`
- `src/context/FeedPostContext.tsx`
  - generic feed-post state
  - Rescue creation modal

## 3. Core Product Concepts

### Formal rescue case

A durable public record for coordinating and documenting an animal rescue. It
has:

- a stable case reference
- a responsible poster
- animal and location details
- a status
- one or more evidence photos
- an append-only update timeline
- followers
- optional help offers

Frontend label: `Rescue Case`.

### Rescue-tagged feed post

An ordinary feed post labeled or tagged `rescue`.

It supports normal feed reactions, comments, saving, and forwarding, but does
not automatically have:

- a case ID
- status history
- followers
- a case update timeline
- structured help offers

### Case owner/poster

The authenticated user who opened the formal case.

The current frontend treats a case as owned when:

```ts
item.userId === "you" && a RescueFeedContext is present
```

The backend must use authenticated IDs and explicit ownership.

### Follower

A user subscribed to case changes.

### Helper

A user who submits a structured offer to assist with a case.

### Case update

An owner-authored timeline entry with at least one photo, optional text, and an
optional short video.

### Resolved case

Frontend status: `recovered`.

UI label: `Resolved`.

This means the case is closed with an outcome, not necessarily that every
animal was medically recovered. The backend should use a separate resolution
outcome field so `Resolved` can accurately represent reunited, fostered,
rehomed, transferred, recovered, or another result.

## 4. Current Frontend Data Model

### Rescue case

```ts
{
  id: string;
  userId: string;
  name: string;
  species: string;
  icon: string;
  tint: string;
  status: "active" | "under_treatment" | "recovered";
  date: string;
  location: string;
  story: string;
  postId?: string;
  caseId?: string;
  headline?: string;
  tags?: string[];
  followers?: number;
  updates?: RescueUpdate[];
}
```

### Rescue update

```ts
{
  id: string;
  time: string;
  text: string;
  hasPhoto?: boolean;
}
```

### In-memory Rescue state

```ts
{
  cases: RescueCase[];
  followedIds: Set<string>;
}
```

No Rescue case, follow, or update state is persisted to AsyncStorage or a
backend.

## 5. Current Frontend Status Semantics

### `active`

UI label: `Needs Help`.

Description:

- still open
- may need foster, owner search, transport, rescue team, or other support

### `under_treatment`

UI label: `Under Treatment`.

Description:

- animal is receiving care
- updates should document progress

### `recovered`

UI label: `Resolved`.

Description:

- animal is safe
- case is closed with a public outcome

### Current limitation

The create form allows any status, including `recovered`, when opening a new
case.

The update form cannot change status. Therefore, after a case is created, the
active frontend has no connected action that moves:

```text
Needs Help -> Under Treatment -> Resolved
```

The backend and production update form must implement status transitions.

## 6. Recommended Backend Data Model

Use server-generated UUIDs and real timestamps. Display strings such as
`Today, 10:30 AM` are client formatting, not stored timestamps.

### `rescue_cases`

Recommended fields:

- `id`
- `public_case_number`
- `owner_user_id`
- `animal_name`
- `species`: `dog`, `cat`, `other`
- `headline`
- `original_story`
- `status`: `needs_help`, `under_treatment`, `resolved`
- `resolution_outcome`
- `resolution_note`
- `location_area_id`
- `public_location_label`
- `private_latitude`
- `private_longitude`
- `location_precision`: `area`, `approximate`, `exact_private`
- `visibility`: `public`, `circles`, `unlisted`, `private`
- `moderation_status`: `pending`, `approved`, `limited`, `rejected`,
  `removed`
- `follower_count`
- `help_offer_count`
- `update_count`
- `linked_announcement_post_id`
- `created_at`
- `updated_at`
- `resolved_at`
- `archived_at`
- `deleted_at`

The public case number should be readable but not guessable enough to expose
private cases through sequential enumeration.

Example:

```text
RC-2026-8F4K2M
```

### `rescue_case_updates`

Recommended fields:

- `id`
- `case_id`
- `author_user_id`
- `text`
- `status_before`
- `status_after`
- `resolution_outcome`
- `created_at`
- `edited_at`
- `deleted_at`
- `moderation_status`
- `client_idempotency_key`

Updates should be append-only evidence. Corrections should preserve edit
history.

### `rescue_case_status_history`

Recommended fields:

- `id`
- `case_id`
- `from_status`
- `to_status`
- `changed_by_user_id`
- `update_id`
- `reason`
- `created_at`

This provides an auditable lifecycle even if an update is later moderated.

### `rescue_case_followers`

Recommended fields:

- `id`
- `case_id`
- `user_id`
- `notification_mode`: `all_updates`, `status_only`, `none`
- `followed_at`
- `unfollowed_at`
- `last_read_update_id`

Constraint:

- one current follow relationship per case/user

### `rescue_help_offers`

Recommended fields:

- `id`
- `case_id`
- `helper_user_id`
- `type`: `foster`, `transport`, `vet`, `supplies`, `search`,
  `temporary_shelter`, `other`
- `message`
- `availability`
- `private_contact_method`
- `status`: `offered`, `viewed`, `accepted`, `declined`, `withdrawn`,
  `completed`, `canceled`
- `reviewed_by_user_id`
- `reviewed_at`
- `created_at`
- `updated_at`

Do not expose private contact details in the public case response.

### `rescue_case_media`

Recommended fields:

- `id`
- `case_id`
- `update_id`
- `media_asset_id`
- `role`: `cover`, `evidence`, `update_photo`, `update_video`
- `sort_order`
- `created_at`
- `removed_at`

Exactly one current cover image should be selected for public cards.

### `media_assets`

Use a shared media table:

- `id`
- `owner_user_id`
- `purpose`: `rescue_case`, `rescue_update`, `rescue_report`
- `media_type`: `image`, `video`
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

### `rescue_case_post_links`

Use an explicit link rather than a loose `postId` string:

- `id`
- `case_id`
- `post_id`
- `relationship`: `announcement`, `update_share`, `source_report`
- `created_at`

### `rescue_reports`

Recommended fields:

- `id`
- `case_id`
- `update_id`
- `reporter_user_id`
- `reason_code`
- `note`
- `status`: `submitted`, `triaged`, `actioned`, `dismissed`
- `reviewer_user_id`
- `resolution`
- `created_at`
- `resolved_at`

### `rescue_audit_events`

Track:

- case creation
- case field corrections
- status changes
- update creation/edit/removal
- media moderation/removal
- help-offer decisions
- ownership transfer
- archive/delete
- moderation actions

### Transactional outbox events

Recommended events:

- `rescue.case_created`
- `rescue.case_updated`
- `rescue.status_changed`
- `rescue.case_resolved`
- `rescue.followed`
- `rescue.unfollowed`
- `rescue.help_offered`
- `rescue.help_offer_accepted`
- `rescue.update_posted`
- `rescue.report_submitted`

## 7. Roles and Authorization

### Public viewer

May:

- discover eligible public cases
- read public case details and updates
- share a public case link
- report a case or update

### Authenticated viewer

May also:

- follow/unfollow eligible cases
- submit or withdraw a help offer
- receive notifications

### Case owner

May:

- post updates
- change status through allowed transitions
- review help offers
- correct editable case fields
- update public location precision
- choose cover media
- resolve/archive the case

May not:

- falsify another user's identity
- create system/moderation events
- silently delete evidence after a dispute or report

### Collaborator

The current frontend does not model collaborators.

If production allows vet, shelter, or co-rescuer updates, add explicit
collaborator roles:

- `editor`
- `update_author`
- `help_coordinator`

Do not infer collaborator rights from being a follower or helper.

### Moderator

May:

- limit discovery
- remove unsafe location/contact information
- hide fraudulent or harmful content
- freeze a case
- preserve evidence

Every mutation must be authorized on the backend.

## 8. Formal Case Versus Rescue Feed Post

The main Feed creation menu deliberately offers two different choices:

### `Open a case`

Frontend description:

```text
Formal rescue with public updates
```

This creates a `RescueCase`.

### `New post -> Rescue`

This creates an ordinary feed `Post` with:

- `label = rescue`
- `tag = rescue`

It does not create a formal case.

### Production rule

These must remain distinct:

- use a rescue post for a quick alert, request, story, or discussion
- use a formal case for durable coordination and an evidence timeline

The backend should support explicitly linking a rescue post to a formal case.
It must not guess a link from similar text, animal name, or location.

An optional `Convert to case` action may:

1. verify the post owner
2. prefill a case draft
3. require missing case fields and evidence
4. create the case
5. link the original post as `source_report`

## 9. Opening a Formal Rescue Case

Current form fields:

- headline, required
- story, required and at least 12 trimmed characters
- animal name, required
- species: dog, cat, other
- location from a fixed Dhaka list
- status: Needs Help, Under Treatment, or Resolved
- one to three mock photos, at least one required

Current creation behavior:

1. Generate case ID with `Date.now()`.
2. Set owner to `you`.
3. Store selected status.
4. Create a timeline update by copying the original story.
5. Store only whether any photo exists.
6. Add the case to the current provider instance.
7. Open the new case detail.

Production creation workflow:

1. User completes the case draft.
2. Client selects and uploads one to three real images.
3. Backend validates:
   - authenticated owner
   - required fields
   - supported species/status
   - media ownership and readiness
   - location and visibility policy
   - content and abuse rules
4. Backend assigns public case number.
5. In one transaction:
   - create case
   - attach ready media
   - choose cover image
   - create initial timeline update/event
   - create status-history row
   - optionally create one linked announcement post
   - emit `rescue.case_created`
6. Return the canonical detail read model.

Suggested validation:

- animal name: 1-80 characters
- headline: 5-140 characters
- original story: 12-5,000 characters
- public location: normalized area, not arbitrary exact-address text
- initial images: 1-3
- idempotency key required

### Initial status policy

The frontend permits opening a case as Resolved.

The backend should choose one explicit policy:

- live-case mode: only Needs Help or Under Treatment may be selected at creation
- historical-log mode: Resolved is allowed only with a required outcome and
  resolution date

Do not allow an unexplained newly created resolved case.

## 10. Original Story and Editable Fields

The create form says:

```text
What happened? Locks after posting.
```

Recommended production behavior:

- preserve `original_story` as the initially published record
- allow typo/safety corrections through a versioned edit endpoint
- keep edit history and editor timestamps
- never rewrite historical updates when case fields change

Fields that may be safely corrected:

- animal name
- headline
- public area label
- species, with audit history
- cover image

High-risk changes should require stronger review:

- owner identity
- exact location
- original evidence
- resolution outcome

## 11. Status Lifecycle

Recommended state machine:

```text
needs_help -> under_treatment
needs_help -> resolved
under_treatment -> needs_help
under_treatment -> resolved
resolved -> needs_help       only through explicit reopen
resolved -> under_treatment  only through explicit reopen
```

### Moving to Under Treatment

Require:

- owner/collaborator authorization
- update text or structured treatment note
- optional clinic information kept private unless consented

### Resolving a case

Require:

- resolution outcome
- public outcome note
- at least one final update photo if product policy keeps the frontend's
  evidence requirement

Suggested outcomes:

- recovered
- reunited_with_owner
- placed_in_foster
- adopted_or_rehomed
- transferred_to_shelter
- no_longer_at_location
- deceased
- other

Sensitive outcomes must use respectful visibility and moderation policy.

### Reopening

Reopening must:

- preserve prior resolved timestamp and history
- create a new status-history entry
- notify current followers
- explain why help is needed again

## 12. Posting a Case Update

Current frontend form:

- one to three photos required
- optional short video
- optional update text
- if text is blank, stores `Case update posted.`
- displays a client-formatted current time

Current stored update:

```ts
{
  id: `u${Date.now()}`,
  time: formattedClientTime,
  text: suppliedTextOrFallback,
  hasPhoto: true
}
```

Current gaps:

- `photoCount` is accepted but ignored
- `hasVideo` is never submitted or stored
- no real media is selected or uploaded
- status cannot change
- timestamps and IDs are client-generated
- no notification is sent to followers

Production update workflow:

1. Owner/collaborator opens update form.
2. Select one to three images and optional one video.
3. Optionally write text and choose a new status.
4. Upload all media and wait for ready status.
5. Submit update with asset IDs, status change, and idempotency key.
6. Backend verifies:
   - case is active and editable
   - author permission
   - all assets are ready and owned by author
   - 1-3 images
   - at most one allowed video
   - valid status transition
7. In one transaction:
   - create update
   - attach media in sort order
   - apply status transition
   - create status history
   - update counters and last activity
   - emit update/status events
8. Notify eligible followers after commit.
9. Return canonical update and case summary.

The server supplies ID and timestamp.

## 13. Real Photo and Video Selection

### Current frontend behavior

Both formal-case creation and case updates use `MockMediaTile`.

The tiles only toggle Boolean values and display generated placeholder images.
The package currently does not include `expo-image-picker`.

Therefore, the current frontend does not:

- open the media library
- open the camera
- record video
- retain actual local asset metadata
- upload bytes
- store media references
- display the selected user's real media

### Production Expo SDK 56 workflow

Use `expo-image-picker` according to:

`https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/`

1. User taps an empty media slot.
2. Show:
   - choose from library
   - take photo
   - record/select video for update video slot
3. Request camera permission only when camera/recording is selected.
4. Request media-library permission where required, including the documented
   iOS video behavior.
5. If permission is denied:
   - keep all draft fields and selected media
   - explain why access is needed
   - offer Open Settings when it cannot be requested again
6. On web, launch picker/camera directly from the user's gesture.
7. For multiple images:
   - allow selection only up to remaining slots
   - do not combine multiple selection with editing/cropping
8. Read:
   - URI or web `File`
   - media type
   - MIME type
   - filename
   - byte size
   - width/height
   - video duration
9. Show actual previews.
10. Allow remove, replace, and reorder before publishing.
11. On Android, call `ImagePicker.getPendingResultAsync()` after resume so a
    selection survives activity destruction.
12. Confirm before discarding a draft containing text or selected media.

Suggested limits:

- images: JPEG, PNG, HEIC, or WebP
- maximum image size: 10 MB each
- initial case: 1-3 images
- update: 1-3 images
- video: MP4 or MOV, one per update, 60 seconds, 100 MB
- reject GIF/live-photo pairs unless the app explicitly supports conversion

The backend must publish limits through configuration so client and server use
the same rules.

## 14. Media Upload and Processing

Use direct-to-object-storage uploads with short-lived signed URLs.

1. Client requests an upload session for each asset.
2. Backend verifies authenticated user, intended case/update purpose, limits,
   and rate policy.
3. Backend creates a pending `media_assets` record.
4. Return:
   - `mediaAssetId`
   - signed upload URL and headers
   - expiry
   - allowed byte size
5. Client uploads bytes with progress.
6. Failed files show Retry and Remove.
7. Client calls upload-complete.
8. Backend verifies the object:
   - exists
   - actual content signature is allowed
   - byte size is allowed
   - image dimensions/video duration are allowed
   - checksum matches when supplied
9. Scan for malware and harmful/illegal content.
10. Create image renditions or video thumbnails/transcodes.
11. Mark the asset ready.
12. Enable case/update Publish only when every selected asset is ready.

Publishing sends asset IDs and sort order, never permanent local URIs or
client-supplied public URLs.

Abandoned unattached assets should be deleted after a short expiry such as 24
hours.

Repeated create/update requests with the same idempotency key must return the
original record.

## 15. Media Privacy and Safety

Rescue media can expose:

- exact animal location
- home addresses
- clinic paperwork
- license plates
- children or bystanders
- phone numbers
- graphic injuries

Production rules:

- strip public EXIF/GPS metadata
- use private object keys and authorized CDN URLs
- blur or moderate graphic images where policy requires
- permit owner to mark media sensitive
- prevent search-engine indexing for non-public cases
- retain reported evidence according to moderation policy
- record removal reason and actor

Removing published evidence should not silently erase the audit trail.

## 16. Browse, Following, and My Cases

### Browse / Discover

Current behavior:

- excludes cases with status `recovered`
- may mix formal cases and rescue-tagged feed posts
- applies scope, species, content type, and sometimes status filters

Production Browse should return:

- public, approved, non-resolved cases by default
- eligible rescue posts if content type includes posts
- viewer relationship and actions
- stable pagination
- server-sorted relevance/urgency

### Following

Current behavior:

- filters formal cases by a local set of IDs
- may include resolved cases
- hidden Browse filters still continue affecting the result

Production Following should return all cases currently followed by the user,
with explicit optional filters.

### My Cases

Current behavior:

- formal cases where `userId === "you"`
- includes all statuses
- uses compact rows
- hidden Browse filters still continue affecting the result

Production My Cases should return owner/collaborator cases and include:

- pending moderation
- drafts if supported
- active, treatment, resolved, archived
- owner-only action metadata

### Hidden filter issue

Because one filter object is shared, filters selected in Browse also filter
Following and My Cases even though the filter control is hidden on those tabs.

The backend/client contract should either:

- expose filters on every tab, or
- reset/ignore Browse-only filters outside Browse

Do not apply invisible constraints.

## 17. Content Type and Duplicate Handling

Current content types:

- `All`
- `Rescue`: ordinary rescue-tagged posts
- `Cases`: formal Rescue cases

Some formal cases include `postId` links to feed posts.

The current deduplication branch is effectively never enabled, so linked case
and post records can both appear as duplicate content.

There is also inconsistent seed linkage:

- case `r1` points to `p4`, which is a lost-pet post
- a separate `p-rescue-milo` post exists but is not linked to `r1`

Production requirements:

- store explicit, validated case/post links
- return a heterogeneous result type with stable IDs
- suppress the announcement post when the linked formal case is already shown
  in the same `All` result, or render a single combined card
- never infer links from names

Example result:

```json
{
  "kind": "case",
  "case": {},
  "linkedPost": {
    "id": "post-id",
    "relationship": "announcement"
  }
}
```

## 18. Search

Current case search matches:

- animal name
- headline
- story
- location
- case ID
- species

It supports a species filter and searches all locations/statuses.

Production search should support:

- query
- species
- status
- area/radius
- owner
- public case number
- created/updated date
- pagination

Search results must enforce:

- visibility
- moderation status
- blocks
- sensitive-location policy

Do not expose private exact coordinates or private help/contact information in
search indexes.

## 19. Nearby Logic and Location

Current `Near me` behavior checks whether the case location string contains
one of several Dhaka-area keywords.

It does not:

- request device location
- calculate distance
- use the user's selected/profile area
- distinguish exact and public locations

Production location choices:

1. User manually selects an area.
2. User optionally grants foreground location to suggest an area.
3. Store exact coordinates privately only when operationally necessary.
4. Publish coarse area or approximate distance.

If Expo foreground location is used, follow:

`https://docs.expo.dev/versions/v56.0.0/sdk/location/`

Nearby queries should use:

- normalized area hierarchy, or
- geospatial distance against an intentionally coarse public point

Never expose an injured or vulnerable animal's exact location to every viewer
by default.

## 20. Following a Case

Current behavior:

- Listing and Search use one in-memory `followedIds` set.
- Initial mock followed IDs are `r2` and `r5`.
- Follow state disappears when the provider remounts.
- Case Detail uses a separate local `following` Boolean initialized false.
- Detail follower count never changes.

Production follow:

1. Authenticated user taps Follow.
2. Backend verifies case visibility and status.
3. Upsert active follow relationship.
4. Update/recompute follower count.
5. Return current relationship and count.
6. Subscribe user to allowed update/status notifications.

Unfollow:

- close/deactivate follow relationship
- stop future case notifications
- retain notification/read history as required

Both operations must be idempotent.

The owner normally does not need to follow their own case.

## 21. Follower Notifications

The current frontend has no connected Rescue follower notifications.

Create notifications for:

- new case update
- status changed to Under Treatment
- case resolved
- case reopened
- major location/help need changed
- help offer accepted/declined for the helper

Do not notify:

- the author about their own update
- muted/unsubscribed followers
- users who can no longer view the case

Push behavior should follow Expo SDK 56:

`https://docs.expo.dev/versions/v56.0.0/sdk/notifications/`

Use a transactional outbox so a committed update and its notification fanout
cannot silently disagree.

## 22. `I Can Help`

Current behavior:

1. Viewer taps `I Can Help`.
2. UI shows `Thanks - the poster will be notified`.
3. No help offer or notification is created.

Production workflow:

1. Authenticated viewer taps I Can Help.
2. Show assistance types and optional message/availability.
3. Backend verifies:
   - case is eligible for help
   - helper is not blocked/banned
   - rate and abuse limits
4. Create structured help offer.
5. Notify owner/help coordinators.
6. Owner reviews and accepts/declines.
7. On acceptance, reveal only the necessary private contact channel.
8. Track completion/withdrawal.

The public case should expose only aggregate help information, never helper
contact details.

Duplicate offers should be prevented or intentionally versioned.

### Donations and fundraising

Some mock stories mention surgery funds, but the frontend does not implement
payments or fundraising.

Do not treat `I Can Help` as a donation transaction. A payment/fundraising
workflow requires a separate financial, fraud, refund, and compliance design.

## 23. Rescue Contact and Messaging Handoff

### Current frontend behavior

The Rescue feature has no case-specific chat thread and `I Can Help` does not
send a message. It only displays a confirmation toast.

The backend must not interpret the current button as:

- a delivered direct message
- a new Paw Circle conversation
- consent to reveal either user's phone number
- acceptance of the help offer

### Recommended production workflow

Keep the help offer as the structured first step. After the owner accepts it:

1. Create or reuse a canonical direct conversation between the owner and
   helper through the application's main messaging service.
2. Add a private system message containing a safe Rescue case reference.
3. Return the `conversationId` to both authorized participants.
4. Let the clients open that conversation from the accepted offer.
5. Apply normal message, attachment, blocking, reporting, retention, and
   notification rules from the messaging backend.

The Rescue service should store only the relationship between:

- `helpOfferId`
- `caseId`
- `conversationId`

It should not implement a second message table or duplicate chat attachments.

Conversation creation must be idempotent. Repeated acceptance or retries must
not create multiple chats for the same accepted offer.

The case owner may decline an offer without opening a conversation. Blocking
either participant must prevent new contact and must be checked when opening
the linked chat. Case visibility changes should not automatically erase an
existing private conversation, but the embedded case card must re-check
authorization and show unavailable when appropriate.

If product policy does not want Rescue-to-chat handoff, the accepted offer
must instead expose a clearly defined in-app contact method. The frontend
currently defines neither behavior, so this is a backend/product decision that
must be made explicitly.

## 24. Sharing a Case

Current Share actions only show toasts such as:

- `Case link copied`
- `Case shared`

Search has a no-op Share handler.

Production sharing:

- generate canonical deep link
- include only public-safe preview metadata
- verify case visibility when the link is opened
- support revoked/removed case state
- optionally record aggregate share count

Do not encode exact private location or private contact details in share URLs,
Open Graph metadata, or push payloads.

## 25. Linked Feed Announcement and Updates

Formal case creation currently adds only a case to Rescue state. It does not
create a feed announcement.

Recommended production behavior:

- formal case remains the source of truth
- optionally create one linked announcement feed post atomically
- announcement card points to the case
- future case updates may optionally be shared as feed posts
- deleting a feed post does not delete the formal case
- deleting/limiting the case makes linked cards unavailable

This prevents the case and post from drifting into two editable copies of the
same rescue record.

## 26. Feed Reactions, Comments, Saves, and Forwarding

Ordinary rescue posts use generic feed behavior:

- paw/reaction
- comments
- save
- forward

In the embedded Rescue listing, those callbacks are currently no-ops except
Forward, which only shows a toast.

Production behavior:

- use the same feed-post service regardless of which screen renders the post
- actions must update canonical post state
- comments and mentions should notify the post author
- save state is per user
- forwarding must create a real share/delivery action

The Rescue hub must not render a visually functional card with disconnected
actions.

## 27. My Profile and Public Profile Connection

### Current My Profile behavior

My Profile gets Rescue cases through:

```ts
getRescuesForUser(userId)
```

That function reads only static `RESCUE_CASES` from `profileData.ts`.

It does not read `RescueFeedContext`.

Therefore:

- newly opened cases do not appear in My Profile
- new updates do not appear in profile details
- Follow state does not affect profile
- app restart restores only seed data

### Current profile displays

Profile shows:

- Rescue count in impact stats
- Rescues content tab
- two-column Rescue grid
- full Rescues screen with:
  - Total
  - Needs Help
  - Under Treatment
  - Resolved
- status filters
- public users' Rescue tab

### Production profile queries

The backend must use the same `rescue_cases` source for:

- Rescue hub
- My Cases
- My Profile
- public profiles
- Rescue detail
- impact counts

Profile summary should return counts by current status.

Public profiles should include only cases allowed by:

- case visibility
- moderation state
- user profile policy
- block relationships

Owner profile may include private/unlisted cases in an owner-only response.

## 28. Provider and Persistence Problem

The frontend creates `RescueFeedProvider` inside:

- the embedded Rescue navigator
- the standalone Rescue navigator
- the Open Case modal

Each provider initializes independently from seed data.

This means a case created in the Feed modal exists only in that modal provider.
Closing the modal destroys it. Another Rescue navigator starts from seed data
again.

The backend must provide one account-wide source of truth. Frontend clients
should query/cache that server state rather than instantiate isolated datasets.

## 29. Timeline Ordering and `View All`

Current updates are inserted at the front, and detail shows only the first
three.

`View all` only shows a toast.

Production:

- order by server `created_at` descending for preview
- provide cursor pagination for full history
- keep stable ordering when timestamps match
- return media thumbnails
- preserve status-event context
- provide an actual full-history screen/query

Owner edits must not reorder an update as if it were newly posted unless the
product explicitly displays `edited_at`.

## 30. Case Visibility and Privacy

Formal Rescue cases are described as public, and profile screens show them on
public profiles.

Production must support explicit visibility:

- `public`
- `circles`
- `unlisted`
- `private`

Recommended behavior:

- public: discoverable and shareable
- circles: visible to users sharing eligible Paw Circle membership
- unlisted: accessible by authorized link but not broad discovery
- private: owner/collaborator/moderator only

Location, contact details, helper identities, and medical documents can have
stricter visibility than the case itself.

General profile/post privacy settings must not accidentally reveal a case whose
own visibility is more restrictive.

## 31. Corrections, Archive, and Deletion

The frontend has no connected case edit, archive, or delete controls.

Production requirements:

### Correct case

- version changes
- preserve original values in audit history
- re-run moderation for meaningful content/media changes

### Archive

- remove from active discovery
- keep owner/profile history according to visibility
- stop help offers
- keep follower access/notifications according to policy

### Delete request

- soft-delete or restrict display
- retain reported/legal evidence
- revoke public media URLs
- preserve aggregate/audit records
- show appropriate unavailable state to old links

A resolved case should normally be archived, not hard-deleted.

## 32. Reports, Fraud, and Animal Safety

Rescue content has higher safety risk than an ordinary social post.

Report reasons should include:

- fake or misleading case
- animal harm/abuse
- dangerous rescue instruction
- stolen media
- exact-location safety concern
- harassment/doxxing
- fraudulent fundraising
- graphic content
- spam/duplicate case

Moderation can:

- limit discovery
- hide contact/location
- quarantine media
- freeze updates/help offers
- remove linked feed posts
- suspend owner
- refer urgent animal-safety concerns to the appropriate process

Do not publicly display reporter identity or internal moderation notes.

## 33. Notifications and Read Models

Recommended Rescue notification types:

- `rescue_update_posted`
- `rescue_status_changed`
- `rescue_case_resolved`
- `rescue_case_reopened`
- `rescue_help_offer_received`
- `rescue_help_offer_accepted`
- `rescue_help_offer_declined`
- `rescue_case_moderated`

Each notification should reference stable IDs:

- case ID
- update/help-offer ID where relevant
- actor ID

Opening a notification should:

- mark it read
- re-check case authorization
- navigate to current case/update state

## 34. Suggested API Surface

```text
GET    /rescue-cases
POST   /rescue-cases
GET    /rescue-cases/:caseId
PATCH  /rescue-cases/:caseId
POST   /rescue-cases/:caseId/archive
DELETE /rescue-cases/:caseId

GET    /rescue-cases/search
GET    /users/:userId/rescue-cases
GET    /users/:userId/rescue-summary

POST   /rescue-cases/:caseId/follow
DELETE /rescue-cases/:caseId/follow
PATCH  /rescue-cases/:caseId/follow-preferences

GET    /rescue-cases/:caseId/updates
POST   /rescue-cases/:caseId/updates
PATCH  /rescue-case-updates/:updateId
DELETE /rescue-case-updates/:updateId

POST   /rescue-cases/:caseId/status
POST   /rescue-cases/:caseId/reopen

GET    /rescue-cases/:caseId/help-offers
POST   /rescue-cases/:caseId/help-offers
POST   /rescue-help-offers/:offerId/accept
POST   /rescue-help-offers/:offerId/decline
POST   /rescue-help-offers/:offerId/withdraw
POST   /rescue-help-offers/:offerId/complete
POST   /rescue-help-offers/:offerId/conversation

POST   /rescue-cases/:caseId/link-post
DELETE /rescue-cases/:caseId/post-links/:postId
POST   /feed-posts/:postId/convert-to-rescue-case

POST   /media/upload-sessions
POST   /media/:mediaAssetId/complete
GET    /media/:mediaAssetId/status
DELETE /media/:mediaAssetId

POST   /rescue-cases/:caseId/reports
POST   /rescue-case-updates/:updateId/reports
```

### Suggested listing parameters

```text
GET /rescue-cases?
  view=browse|following|mine&
  content=all|cases|posts&
  species=all|dog|cat|other&
  status=needs_help|under_treatment|resolved&
  areaId=...&
  latitude=...&
  longitude=...&
  radiusKm=...&
  query=...&
  cursor=...
```

For a mixed cases/posts endpoint, return a discriminated union.

## 35. Recommended Read Models

### Case card

```json
{
  "id": "uuid",
  "publicCaseNumber": "RC-2026-8F4K2M",
  "animal": {
    "name": "Luna",
    "species": "cat"
  },
  "headline": "Stray kitten needs vet care",
  "status": "under_treatment",
  "statusLabel": "Under Treatment",
  "publicLocation": "Dhanmondi, Dhaka",
  "coverMedia": {
    "id": "media-id",
    "thumbnailUrl": "signed-or-public-url"
  },
  "owner": {
    "id": "user-id",
    "name": "Aisha Rahman"
  },
  "followerCount": 84,
  "updateCount": 4,
  "viewer": {
    "isOwner": false,
    "isFollowing": true,
    "canHelp": true,
    "canUpdate": false
  },
  "createdAt": "2026-06-14T08:30:00Z",
  "lastUpdatedAt": "2026-06-14T10:30:00Z"
}
```

### Owner case detail

```json
{
  "case": {},
  "viewer": {
    "role": "owner",
    "canPostUpdate": true,
    "canChangeStatus": true,
    "canReviewHelpOffers": true,
    "canArchive": true
  },
  "counters": {
    "followers": 84,
    "updates": 4,
    "pendingHelpOffers": 3
  },
  "latestUpdates": []
}
```

### Update

```json
{
  "id": "uuid",
  "caseId": "uuid",
  "author": {
    "id": "user-id",
    "name": "Aisha Rahman"
  },
  "text": "Vet checkup done. Eye drops started.",
  "statusChange": {
    "from": "needs_help",
    "to": "under_treatment"
  },
  "media": [
    {
      "id": "media-id",
      "type": "image",
      "url": "authorized-url",
      "thumbnailUrl": "authorized-thumbnail"
    }
  ],
  "createdAt": "2026-06-14T10:30:00Z"
}
```

## 36. Backend Invariants

- Every formal case has one owner.
- Public case numbers are server-generated and unique.
- A published case has at least one ready image.
- A published case has no more than three initial images.
- A published update has one to three ready images.
- A published update has at most one ready video.
- Attached media belongs to the author and correct Rescue purpose.
- IDs, timestamps, counts, and owner identity never come from trusted client
  input.
- Case status changes follow the allowed state machine.
- Resolving a case records an explicit outcome.
- Status change and its history row commit atomically.
- Update creation, media attachments, status transition, counters, and outbox
  event commit atomically.
- Follow/unfollow is idempotent.
- Follower count is derived or transactionally maintained.
- Help-offer contact information is never exposed publicly.
- Accepted-offer conversation creation reuses the canonical messaging service
  and is idempotent.
- Linked feed posts reference the formal case rather than duplicate its
  mutable source data.
- Profile Rescue history and Rescue hub use the same case records.
- Visibility and moderation are checked on every case, update, media, search,
  share, and notification read.
- Exact location is private unless explicit policy authorizes its release.
- Resolved/archived cases do not accept new help offers unless reopened.

## 37. Current Frontend Gaps the Backend Must Not Copy

- Rescue state is in-memory and resets when providers remount.
- Multiple independent Rescue providers create separate copies of the data.
- A case created from the Feed modal disappears when that modal provider is
  destroyed.
- My Profile reads a separate static case list.
- New cases and updates do not appear in My Profile.
- Formal case creation does not create or link a real feed announcement.
- Case/post seed links are inconsistent.
- Case/post deduplication is effectively disabled.
- Nearby is a keyword match against location strings.
- Browse filters remain active but hidden in Following and My Cases.
- Follow state is local and not persistent.
- Detail Follow state is disconnected from Listing/Search follow state.
- Follower counts never update.
- I Can Help only shows a toast.
- Share only shows a toast or does nothing.
- Embedded rescue-post reactions/comments/saves are no-ops.
- Case IDs and update IDs use `Date.now()`.
- Human-readable time strings are stored as data.
- Status can be selected at creation but cannot change afterward.
- A case can be opened as Resolved without a required outcome.
- Original story is said to lock, but no versioned correction flow exists.
- Case creation and update media controls are mock toggles.
- `photoCount` is not stored.
- update video selection is not submitted or stored.
- Rescue updates only store `hasPhoto`, not media references.
- Timeline View All only shows a toast.
- There is no connected report/moderation workflow.
- There is no archive/delete/correction workflow.
- Profile/public visibility is not enforced against case-level privacy.
- Static profile Rescue counts are not canonical backend counts.

## 38. Minimum Acceptance Scenarios

1. User opens a formal case with valid fields and one to three real images.
2. Duplicate create request with the same idempotency key creates one case.
3. Backend assigns stable case ID, owner, timestamp, and initial status history.
4. Created case appears consistently in Browse, My Cases, My Profile, and
   owner detail according to visibility.
5. Quick rescue-tagged post remains an ordinary post unless explicitly linked
   or converted.
6. Linked case and announcement post render once in mixed `All` results.
7. Browse hides resolved cases by default; My Cases and Following can show
   them.
8. Browse filters do not invisibly constrain other tabs.
9. Nearby results use normalized area or geospatial policy without exposing
   exact coordinates.
10. Case search finds eligible cases by name, headline, area, species, and
    public case number.
11. Follow from Listing, Search, and Detail uses one relationship and updates
    follower count everywhere.
12. Follow/unfollow survives app restart and works across devices.
13. Follower receives allowed notification after a new update.
14. Owner posts update with one to three photos, optional text, and optional
    short video.
15. Update is not published until every selected asset is ready.
16. Permission denial, picker cancellation, Android activity recreation,
    offline upload, expired signed URL, invalid MIME, oversized file, failed
    scan, and processing failure preserve a recoverable draft and clear error.
17. Retried update publish creates one update.
18. Update and media appear in the timeline and My Profile detail.
19. Owner transitions Needs Help to Under Treatment with audit history.
20. Owner resolves case with required outcome and final public update.
21. Resolving stops new help offers and notifies eligible followers.
22. Reopening preserves prior resolution history and notifies followers.
23. I Can Help creates a private structured offer and notifies owner.
24. Owner accepts/declines help offer without exposing private contact data
    publicly.
25. Accepted help offer creates or reuses one authorized canonical
    conversation; retries do not create duplicates.
26. Declined help offer does not create a conversation or reveal contact data.
27. Canonical case link opens current authorized state and does not leak exact
    location.
28. Ordinary rescue-post reactions, comments, saves, and forwards work from
    the Rescue hub.
29. Reported case/update creates moderation case and preserves evidence.
30. Archive removes case from active discovery without erasing history.
31. Deleted/limited case revokes public media access and shows unavailable
    state on old links.
32. Unauthorized users cannot post updates, change status, inspect help
    offers, or access private media through direct API calls.
