# Companion Backend Workflow

## 1. Purpose

This document describes the complete Companion workflow represented by the
frontend.

It covers:

- the Companion section on My Profile
- manually adding a companion
- creating a companion from a confirmed adoption
- companion identity, handles, avatars, and owner association
- the mini Companion sheet and full Companion profile
- editing, archiving, transfer, and historical attribution
- companion privacy and blocking
- followers
- pawprints
- treats and treat allowances
- moods and social profile fields
- sibling and household relationships
- Feed-only posts made as a companion
- ordinary human posts made with a companion
- the Companion profile Posts tab
- reactions, comments, saves, and shares on companion posts
- Companion links from Feed, Community, profiles, and shared posts
- veterinary use of owned companions
- media selection and upload
- APIs, database models, events, errors, security rules, and acceptance tests

The current frontend is a prototype. Companion records are stored in mutable
mock data, several actions exist only in local React state or AsyncStorage,
media is represented by placeholders, and privacy settings are not consistently
enforced.

The backend must implement the intended behavior without reproducing those
limitations.

## 2. Main Frontend Sources

The Companion workflow is primarily implemented in:

- `src/context/CompanionContext.tsx`
- `src/data/mockData.ts`
- `src/components/profile/ProfileChrome.tsx`
- `src/components/profile/AddCompanionSheet.tsx`
- `src/screens/profile/ProfileHomeScreen.tsx`
- `src/screens/profile/MyCompanionScreen.tsx`
- `src/components/CompanionProfile.tsx`
- `src/components/CompanionProfileOverlay.tsx`
- `src/components/ui/Avatar.tsx`
- `src/context/TreatWalletContext.tsx`
- `src/utils/treatWallet.ts`
- `src/components/TreatWalletPill.tsx`
- `src/components/RecentTreatsRow.tsx`
- `src/components/OwnerTreatsSection.tsx`
- `src/context/FeedPostContext.tsx`
- `src/components/feed/PostComposer.tsx`
- `src/components/feed/PostAuthorRow.tsx`
- `src/components/feed/FeedPostCard.tsx`
- `src/utils/postAuthor.ts`
- `src/hooks/useProfileViewData.ts`
- `src/screens/FeedScreen.tsx`
- `src/screens/pawCircles/UserProfileScreen.tsx`
- `src/screens/pawCircles/CircleSharedPostCard.tsx`
- `src/context/UserPrivacyContext.tsx`
- `src/screens/profile/ProfilePrivacyScreen.tsx`
- `src/data/adoptionRecords.ts`
- `src/screens/vet/VetProfileScreen.tsx`
- `src/screens/vet/VetUrgentPetScreen.tsx`
- `src/screens/vet/VetUrgentDetailsScreen.tsx`
- `src/context/VetConsultContext.tsx`

The Feed companion-post contract is also described in:

- `docs/feed-companion-backend-workflow.md`

This document is the canonical backend handoff for the Companion page itself.

## 3. Product Definitions

### Companion

A Companion is an animal profile managed by one or more authorized human
users.

A Companion is not:

- a login account
- an independent legal actor
- a replacement for the accountable human user
- automatically the same thing as an adoption listing
- automatically the same thing as a Rescue case
- automatically the same thing as a veterinary patient record

These features may reference the same Companion ID, but they remain separate
domain records.

### Primary owner

The main human account responsible for the Companion.

### Companion manager

An additional authorized human who may perform specific actions, such as:

- edit profile information
- upload an avatar
- attach the Companion to a human-authored post
- publish a Feed post as the Companion
- access care details
- use the Companion in a veterinary consultation

Permissions must be explicit. A viewer is not a manager merely because they
follow the owner or Companion.

### Public Companion profile

A viewer-specific social profile containing only fields the viewer is allowed
to see.

### Care record

Private or restricted information such as:

- vaccination status
- neutering status
- microchip status
- veterinary history
- medical notes
- private date of birth
- ownership or transfer evidence

The care record must not be returned as part of an ordinary public Companion
profile response.

### Companion-authored post

A Feed post where:

- a human user performs the action
- the human user remains accountable
- the Companion is presented as the visible author
- the post is labeled Paw Posting
- the placement is limited to the main Feed

### Human post with a Companion

A normal user-authored post that explicitly references one or more Companions.
The human remains the visible author.

## 4. Current Frontend Companion Model

The mock `Companion` model contains:

```ts
{
  id,
  name,
  species,
  icon,
  breed,
  age,
  gender,
  owner,
  ownerId,
  tint,
  traits,
  vaccinated,
  neutered,
  microchipped,
  about,
  handle,
  mood,
  followers,
  pawprints,
  treats,
  postsCount,
  siblings,
  online,
  verified
}
```

Current problems:

- Public and private fields are mixed in one object.
- `owner` and `ownerId` duplicate ownership.
- IDs are generated from names.
- Handles are usually the same value as the name-based ID.
- Counts are static seed values.
- Health fields can be read anywhere the mock object is imported.
- There is no status such as active, archived, transferred, or memorialized.
- There is no created or updated timestamp.
- There is no profile version for concurrent editing.
- There is no media asset ID.
- There is no adoption-source ID.
- There is no manager or co-owner model.
- Sibling relationships are stored as mutable ID arrays.
- Online and verified fields have no defined backend meaning.

## 5. Recommended Companion Domain Model

Separate public identity, ownership, care data, and counters.

### Public identity

```text
companions
- id
- primary_owner_user_id
- public_handle
- normalized_public_handle
- name
- species
- breed_public
- age_display
- gender_display
- about
- mood
- avatar_asset_id
- profile_visibility
- status
- source_type
- source_adoption_record_id
- verified_status
- created_at
- updated_at
- archived_at
- profile_version
```

### Management access

```text
companion_managers
- companion_id
- user_id
- role
- can_edit_profile
- can_manage_avatar
- can_attach_to_posts
- can_post_as_companion
- can_view_care_record
- can_use_vet_services
- can_manage_access
- created_at
- revoked_at
```

### Private care data

```text
companion_care_profiles
- companion_id
- date_of_birth
- breed_private
- sex
- vaccination_status
- neuter_status
- microchip_status
- microchip_identifier_encrypted
- allergies
- medical_notes
- updated_at
```

### Social counters

Counters may be stored in a projection or calculated from canonical records:

```text
companion_social_stats
- companion_id
- follower_count
- pawprint_count
- treat_count
- visible_feed_post_count
- updated_at
```

Do not accept client-supplied counter totals as authoritative.

## 6. Stable IDs And Companion Handles

The current frontend creates a Companion ID by slugifying the Companion name.

For example:

```text
Max -> max
Luna Belle -> luna-belle
```

This is not safe because:

- many users can have a Companion named Max
- one owner can have two same-named Companions
- renaming a Companion should not change its ID
- name punctuation can produce empty or colliding slugs
- historical posts must retain stable references

Production rules:

- The Companion ID is a server-generated immutable UUID.
- The Companion name does not need to be unique.
- Two Companions may have the same name.
- Renaming does not change the Companion ID.
- Every API relationship uses the Companion ID.

The frontend displays `@max` on Companion profiles. If Companion handles remain
a product feature, they must be treated separately from IDs.

Recommended handle rules:

- optional during initial Companion creation
- globally unique after normalization
- case-insensitive uniqueness
- server-validated
- reserved-name checks
- stable Companion-ID links remain canonical
- handle changes use history and release protection

An alternative is to remove public Companion handles and use only name plus
stable ID routes. The backend must not use a display name as an identifier.

## 7. Companion Status

Recommended states:

```text
draft
active
private
archived
memorialized
transferred
restricted
deleted
```

Meanings:

- `draft`: creation has started but required information is incomplete.
- `active`: usable in profile, Feed, and eligible connected features.
- `private`: usable by managers but not publicly discoverable.
- `archived`: removed from active owner surfaces while history is preserved.
- `memorialized`: historical profile remains according to owner privacy.
- `transferred`: management or ownership moved under an audited workflow.
- `restricted`: posting or public actions disabled by moderation.
- `deleted`: legally deleted or irreversibly removed under policy.

The client must not convert these states by deleting local objects.

## 8. My Profile Companion Section

The current My Profile page:

1. Loads Companions whose `ownerId` equals the current user ID.
2. Displays each Companion as a chip.
3. Shows avatar, name, species, and age.
4. Opens the full Companion profile when selected.
5. Shows an Add chip.
6. Provides an edit mode with remove buttons.

Recommended endpoint:

```http
GET /v1/me/companions
```

Response:

```json
{
  "items": [
    {
      "id": "companion_123",
      "name": "Max",
      "species": "dog",
      "age_display": "3 yrs",
      "avatar_url": "https://cdn.example.com/max.jpg",
      "status": "active",
      "capabilities": {
        "can_view": true,
        "can_edit": true,
        "can_archive": true,
        "can_post_as_companion": true,
        "can_use_vet_services": true
      }
    }
  ]
}
```

This response must be based on manager permissions, not only
`primary_owner_user_id`.

## 9. Adding A Companion Manually

### Current frontend behavior

The Add Companion sheet asks for:

- name
- species: dog, cat, or other
- age as free text

Only name is required.

The frontend then:

- creates an ID from the name
- sets placeholder values for breed and gender
- sets all care booleans to false
- assigns a default mood
- assigns every other Companion belonging to the owner as a sibling
- inserts the object into an in-memory global record

There is no:

- backend persistence
- avatar selection
- field validation beyond non-empty name
- duplicate-safe stable ID
- edit screen
- explicit privacy choice
- care-data confirmation
- manager access

### Correct creation workflow

1. Owner taps Add Companion.
2. Client shows manual creation and eligible adoption choices.
3. Owner selects manual creation.
4. Client collects required fields.
5. Client optionally collects an avatar.
6. Client validates basic field lengths and formats.
7. If media is selected, client uploads it through the media pipeline.
8. Client submits an idempotent Companion creation request.
9. Backend authenticates the user.
10. Backend validates that the account may create Companions.
11. Backend validates all fields and the avatar asset.
12. Backend creates the Companion with a server-generated ID.
13. Backend creates the owner manager row.
14. Backend stores care fields in the restricted care record.
15. Backend writes an audit event.
16. Backend returns the canonical Companion summary.
17. Client refreshes My Profile, composer choices, and veterinary choices.
18. Client may open the newly created Companion profile.

Recommended request:

```http
POST /v1/companions
Idempotency-Key: 7a147e7f-...
```

```json
{
  "name": "Max",
  "species": "dog",
  "breed": "Golden Retriever",
  "date_of_birth": "2023-03-14",
  "age_display": "3 yrs",
  "gender": "male",
  "about": "",
  "mood": "New on the block",
  "avatar_asset_id": "asset_123",
  "profile_visibility": "everyone",
  "care": {
    "vaccination_status": "unknown",
    "neuter_status": "unknown",
    "microchip_status": "unknown"
  }
}
```

Do not use `false` to mean both "no" and "not yet known."

Use explicit values:

```text
yes
no
unknown
not_applicable
```

## 10. Companion Creation Validation

Recommended limits:

- name: 1 to 80 characters
- species: configured taxonomy value
- breed: 0 to 100 characters
- about: 0 to 500 characters
- mood: 0 to 120 characters
- traits: no more than 12 values
- each trait: 1 to 40 characters
- age display: server-generated where date of birth is known

Backend validation must:

- trim surrounding whitespace
- reject control characters
- moderate public text
- reject unsupported media
- allow duplicate Companion names
- validate dates
- reject future dates of birth
- avoid inferring medical truth from missing fields
- enforce Companion limits only if the product has an explicit limit

## 11. Adding A Companion From Adoption

### Current frontend behavior

The Add Companion sheet lists adoption records where:

- the current user is the adopter
- the adoption is no longer pending confirmation
- the frontend does not think a same-named Companion already exists

Selecting the record creates a Companion with:

- a name-based ID
- the adoption pet name and species
- breed set to `Adopted`
- unknown age and gender
- all care booleans set to false
- an about line derived from adoption date and new-home text
- a default settling-in mood
- all existing owner Companions marked as siblings

Duplicate prevention currently relies partly on name equality. That can block
two genuinely different adopted animals with the same name.

### Correct adoption-to-Companion workflow

The adoption service is the source of truth for confirmed adoption eligibility.

1. Client requests eligible adopted animals.
2. Backend returns adoption records that the current user may convert or link.
3. Records already linked to a Companion are marked as linked.
4. User selects one eligible adoption.
5. Client may ask for missing profile fields and an avatar.
6. Client submits the adoption record ID.
7. Backend authenticates the adopter.
8. Backend locks or consistently reads the adoption record.
9. Backend verifies that the adoption is confirmed and eligible.
10. Backend verifies the current user is the adopter or authorized recipient.
11. Backend checks for an existing `source_adoption_record_id` link.
12. Backend creates or links exactly one Companion.
13. Backend creates the appropriate management relationship.
14. Backend preserves the immutable adoption history.
15. Backend returns the Companion.

Recommended request:

```http
POST /v1/adoptions/{adoption_record_id}/companion
Idempotency-Key: 8f86836a-...
```

```json
{
  "name": "Pepper",
  "avatar_asset_id": "asset_456",
  "profile_visibility": "everyone"
}
```

The operation must be idempotent per adoption record.

If the adopted animal already has a canonical Companion record, the backend
should transfer or grant management according to adoption policy instead of
creating a duplicate animal identity.

## 12. Adoption And Companion Records Remain Different

A confirmed adoption record represents:

- who rehomed the animal
- who adopted the animal
- confirmation history
- required home updates
- trust and safety history

A Companion profile represents:

- the animal's current social profile
- current managers
- public identity
- Feed posts
- followers and treats
- optional care and veterinary use

Deleting or archiving a Companion must not delete the confirmed adoption
record.

Closing or completing adoption follow-up must not automatically archive the
Companion.

## 13. Companion Avatar

### Current frontend behavior

`CompanionAvatar` resolves a mock image from a Companion ID or name. There is
no real avatar picker, crop flow, upload, processing state, or media asset ID.

### Production Expo SDK 56 workflow

Use the exact Expo SDK 56 ImagePicker contract:

- <https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/>

The current project does not list `expo-image-picker` in `package.json`.

Library flow:

1. Owner or authorized manager taps Change photo.
2. Client opens the device media picker with `launchImageLibraryAsync`.
3. Client handles cancellation without modifying the Companion.
4. Client validates type, size, and dimensions.
5. Client shows crop and preview UI.
6. Client uploads the selected bytes.
7. Backend scans and processes the image.
8. Client receives or polls the ready asset.
9. Client submits the ready asset ID in a Companion update.
10. Backend atomically changes the avatar reference.

Camera flow:

1. Request camera permission.
2. Call `launchCameraAsync`.
3. Handle denial and cancellation.
4. Preview, crop, upload, and commit through the same asset workflow.

On Android, the relevant flow should check `getPendingResultAsync` when
recovering from activity destruction.

On web, picker launch must occur directly from user activation.

Do not store a local device URI in the Companion record.

## 14. Companion Media Upload

Recommended upload request:

```http
POST /v1/media/upload-sessions
```

```json
{
  "purpose": "companion_avatar",
  "mime_type": "image/jpeg",
  "file_size": 2381942,
  "width": 1800,
  "height": 1800,
  "companion_id": "companion_123"
}
```

The media service must validate:

- actor ownership or manager permission
- permitted MIME type
- maximum size
- image dimensions
- malware and content scanning
- moderation rules
- asset purpose

Recommended asset states:

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

The old avatar should be retired only after the new avatar update commits.

## 15. Editing A Companion

The current frontend does not provide a working Companion edit profile screen.
The More button shows a "coming soon" toast.

The backend should support editing even if the UI is implemented later.

Editable public fields:

- name
- handle, when supported
- species
- public breed
- age display or date of birth according to policy
- public gender label
- about
- mood
- traits
- avatar
- profile visibility

Restricted care fields:

- vaccination status
- neuter status
- microchip status
- allergies
- medical notes

Recommended endpoint:

```http
PATCH /v1/companions/{companion_id}
If-Match: "profile-version-8"
```

The backend must:

- verify edit permission
- validate changed fields
- recheck media ownership
- use optimistic concurrency
- write an audit event
- return a new profile version
- invalidate Companion, owner-profile, Feed-author, and search caches

## 16. Companion Profile Entry Points

The frontend can open a Companion profile from:

- My Profile Companion chips
- another user's public profile
- a Feed post authored as the Companion
- a Feed post made with the Companion
- some Community post author rows
- Community search
- Community group feed
- Community post detail
- sibling links
- direct Profile navigation

The Feed commonly opens:

1. a mini Companion sheet
2. then a full Companion profile

My Profile and public user profiles often open the full profile directly.

Every entry point must resolve the same viewer-authorized Companion read model.
The client must not assemble a profile from globally imported data.

## 17. Viewer-Specific Companion Read Model

Recommended endpoint:

```http
GET /v1/companions/{companion_id}
```

Example public response:

```json
{
  "id": "companion_123",
  "handle": "max.aisha",
  "name": "Max",
  "species": "dog",
  "breed": "Golden Retriever",
  "age_display": "3 yrs",
  "gender_display": "Male",
  "about": "A soft soul who loves lake-side mornings.",
  "mood": "Gentle and playful",
  "traits": [
    "Gentle",
    "Playful",
    "Loves water"
  ],
  "avatar_url": "https://cdn.example.com/max.jpg",
  "status": "active",
  "verified": false,
  "owner": {
    "id": "user_123",
    "display_name": "Aisha Rahman",
    "username": "aisharahman",
    "can_view_profile": true
  },
  "stats": {
    "followers": 2100,
    "pawprints": 5800,
    "treats": 1200,
    "feed_posts": 34
  },
  "relationships": {
    "viewer_follows": false,
    "viewer_is_owner": false,
    "viewer_is_manager": false
  },
  "capabilities": {
    "can_view": true,
    "can_follow": true,
    "can_give_treat": true,
    "can_edit": false,
    "can_archive": false,
    "can_post_as_companion": false,
    "can_view_care_record": false
  }
}
```

Owner-only response may add:

```json
{
  "care": {
    "vaccination_status": "yes",
    "neuter_status": "yes",
    "microchip_status": "yes"
  },
  "capabilities": {
    "can_edit": true,
    "can_archive": true,
    "can_post_as_companion": true,
    "can_view_care_record": true
  }
}
```

Do not return an encrypted or masked microchip identifier unless the viewer has
a specific reason and permission to access it.

## 18. Mini Companion Sheet

The current mini sheet displays:

- Companion avatar
- Companion name
- owner association
- Companion handle
- biography
- followers
- pawprints
- treats
- current mood
- View Profile
- Add post for the owner
- Give Treat for another viewer

The mini sheet must use the same server response as the full profile, possibly
through a smaller summary endpoint.

Recommended endpoint:

```http
GET /v1/companions/{companion_id}/summary
```

The response should include capability flags so the client does not guess which
buttons to show.

## 19. Full Companion Profile

The current full profile displays:

- back action
- Companion handle in the navigation bar
- More action
- large avatar
- name
- owner association
- biography
- follower count
- pawprint count
- treat count
- current mood
- Follow for visitors
- Give Treat for visitors
- Add post for an owner
- sibling profiles
- Posts tab and count
- a three-column post grid

The backend should return each section independently enough that unavailable
features can be hidden without failing the full profile.

## 20. Owner Association

The current Companion profile displays:

```text
with you
```

for the owner viewing their own Companion, and:

```text
with Aisha Rahman
```

for other viewers.

The owner name opens the owner's profile when the viewer is permitted.

Backend rules:

- Return only owner identity fields allowed for the viewer.
- Respect owner profile visibility.
- Respect blocks in both directions.
- Do not expose private contact details.
- Keep the primary owner association stable after archival.
- For transferred Companions, define whether the public page shows current
  owner, previous owner history, or neither.

The phrase "with" is presentation text. Ownership and management must remain
structured data.

## 21. Companion Privacy

The user privacy screen currently contains:

```text
Show companions on profile
```

The setting is saved locally but is not enforced by the public profile or
direct Companion routes.

Production privacy should support:

- owner-level Companion list visibility
- per-Companion profile visibility
- Companion search discoverability
- owner association visibility
- Feed-post visibility
- treat-count visibility
- follower-list visibility
- care-record visibility

Recommended Companion profile visibility:

```text
everyone
circles
only_me
```

Enforcement points:

- owner public profile Companion list
- direct Companion profile endpoint
- Feed author enrichment
- tagged Companion enrichment
- search
- suggestions
- follower lists
- sibling and household lists
- media URLs
- veterinary selection

Hiding a chip in the UI is not authorization.

## 22. Owner-Level And Companion-Level Privacy

Recommended policy:

1. Owner-level `show_companions_on_profile = false` hides the Companion list
   from the owner's public profile.
2. It does not automatically delete or rewrite existing Feed posts.
3. A Companion with `profile_visibility = only_me` cannot be opened by an
   ordinary viewer.
4. A visible historical post may show a minimal non-clickable Companion
   snapshot when policy permits.
5. A manager may use a private Companion in owner-only veterinary flows.
6. Blocks override visibility.

The API should explicitly return:

```json
{
  "can_view_profile": false,
  "display_mode": "minimal_snapshot"
}
```

instead of requiring the client to infer privacy.

## 23. Blocking

If owner A blocks viewer B, viewer B should not be able to:

- open A's Companion profiles
- follow A's Companions
- give treats to A's Companions
- discover A's Companions in search or suggestions
- use direct Companion links to bypass the block
- obtain Companion media through unrestricted URLs

Existing historical content should follow the product's block policy without
leaking the Companion profile.

## 24. Following A Companion

### Current frontend behavior

Visitor Follow state:

- exists only in local component state
- resets when the Companion changes or profile remounts
- does not change the displayed follower count
- does not persist across devices
- does not produce notifications

Owners do not see Follow on their own Companion.

### Production follow workflow

1. Viewer opens an eligible Companion profile.
2. Response includes `viewer_follows` and `can_follow`.
3. Viewer taps Follow.
4. Client submits an idempotent follow request.
5. Backend checks visibility, blocks, account state, and moderation.
6. Backend creates the follow relationship if absent.
7. Backend updates the follower projection.
8. Backend may create an owner notification.
9. Response returns canonical relationship state and count.

Endpoints:

```http
PUT    /v1/companions/{companion_id}/followers/me
DELETE /v1/companions/{companion_id}/followers/me
```

Rules:

- Owners and managers do not need to follow their own Companion.
- Follow and unfollow are idempotent.
- Count changes are server-authoritative.
- Block or privacy changes may remove or hide follows.
- Archived or restricted Companions cannot gain new followers.

## 25. Follower Lists

If follower lists are exposed:

```http
GET /v1/companions/{companion_id}/followers
```

The response must:

- be paginated
- apply blocks and user privacy
- omit deactivated accounts
- avoid leaking follower relationships to unauthorized viewers
- return stable user IDs and safe summaries

The current frontend displays only a count, so a follower-list endpoint is
optional for the first backend phase.

## 26. Pawprints

The frontend displays a static `pawprints` count but does not define how it is
calculated.

Recommended canonical definition:

> Pawprints are the total valid paw reactions received by visible main-Feed
> posts presented as the Companion.

This definition excludes:

- reactions on human-authored posts that merely tag the Companion
- removed or moderation-hidden posts
- Community-only placements
- duplicate reaction events from the same user on the same post

If the product wants a wider definition, name the stat clearly and apply one
consistent rule. Do not store an unexplained client-editable number.

## 27. Treat Wallet

### Current frontend behavior

Each user receives:

- 100 treats
- a local 30-day period
- automatic reset when the local period is considered expired

A user can:

- give a treat to another user's Companion
- give repeated treats until the wallet is empty
- not give a treat to their own Companion

The frontend:

- uses a 600 millisecond debounce
- persists wallet and gifts in AsyncStorage
- applies optimistic local updates
- does not roll back a failed persistence write
- combines static Companion treat totals with local gifts

This is not safe for a real balance or social counter.

## 28. Production Treat Rules

Recommended rules:

- Each eligible user has a server-side allowance.
- The initial product allowance is 100 per configured period.
- Period boundaries are generated by the server.
- A user cannot treat their own Companion.
- A user cannot treat a blocked, archived, private-inaccessible, or restricted
  Companion.
- One request transfers one treat unless the API explicitly supports an
  amount.
- Repeated treats are permitted only if product policy allows them.
- The wallet decrement and gift creation happen in one transaction.
- Requests require an idempotency key.
- Client debounce improves UX but is not fraud protection.
- Counts exclude reversed, fraudulent, or moderated gifts.

Recommended request:

```http
POST /v1/companions/{companion_id}/treats
Idempotency-Key: 0d12b4b9-...
```

```json
{
  "amount": 1
}
```

Response:

```json
{
  "gift_id": "treat_gift_123",
  "companion_id": "companion_456",
  "amount": 1,
  "wallet": {
    "remaining": 84,
    "allowance": 100,
    "resets_at": "2026-07-01T00:00:00Z"
  },
  "companion_treat_count": 1201
}
```

## 29. Treat Wallet Endpoint

```http
GET /v1/me/treat-wallet
```

Example:

```json
{
  "remaining": 84,
  "allowance": 100,
  "period_started_at": "2026-06-01T00:00:00Z",
  "resets_at": "2026-07-01T00:00:00Z",
  "status": "active"
}
```

Use a scheduler plus read-time reconciliation so missed jobs do not leave an
expired balance.

## 30. Treat Counts And Recent Love

The frontend has components for:

- Companion-level recent treat givers
- owner-level total treats across all Companions
- recent giver chips
- a temporary "+1 treat" banner
- a treat-count visibility toggle

Some of these components are not currently mounted on the main Companion page.

Recommended endpoints:

```http
GET /v1/companions/{companion_id}/treats/summary
GET /v1/companions/{companion_id}/treats/recent
GET /v1/me/companions/treats/summary
```

Recent giver responses must respect:

- giver profile privacy
- blocks
- account state
- Companion privacy
- treat visibility settings

## 31. Treat Visibility

The current `showTreatsOnProfile` setting is local and the Companion stats grid
still displays the treat count regardless of that setting.

Correct behavior:

- Owner can choose whether ordinary viewers see treat counts.
- Owner always sees their own canonical counts.
- Managers see counts only if permitted.
- Hidden counts return `null` or an explicit visibility flag.
- The client must not derive hidden counts from recent gifts.

Example:

```json
{
  "treats": null,
  "treats_visibility": "hidden"
}
```

## 32. Treat Notifications

When a treat is accepted:

- notify the primary owner according to notification preferences
- optionally notify other managers
- identify the giver only when the owner may view that profile
- group bursts to avoid notification spam
- deep-link to the Companion profile or treat activity
- do not reveal a private giver through push notification text

The Companion itself does not own a notification inbox.

## 33. Current Mood

The Companion profile displays a free-text mood.

Production rules:

- Mood is optional.
- Only authorized managers can update it.
- Mood is public profile content and must be moderated.
- Store `mood_updated_at`.
- Consider expiring or visually aging old moods.
- Do not infer medical condition from social mood text.

Endpoint:

```http
PATCH /v1/companions/{companion_id}/mood
```

## 34. Traits

Traits exist in the mock model but are not prominently rendered by the current
Companion profile.

If supported:

- use a configured set plus optional moderated custom traits
- preserve ordering
- limit count and length
- do not treat traits as medical or behavioral guarantees

## 35. Siblings And Household Companions

### Current frontend behavior

When a new Companion is created, the frontend marks every other Companion
owned by the same user as its sibling.

When explicit siblings are missing, the profile also falls back to displaying
all other same-owner Companions as siblings.

This can incorrectly label unrelated animals as siblings.

### Correct relationship model

Use structured relationships:

```text
companion_relationships
- companion_id
- related_companion_id
- relationship_type
- created_by_user_id
- created_at
- revoked_at
```

Relationship types may include:

```text
biological_sibling
bonded_pair
household_companion
parent
offspring
other
```

Rules:

- Do not infer biological sibling status from shared ownership.
- If the intended UI means household, label it "Household companions."
- Biological or family relationships require explicit owner input.
- A symmetrical relationship should be stored or projected symmetrically.
- A viewer must be allowed to see both Companion profiles.
- Archiving one Companion should not corrupt the other record.

## 36. Switching Between Companion Profiles

The full profile allows a viewer to tap a sibling and switch the active
Companion profile without leaving the overlay.

The backend must reauthorize every newly selected Companion. Access to one
Companion does not grant access to related Companions.

## 37. Removing A Companion

### Current frontend behavior

My Profile edit mode immediately:

- deletes the Companion from the global mock record
- removes its ID from sibling arrays
- shows a success toast

There is no:

- confirmation
- backend request
- archive state
- ownership transfer
- recovery period
- post-history protection
- adoption-history protection

### Correct archive workflow

The ordinary owner action should be Archive, not hard delete.

1. Owner opens Companion settings.
2. Client explains effects.
3. Owner confirms.
4. Backend requires appropriate manager permission.
5. Backend may require recent authentication.
6. Backend verifies there is no ownership-transfer workflow in progress.
7. Backend archives the Companion.
8. Backend removes it from active composer and veterinary choices.
9. Historical posts retain attribution according to privacy policy.
10. Companion profile becomes archived, private, or unavailable according to
    the selected option.
11. Followers and treat actions are disabled.
12. Backend writes an audit event.

Endpoint:

```http
POST /v1/companions/{companion_id}/archive
```

Optional restoration:

```http
POST /v1/companions/{companion_id}/restore
```

## 38. Companion Transfer

Ownership transfer must not be implemented as archive plus recreation.

Recommended workflow:

1. Current authorized owner initiates transfer.
2. Backend validates transfer eligibility.
3. Recipient accepts through an authenticated flow.
4. Backend updates the primary ownership relationship transactionally.
5. Prior ownership and adoption records remain auditable.
6. Manager permissions are recalculated.
7. Public owner association updates according to policy.
8. Historical Feed posts retain accountable human author records.
9. Private care access is reauthorized.

For an adoption, the adoption domain may initiate this workflow.

## 39. Memorialization

Memorialization should be distinct from deletion.

Potential behavior:

- profile remains visible according to owner choice
- no new posts as the Companion
- no new treats or follows
- historical posts remain
- mood changes are disabled
- page receives a respectful memorial status

This should be an explicit product choice, not inferred from inactivity.

## 40. Feed-Only Companion-Authored Posts

This is the key Companion posting rule.

When the owner taps **Add post** from the Companion mini or full profile:

1. The Feed composer opens with the Companion preselected.
2. `postAsCompanionId` identifies the presented Companion author.
3. The visible author becomes the Companion.
4. The accountable human remains the authenticated user.
5. Category becomes Paw Posting.
6. The destination is locked to the main Feed.
7. Community destination selection is hidden.
8. The post cannot be published as a Companion into a Community.

Production invariant:

```text
presentation_mode = companion
requires destination_type = feed
```

A backend request attempting companion presentation in a Community must be
rejected rather than silently converted to human presentation.

## 41. Companion Post Creation Request

```http
POST /v1/posts
Idempotency-Key: e69d4330-...
```

```json
{
  "body": "Found the best sunny spot today.",
  "category": "paw-posting",
  "presentation": {
    "mode": "companion",
    "author_companion_id": "companion_123"
  },
  "companion_ids": [
    "companion_123"
  ],
  "asset_ids": [
    "asset_post_456"
  ],
  "destinations": [
    {
      "type": "feed"
    }
  ]
}
```

Backend validation:

- authenticate the human actor
- verify the Companion exists
- verify `can_post_as_companion`
- verify Companion status permits posting
- verify the Companion is visible enough for the requested post audience
- require exactly one author Companion
- require that author Companion in `companion_ids`
- normalize category to Paw Posting
- require only one main Feed placement
- validate every media asset
- apply post moderation
- preserve the human actor and accountable author

## 42. Companion Post Stored Identity

Recommended fields:

```text
posts
- id
- actor_user_id
- accountable_author_user_id
- presentation_mode
- author_companion_id
- body
- category
- status
- created_at
- updated_at
```

For a Companion post:

```text
actor_user_id = authenticated human
accountable_author_user_id = authenticated human
presentation_mode = companion
author_companion_id = selected Companion
category = paw-posting
```

The Companion is a presentation identity. It never signs credentials or owns
the security session.

## 43. Companion Post Response

```json
{
  "id": "post_123",
  "presentation_mode": "companion",
  "display_author": {
    "type": "companion",
    "id": "companion_123",
    "name": "Max",
    "handle": "max.aisha",
    "avatar_url": "https://cdn.example.com/max.jpg",
    "can_view_profile": true
  },
  "accountable_author": {
    "id": "user_123",
    "display_name": "Aisha Rahman"
  },
  "category": "paw-posting",
  "placement": {
    "type": "feed"
  },
  "body": "Found the best sunny spot today.",
  "media": [],
  "created_at": "2026-06-14T12:00:00Z"
}
```

Ordinary public clients may not need the full accountable-author object in
every list response, but the backend and moderation systems must retain it.

## 44. Companion Post Media

The current composer only turns on a `hasPhoto` flag and shows a placeholder.

Production flow:

1. Owner opens Add post from Companion profile.
2. Owner selects library or camera.
3. Client uses Expo ImagePicker.
4. Client handles cancellation and permissions.
5. Client validates and previews selected media.
6. Client allows remove and reorder.
7. Client uploads media through a post-media upload session.
8. Backend scans and processes assets.
9. Client submits only ready asset IDs.
10. Post service validates ownership, purpose, type, and destination limits.

Local file URIs must never be stored as final post media.

## 45. Companion Post Feed Rendering

The Feed card currently:

- uses the Companion avatar
- displays the Companion name as primary author
- opens the Companion profile when the author is tapped
- displays a Paw Posting tag
- shows normal Feed reactions, comments, forwarding, and saving

The backend should return a complete `display_author` object so every surface
uses the same presentation.

Do not make each client reconstruct author identity from owner and Companion
IDs.

## 46. Human Posts With A Companion

This is different from posting as the Companion.

Example:

```text
Aisha Rahman with Max
```

The human:

- remains the visible author
- may attach one or more authorized Companions
- may choose Feed or supported Community destinations

The Companion relationship should be stored as:

```text
relationship_type = with
```

This does not turn the post into Paw Posting.

## 47. Companion Profile Posts Tab

### Current frontend behavior

The frontend treats a Feed post as connected to a Companion when:

```ts
post.companions.includes(companionId)
```

This includes:

- posts presented as the Companion
- human-authored Feed posts made with the Companion

Community posts are not part of the Companion profile post query.

The current Companion page:

- combines a static seed post count with newly created local Feed posts
- calculates a number of grid slots
- displays placeholder images rather than actual post media
- does not open real posts from the grid

### Canonical production rule

The Companion profile Posts tab contains accessible **main Feed posts** related
to the Companion.

It may include:

- `relationship=author`: presented as the Companion
- `relationship=with`: human post explicitly made with the Companion

It must not include:

- Community-only placements
- unrelated owner posts
- posts where the backend invented a default Companion
- hidden or removed posts
- posts outside the viewer's audience

Recommended endpoint:

```http
GET /v1/companions/{companion_id}/feed-posts?relationship=all&cursor=...
```

Optional filters:

```text
relationship=author
relationship=with
relationship=all
```

## 48. Why Companion Profile Posts Are Feed-Only

The current product behavior separates:

- Companion social publishing in the main Feed
- human participation in Communities

Therefore:

- A Paw Posting authored as a Companion is Feed-only.
- Community posts always have a human primary author in the current product.
- A Community post may say the human is "with Max."
- Community-only posts do not populate the Companion page Posts tab.

If the product later allows Companion-authored Community posts, that is a new
feature requiring changes to:

- Community post schema
- moderation
- author rows
- search
- saved posts
- detail pages
- Companion profile aggregation

It should not be enabled by accepting the current Feed payload unchanged.

## 49. Companion Post Count

The displayed count must use the same visibility rules as the posts query.

Recommended response:

```json
{
  "count": 34,
  "scope": "visible_main_feed_posts",
  "includes": [
    "author",
    "with"
  ]
}
```

Do not:

- add a seed count to a live count
- count Community-only posts
- count inaccessible posts for an ordinary viewer
- count deleted placements
- let the client submit `postsCount`

## 50. Companion Post Grid

Production grid items should contain:

```json
{
  "post_id": "post_123",
  "relationship": "author",
  "thumbnail": {
    "asset_id": "asset_456",
    "url": "https://cdn.example.com/thumb.jpg",
    "width": 600,
    "height": 600
  },
  "text_preview": "Found the best sunny spot...",
  "created_at": "2026-06-14T12:00:00Z",
  "can_open": true
}
```

For text-only posts, return a text-card presentation type rather than a fake
photo.

Tapping a grid item should open the canonical Feed post detail.

## 51. Feed Reactions And Pawprints

Companion-authored posts use the ordinary Feed reaction system.

When a user paws a post:

- create or remove one user-post reaction
- update the post reaction count
- update Companion pawprint projections when the post is Companion-authored
- notify the accountable owner according to preferences

The Companion does not receive or send reactions as an authenticated actor.

## 52. Comments On Companion Posts

Comments remain human-authored under the current product.

The current `CommentAuthorLine` incorrectly appends a user's first Companion to
comments even when the comment contains no Companion relationship.

Correct behavior:

- A normal comment displays only its human author.
- Do not add "with Max" from the author's default Companion.
- If Companion-authored comments are not supported, reject such a mode.
- If a future comment explicitly references a Companion, store that structured
  relationship rather than deriving it from ownership.

Replies and moderation must identify human actors.

## 53. Saving Companion Posts

Saving is a user-private relationship to the canonical Feed post.

Companion archival must not silently turn a saved post into a different human
author. Use a historical Companion author snapshot when permitted.

## 54. Sharing Companion Posts

The frontend can forward Feed posts to users, Paw Circles, or Communities.

A share should reference the original Feed post, not duplicate its author
fields.

The current Paw Circle shared card:

- always displays the human owner avatar first
- adds the first Companion avatar
- formats owner and Companion differently from the original Feed card
- does not preserve Companion-as-author presentation

Correct shared-post preview:

- use the original `display_author`
- preserve Paw Posting identity
- preserve the accountable owner internally
- show unavailable state when the source post is inaccessible
- do not expose a private Companion through a share

The source Companion post remains Feed-only. A shared preview is a reference,
not a new Community-authored Companion post.

## 55. Profile Aggregation

The owner's user profile currently includes:

- Feed posts authored by the user
- Feed posts presented as Companions owned by the user

The Companion profile includes Feed posts related to that Companion.

Recommended rules:

- User profile can include Companion-authored Feed posts for which the user is
  accountable.
- Companion profile includes only authorized Feed-related posts for that
  Companion.
- Cross-surface pagination and counts use canonical post IDs.
- The same canonical post is not duplicated because of multiple projections.

## 56. Historical Companion Attribution

The current hard deletion makes old posts lose Companion identity.

For example:

- `companionAuthorId` no longer resolves
- the Feed helper falls back to the human user
- the old Paw Posting appears to have been written by a different author

Production posts should preserve a minimal snapshot:

```text
post_companions
- post_id
- companion_id
- relationship_type
- position
- display_name_snapshot
- handle_snapshot
- avatar_asset_id_snapshot
- created_at
```

Use the live Companion profile when authorized. Use the snapshot when the
Companion is archived or unavailable and policy permits historical identity.

Do not copy care data into post snapshots.

## 57. Companion Links From Community

The current Community author row can show:

```text
Aisha Rahman with Max
```

Tapping Max opens the Companion overlay in several Community surfaces.

Rules:

- The Community post remains human-authored.
- The Companion must have been explicitly attached.
- The viewer must be allowed to view the Companion.
- Community code must not fall back to the author's first Companion.
- Community-only posts do not appear in the Companion Feed-post grid.
- Saved, search, group, and detail surfaces should use the same link behavior.

## 58. Direct Companion Navigation

Recommended routes:

```text
/companions/{companion_id}
/@companion-handle
```

The UUID route is canonical. A handle route resolves to the UUID.

Direct navigation must enforce:

- Companion visibility
- owner visibility
- blocks
- Companion status
- moderation restrictions
- viewer capabilities

## 59. Search And Discovery

If Companion search is supported:

```http
GET /v1/search/companions?q=max
```

Search indexing may include:

- name
- public handle
- species
- public breed
- owner-safe display name

It must not include:

- microchip data
- private medical fields
- private location
- adoption safety notes
- private manager identities

Only active and discoverable Companions should appear.

## 60. Companion Verification

The mock model contains a `verified` Boolean, but the Companion profile does not
define how it is earned or displayed.

If verification is supported, use structured states:

```text
none
identity_linked
adoption_verified
organization_verified
moderator_verified
revoked
```

Store:

- verification type
- issuer
- reason
- issued timestamp
- revoked timestamp
- audit evidence reference

Do not let the client submit `verified: true`.

## 61. Online Status

The mock model contains `online`, but a Companion cannot independently log in.

Recommended rule:

- Do not expose Companion online presence by default.
- If the product shows "active," define it as recent manager activity on behalf
  of the Companion.
- Respect the human owner's online-visibility setting.
- Never imply that the animal itself is operating the app.

## 62. Veterinary Companion Selection

The veterinary frontend reuses owned Companions when:

- choosing a pet for an urgent consultation
- booking a selected veterinarian
- showing breed, age, and gender

The list is currently derived from the same global mock record and can become
stale.

Recommended endpoint:

```http
GET /v1/me/companions?capability=use_vet_services
```

The response may include owner-authorized care summary fields needed for the
consultation.

Rules:

- Only authorized managers can select the Companion.
- Public Companion visibility does not control private veterinary access.
- Veterinary access requires `can_use_vet_services`.
- Archived or transferred Companions are excluded unless policy permits.
- The vet consultation stores a Companion ID plus a safe snapshot.
- Medical notes belong to the consultation or care domain, not the public
  Companion profile.

## 63. Custom Veterinary Pets

The urgent vet flow allows "Add another pet" and creates a consultation with a
custom pet name.

This should not automatically create a public Companion.

Recommended behavior:

- store `companion_id = null`
- store consultation-only pet name and species snapshot
- offer a separate explicit "Save as Companion" action after consent
- do not publish veterinary information to a Companion profile

## 64. Veterinary Media

The current urgent consultation photo action only toggles a Boolean.

Real veterinary media must use:

- media selection
- upload session
- restricted medical purpose
- access-controlled storage
- malware scanning
- retention policy

Veterinary media must not reuse a public Feed asset URL unless explicitly
approved.

## 65. Companion Data Exposed To Veterinarians

Return only what is required:

- Companion ID
- name
- species
- age or date of birth when authorized
- breed
- sex when relevant
- owner-submitted symptoms
- selected care fields with consent

Do not automatically disclose:

- owner social graph
- Feed post history
- treat activity
- followers
- private adoption notes
- unrelated medical history

Access should be scoped to the consultation and audited.

## 66. Manager Permissions

Recommended roles:

```text
primary_owner
co_owner
caregiver
profile_editor
viewer
```

Example permission matrix:

| Action | Primary owner | Co-owner | Caregiver | Profile editor | Viewer |
| --- | --- | --- | --- | --- | --- |
| View public profile | yes | yes | yes | yes | policy |
| View care record | yes | configurable | configurable | no | no |
| Edit public profile | yes | configurable | no | yes | no |
| Change avatar | yes | configurable | no | yes | no |
| Attach to human post | yes | configurable | configurable | no | no |
| Post as Companion | yes | configurable | no | no | no |
| Use vet services | yes | configurable | configurable | no | no |
| Manage access | yes | configurable | no | no | no |
| Archive or transfer | yes | restricted | no | no | no |

The backend is authoritative for every action.

## 67. Companion Profile Capabilities

Every Companion response should contain capabilities appropriate for the
viewer:

```json
{
  "can_view": true,
  "can_follow": false,
  "can_give_treat": false,
  "can_edit": true,
  "can_change_avatar": true,
  "can_post_as_companion": true,
  "can_view_care_record": true,
  "can_use_vet_services": true,
  "can_archive": true,
  "can_transfer": true
}
```

The client uses capabilities for presentation. Direct API calls must still
repeat authorization.

## 68. Recommended Database Tables

```text
companions
companion_handles
companion_handle_history
companion_managers
companion_care_profiles
companion_relationships
companion_followers
companion_treat_gifts
treat_wallet_periods
companion_social_stats
posts
post_companions
post_assets
post_placements
media_assets
adoption_records
vet_consultations
audit_events
```

Use stable UUIDs and foreign keys where services share a database. In a
service architecture, use durable IDs, events, and idempotent projections.

## 69. Suggested API Surface

```text
GET    /me/companions
POST   /companions
GET    /companions/:companionId
GET    /companions/:companionId/summary
PATCH  /companions/:companionId

PUT    /companions/:companionId/avatar
DELETE /companions/:companionId/avatar
PATCH  /companions/:companionId/mood

POST   /companions/:companionId/archive
POST   /companions/:companionId/restore
POST   /companions/:companionId/transfers
POST   /companion-transfers/:transferId/accept

GET    /companions/:companionId/managers
POST   /companions/:companionId/managers
PATCH  /companions/:companionId/managers/:userId
DELETE /companions/:companionId/managers/:userId

GET    /companions/:companionId/relationships
POST   /companions/:companionId/relationships
DELETE /companions/:companionId/relationships/:relationshipId

PUT    /companions/:companionId/followers/me
DELETE /companions/:companionId/followers/me
GET    /companions/:companionId/followers

GET    /me/treat-wallet
POST   /companions/:companionId/treats
GET    /companions/:companionId/treats/summary
GET    /companions/:companionId/treats/recent

GET    /companions/:companionId/feed-posts
POST   /posts

GET    /me/adoptions/eligible-companions
POST   /adoptions/:adoptionRecordId/companion

POST   /media/upload-sessions
POST   /media/:assetId/complete
GET    /media/:assetId/status
```

## 70. Companion Creation Transaction

Recommended transaction:

1. Authenticate actor.
2. Validate account status.
3. Validate idempotency key.
4. Validate public fields.
5. Validate restricted care fields separately.
6. Validate avatar asset if present.
7. Create Companion UUID.
8. Create owner manager row.
9. Create care profile.
10. Create optional handle.
11. Create optional explicit relationships.
12. Create initial stats projection.
13. Write audit event.
14. Commit.
15. Publish `companion.created`.
16. Return canonical response.

## 71. Adoption Link Transaction

Recommended transaction:

1. Authenticate adopter.
2. Load and lock adoption record.
3. Verify confirmation and eligibility.
4. Check existing Companion link.
5. If linked, return the existing result for an idempotent retry.
6. Create or transfer the Companion.
7. Create manager permissions.
8. Link `source_adoption_record_id`.
9. Write audit event.
10. Commit.
11. Publish Companion and adoption-link events.

## 72. Treat Transaction

Recommended transaction:

1. Authenticate giver.
2. Validate idempotency key.
3. Load current wallet period.
4. Reconcile period reset.
5. Load Companion and owner.
6. Check blocks and visibility.
7. Reject own Companion.
8. Check remaining balance.
9. Decrement wallet.
10. Create gift ledger row.
11. Update or enqueue treat-count projection.
12. Commit.
13. Publish notification event.
14. Return wallet and Companion totals.

Do not update a balance and gift history in separate uncoordinated writes.

## 73. Feed-Only Companion Post Transaction

Recommended transaction:

1. Authenticate human actor.
2. Validate idempotency key.
3. Load Companion and manager permission.
4. Verify active status.
5. Verify Feed-only destination.
6. Validate text and media.
7. Create canonical post.
8. Store human accountable author.
9. Store Companion presentation author.
10. Create `post_companions` author relationship.
11. Create one main Feed placement.
12. Write moderation and audit metadata.
13. Commit.
14. Publish Feed, Companion-profile, count, and notification events.

## 74. Events

Recommended events:

```text
companion.created
companion.updated
companion.avatar_changed
companion.mood_changed
companion.archived
companion.restored
companion.transferred
companion.manager_added
companion.manager_removed
companion.relationship_added
companion.relationship_removed
companion.followed
companion.unfollowed
companion.treat_received
companion.post_created
companion.post_deleted
companion.privacy_changed
```

Events must contain safe identifiers and change metadata. Do not publish
private care details on general event buses.

## 75. Cache Invalidation

Companion changes may affect:

- My Profile Companion list
- public owner profile
- Companion mini sheet
- full Companion profile
- Feed author rows
- Companion Feed-post grid
- follower and treat counts
- search
- post composer choices
- veterinary selection
- sibling or household rows
- shared-post previews

Privacy and block changes must take effect at read time even before every cache
or search index is refreshed.

## 76. Notifications

Potential notifications:

- new follower
- treat received
- reaction on Companion-authored post
- comment on Companion-authored post
- manager invitation
- manager permission changed
- transfer requested
- transfer accepted
- moderation restriction

All notifications are delivered to human accounts. The Companion does not own
credentials or a separate notification device.

## 77. Moderation And Reporting

Moderation records must identify:

- Companion ID
- accountable human user ID
- actor user ID
- post ID or profile field
- placement ID
- report reason
- decision and timestamps

Possible enforcement:

- remove profile text
- remove avatar
- disable public profile
- disable posting as Companion
- disable treats
- archive or restrict Companion
- enforce against accountable human account

Archiving or transferring the Companion must not erase moderation history.

## 78. Error Contract

Recommended errors:

```text
COMPANION_NOT_FOUND
COMPANION_NOT_VISIBLE
COMPANION_NOT_ACTIVE
COMPANION_LIMIT_REACHED
COMPANION_EDIT_FORBIDDEN
COMPANION_POST_FORBIDDEN
COMPANION_VET_ACCESS_FORBIDDEN
COMPANION_ALREADY_LINKED_TO_ADOPTION
ADOPTION_NOT_ELIGIBLE_FOR_COMPANION
COMPANION_HANDLE_TAKEN
COMPANION_HANDLE_RESERVED
PROFILE_VERSION_CONFLICT
RELATIONSHIP_INVALID
CANNOT_FOLLOW_OWN_COMPANION
FOLLOW_FORBIDDEN
CANNOT_TREAT_OWN_COMPANION
TREAT_BALANCE_EMPTY
TREAT_FORBIDDEN
COMPANION_PRESENTATION_FEED_ONLY
MEDIA_NOT_READY
MEDIA_TYPE_NOT_ALLOWED
IDEMPOTENCY_CONFLICT
RECENT_AUTHENTICATION_REQUIRED
```

Errors should include a field and safe recovery guidance where relevant.

## 79. Security Invariants

The backend must always enforce:

1. Companion IDs are server-generated and immutable.
2. Companion names do not grant identity or ownership.
3. Every management action checks current permission.
4. Public profile responses exclude private care data.
5. The authenticated human is accountable for every Companion-authored post.
6. Companion-authored posts have only a main Feed placement.
7. Community posts cannot impersonate Companion authors.
8. Treat balances are server-side and transactional.
9. Users cannot treat their own Companions.
10. Follow and treat actions respect blocks and privacy.
11. Adoption linking is idempotent per adoption record.
12. Archival preserves required historical attribution.
13. Veterinary access is separate from public visibility.
14. Media access follows purpose-specific authorization.
15. Counts derive from canonical records.
16. Empty or missing Companion relationships are never replaced with a
    default Companion.

## 80. Current Frontend Inconsistencies

These are current implementation facts, not recommended backend behavior:

1. Companion IDs are generated from names.
2. A same-name Companion can collide globally.
3. Public and private care data share one mock object.
4. Manual creation requires only a name.
5. Adoption conversion uses name matching for duplicate detection.
6. Every other owner Companion is automatically labeled a sibling.
7. Missing sibling data falls back to all same-owner Companions.
8. Companion avatar media is mocked.
9. Companion editing is not implemented.
10. More options is a coming-soon toast.
11. Removal immediately hard-deletes the Companion.
12. Removal can silently rewrite historical post presentation.
13. Follow state is local and resets.
14. Follower and pawprint counts are static.
15. Treat wallet and gifts are device-local.
16. Treat totals combine static values with local gifts.
17. Treat privacy is not consistently enforced.
18. Companion privacy is not enforced on public profile or direct links.
19. Post counts combine a seed number with local Feed additions.
20. Companion post grids are placeholders rather than actual posts.
21. Community-only Companion relationships are excluded from the profile.
22. Companion-authored posts are correctly locked to Feed in the composer,
    but the backend does not yet enforce it.
23. Some Community and saved surfaces do not consistently support Companion
    profile navigation.
24. Paw Circle shares lose Companion-as-author presentation.
25. Comment author rows can invent the author's first Companion.
26. Vet Companion lists are read from a stale global cache.
27. Vet consultation images are represented by a Boolean.
28. Companion `online` and `verified` fields have no complete product logic.

The backend must implement the corrected rules in this document.

## 81. End-To-End Manual Companion Workflow

1. User opens My Profile.
2. Client loads manageable Companions.
3. User taps Add.
4. User chooses manual creation.
5. User enters name, species, and other optional details.
6. User optionally selects an avatar.
7. Client previews and uploads avatar media.
8. Client submits an idempotent creation command.
9. Backend creates a stable Companion ID.
10. Backend grants owner management permissions.
11. Backend stores public and care data separately.
12. Backend returns the canonical Companion.
13. Client refreshes My Profile, Feed composer, and vet selectors.
14. Client opens the new Companion profile.

## 82. End-To-End Adoption Companion Workflow

1. Adoption is canonically confirmed.
2. Adoption service exposes the record as eligible.
3. User opens Add Companion.
4. Client displays eligible adopted animals.
5. User selects the adopted animal.
6. User completes missing profile information and optional avatar.
7. Client submits the adoption record ID.
8. Backend verifies adopter identity and record status.
9. Backend creates or transfers exactly one Companion.
10. Backend links the Companion to the adoption record.
11. Adoption history remains immutable.
12. Companion appears in My Profile and eligible connected features.

## 83. End-To-End Visitor Companion Workflow

1. Viewer taps a Companion from an accessible Feed, Community, or user profile.
2. Backend returns a viewer-specific Companion summary.
3. Mini sheet displays permitted identity and stats.
4. Viewer opens the full profile.
5. Backend applies visibility and block rules.
6. Viewer can follow when permitted.
7. Viewer can give a treat when permitted and balance is available.
8. Viewer can open visible household or sibling Companion profiles.
9. Viewer sees only accessible main Feed posts related to the Companion.
10. Viewer cannot access private care fields or owner-only actions.

## 84. End-To-End Owner Companion Post Workflow

1. Owner opens their Companion profile.
2. Owner taps Add post.
3. Composer opens in post-as-Companion mode.
4. Companion is locked as the display author.
5. Destination is locked to main Feed.
6. Paw Posting category is applied.
7. Owner writes text.
8. Owner optionally selects and uploads media.
9. Client submits one idempotent post command.
10. Backend verifies `can_post_as_companion`.
11. Backend rejects any non-Feed destination.
12. Backend stores the human as accountable actor.
13. Backend stores the Companion as display author.
14. Feed renders the Companion name and avatar.
15. Post appears in the Companion's Feed-post grid.
16. Reactions and comments notify the human owner.

## 85. End-To-End Archive Workflow

1. Owner opens Companion settings.
2. Owner selects Archive.
3. Client explains effects and asks for confirmation.
4. Backend verifies permission and recent authentication when required.
5. Backend changes status to archived.
6. Companion is removed from active creation, composer, and vet lists.
7. New follows, treats, and posts are disabled.
8. Historical Feed posts retain permitted Companion presentation.
9. Adoption records remain unchanged.
10. Caches and search are invalidated.
11. Audit event records actor and reason.

## 86. Minimum Acceptance Scenarios

1. Owner can create two Companions with the same name.
2. Companion IDs remain stable after rename.
3. Owner sees newly created Companion across devices.
4. Unauthorized user cannot edit a Companion.
5. Public response never contains private microchip or medical information.
6. Owner can upload and commit a real Companion avatar.
7. Picker cancellation leaves the current avatar unchanged.
8. Android picker recovery handles pending results.
9. Invalid or rejected media does not replace the avatar.
10. Confirmed adoption creates or links one Companion idempotently.
11. Pending or unauthorized adoption cannot create a Companion.
12. Adoption history survives Companion archival.
13. Same-owner Companions are not automatically called siblings.
14. Explicit household or sibling relationships render correctly.
15. Viewer can follow an accessible Companion.
16. Follow state and count persist across devices.
17. Follow and unfollow are idempotent.
18. Blocked viewer cannot follow or open the Companion.
19. Viewer with balance can give one treat.
20. Treat gift and wallet decrement commit atomically.
21. User cannot give a treat to their own Companion.
22. Duplicate treat retry with one idempotency key charges once.
23. Treat visibility is enforced in API responses.
24. Owner can update an allowed mood.
25. Owner opens Add post from Companion profile.
26. Companion-authored post is created only in main Feed.
27. Backend rejects a Community destination for Companion presentation.
28. Feed displays Companion as the primary author with Paw Posting.
29. Human accountable author remains available to moderation.
30. Companion-authored post appears in Companion Feed-post results.
31. Explicit human-with-Companion Feed post may also appear under the `with`
    relationship.
32. Community-only post does not appear in Companion Feed-post results.
33. Companion post grid uses real post thumbnails or text cards.
34. Post count matches the authorized Feed-post query.
35. Removed or inaccessible posts do not leak through the grid.
36. Normal comments do not invent a default Companion.
37. Shared preview preserves Companion-as-author presentation.
38. Owner-level hide-Companions setting hides public profile chips.
39. Direct Companion endpoint cannot bypass privacy.
40. Archived Companion disappears from active selectors.
41. Historical post identity does not silently change after archival.
42. Transfer changes management without creating a duplicate Companion.
43. Vet selector shows only Companions the user may use.
44. Vet consultation stores Companion reference and a safe snapshot.
45. Custom consultation pet does not create a public Companion automatically.
46. Privacy changes invalidate cached public Companion data.
47. Every management action creates an audit event.

## 87. Canonical Product Summary

The production Companion workflow should follow these principles:

- A Companion is a managed animal profile, not an account.
- Humans remain accountable for every action.
- Companion identity uses a stable server-generated ID.
- Names may be duplicated and changed safely.
- Public social fields and private care data are separate.
- Owners and managers receive explicit capabilities.
- Adoption can create or transfer a Companion without replacing adoption
  history.
- Same-owner animals are household Companions, not automatically siblings.
- Followers, treats, pawprints, and posts come from canonical backend records.
- Privacy and blocks are enforced by every API and media route.
- Posting as a Companion creates Paw Posting content only in the main Feed.
- Community content remains human-authored under the current product.
- The Companion page Posts tab contains authorized main Feed posts related to
  the Companion.
- Archiving does not rewrite historical post identity.
- Veterinary use is owner-authorized and does not expose public social data or
  private care data without purpose-specific permission.
