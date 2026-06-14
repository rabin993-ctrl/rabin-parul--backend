# Lost and Found Backend Workflow

## 1. Purpose

This document describes the complete Lost and Found workflow represented by the
frontend and the backend behavior required to make it production-ready.

It covers:

- creating a Lost alert
- creating a Found sighting
- linking a known Companion
- handling an unknown found animal
- media selection and upload
- location entry and optional device location
- main Feed Lost and Found cards
- Community Lost and Found posts
- nearby alert distribution
- messaging the owner or finder
- direct contact privacy
- saving alerts
- sharing and forwarding
- comments, sightings, and tips
- matching Lost and Found reports
- ownership claims and verification
- status transitions
- reunited, resolved, expired, withdrawn, and removed states
- editing and deleting
- notifications and reminders
- profile, saved, search, and shared-post behavior
- moderation, abuse prevention, and safety
- APIs, database models, events, errors, and acceptance tests

The current frontend stores Lost and Found information as optional fields on
mock Feed and Community posts. It has no durable alert state, no real nearby
calculation, no claim or reunited flow, no real messaging action, no canonical
save state on the dedicated cards, and no media or location service.

The backend must implement Lost and Found as a structured alert domain linked
to social post placements.

## 2. Main Frontend Sources

The workflow is primarily implemented in:

- `src/screens/FeedScreen.tsx`
- `src/components/feed/PostComposer.tsx`
- `src/components/feed/PostAuthorRow.tsx`
- `src/context/FeedPostContext.tsx`
- `src/data/mockData.ts`
- `src/components/ForwardSheet.tsx`
- `src/components/feed/FeedCommentSheet.tsx`
- `src/components/feed/FeedPostCard.tsx`
- `src/components/profile/ProfileChrome.tsx`
- `src/components/profile/ProfilePostDetailSheet.tsx`
- `src/screens/profile/ProfileSavedScreen.tsx`
- `src/components/community/CommunityComposer.tsx`
- `src/screens/community/CommunityCreatePostScreen.tsx`
- `src/data/communityPosts.ts`
- `src/context/CommunityFeedContext.tsx`
- `src/components/community/CommunityFeedPost.tsx`
- `src/screens/community/CommunityPostDetailScreen.tsx`
- `src/screens/community/CommunityFeedScreen.tsx`
- `src/screens/community/CommunityGroupScreen.tsx`
- `src/screens/community/CommunitySearchScreen.tsx`
- `src/screens/community/CommunitySavedScreen.tsx`
- `src/screens/NotificationsScreen.tsx`
- `src/context/UserPrivacyContext.tsx`
- `src/components/CompanionProfileOverlay.tsx`

Related backend handoffs:

- `docs/feed-companion-backend-workflow.md`
- `docs/companion-backend-workflow.md`
- `docs/community-backend-workflow.md`
- `docs/messages-backend-workflow.md`
- `docs/rescue-backend-workflow.md`

## 3. Product Definitions

### Lost alert

A time-sensitive report created by an owner, caregiver, or authorized reporter
for an animal whose location is unknown.

### Found sighting

A report that an unidentified or possibly lost animal was seen or secured at a
specific place and time.

### Alert

The canonical Lost or Found domain record containing:

- kind
- status
- subject animal information
- location
- event time
- contact policy
- media
- reporter
- resolution

### Post

The social content used to display and discuss the alert in:

- main Feed
- one or more Communities

The post is not the alert's source of truth.

### Placement

One destination-specific appearance of the alert's post.

### Sighting

A structured report from another user who may have seen the animal.

### Claim

A request by a user asserting that a found animal belongs to them or someone
they represent.

### Match candidate

A possible relationship between a Lost alert and a Found alert based on
location, time, animal description, media, microchip evidence, or human review.

## 4. Current Frontend Feed Model

The mock Feed `Post` can contain:

```ts
lost?: {
  kind: string;
  lastSeen: string;
  area: string;
  phone?: string;
};

found?: {
  area: string;
  foundAt: string;
  looksLike?: string;
  phone?: string;
};
```

A post also stores:

- human author ID
- attached Companion IDs
- free-text body
- image count
- label: `lost` or `found`
- paw count
- forward count
- comments
- saved state

Current limitations:

- Event dates are display strings rather than timestamps.
- Areas are unstructured free text.
- Contact information is embedded directly in the post.
- There is no alert ID separate from the post ID.
- There is no alert status.
- There is no resolution outcome.
- There is no owner/finder messaging relationship.
- There are no sightings or claims.
- There is no actual distance or nearby calculation.
- There is no notification fanout record.
- There is no expiry.
- There is no edit or history model.

## 5. Current Frontend Community Model

Community posts can contain:

```ts
alertMeta?: {
  kind: "lost" | "found";
  area: string;
  when: string;
  contact?: string;
  looksLike?: string;
};
```

Community Lost and Found uses:

- category `lost-found`
- composer label `lost` or `found`
- normal Community post rendering
- optional compact alert metadata

Current limitations:

- Some seeded Lost and Found Community posts have no `alertMeta`.
- The separate Community create-post screen can choose `lost-found` without
  collecting required Lost or Found fields.
- A Found post may be converted to the generic `lost` composer label when only
  its category is available.
- Contact is displayed as ordinary text.
- There is no Message owner or Message finder action.
- No structured status follows the post across Communities.

## 6. Canonical Architecture

Use one canonical Lost or Found alert linked to one canonical post and one or
more placements.

Recommended relationship:

```text
lost_found_alert
        |
        v
canonical_post
        |
        +--> main_feed_placement
        +--> community_placement_A
        +--> community_placement_B
```

The alert owns:

- status
- event details
- subject animal
- location
- contact policy
- sighting and claim workflow
- resolution

The post owns:

- narrative text
- media relationships
- reactions and comments

The placement owns:

- destination
- moderation state
- destination visibility
- destination removal

## 7. Alert Kind

Use an explicit enum:

```text
lost
found
```

Do not infer kind only from presentation labels or body text.

## 8. Alert Status

Recommended common states:

```text
draft
active
matched
resolution_pending
resolved
expired
withdrawn
removed
```

Meaning:

- `draft`: not publicly distributed.
- `active`: visible and accepting help.
- `matched`: at least one credible Lost/Found match is under review.
- `resolution_pending`: owner and finder are coordinating or a claim is being
  verified.
- `resolved`: final outcome recorded.
- `expired`: alert passed its active period without a confirmed resolution.
- `withdrawn`: reporter voluntarily closed the alert without a reunion.
- `removed`: moderation or safety removal.

The response should also return a viewer-friendly label such as:

- Lost
- Found
- Possible match
- Reunion pending
- Reunited
- Resolved
- Expired
- Withdrawn

## 9. Resolution Outcomes

Do not use one generic `resolved` label without an outcome.

Lost outcomes:

```text
reunited_with_owner
located_safe
in_rescue_care
deceased
duplicate_alert
reported_in_error
other
```

Found outcomes:

```text
reunited_with_verified_owner
transferred_to_rescue
transferred_to_shelter
fostered
adopted_after_hold
released_under_policy
duplicate_alert
reported_in_error
other
```

Some outcomes may require staff, rescue, or moderator approval.

## 10. Reporter And Accountable Actor

Every alert stores:

- authenticated actor user ID
- reporter user ID
- role
- creation timestamp

Possible reporter roles:

```text
owner
companion_manager
caregiver
finder
witness
rescue_organization
moderator
```

The human remains accountable even when the alert concerns a Companion.

## 11. Known Companion Versus Unknown Animal

### Known lost Companion

A Lost alert should normally link exactly one manageable Companion:

```text
subject_companion_id = companion_123
```

The backend must verify that the reporter:

- owns the Companion
- manages the Companion
- or has another approved reporting role

### Unknown found animal

A Found alert normally has:

```text
subject_companion_id = null
```

It uses a temporary subject snapshot:

- species
- estimated breed
- estimated age
- appearance
- collar or identifiers
- temperament
- sex when safely observed
- media

### Known Companion sighting

A user may report finding or seeing a known Companion after opening an active
Lost alert. That should create a sighting or match, not a second unrelated
Found alert unless the user explicitly chooses to publish one.

## 12. Current Companion Selection Problem

The normal Feed and Community composers default to the current user's first
Companion.

This can cause:

- a Found alert about an unknown cat to be incorrectly attached to Max
- a Lost alert to attach the wrong Companion
- several Companions to be attached when there is only one missing animal

Correct rules:

- Lost requires an explicit subject selection when the animal is an existing
  Companion.
- Lost may allow an unregistered animal through an explicit temporary subject.
- Found starts with no Companion selected.
- A Lost or Found alert has at most one `subject_companion_id`.
- Other Companions must not be attached merely as social tags.
- An empty subject stays empty.
- The backend never inserts a default Companion.

## 13. Feed Creation Entry Point

The main Feed composer can be opened through:

- the New post category menu
- selecting Lost
- selecting Found
- changing an ordinary post's tag to Lost or Found

Current required frontend fields:

Lost:

- body text
- last-seen area
- time

Optional:

- contact
- photo placeholder
- selected Companion
- destinations

Found:

- body text
- found-at area
- time

Optional:

- appearance description
- contact
- photo placeholder
- selected Companion
- destinations

## 14. Correct Lost Creation Workflow

1. User opens the Lost flow.
2. Client asks which animal is missing.
3. User selects one manageable Companion or enters an unregistered animal.
4. Client collects last-seen place.
5. Client collects a real date and time.
6. Client collects description and circumstances.
7. Client requests at least one clear photo when available.
8. Client asks how others should contact the reporter.
9. Client lets the user choose alert radius and destinations.
10. Client shows a privacy and safety preview.
11. Client uploads selected media.
12. Client submits an idempotent create request.
13. Backend validates the reporter and subject.
14. Backend validates location, time, contact, media, and destinations.
15. Backend creates the alert, canonical post, and placements.
16. Backend queues nearby and follower notifications.
17. Backend returns canonical alert and delivery summary.
18. Client displays the active Lost card.

## 15. Correct Found Creation Workflow

1. User opens the Found flow.
2. Client asks whether the animal was seen or safely secured.
3. Client starts with no owned Companion attached.
4. User enters found or sighted location.
5. User enters a real date and time.
6. User enters appearance and identifier details.
7. User uploads clear media when safe.
8. User chooses whether to reveal exact location.
9. User chooses contact through in-app messaging, relay contact, or approved
   public contact.
10. User chooses destinations.
11. Backend validates the request.
12. Backend creates the Found alert and placements.
13. Matching service compares it with active Lost alerts.
14. Backend notifies eligible nearby viewers and potential owners.
15. Client displays the active Found card.

## 16. Recommended Lost Create Request

```http
POST /v1/lost-found/alerts
Idempotency-Key: 50b26135-...
```

```json
{
  "kind": "lost",
  "subject": {
    "companion_id": "companion_123"
  },
  "body": "Bruno slipped his harness near the park.",
  "event": {
    "occurred_at": "2026-06-14T18:10:00+06:00",
    "timezone": "Asia/Dhaka"
  },
  "location": {
    "label": "Mirpur Section 10",
    "latitude": 23.8067,
    "longitude": 90.3687,
    "precision": "neighborhood"
  },
  "contact": {
    "mode": "in_app",
    "public_value": null
  },
  "asset_ids": [
    "asset_123"
  ],
  "destinations": [
    {
      "type": "feed"
    },
    {
      "type": "community",
      "community_id": "community_456"
    }
  ],
  "alert_radius_km": 8
}
```

## 17. Recommended Found Create Request

```json
{
  "kind": "found",
  "subject": {
    "companion_id": null,
    "species": "cat",
    "breed_description": "Tabby",
    "appearance": "Green eyes, no collar, shy but calm",
    "secured": true
  },
  "body": "Found near the south gate and keeping her safe.",
  "event": {
    "occurred_at": "2026-06-14T16:30:00+06:00",
    "timezone": "Asia/Dhaka"
  },
  "location": {
    "label": "Dhanmondi Lake, south gate",
    "latitude": 23.7464,
    "longitude": 90.3760,
    "precision": "landmark"
  },
  "contact": {
    "mode": "in_app",
    "public_value": null
  },
  "asset_ids": [
    "asset_789"
  ],
  "destinations": [
    {
      "type": "feed"
    }
  ],
  "alert_radius_km": 5
}
```

## 18. Required Validation

Common:

- authenticated and active reporter
- non-empty body
- valid kind
- valid event time
- event time is not implausibly far in the future
- location label or approved coordinates
- destination permission
- media ownership and readiness
- contact policy
- moderation checks

Lost:

- one known Companion or explicit temporary subject
- reporter authorized for known Companion
- last-seen time and location
- description sufficient for recognition

Found:

- species or meaningful appearance description
- found/sighted time and location
- secured status
- safe handling acknowledgement where relevant

The backend should strongly encourage media but may allow no photo in an
emergency.

## 19. Structured Event Time

The current frontend accepts strings such as:

```text
Today - 6:10 PM
```

Production requests must use:

- ISO timestamp
- timezone
- server receive time

The client may display relative text, but the backend stores the absolute time.

The API should distinguish:

- `occurred_at`: when the animal was last seen or found
- `reported_at`: when the alert was submitted
- `updated_at`
- `resolved_at`

## 20. Location Model

Recommended fields:

```text
location_label
latitude
longitude
geohash
precision
visibility
source
```

Precision values:

```text
exact
landmark
neighborhood
district
city
```

Source values:

```text
manual
device
map_pin
geocoded
moderator
```

The public label and public coordinates do not have to match the exact stored
location.

## 21. Exact Location Safety

Exact location can be dangerous for:

- a finder sheltering an animal at home
- wildlife
- valuable breeds
- stalking or harassment
- baiting or fraudulent claims

Recommended rules:

- Store exact location only when necessary and consented.
- Publicly show a coarser landmark or neighborhood.
- Found alerts for secured animals should normally hide the current holding
  address.
- Reveal exact location only through an approved conversation or handoff.
- Moderators may reduce location precision.
- Signed media URLs must not reveal private coordinates through metadata.

## 22. Expo SDK 56 Location Workflow

The frontend currently does not use `expo-location`, and the package is not
listed in `package.json`.

If device-assisted location is added, use the exact Expo SDK 56 contract:

- <https://docs.expo.dev/versions/v56.0.0/sdk/location/>

Suggested foreground workflow:

1. User taps Use current location.
2. Explain why location helps nearby distribution.
3. Request foreground permission with
   `requestForegroundPermissionsAsync`.
4. If denied, preserve the form and allow manual location.
5. Obtain a one-time position with `getCurrentPositionAsync`.
6. Optionally use `reverseGeocodeAsync` to suggest a label.
7. Let the user review and reduce precision.
8. Submit the selected location, not an invisible background reading.

Background location is not required for creating a Lost or Found alert.

Do not request continuous tracking merely to publish an alert.

## 23. Manual Location

Manual location must always be supported because:

- the user may report a place different from their current location
- the user may deny permission
- location services may be unavailable
- the alert may be submitted later

Geocode manual labels only when useful, and let the user correct the map point.

## 24. Nearby Meaning

The dedicated cards currently always show:

```text
Nearby
```

This is hardcoded.

Production `nearby` must be viewer-specific.

Possible criteria:

- viewer's current approved coarse location
- viewer's saved home area
- Community or Paw Circle area
- alert's configured radius
- viewer notification preferences

Response:

```json
{
  "proximity": {
    "is_nearby": true,
    "distance_km": 2.4,
    "distance_label": "About 2 km away"
  }
}
```

Do not expose the viewer's location to the alert reporter.

## 25. Media Selection

The current image and camera buttons only set `hasPhoto = true` and render a
placeholder.

Production should use Expo SDK 56 ImagePicker:

- <https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/>

Library:

1. User taps image library.
2. Client calls `launchImageLibraryAsync`.
3. Handle cancellation.
4. Validate returned asset type, file size, dimensions, and count.
5. Preview selected media.
6. Allow remove, reorder, and crop when appropriate.

Camera:

1. Request camera permission.
2. Call `launchCameraAsync`.
3. Handle denial and cancellation.
4. Preview and upload through the same pipeline.

Android recovery should check `getPendingResultAsync`.

On web, picker launch must happen directly from user activation.

The project currently does not list `expo-image-picker`.

## 26. Lost And Found Media Recommendations

Recommended limits:

- at least one clear image when available
- multiple images supported
- images before video in the first phase
- server-generated thumbnails
- optional alt text

For Lost alerts, useful media includes:

- face
- full body
- distinctive marks
- collar or harness

For Found alerts:

- avoid showing private home interiors when possible
- retain original securely for matching
- publish a privacy-safe derivative
- remove GPS EXIF from public derivatives

## 27. Media Upload Workflow

1. Client requests upload session.
2. Backend returns asset ID and upload URL.
3. Client uploads bytes.
4. Media service scans and processes.
5. Asset reaches `ready`.
6. Client submits ready asset IDs.
7. Alert service validates purpose and ownership.

Purpose:

```text
lost_found_alert
```

Recommended states:

```text
created
uploading
uploaded
scanning
processing
ready
rejected
failed
deleted
```

Local file URIs are never final post media.

## 28. Destination Selection

The global composer currently allows:

- Feed only
- Community only
- Feed plus one or more Communities
- multiple Communities

The Community composer allows one or more joined Communities.

Backend validation per Community:

- membership or posting permission
- Lost and Found topic enabled
- media rules
- moderation rules
- location policy
- contact policy

Use one canonical alert and destination placements.

## 29. Cross-Posting

The current frontend creates unrelated Feed and Community IDs.

Production should use:

```text
alert_id
post_id
crosspost_batch_id
placement_id
```

Benefits:

- resolving once updates every placement
- editing core details stays consistent
- alert matches and sightings are shared
- nearby counts are not duplicated
- moderation can remove one destination or the full alert

Comments and reactions may remain placement-specific.

## 30. Atomic Destination Creation

Recommended behavior:

- validate all selected destinations first
- create alert, post, media links, and placements transactionally
- reject the entire request if a required destination is invalid

If partial destination success is supported, return explicit per-destination
results and do not imply full success.

## 31. Main Feed Lost Card

The current Lost card displays:

- red urgent strip
- pulsing alert icon
- Lost label
- hardcoded Nearby badge
- author row
- "posted an alert"
- body text
- photo placeholder
- last-seen area
- time
- optional contact
- Message owner
- Forward
- Bookmark
- forward count
- hardcoded "100 alerted nearby"

Production response must provide every dynamic value.

## 32. Main Feed Found Card

The current Found card displays:

- green strip
- pulsing check icon
- Found label
- hardcoded Nearby badge
- author row
- "posted a sighting"
- body text
- photo placeholder
- found-at area
- time
- optional appearance
- optional contact
- Message finder
- Forward
- Bookmark
- forward count
- static "shared with local circles"

Production response must provide status, proximity, contact capability, save
state, share count, and distribution summary.

## 33. Alert Card Response

```json
{
  "alert": {
    "id": "alert_123",
    "kind": "lost",
    "status": "active",
    "status_label": "Lost",
    "subject": {
      "companion_id": "companion_456",
      "name": "Bruno",
      "species": "dog",
      "description": "Brown indie with a green collar",
      "avatar_url": "https://cdn.example.com/bruno.jpg",
      "can_view_companion": true
    },
    "event": {
      "occurred_at": "2026-06-14T18:10:00+06:00",
      "display_time": "Today at 6:10 PM"
    },
    "location": {
      "label": "Mirpur Section 10",
      "precision": "neighborhood"
    },
    "contact": {
      "mode": "in_app",
      "can_message": true,
      "public_value": null
    },
    "proximity": {
      "is_nearby": true,
      "distance_label": "About 2 km away"
    },
    "distribution": {
      "notified_nearby_count": 100,
      "share_count": 312
    },
    "capabilities": {
      "can_message_reporter": true,
      "can_report_sighting": true,
      "can_submit_claim": false,
      "can_save": true,
      "can_share": true,
      "can_edit": false,
      "can_resolve": false
    }
  },
  "post": {
    "id": "post_789",
    "body": "Bruno slipped his harness near the park.",
    "author": {
      "id": "user_321",
      "display_name": "Rafiq Mahmud",
      "avatar_url": "https://cdn.example.com/rafiq.jpg"
    },
    "media": [],
    "viewer": {
      "saved": false
    }
  }
}
```

## 34. Companion Link On Lost Cards

The Lost card currently uses `PostAuthorRow`, but it passes only a user-profile
callback. A Companion may be displayed after "with," but cannot be opened from
the dedicated card.

Correct behavior:

- Known lost Companion should be the alert subject.
- Companion name and avatar should open its profile when permitted.
- The card should not depend on the author's first attached Companion.
- Unknown animals should use an alert-subject profile or detail, not a fake
  Companion record.

## 35. Feed Card Reactions And Comments

Dedicated Lost and Found cards currently omit:

- paw reaction
- comment button
- comment preview

The post model can still contain reactions and comments.

Production should decide intentionally:

- Treat the primary action as Help, Sighting, or Message.
- Keep comments available for public tips when safety policy allows.
- Avoid using a playful reaction as the main emergency signal.
- Show counts consistently across Feed, detail, profile, and saved surfaces.

Recommended actions:

```text
Report sighting
Message owner/finder
Share
Save
Comment
```

## 36. Message Owner And Message Finder

The current buttons only show:

```text
Opening chat...
```

They do not create or open a conversation.

Correct workflow:

1. Viewer taps Message owner or Message finder.
2. Backend checks blocks, message policy, alert state, and viewer eligibility.
3. Backend creates or reuses an alert-scoped direct conversation.
4. Conversation contains alert context.
5. Client opens the correct thread.

Recommended request:

```http
POST /v1/lost-found/alerts/{alert_id}/conversation
Idempotency-Key: 28d56443-...
```

Response:

```json
{
  "conversation_id": "conversation_123",
  "created": true,
  "context": {
    "type": "lost_found_alert",
    "alert_id": "alert_456"
  }
}
```

The endpoint must reuse an existing eligible conversation rather than creating
duplicates on repeated taps.

## 37. Alert Conversation Context

The conversation header or system message should include:

- Lost or Found label
- animal name or safe description
- alert status
- coarse location
- alert thumbnail
- link to alert detail

Do not copy public phone numbers into messages automatically.

When the alert resolves, the conversation remains but its context changes to
Resolved or Reunited.

## 38. Messaging Safety

Lost and Found conversations are high-risk for scams and harassment.

Recommended safeguards:

- block checks
- report and block actions
- rate limits
- new-account limits
- scam and payment-warning prompts
- no requirement to pay a reward
- no automatic disclosure of exact address
- no automatic disclosure of phone number
- suspicious-link scanning
- safety reminders before in-person handoff

The owner may allow messages even if ordinary direct messages are restricted,
but this must be an explicit alert contact policy.

## 39. Contact Modes

Recommended values:

```text
in_app
phone_relay
public_phone
public_email
rescue_contact
none
```

Default:

```text
in_app
```

For a public contact:

- validate format
- require confirmation
- explain public exposure
- allow removal
- redact in logs and analytics
- apply scraping and abuse protections

Prefer relay or in-app contact over exposing personal phone numbers.

## 40. Calling Or Copying Contact

If public contact is enabled, return capabilities:

```json
{
  "can_call": true,
  "can_copy_contact": true,
  "display_value": "+880 17...210",
  "action_token": "short_lived_contact_token"
}
```

The public display may be masked while the authorized action resolves a
short-lived contact route.

## 41. Saving Alerts

The dedicated Feed Lost and Found cards currently keep `saved` in component
state. It:

- starts false regardless of post state
- resets when the card remounts
- does not update `FeedPostContext`
- does not appear reliably in Saved posts

Production save is a canonical private user-alert relationship:

```http
PUT    /v1/me/saved-lost-found-alerts/{alert_id}
DELETE /v1/me/saved-lost-found-alerts/{alert_id}
```

Save and unsave are idempotent.

The response must return `viewer.saved`.

## 42. Saved Alerts Screen

The current Profile Saved screen renders every saved Feed item through the
generic `FeedPostCard`. A saved Lost or Found alert therefore loses:

- dedicated alert details
- Message owner/finder
- status
- location emphasis
- nearby and resolution information

Production should:

- render the Lost or Found card variant
- show current alert status
- show Reunited or Resolved state
- disable stale actions
- open canonical alert detail

Consider a dedicated Saved Alerts section.

## 43. Sharing And Forwarding

The Feed Forward sheet supports:

- Paw Circles
- Communities
- individual circle members

The current frontend increments a forward count locally and may open a Circle
chat.

Production sharing should create a structured reference:

```text
shared_object_type = lost_found_alert
shared_object_id = alert_id
source_post_id = post_id
```

The share preview must update when:

- alert resolves
- location visibility changes
- contact is removed
- alert is moderated
- source becomes unavailable

Do not duplicate stale contact details into every share.

## 44. Share Counts

Count a share only after a destination succeeds.

Distinguish:

- in-app forwards
- external link shares
- notification fanout

Do not describe nearby notifications as forwards.

## 45. Community Lost And Found Rendering

Community feed currently displays:

- human author
- Community
- body
- Lost or Found badge
- compact area and time
- optional image
- helpful reaction
- comments
- share
- save

Community detail adds:

- area
- time
- appearance
- contact

Recommended improvement:

- use the same canonical alert status
- show Message owner/finder
- show Report sighting or Claim
- show resolution state
- preserve location and contact privacy
- link to the canonical alert detail

## 46. Community Create Screen Gap

The separate Community create-post screen can select category `lost-found` but
does not ask:

- Lost or Found
- location
- time
- appearance
- contact

It also attaches the user's first Companion without consent.

Correct rule:

- A `lost-found` category cannot publish without choosing `lost` or `found`.
- Required alert fields must be collected.
- No default Companion is attached.
- The request must create or reference a canonical alert.

## 47. Community Seed Gap

A Community post may have:

```text
category = lost-found
composerLabel = found
alertMeta = missing
```

The backend should reject an active Lost or Found placement without a valid
canonical alert reference.

Legacy records may be migrated to:

- an alert with partial data
- or a generic discussion that is not treated as an active alert

## 48. Search

Community search currently checks:

- title
- body
- Community name
- author name

It does not search structured alert location or animal description.

Recommended alert search:

```http
GET /v1/lost-found/search
  ?kind=lost
  &status=active
  &species=dog
  &near_lat=...
  &near_lng=...
  &radius_km=...
  &query=green+collar
```

Search index may include:

- kind
- status
- species
- breed description
- appearance
- public location label
- event time
- Companion name when public

It must not include:

- hidden exact location
- private phone or email
- private claim evidence
- private microchip data

## 49. Feed Filtering

The Feed filter combines Lost and Found under:

```text
Lost / Found
```

The current filter matches both labels.

Production filters should support:

- Lost and Found combined
- Lost only
- Found only
- active only
- resolved and expired history
- nearby only

Default main Feed should prioritize active alerts and reduce prominence after
resolution.

## 50. Profile Posts

The current profile Posts tab renders Lost and Found records through the
generic Feed post card. Their alert details are lost.

Correct behavior:

- render dedicated alert preview
- show current status
- link to canonical alert detail
- respect public location and contact policy
- hide owner-only management controls from public viewers

The profile Post detail sheet also currently shows only generic post content
and a Lost/Found tag. It should display structured alert details.

## 51. Alert Detail

Recommended route:

```text
/lost-found/{alert_id}
```

Detail should include:

- status
- reporter
- subject
- media
- event time
- public location
- description
- contact actions
- recent approved sightings
- possible match state where viewer is allowed
- comments or updates
- share and save
- owner/finder management actions

## 52. Sighting Workflow

Recommended action:

```text
Report sighting
```

1. Viewer opens an active Lost alert.
2. Viewer taps Report sighting.
3. Client collects:
   - when
   - where
   - whether the animal is still there
   - optional note
   - optional media
   - contact permission
4. Client warns against unsafe pursuit.
5. Backend validates and stores the sighting.
6. Backend risk-scores and moderates it.
7. Owner receives a notification.
8. Owner can message the reporter.
9. Public display uses coarse location unless approved.

Endpoint:

```http
POST /v1/lost-found/alerts/{alert_id}/sightings
```

## 53. Sighting Model

```text
lost_found_sightings
- id
- alert_id
- reporter_user_id
- occurred_at
- location_label
- latitude
- longitude
- public_precision
- still_present
- note
- moderation_status
- created_at
```

Media uses separate asset relationships.

## 54. Found Alert Claim Workflow

For a secured found animal:

1. Potential owner taps This may be my pet.
2. Backend checks account, blocks, and alert state.
3. Client opens a private claim form.
4. Claimant provides non-public proof.
5. Finder receives a safe claim summary, not all sensitive evidence.
6. Finder, rescue, or moderator reviews.
7. In-app conversation may open.
8. Handoff occurs safely.
9. Finder or authorized moderator marks the claim verified.
10. Alert resolves as reunited with verified owner.

Endpoint:

```http
POST /v1/lost-found/alerts/{alert_id}/claims
```

## 55. Claim Evidence

Possible evidence:

- older photos
- distinctive markings not shown publicly
- vet or vaccination records
- microchip confirmation
- collar details
- behavioral details
- location history

Never require claimants to post private evidence publicly.

Microchip matching should be handled by authorized staff or verified
organizations. Do not expose microchip identifiers to ordinary users.

## 56. Claim States

```text
submitted
under_review
more_information_required
accepted
rejected
withdrawn
expired
```

Only one accepted claim may resolve a specific Found alert.

Rejected claimants should not receive the verified owner's private details.

## 57. Lost And Found Matching

The matching service may compare:

- species
- breed
- colors and markings
- media similarity
- collar and identifiers
- location distance
- event-time compatibility
- sex and estimated age
- Companion name where known
- microchip result through a protected service

Automated matching produces candidates, not final ownership decisions.

## 58. Match Candidate Workflow

1. Lost or Found alert becomes active.
2. Matching service searches opposite-kind active alerts.
3. Candidate scores are generated.
4. Low-confidence candidates remain internal.
5. Eligible high-confidence candidates notify reporters safely.
6. Reporters compare details.
7. They may open an alert-scoped conversation.
8. Match is confirmed or dismissed.
9. Confirmed match moves alerts to resolution pending.
10. Verified reunion resolves both alerts.

## 59. Match Candidate Model

```text
lost_found_matches
- id
- lost_alert_id
- found_alert_id
- score
- reasons
- status
- created_at
- reviewed_at
- reviewed_by_user_id
```

Statuses:

```text
candidate
notified
confirmed_by_lost_reporter
confirmed_by_found_reporter
resolution_pending
matched
dismissed
rejected_by_moderator
```

## 60. Duplicate Alerts

The backend should detect likely duplicates by:

- same reporter
- same Companion
- nearby location
- overlapping event time
- similar media or description

Do not silently merge.

Offer:

- continue existing alert
- add an update
- create a separate alert

Confirmed duplicates may resolve with `duplicate_alert`.

## 61. Alert Updates

Reporters should be able to post structured updates:

- new sighting
- location correction
- new photo
- collar or description correction
- contact change
- reward warning
- animal secured
- possible match
- reunion

Use:

```http
POST /v1/lost-found/alerts/{alert_id}/updates
```

Updates must preserve history.

## 62. Editing Active Alerts

Editable:

- body
- subject description
- public location label
- event time correction
- media
- contact mode
- radius

Restricted:

- kind change from Lost to Found
- subject Companion replacement
- reporter replacement
- accepted claim evidence
- resolution history

Major edits should trigger:

- audit event
- match recalculation
- notification update where necessary
- moderation review

Use optimistic concurrency.

## 63. Resolving A Lost Alert

1. Authorized reporter opens Manage alert.
2. User selects Reunited or another outcome.
3. Client asks for optional resolution note and media.
4. Backend verifies permission and current state.
5. Backend records outcome and timestamp.
6. All placements update to Resolved/Reunited.
7. Nearby active fanout stops.
8. New sightings and claims are disabled.
9. Saved and shared previews update.
10. Owner may publish a reunion update.
11. Matching candidates close.

## 64. Resolving A Found Alert

1. Finder, rescue, or authorized moderator selects an outcome.
2. If reunited, an accepted claim or verified handoff is required under policy.
3. Backend records outcome.
4. All placements update.
5. Contact and exact location are hidden.
6. Active matches close.
7. New claims are disabled.
8. Required legal hold or shelter record remains.

## 65. Resolution Request

```http
POST /v1/lost-found/alerts/{alert_id}/resolve
Idempotency-Key: 06619445-...
```

```json
{
  "outcome": "reunited_with_owner",
  "note": "Safely home after a neighbor recognized him.",
  "matched_alert_id": "alert_789",
  "accepted_claim_id": null
}
```

## 66. Reopening

Only authorized users may reopen:

```text
resolved -> active
expired -> active
withdrawn -> active
```

Require:

- reason
- updated event/location details when necessary
- audit log
- new expiry and fanout calculation

Do not reuse stale nearby notifications without recalculation.

## 67. Expiration

Active alerts should not remain urgent forever.

Recommended:

- configurable active period by kind and region
- reminder before expiry
- owner can extend after confirming details
- expired alerts remain in history
- expired alerts stop nearby fanout
- exact location and contact become more restricted

Expiration is not the same as resolution.

## 68. Withdrawal

Reporter may withdraw for:

- entered by mistake
- duplicate
- privacy concern
- no longer wishes public distribution

Withdrawal:

- stops active distribution
- preserves audit history
- hides contact
- does not claim reunion

## 69. Hard Deletion

Ordinary users should not hard-delete an active alert and erase safety history.

Use withdrawal or archive.

Hard deletion is reserved for:

- legal deletion requirements
- invalid or abusive content
- moderator policy
- unsubmitted drafts

Required transactional and safety records may be retained or anonymized.

## 70. Nearby Notification Fanout

The Feed card currently states:

```text
100 alerted nearby
```

Production distribution should:

1. Determine eligible audience from geospatial policy.
2. Apply user alert preferences.
3. Apply blocks and account state.
4. Apply rate and duplicate suppression.
5. Queue push and in-app notifications.
6. Track delivery outcomes.
7. Return an approximate safe count.

Do not reveal recipient identities to the reporter.

## 71. Notification Eligibility

Potential recipients:

- nearby users who opted in
- local Paw Circle members
- relevant Community members
- followers of the missing Companion
- rescue volunteers
- moderators or trusted responders

Eligibility must respect:

- distance
- alert kind
- species preferences where supported
- muted areas or Communities
- blocked users
- notification settings
- spam protections

## 72. Lost Notification

The current notification system contains a static Lost notification with no
working deep link.

Production notification:

```json
{
  "type": "lost_found_nearby",
  "alert_id": "alert_123",
  "title": "Lost dog nearby",
  "body": "Bruno was last seen in Mirpur Section 10.",
  "image_url": "https://cdn.example.com/thumb.jpg"
}
```

Tapping it opens the canonical alert detail.

## 73. Notification Types

Recommended:

```text
lost_found_nearby
lost_found_sighting_received
lost_found_claim_received
lost_found_claim_updated
lost_found_possible_match
lost_found_message_received
lost_found_expiry_reminder
lost_found_resolved
lost_found_alert_updated
lost_found_moderation_action
```

## 74. Notification Deduplication

Avoid duplicate push messages when the same alert is placed in:

- Feed
- several Communities
- a Paw Circle share

Use alert-level notification keys and destination-specific in-app context.

## 75. Comments And Public Tips

Comments can help, but may expose:

- exact locations
- private phone numbers
- false sightings
- harassment
- unsafe instructions

Recommended:

- allow public comments where policy permits
- detect and mask contact data when necessary
- provide a structured Sighting action
- let reporter pin a useful update
- let moderators remove dangerous details
- preserve private evidence in claim/sighting workflows instead of comments

## 76. Helpful Reactions In Community

Community Lost and Found posts use the ordinary Helpful reaction.

Helpful is not a verified sighting and must not:

- change alert status
- notify the owner as a sighting
- count as evidence
- trigger matching

Keep social reaction and operational alert actions separate.

## 77. Ownership And Found-Animal Safety

For a found animal:

- do not publish every identifying detail
- reserve one or more private verification details
- do not hand over based only on a name claim
- use microchip or documentary verification where available
- advise veterinary or rescue scanning
- document handoff outcome

The app should not present itself as legal proof of ownership.

## 78. Rewards And Payments

Scammers may demand money or fake possession.

Recommended rules:

- no payment is required to report a sighting
- display scam warnings
- prohibit ransom language
- moderate suspicious payment requests
- do not guarantee reward enforcement
- keep payments outside the first Lost and Found implementation

## 79. Abuse Prevention

Protect against:

- fake Lost alerts
- fake Found alerts
- stalking through exact location
- scraping phone numbers
- fraudulent ownership claims
- repeated spam alerts
- harassment through Message owner/finder
- malicious location updates
- stolen or misleading photos
- dangerous advice

Controls:

- account verification signals
- rate limits
- device and abuse risk signals
- media similarity
- duplicate detection
- report tools
- moderation queues
- location precision limits
- contact relay
- audit logs

## 80. Moderation

Moderators should be able to:

- hide or restore an alert
- reduce location precision
- hide contact data
- remove media
- mark duplicate
- restrict messaging
- reject fraudulent claims
- resolve with policy outcome
- suspend nearby fanout
- preserve evidence

Every action requires actor, reason, and timestamp.

## 81. Reporting An Alert

Report reasons:

```text
false_information
fraud_or_scam
unsafe_location
exposed_private_information
stolen_media
animal_welfare_concern
harassment
duplicate
already_resolved
other
```

Reporting must not automatically disclose reporter identity to the alert owner.

## 82. Viewer Capabilities

Every response should include:

```json
{
  "can_view": true,
  "can_message_reporter": true,
  "can_report_sighting": true,
  "can_submit_claim": false,
  "can_comment": true,
  "can_save": true,
  "can_share": true,
  "can_edit": false,
  "can_withdraw": false,
  "can_resolve": false,
  "can_reopen": false,
  "can_report": true
}
```

Capabilities improve presentation but do not replace server authorization.

## 83. Recommended Database Model

### `lost_found_alerts`

```text
id
kind
status
reporter_user_id
reporter_role
subject_companion_id
temporary_subject_id
canonical_post_id
occurred_at
reported_at
expires_at
alert_radius_km
contact_mode
public_contact_encrypted
resolution_outcome
resolution_note
resolved_at
resolved_by_user_id
created_at
updated_at
version
```

### `lost_found_subjects`

```text
id
species
breed_description
age_description
sex_description
appearance
collar_description
temperament
secured
public_notes
private_verification_notes
```

### `lost_found_locations`

```text
alert_id
location_label
latitude
longitude
geohash
public_precision
source
visibility
```

### `lost_found_alert_assets`

```text
alert_id
asset_id
position
visibility
```

### `lost_found_sightings`

```text
id
alert_id
reporter_user_id
occurred_at
location_label
latitude
longitude
public_precision
still_present
note
moderation_status
created_at
```

### `lost_found_claims`

```text
id
found_alert_id
claimant_user_id
status
reviewer_user_id
accepted_at
rejected_at
created_at
updated_at
```

### `lost_found_claim_evidence`

```text
claim_id
evidence_type
asset_id
encrypted_text
visibility
created_at
```

### `lost_found_matches`

```text
id
lost_alert_id
found_alert_id
score
reasons_json
status
created_at
reviewed_at
```

### Other related tables

```text
posts
post_placements
post_assets
post_companions
saved_lost_found_alerts
lost_found_updates
lost_found_notification_deliveries
conversations
conversation_contexts
audit_events
```

## 84. Suggested API Surface

```text
POST   /lost-found/alerts
GET    /lost-found/alerts/:alertId
PATCH  /lost-found/alerts/:alertId
POST   /lost-found/alerts/:alertId/withdraw
POST   /lost-found/alerts/:alertId/resolve
POST   /lost-found/alerts/:alertId/reopen

GET    /lost-found/alerts
GET    /lost-found/search
GET    /me/lost-found/alerts

POST   /lost-found/alerts/:alertId/updates
GET    /lost-found/alerts/:alertId/updates

POST   /lost-found/alerts/:alertId/sightings
GET    /lost-found/alerts/:alertId/sightings

POST   /lost-found/alerts/:alertId/claims
GET    /lost-found/alerts/:alertId/claims
PATCH  /lost-found/claims/:claimId

GET    /lost-found/alerts/:alertId/matches
POST   /lost-found/matches/:matchId/confirm
POST   /lost-found/matches/:matchId/dismiss

POST   /lost-found/alerts/:alertId/conversation

PUT    /me/saved-lost-found-alerts/:alertId
DELETE /me/saved-lost-found-alerts/:alertId
GET    /me/saved-lost-found-alerts

POST   /lost-found/alerts/:alertId/report

POST   /media/upload-sessions
POST   /media/:assetId/complete
GET    /media/:assetId/status
```

## 85. Create Transaction

Recommended transaction:

1. Authenticate reporter.
2. Validate idempotency key.
3. Validate kind and subject.
4. Validate Companion permission where present.
5. Validate event time.
6. Validate and normalize location.
7. Validate contact policy.
8. Validate media assets.
9. Validate destinations.
10. Run duplicate precheck.
11. Create alert.
12. Create temporary subject if required.
13. Create canonical post.
14. Link media and subject Companion.
15. Create placements.
16. Create expiry schedule.
17. Write audit event.
18. Commit.
19. Publish create and matching events.
20. Queue nearby distribution after commit.

## 86. Resolve Transaction

1. Authenticate actor.
2. Validate idempotency key.
3. Lock alert.
4. Verify resolve permission.
5. Validate current status.
6. Validate outcome.
7. Validate accepted claim or match when required.
8. Store resolution details.
9. Update all placements.
10. Disable active actions.
11. Close match candidates.
12. Stop scheduled fanout and expiry.
13. Write audit event.
14. Commit.
15. Publish resolution event.

## 87. Save Transaction

Save and unsave should be a unique relationship:

```text
UNIQUE(user_id, alert_id)
```

It must not mutate the alert or post.

## 88. Events

Recommended domain events:

```text
lost_found.alert_created
lost_found.alert_updated
lost_found.alert_withdrawn
lost_found.alert_expired
lost_found.alert_resolved
lost_found.alert_reopened
lost_found.sighting_created
lost_found.claim_created
lost_found.claim_updated
lost_found.match_candidate_created
lost_found.match_confirmed
lost_found.match_dismissed
lost_found.contact_changed
lost_found.placement_created
lost_found.placement_removed
lost_found.moderation_applied
```

Events must not expose exact private locations or contact values on general
event buses.

## 89. Cache And Index Updates

Invalidate or update:

- main Feed
- Community feeds
- Community search
- Lost and Found search
- alert detail
- saved alerts
- owner profile posts
- shared previews
- notification payloads
- geospatial active-alert index
- Companion profile link where relevant

Status and privacy changes must be enforced at read time before every cache is
fully refreshed.

## 90. Error Contract

Recommended errors:

```text
LOST_FOUND_ALERT_NOT_FOUND
LOST_FOUND_KIND_REQUIRED
LOST_FOUND_SUBJECT_REQUIRED
LOST_FOUND_COMPANION_FORBIDDEN
LOST_FOUND_LOCATION_REQUIRED
LOST_FOUND_TIME_REQUIRED
LOST_FOUND_TIME_INVALID
LOST_FOUND_CONTACT_INVALID
LOST_FOUND_DESTINATION_FORBIDDEN
LOST_FOUND_ALERT_NOT_ACTIVE
LOST_FOUND_RESOLUTION_INVALID
LOST_FOUND_ALREADY_RESOLVED
LOST_FOUND_SIGHTING_FORBIDDEN
LOST_FOUND_CLAIM_FORBIDDEN
LOST_FOUND_CLAIM_ALREADY_ACTIVE
LOST_FOUND_MATCH_NOT_AVAILABLE
LOST_FOUND_EXACT_LOCATION_HIDDEN
MESSAGE_NOT_ALLOWED
MEDIA_NOT_READY
MEDIA_TYPE_NOT_ALLOWED
PROFILE_VERSION_CONFLICT
IDEMPOTENCY_CONFLICT
RATE_LIMITED
```

## 91. Backend Invariants

1. Every public Lost or Found placement references one canonical alert.
2. Every alert has exactly one kind.
3. Every active alert has a structured event time and location.
4. A known lost Companion is authorized against the reporter.
5. Found alerts do not attach the reporter's default Companion.
6. Exact private location is never inferred from a public label.
7. Public contact is exposed only under explicit policy.
8. Messaging checks blocks and alert contact rules.
9. Save state is private and canonical.
10. Nearby status is calculated per viewer.
11. Notification counts come from delivery records, not hardcoded text.
12. Resolving one alert updates all placements.
13. Claims and sightings preserve accountable human actors.
14. Automated matches never establish legal ownership.
15. Community helpful reactions do not count as sightings.
16. Expired is different from resolved.
17. Withdrawal is different from reunion.
18. Historical audit records survive ordinary withdrawal or archival.
19. Media and exact locations use purpose-specific authorization.
20. Blocks apply to profile, alert, message, claim, and notification surfaces.

## 92. Current Frontend Inconsistencies

These are current implementation facts, not production rules:

1. Lost and Found are optional post fields rather than canonical alerts.
2. Time is free-form display text.
3. Location is free-form text.
4. Exact and public location are not separated.
5. Feed cards always say Nearby.
6. Lost cards always say 100 people were alerted.
7. Found cards always say the alert was shared with local circles.
8. Message owner and Message finder only show a toast.
9. Dedicated-card save state resets locally.
10. Dedicated-card saves do not update canonical saved posts.
11. There is no sighting workflow.
12. There is no claim or proof-of-ownership workflow.
13. There is no Lost/Found matching.
14. There is no active, resolved, reunited, expired, or withdrawn state.
15. There is no alert management or update history.
16. Photos are placeholders.
17. Device location is not implemented.
18. The composer defaults to the user's first Companion.
19. Found alerts can therefore be mislabeled with an unrelated Companion.
20. Lost alerts can attach more than one Companion.
21. Dedicated Feed cards do not pass Companion-profile navigation.
22. Dedicated cards omit normal comment and reaction controls.
23. Profile and Saved screens render alerts as generic Feed posts.
24. Profile post detail omits structured alert details.
25. Cross-posted Feed and Community records have no durable relationship.
26. Community Lost and Found posts may have no alert metadata.
27. The separate Community create screen does not collect required alert data.
28. Community detail displays contact as ordinary text.
29. Search ignores structured location and animal description.
30. Static Lost notifications do not deep-link to a canonical alert.

The backend must implement the corrected workflow in this document.

## 93. End-To-End Lost Workflow

1. Owner chooses Lost.
2. Owner explicitly selects one manageable Companion or enters an unregistered
   animal.
3. Owner enters last-seen time and place.
4. Owner enters description and contact preference.
5. Owner selects and uploads media.
6. Owner chooses Feed and eligible Communities.
7. Backend validates and creates one canonical alert.
8. Backend creates post placements.
9. Nearby and relevant users are notified.
10. Feed displays a viewer-specific Lost card.
11. Viewers may save, share, message, comment, or report a sighting.
12. Sightings notify the owner.
13. Matching service compares Found alerts.
14. Owner coordinates through an alert-scoped conversation.
15. Owner marks Reunited or another outcome.
16. Every placement updates to the final state.

## 94. End-To-End Found Workflow

1. Finder chooses Found.
2. No owned Companion is selected by default.
3. Finder indicates whether the animal is seen or secured.
4. Finder enters time, place, appearance, and contact policy.
5. Finder uploads privacy-safe media.
6. Backend creates one canonical Found alert.
7. Matching service checks active Lost alerts.
8. Eligible nearby users and potential owners are notified.
9. Viewers may save, share, message, or submit a private claim.
10. Finder reviews claims safely.
11. Verified handoff occurs.
12. Finder or authorized moderator resolves as reunited or another outcome.
13. Contact and exact location are hidden after resolution.

## 95. End-To-End Sighting Workflow

1. Viewer opens an active Lost alert.
2. Viewer taps Report sighting.
3. Viewer enters when, where, current presence, and note.
4. Viewer optionally uploads media.
5. Backend stores and moderates the sighting.
6. Owner receives a notification.
7. Owner can open or reuse an alert-scoped conversation.
8. Sighting may create a Found match candidate.
9. Reporter can correct or withdraw their sighting under policy.

## 96. End-To-End Claim Workflow

1. Potential owner opens a secured Found alert.
2. User taps This may be my pet.
3. Client collects private proof.
4. Backend creates one active claim.
5. Finder receives a safe notification.
6. Finder, rescue, or moderator asks for more evidence if needed.
7. Claim is accepted or rejected.
8. Accepted claim moves the alert to resolution pending.
9. Safe handoff is completed.
10. Alert resolves as reunited with verified owner.

## 97. Minimum Acceptance Scenarios

1. User can create a Lost alert for one authorized Companion.
2. User cannot report another user's Companion as lost without permission.
3. User can create Lost for an unregistered animal through an explicit subject.
4. Found creation starts with no Companion selected.
5. Found alert cannot silently attach the user's first Companion.
6. Required event time and location are validated.
7. Absolute timestamps and timezone are stored.
8. User can manually enter location without device permission.
9. Foreground location denial preserves the draft.
10. User can reduce public location precision.
11. Exact holding address is hidden for a secured found animal.
12. User can select and upload real media.
13. Picker cancellation preserves the form.
14. Android pending picker result can be recovered.
15. Invalid or rejected media does not publish.
16. One create command can place the alert in Feed and Communities.
17. Cross-posted placements share one alert status.
18. Invalid Community destination prevents unintended partial creation.
19. Feed Lost card displays real alert data.
20. Feed Found card displays real alert data.
21. Nearby badge is viewer-specific.
22. Alerted-nearby count comes from canonical delivery records.
23. Message owner creates or reuses the correct alert conversation.
24. Message finder creates or reuses the correct alert conversation.
25. Blocks and message policy prevent unauthorized contact.
26. Public phone is never exposed without explicit consent.
27. Save and unsave persist across devices.
28. Saved alert retains dedicated card behavior.
29. Share references the canonical alert.
30. Shared preview updates when alert resolves.
31. Known Companion link opens when authorized.
32. Unknown animal does not require a fake Companion profile.
33. Viewer can submit a structured sighting.
34. Sighting notifies the alert owner.
35. Helpful reaction does not create a sighting.
36. Potential owner can submit a private claim.
37. Claim evidence is not publicly visible.
38. Two active accepted claims cannot exist for one found animal.
39. Matching service can produce reviewable candidates.
40. Automated match does not prove ownership.
41. Owner can resolve Lost as reunited.
42. Finder can resolve Found after verified handoff.
43. Resolution updates every placement.
44. Resolution disables new sightings and claims.
45. Expiration stops active distribution without claiming resolution.
46. Reporter can extend an expiring alert.
47. Withdrawal hides contact and stops fanout.
48. Reopen requires authorization and an audit reason.
49. Profile renders Lost/Found details rather than a generic card.
50. Community create screen cannot publish incomplete alert metadata.
51. Community search can find public location and appearance fields.
52. Notification tap opens canonical alert detail.
53. Moderators can hide contact or reduce location precision.
54. Direct APIs cannot bypass privacy, blocks, or alert status.

## 98. Canonical Product Summary

The production Lost and Found workflow should follow these principles:

- Lost and Found are structured, time-sensitive alerts, not only post tags.
- One alert may appear in Feed and several Communities.
- A Lost alert explicitly identifies one known Companion or one temporary
  subject.
- A Found alert starts without an owned Companion.
- Time and location are structured and reviewable.
- Public location may be less precise than stored location.
- In-app or relay contact is safer than public phone numbers.
- Nearby badges and notification counts come from real viewer and delivery
  data.
- Messaging opens an alert-scoped canonical conversation.
- Saves, shares, sightings, claims, matches, and status are backend records.
- Reunited, resolved, expired, and withdrawn have different meanings.
- Resolving the alert updates every placement and shared preview.
- Claims use private proof and do not expose sensitive evidence publicly.
- Automated matching suggests candidates but does not prove ownership.
- Media is selected and uploaded through the Expo SDK 56-compatible asset
  workflow.
- The backend is authoritative for permissions, privacy, location, contact,
  moderation, distribution, and history.
