# Adoption, Rehoming, Chat, and Profile Backend Workflow

## 1. Purpose

This document translates the current frontend behavior into a backend-ready workflow.
It covers:

- Adoption listings and adoption requests
- Lister/poster and adopter chat behavior
- `Rehoming` and `Adopting` chat sections
- `Rehomed` and `Adopted` profile sections
- `Mark as adopted`, `Adopted`, `Post home update`, and `Update requested`
- Home-update milestones and overdue calculations
- The warning triangle/count on the profile `Adopted` tab
- Avatar warning badges, notifications, ratings, responses, and re-listing
- Current frontend inconsistencies that the backend must resolve

The current frontend state is in memory and is split mainly between:

- `src/context/AdoptionFeedContext.tsx`: listings, requests, and request notifications
- `src/context/AdoptionContext.tsx`: adoption records, chat threads/messages, updates, and update notifications
- `src/utils/chatThreadMeta.ts`: chat role, section, tag, action, and panel derivation
- `src/utils/adoptionUpdateSchedule.ts`: milestone and overdue rules
- `src/utils/profileAdoptionDisplay.ts`: profile tags, missed milestones, and warning counts

## 2. Terminology

### Poster / lister / previous owner

The user who created the adoption listing. The frontend uses `posterId`, `owner`,
and `userId` in different objects for this role.

### Requester / adopter

The user who requests the pet. After adoption is marked complete, this user is
stored as `adopterId`.

### Listing

The public pet post shown in Browse and My listings.

### Request

A specific user's application for a specific listing.

### Adoption record

The permanent relationship/history created when a poster marks one requester as
the adopter. This record powers chat statuses, profile `Rehomed`/`Adopted`
sections, check-ins, warnings, ratings, and re-list history.

## 3. Current Frontend Data Model

The frontend currently models three separate state machines.

### 3.1 Adoption listing

Important fields:

```ts
{
  id,
  userId,             // poster
  name,
  species,
  breed,
  age,
  gender,
  location,
  status,             // Available | Urgent | Adopted
  urgent,
  adoptedDate?,
  adoptedNote?,
  postedAt
}
```

### 3.2 Adoption request

Important fields:

```ts
{
  id,
  listingId,
  posterId,
  requesterId,
  requesterName,
  message,
  submittedAt,
  status,             // submitted | approved | rejected | adopted
  threadId?
}
```

`submitted` and `approved` are considered active requests.

### 3.3 Adoption record

Important fields:

```ts
{
  id,
  adoptionPostId,     // listing ID
  chatThreadId?,
  posterId,
  adopterId,
  petName,
  species,
  icon,
  tint,
  newHome?,
  confirmedAt?,
  confirmedAtMs?,
  status,             // pending_confirmation | confirmed | update_due | closed
  updates,
  completedMilestones?,
  posterEndorsed?,
  posterRecommendation?,
  closedReason?,      // relisted
  closedAt?
}
```

Confirmed adoption records are treated as permanent public history. The
frontend prevents changing the poster, adopter, or confirmation timestamp and
prevents moving a confirmed record back to `pending_confirmation`.

## 4. Recommended Backend Tables

Use one database transaction for all cross-entity transitions.

### `adoption_listings`

- `id`
- `poster_id`
- pet/profile fields
- `status`: `available | urgent | adopted`
- `selected_request_id`, nullable
- `active_adoption_record_id`, nullable
- `adopted_at`, nullable
- `adopted_note`, nullable
- `published_at`
- `created_at`, `updated_at`

### `adoption_requests`

- `id`
- `listing_id`
- `poster_id`
- `requester_id`
- `message`
- `status`: `submitted | approved | rejected | adopted | cancelled`
- `thread_id`, nullable
- `submitted_at`, `approved_at`, `rejected_at`, `adopted_at`, `cancelled_at`
- Unique active request constraint for `(listing_id, requester_id)`

### `adoption_records`

- `id`
- `listing_id`
- `selected_request_id`
- `poster_id`
- `adopter_id`
- pet snapshot fields
- `status`: `confirmed | update_due | closed`
- `confirmed_at`
- `closed_at`, nullable
- `closed_reason`, nullable
- `chat_thread_id`, nullable
- immutable audit timestamps

The active frontend immediately confirms the adoption when the poster marks it.
`pending_confirmation` exists in types but is not created by the active UI. Do
not add a two-sided confirmation state unless the product adds an adopter
confirmation action.

### `adoption_updates`

- `id`
- `adoption_record_id`
- `type`: `adopter_home | poster_placement | poster_endorsement | adopter_response`
- `author_id`
- `milestone_id`, nullable
- `text`, nullable
- `recommendation`, nullable
- media references
- `created_at`

### `media_assets`

Do not store only `photoCount` or `hasVideo`. Those are current frontend mock
fields and are not enough for production.

- `id`
- `owner_id`
- `purpose`: `adoption_listing | adoption_home_update`
- `status`: `pending | uploading | uploaded | processing | ready | failed | deleted`
- `media_type`: `image | video`
- `storage_key`
- `original_filename`, nullable
- `mime_type`
- `byte_size`
- `width`, `height`, nullable
- `duration_ms`, nullable
- `checksum`, nullable
- `thumbnail_storage_key`, nullable
- `moderation_status`: `pending | approved | rejected`
- `created_at`, `uploaded_at`, `deleted_at`, nullable

Use join tables such as `adoption_update_media` and
`adoption_listing_media` with an explicit `sort_order`. Only `ready`,
approved assets owned by the submitting user may be attached to a published
update.

### `adoption_milestones`

This may be materialized or calculated:

- `adoption_record_id`
- `milestone_id`: `week_1 | month_1 | month_3 | month_6`
- `due_at`
- `status`: `upcoming | due | satisfied | missed | excused`
- `satisfied_by_update_id`, nullable
- `excused_by_endorsement_id`, nullable

### Chat and notification tables

- `chat_threads`
- `chat_participants`
- `chat_messages`
- `notifications`
- `notification_receipts` for read/dismissed state

Re-listing should archive the adoption chat instead of physically deleting it.

## 5. Listing and Request Lifecycle

### 5.1 Poster creates a listing

1. Poster submits pet details.
2. Backend creates the listing as `available` or `urgent`.
3. `urgent = true` and listing status `urgent` must stay consistent.
4. Listing appears in Browse unless its status is `adopted`.
5. It appears in My listings when `listing.poster_id = current_user`.

### 5.2 Adopter submits a request

1. Only a non-poster may request the listing.
2. Listing must be `available` or `urgent`.
3. Create request with status `submitted`.
4. Return/create a linked adoption chat thread.
5. Notify the poster of the new request.
6. Adopter sees:
   - Chat tag: `Requested`
   - Hint: waiting for the poster
7. Poster sees:
   - Chat tag: `New request`
   - Request appears under the relevant pet

The frontend currently creates the request first and lazily creates the thread
when either user opens chat. The backend should preferably create both in one
operation so the relationship cannot be lost.

### 5.3 Poster starts the conversation

In the current UI, the first text message sent by the poster automatically
changes the request from `submitted` to `approved`.

After approval:

- Both sides see `In chat`.
- Poster sees a `Mark as adopted` panel.
- The button is disabled until the poster has sent at least one text message.
- Adopter never sees the mark-adopted button.
- Adopter sees a message that the poster will mark the pet adopted when ready.

Backend options:

- Preserve this exact behavior: first poster message approves the request.
- Better explicit API design: approve the request first, then send the message.

If preserving the frontend behavior, the message creation and approval must be
one transaction.

### 5.4 Rejecting and cancelling

- Poster may reject a `submitted` request.
- Rejected pre-adoption threads are hidden from the Adoption Chats UI.
- The current frontend also deletes the local thread/messages immediately when
  the poster rejects from the applicant inbox.
- Requester may cancel an active request.

Backend should use `rejected`/`cancelled` plus archived chat visibility, not
hard-delete the audit history.

## 6. Mark as Adopted

### 6.1 Authorization and preconditions

Only the listing poster may mark a pet adopted.

Required checks:

- Listing belongs to the poster.
- Listing is not already adopted.
- Selected request belongs to the listing.
- Selected request is approved/in chat.
- Selected requester is not the poster.
- There is no active adoption record for the listing.
- Match the UI rule that the poster has sent at least one chat message.

### 6.2 Atomic transition

The current chat action calls two frontend functions: one creates the adoption
record and one marks the listing adopted. A backend must make this one atomic
command:

`POST /adoption-requests/:requestId/mark-adopted`

In one transaction:

1. Lock the listing and request.
2. Set listing status to `adopted`.
3. Set `urgent = false`.
4. Set `adopted_at` and optional adoption note.
5. Set selected request status to `adopted`.
6. Reject/close all other active requests for that listing.
7. Create an immutable adoption record with status `confirmed`.
8. Link listing, selected request, record, and chat thread.
9. Snapshot pet name/species/icon/tint onto the adoption record.
10. Create system messages:
    - `<Pet> marked as adopted`
    - `Adoption confirmed - Share a 1-week check-in soon`
    - calculated next-update schedule line
11. Notify the adopter.
12. Schedule milestone reminders.
13. Emit an `adoption.confirmed` domain event.

### 6.3 Current frontend inconsistency

The active chat flow creates the record and updates the listing, but does not
update the selected request to `adopted` or reject competing requests.
`completeAdoption()` contains that request logic but is not called by the active
screen. The backend must not preserve this inconsistency.

There is also an unused Manage Post screen that marks only the listing adopted
without creating an adoption record. That route is not currently navigated to,
but the backend must reject any listing-only completion that lacks an adopter
and adoption record.

## 7. How Chat Sections Are Chosen

Adoption chats are removed from the general Messages list and shown in the
Adoption hub.

Threads are grouped by listing ID. One listing can contain multiple applicant
threads.

### `Rehoming`

A group belongs here when:

- the listing belongs to the current user, or
- the linked adoption record's `poster_id` is the current user.

This segment shows people interested in pets the current user listed.

### `Adopting`

A group belongs here when it is not the current user's listing. It includes:

- submitted requests
- approved/in-chat requests
- confirmed adoptions
- adopter check-in actions

### Warning dot on `Adopting`

The yellow dot on the `Adopting` segment appears when at least one thread has
`needsAction = true`.

In the current resolver, this means the current user is the adopter and has an
active home-update prompt. Poster overdue states do not create this dot.

## 8. Chat Tags and Panels

All list-row tags, chat-header tags, and top-of-chat panels are derived from the
same resolver in `src/utils/chatThreadMeta.ts`.

### Before adoption: poster view

| Request state | Tag | Panel |
| --- | --- | --- |
| submitted | `New request` | Review request hint |
| approved | `In chat` | `Mark as adopted` button |
| rejected | hidden | none |

### Before adoption: adopter view

| Request state | Tag | Panel |
| --- | --- | --- |
| submitted | `Requested` | Waiting for poster |
| approved | `In chat` | Keep chatting; poster marks adoption |
| rejected | hidden | none |

### After adoption: poster view

- Normal state: `Adopted`, success styling.
- If adopter milestone is overdue: `Update requested`, warning styling.
- Panel always offers `Re-list for adoption`.
- Poster does not receive a `Post home update` action.

### After adoption: adopter view

- Active milestone not overdue:
  - tag `Check-in due`
  - primary styling
  - `Post home update` button
- Active milestone overdue:
  - tag `Post home update`
  - warning styling
  - overdue day count
  - `Post home update` button
- No remaining active prompt:
  - tag `Adopted`
  - success styling

The tags `Post home update`, `Check-in due`, `Update requested`, and `Adopted`
deep-link from chat to the same adoption-detail record used by My Profile.

## 9. Profile Connection

The chat tags and profile tags are connected through the same adoption record
and the same milestone calculation.

### `Rehomed` profile tab

Query:

```text
adoption_records where poster_id = profile_user_id
and status != pending_confirmation
```

This includes active confirmed records and closed/re-listed history.

### `Adopted` profile tab

Query:

```text
adoption_records where adopter_id = profile_user_id
and status != pending_confirmation
```

This also includes closed/re-listed history. Confirmed adoption history is
intended to be permanent and not user-hideable or user-deletable.

### Profile row tag rules

The same tag rules are used for both `Rehomed` and `Adopted` rows:

1. Closed/re-listed record: `Re-listed`
2. Adopter owes an overdue update: `Update requested`
3. Active non-overdue milestone exists: `Check-in due`
4. Otherwise: `Adopted`

Sorting priority is:

1. Warning tags
2. Primary/check-in tags
3. Adopted/success tags

Owner view shows milestone/due text under the pet. Public view shows species and
adoption date, but currently still shows the same status tag.

### Profile statistics

- `Rehomed` count = confirmed/closed records where user is poster.
- `Adopted` count = confirmed/closed records where user is adopter.

The current frontend falls back to old seeded profile counts only when no record
count exists. The backend should return real counts and remove this fallback.

### Companion profile conversion

A confirmed adopted record appears in the `Adopted` history automatically, but
it is not automatically added as a normal Companion profile. The adopter can
separately choose "add from adoption," which creates a companion owned by the
adopter. The backend should preserve this as an explicit optional action.

## 10. Home Update Schedule

Milestones are calculated from `confirmed_at`:

| Milestone | Due |
| --- | --- |
| `week_1` | 7 days |
| `month_1` | 30 days |
| `month_3` | 90 days |
| `month_6` | 180 days |

The active prompt is the first incomplete milestone that has not been satisfied
or excused.

### Satisfied

A milestone is treated as satisfied when any of these is true:

- Its ID is in `completedMilestones`.
- An adopter home update is explicitly linked to that milestone.
- An adopter home update was posted at or after the milestone due time.

### Excused

A poster endorsement posted at or after a milestone's due time excuses that
missed milestone.

This is current frontend behavior, but it is unusual because a rating can erase
an overdue warning. The backend/product team should confirm whether an
endorsement should truly excuse care evidence.

### Due and overdue

- Before `due_at`, the first incomplete milestone is an active `Check-in due`.
- At or after `due_at`, it becomes overdue.
- Overdue days use whole elapsed 24-hour periods.
- The record's derived status becomes `update_due`.
- Once an acceptable adopter update is posted, status is recomputed.

The frontend recomputes every 60 seconds. The backend should calculate this from
server time and optionally materialize it using a scheduled job.

### Bootstrap update

On confirmation, the frontend inserts:

`First day home - settling in well.`

It is typed as an adopter home update but is not a real voluntary check-in and
does not complete a milestone. The backend should model this as a system event,
not fake user-authored evidence.

## 11. Posting a Home Update

Only the adopter may post an adopter home update for an active adoption record.

### Current frontend behavior

The current form does not open a real media library or camera. It renders
`MockMediaTile` controls that only toggle Boolean values and then submits
`photoCount` and `hasVideo`. `expo-image-picker` is not currently installed.

Therefore, the current form demonstrates the intended layout and validation but
does not perform real media selection, upload, storage, or playback.

The intended form rules are:

- At least one photo is required.
- Up to three photos are shown.
- Video is optional.
- Caption is optional.
- Chat sheet leaves the caption empty when omitted.
- Profile inline form substitutes the milestone prompt as the caption when
  omitted.

### Production media-selection workflow

The production Expo SDK 56 client should use `expo-image-picker` for both the
system media library and camera. The versioned documentation is:

`https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/`

1. User taps an empty photo or video tile.
2. Show a source menu:
   - `Choose from library`
   - `Take photo` for image slots
   - `Record video` for the optional video slot
3. Ask for camera permission only when camera/recording is selected.
4. Ask for media-library permission when required by the platform, especially
   before video selection on iOS so the permission dialog is not surprising.
5. If permission is denied:
   - keep the draft intact
   - explain why access is needed
   - offer `Open Settings` when permission cannot be requested again
6. Launch the picker directly from the user's tap. This is required on web,
   where delayed/programmatic picker launches may be blocked.
7. For library photos:
   - allow multiple selection up to the remaining photo slots
   - never allow the total to exceed three images
   - do not enable cropping at the same time as multiple selection
8. For camera photos or videos:
   - add one captured asset at a time
   - return to the form with all previous selections preserved
9. Read the selected asset metadata:
   - local URI or web `File`
   - media type
   - MIME type
   - filename
   - byte size
   - width and height
   - video duration
10. Reject unsupported files before upload and show a plain-language error.
11. Display a real local preview for every selected photo and a thumbnail/play
    state for video.
12. Let the user remove and replace each selected asset before publishing.
13. Preserve draft media while the sheet remains open. If the user closes with
    selected media or a caption, ask whether to discard the draft.
14. On Android, call `ImagePicker.getPendingResultAsync()` when the form
    resumes so a selection is not lost if Android destroys the activity while
    the system picker is open.

Recommended product limits:

- Images: JPEG, PNG, HEIC, or WebP; maximum 10 MB each.
- Video: MP4 or MOV; maximum one video, 60 seconds, and 100 MB.
- Reject GIF/live-photo paired media unless the product explicitly supports
  their conversion and playback.
- Strip or ignore location/EXIF metadata before public delivery.

These limits are backend policy and must be returned to the client through
configuration so both sides display the same rules.

### Upload workflow

Use direct-to-object-storage uploads with short-lived signed URLs rather than
sending large files through the main application server.

1. After selection, the client requests an upload session for each asset.
2. Backend verifies:
   - authenticated user is the adoption record's adopter
   - record is active
   - requested media count and type fit the form rules
3. Backend creates a `media_assets` row with status `pending` and returns:
   - `mediaAssetId`
   - signed upload URL and required headers
   - expiration time
   - maximum accepted size
4. Client uploads the bytes and shows per-file progress.
5. The user may continue editing the caption while uploads run.
6. Failed uploads show `Retry` and `Remove`; successful files show `Uploaded`.
7. Client calls the upload-complete endpoint after object storage succeeds.
8. Backend verifies the object rather than trusting client metadata:
   - object exists
   - actual MIME type/signature is allowed
   - actual byte size is within limits
   - image dimensions or video duration are valid
   - checksum matches when supplied
9. Backend virus-scans/moderates the file, creates image renditions and video
   thumbnails/transcodes when needed, then changes status to `ready`.
10. The update submit button is enabled only when:
    - at least one image is selected
    - every selected asset is `ready`
    - no upload or processing job has failed
11. Publishing sends media asset IDs and sort order, never local device URIs or
    client-supplied public URLs.
12. Backend atomically creates the adoption update and attaches the ready media.
13. Repeated publish requests with the same idempotency key return the original
    update instead of creating duplicates.
14. Unattached pending/ready assets are cleaned up after a short expiry, such
    as 24 hours.

If the network drops:

- keep the local draft and selected previews
- mark incomplete assets as paused/failed
- retry using a fresh signed URL when necessary
- never mark the milestone complete until the update publish request succeeds

### Backend publish validation

The backend should:

- Require 1-3 ready image attachments owned by the adopter.
- Allow at most one optional video.
- Caption may be null.
- Reject duplicate media IDs and media already attached elsewhere.
- Reject pending, failed, deleted, rejected, or expired media.
- Re-check the total media count inside the publish transaction.
- Assign the update to the server-determined active milestone.
- Do not trust a client-supplied `milestone_id`.
- Mark that milestone satisfied.
- Recompute record status and warning counts.
- Add a system chat message: `Home update posted for <Pet>`.
- Resolve/dismiss the corresponding overdue notification.
- Emit `adoption.home_update_posted`.

The current frontend allows posting the active milestone before its due date.
The backend should preserve this only if early check-ins are intended.

### Media privacy and lifecycle

- Store private object keys; return authorized CDN/read URLs.
- Public visibility must follow the adoption record's visibility policy.
- Signed read URLs should expire when media is private.
- Removing a draft asset may delete it immediately if unattached.
- Published evidence should not be silently removed by the adopter. Use a
  moderation/removal request while preserving an audit record.
- Account deletion must follow the product's adoption-history retention policy
  and legal requirements.
- Log upload creator, attachment target, moderation result, and deletion reason.

## 12. Warning Triangle and Count

### Profile `Adopted` tab warning

The warning shown on the `Adopted` tab is not a simple Boolean. It is the total
number of missed milestones across all active adoption records where the
profile user is the adopter.

For each record:

- Ignore `closed`.
- Ignore `pending_confirmation`.
- For every 7/30/90/180-day milestone:
  - due time must have passed
  - no satisfying adopter update
  - no post-due poster endorsement excuse
- Count every missed milestone.

The tab renders:

- yellow alert-triangle icon
- count, capped visually at `9+`
- accessibility label `<Tab>, <count> overdue`

This means one pet may produce a badge count greater than one.

### Exact current mock-data result for `you`

The current user's warning count is driven mainly by record `ar2` for Willow:

- Confirmed 280 days ago
- Week 1 is completed
- Month 1 is missed
- Month 3 is missed
- Month 6 is missed
- No poster endorsement excuses those milestones

Therefore Willow contributes `3` to the profile `Adopted` warning badge.

Other current-user adopted records:

- Chhotu: Month 6 would be late, but a later poster endorsement excuses it.
- Olive: confirmed 6 days ago, so Week 1 is not overdue.
- Mochi: confirmed 3 days ago, so Week 1 is not overdue.

So the current mock-data `Adopted` tab badge is `3`.

### Avatar warning triangle

User avatars independently show a yellow warning badge when the user is an
adopter with at least one active record whose status/evidence is `update_due`.
This avatar badge is Boolean and does not show the missed-milestone count.

## 13. Notifications

### Request notifications

- New request to poster
- Request approved to requester
- Request rejected to requester
- Adoption completed to selected adopter

### Home-update notifications

For every active overdue adoption record:

- Recipient is the adopter.
- Notification ID is stable per record and milestone.
- Title: `Home update requested - <Pet>`
- Body includes milestone and overdue days.
- Opening navigates to the adoption detail.
- Read and dismissed are separate states.

Backend should persist read/dismiss state per user. Dismissing a notification
must not clear the underlying overdue condition or warning badge.

## 14. Poster Notes, Ratings, and Adopter Responses

### Poster placement note

The frontend has logic for a poster-only placement note when:

- adoption is confirmed
- active milestone is overdue by at least 14 days
- adopter has not posted since the due time
- no placement note was posted in the last 14 days

This note is explicitly not adopter proof. The helper exists, but the current
active profile/chat screens do not wire this action.

### Poster recommendation

After confirmation, the poster may repeatedly submit:

- `recommended`
- `not_recommended`

Rules:

- First rating may omit a note.
- Every later rating requires a note.
- Latest rating is the current displayed recommendation.
- Older ratings remain in history.
- A post-due recommendation currently excuses missed milestones.

### Adopter response

If the latest poster recommendation is `not_recommended`, the adopter is shown
a response form. The UI displays the latest adopter response and hides the form
after one exists. Backend authorization must limit responses to the adopter.

## 15. Re-listing

Only the original poster may re-list, and only when:

- record is confirmed/update-due
- record is not already closed
- record has a confirmation timestamp

The current UI allows re-listing at any time after confirmation. It is not
actually restricted to "adopter did not follow through," despite that copy.

Atomic backend re-list operation:

`POST /adoption-records/:id/relist`

1. Lock record and listing.
2. Verify current user is the poster.
3. Close old record with reason `relisted`.
4. Preserve old record permanently in both users' history.
5. Clear old record's active chat link.
6. Archive the selected adopter chat.
7. Set listing to `available`.
8. Clear adopted date/note and active adoption record ID.
9. Set new publish timestamp.
10. Close/remove the selected adopted request from active request views.
11. Decide explicitly whether old rejected/other applications remain archived.
12. Emit `adoption.relisted`.

Profile result:

- Old record remains in `Rehomed` and `Adopted`.
- Its tag becomes `Re-listed`.
- It no longer contributes overdue warnings.
- The listing becomes available in Browse again.

## 16. Trust Summary

The frontend derives an adopter trust badge from all incoming adoption records:

- No records: `New adopter`
- Any active update-due record: `Update pending`
- At least one recommendation plus one recent/on-track update: `Trusted adopter`
- Otherwise, at least one adoption: `Active adopter`

The current profile UI hides `New adopter` and `Update pending` trust strips,
while overdue indicators are shown elsewhere.

## 17. Required Authorization Rules

- Only listing poster can edit listing or manage applicants.
- Poster cannot request own listing.
- Requester can cancel only their own active request.
- Poster can approve/reject only requests for their listing.
- Poster can mark adopted only with one selected approved request.
- Only selected adopter can submit home updates.
- Only poster can submit placement notes and recommendations.
- Only adopter can respond to a negative recommendation.
- Only poster can re-list.
- Confirmed adoption identity fields and timestamps are immutable.
- Closed history cannot be deleted by either user.
- Media ownership and content moderation must be enforced server-side.

## 18. Suggested API Surface

```text
POST   /adoption-listings
GET    /adoption-listings
GET    /adoption-listings/:id
PATCH  /adoption-listings/:id

POST   /adoption-listings/:id/requests
GET    /adoption-listings/:id/requests
POST   /adoption-requests/:id/approve
POST   /adoption-requests/:id/reject
POST   /adoption-requests/:id/cancel
POST   /adoption-requests/:id/mark-adopted

GET    /adoption-chats
GET    /chat-threads/:id/messages
POST   /chat-threads/:id/messages

GET    /users/:id/rehomed-records
GET    /users/:id/adopted-records
GET    /adoption-records/:id
POST   /adoption-records/:id/home-updates
POST   /adoption-records/:id/placement-notes
POST   /adoption-records/:id/recommendations
POST   /adoption-records/:id/adopter-responses
POST   /adoption-records/:id/relist

POST   /media/upload-sessions
POST   /media/:mediaAssetId/complete
GET    /media/:mediaAssetId/status
DELETE /media/:mediaAssetId

GET    /users/:id/adoption-summary
GET    /notifications
POST   /notifications/:id/read
POST   /notifications/:id/dismiss
```

## 19. Recommended Read Models

The frontend currently recomputes many labels. The backend can return canonical
data plus a compact derived read model:

```json
{
  "role": "poster",
  "phase": "confirmed",
  "listingStatus": "adopted",
  "requestStatus": "adopted",
  "recordStatus": "update_due",
  "activeMilestone": {
    "id": "month_1",
    "dueAt": "2026-06-01T00:00:00Z",
    "overdue": true,
    "overdueDays": 13
  },
  "chatTag": "Update requested",
  "profileTag": "Update requested",
  "needsCurrentUserAction": false,
  "allowedActions": ["relist", "recommend"]
}
```

The client should still own wording/theme, but the backend should own role,
authorization, lifecycle state, due dates, overdue state, and allowed actions.

## 20. Backend Invariants

1. One listing has at most one active confirmed adoption record.
2. One adopted listing has exactly one selected adopted request.
3. One confirmed record has exactly one poster and one adopter.
4. Listing poster equals record poster.
5. Selected request requester equals record adopter.
6. Confirming an adoption updates listing, request, record, chat, notifications,
   and competing requests atomically.
7. Re-listing closes the old record before reopening the listing.
8. Closed records never create overdue prompts.
9. Client clocks never determine due or overdue state.
10. Client cannot submit or alter immutable adoption identity fields.
11. Milestone completion is idempotent.
12. Mark-adopted and re-list endpoints require idempotency keys.
13. A published home update has 1-3 ready image assets and at most one ready
    video asset.
14. Media assets must belong to the authenticated author and cannot be attached
    to multiple unrelated records.
15. A milestone is never completed by selection or upload alone; it completes
    only after the update and media attachments commit successfully.

## 21. Current Frontend Gaps the Backend Must Not Copy

- State is split across two contexts with no transaction.
- Active mark-adopted does not update request statuses.
- A listing-only mark-adopted helper can create `Adopted` without a record.
- `pending_confirmation` is modeled but not used.
- Poster placement-note permissions exist but are not wired to active screens.
- `completeAdoption()` and `confirmAdoption()` exist but are not called by the
  active workflow.
- Chat/message deletion is destructive during reject/re-list.
- All state resets on app reload; there is no persistence.
- IDs are generated with `Date.now()`.
- Human-readable date strings are stored beside timestamps.
- `mockData.ts` has an old post-level `adoptionStatus` field that is not used by
  the current adoption workflow.
- A late poster recommendation can excuse missed adopter check-ins.
- One later adopter update can satisfy earlier uncompleted milestones.
- Public profiles expose overdue/missed update state.
- The profile warning count counts missed milestones, while avatar warning is a
  Boolean; API names must make that difference explicit.
- Media controls are mock toggles. They do not open the library/camera, upload
  bytes, retain upload state, or store real media references.
- `photoCount` and `hasVideo` are display placeholders, not a production media
  model.

## 22. Minimum Acceptance Scenarios

1. Requester submits, sees `Requested`; poster sees `New request`.
2. Poster replies, request becomes approved; both see `In chat`.
3. Only poster sees enabled `Mark as adopted` after posting a message.
4. Mark adopted atomically updates listing, selected request, other requests,
   permanent record, chat system messages, and notifications.
5. Poster sees record in `Rehomed`; adopter sees same record in `Adopted`.
6. At day 7, missing Week 1 produces adopter action, warning tag, notification,
   profile count, and avatar warning.
7. Valid photo update satisfies the milestone and clears derived overdue state.
8. Poster can rate; only latest rating is current, but history remains.
9. Negative rating allows adopter response.
10. Poster re-lists; old record remains immutable with `Re-listed`, chat is
    archived, warnings stop, and listing returns to Browse.
11. User can choose up to three real images from the library, preview, reorder,
    replace, and remove them.
12. User can take a photo or record/select one short video after handling
    permissions.
13. Denied permissions, picker cancellation, Android activity recreation,
    offline upload, expired signed URL, invalid MIME type, oversized file, and
    failed processing all preserve a recoverable draft and show a clear error.
14. Publish remains disabled until at least one image and all selected media are
    ready.
15. A duplicate publish request creates only one home update, and abandoned
    uploads are eventually cleaned up.
