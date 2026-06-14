# My Profile and Settings Backend Workflow

## 1. Purpose

This document translates the current My Profile and Settings frontend into a
backend-ready product and engineering specification.

It covers:

- the current user's profile identity
- first-time username creation during account onboarding
- public profile views
- profile editing
- profile photo selection and upload
- profile impact counts
- companions
- Posts, Rescues, Rehomed, and Adopted profile tabs
- the Adopted warning badge
- saved posts and comment activity
- reviews, trust, and safety state
- alert and notification preferences
- privacy and visibility
- online presence
- search discoverability
- message permissions
- blocking and unblocking
- account creation date
- sessions and sign-out
- account deactivation and deletion
- APIs, read models, invariants, and acceptance scenarios

The frontend is a prototype. Some values are static mock data, some are kept
only in React memory, and some are saved only in local `AsyncStorage`.
Several settings are displayed but are not enforced by the rest of the app.

The backend must implement the intended workflow and must not reproduce those
limitations.

## 2. Frontend Source Map

The current behavior is spread across:

- `src/screens/profile/ProfileHomeScreen.tsx`
  - My Profile home
  - impact stats
  - companion add/remove
  - Posts, Rescues, Rehomed, and Adopted tabs
  - Adopted warning count
- `src/screens/profile/ProfileSettingsScreen.tsx`
  - bio and location editing
  - local alert toggles
  - links to privacy and blocked users
  - joined date
  - nonfunctional sign-out
- `src/screens/profile/ProfilePrivacyScreen.tsx`
  - profile visibility
  - discoverability
  - online visibility
  - post visibility
  - location visibility
  - companion visibility
  - messaging policy
- `src/screens/profile/ProfileBlockedUsersScreen.tsx`
  - locally blocked users
  - unblock action
- `src/context/CurrentUserProfileContext.tsx`
  - local bio/location patch
  - local storage persistence
  - mutation of the shared mock user object
- `src/context/UserPrivacyContext.tsx`
  - local privacy settings
  - local block list
  - local storage persistence
- `src/context/CompanionContext.tsx`
  - in-memory companion creation/removal
  - adoption-to-companion conversion
- `src/hooks/useProfileViewData.ts`
  - aggregates posts, rescues, adoption records, trust, and stats
- `src/components/profile/ProfileChrome.tsx`
  - profile hero and impact stats
  - companion controls
  - content tabs and Adopted alert marker
  - profile feed behavior
- `src/components/ui/Avatar.tsx`
  - mock avatar image lookup
  - adoption update alert badge
- `src/screens/pawCircles/UserProfileScreen.tsx`
  - public profile
  - Message and Add to circle actions
- `src/data/profileData.ts`
  - static Rescue cases
  - static fallback profile stats
  - static trust calculation
- `src/data/mockData.ts`
  - users
  - companions
  - reviews
  - seed feed posts
- `src/utils/profileAdoptionDisplay.ts`
  - missed adoption update count
  - Adopted warning logic
- `src/screens/profile/ProfilePostsScreen.tsx`
  - current user's feed posts
- `src/screens/profile/ProfileSavedScreen.tsx`
  - saved feed posts
- `src/screens/profile/ProfileActivityScreen.tsx`
  - comments written by the current user
- `src/screens/profile/ReviewsSafetyScreen.tsx`
  - static reviews and trust state
- `src/screens/profile/RescuesScreen.tsx`
  - static profile Rescue list and filters
- `src/screens/profile/AdoptedAnimalsScreen.tsx`
  - adoption records where the user is the adopter
- `src/screens/profile/SuccessfulAdoptionsScreen.tsx`
  - legacy static successful-adoption showcase

## 3. Product Concepts

### Account

The authentication and security identity. It owns:

- login credentials
- verified email/phone
- sessions and refresh tokens
- account status
- legal consent and policy versions

### User profile

The public or audience-limited social identity. It owns:

- display name
- unique handle
- biography
- profile photo
- public location label
- website
- verification display

Credentials must not be stored in the public profile record.

### Profile read model

A viewer-specific response that combines:

- allowed identity fields
- allowed content
- canonical counts
- trust summary
- companion summary
- relationship and capability flags

The response differs for:

- the profile owner
- an allowed public viewer
- a circle member
- a blocked viewer
- a moderator

### Settings

Private account-owned configuration, including:

- privacy choices
- notification preferences
- messaging permissions
- presence visibility

Settings are not public profile fields.

### Canonical source of truth

Each value must have one official backend owner.

Examples:

- profile service owns bio, location, handle, and photo
- feed service owns posts and saves
- rescue service owns Rescue cases
- adoption service owns Rehomed, Adopted, and update obligations
- social graph owns circles and blocks
- messaging service owns message eligibility
- notification service owns delivery preferences

My Profile is an aggregator over those sources. It must not maintain separate
copies of Rescue or adoption history.

## 4. Current Frontend Profile Model

The mock `User` shape contains:

```ts
{
  id,
  name,
  handle,
  tint,
  loc,
  location,
  verified,
  bio,
  circle,
  circleCount,
  companions,
  postsCount,
  adoptionsCount,
  reviews,
  rating,
  joinedDate,
  website
}
```

Current problems:

- `loc` and `location` duplicate the same concept.
- counts are embedded static values rather than canonical relationships.
- `joinedDate` is presentation text instead of a timestamp.
- rating and review count are stored alongside separately mocked reviews.
- `verified` is a simple Boolean without verification type or audit trail.
- there is no profile-photo asset ID.
- there is no profile revision/version.
- there is no account state.
- there is no distinction between private and public location.

Recommended profile record:

```text
user_profiles
- user_id
- display_name
- handle
- bio
- avatar_media_id nullable
- public_location_label nullable
- location_area_id nullable
- website_url nullable
- verification_status
- verification_type nullable
- created_at
- updated_at
- version
```

Recommended account record:

```text
accounts
- user_id
- primary_email nullable
- email_verified_at nullable
- primary_phone nullable
- phone_verified_at nullable
- status
- created_at
- deactivated_at nullable
- deletion_requested_at nullable
```

Do not return email, phone, session information, or moderation-only fields in
public profile responses.

## 5. Current My Profile Home

The home screen currently shows:

- handle in the header
- profile photo
- display name
- bio
- location
- Rescues, Rehomed, and Adopted impact counts
- Treat balance
- companions
- Posts, Rescues, Rehomed, and Adopted tabs
- a warning marker on Adopted when updates are missed

The header menu opens Settings.

There is an artificial 400 ms loading spinner. It does not represent a network
request.

Production workflow:

1. App opens My Profile.
2. Client requests the owner profile read model.
3. Backend authenticates the session.
4. Profile aggregator requests or reads authorized summaries from canonical
   services.
5. Backend returns profile, settings summary, counts, companions, first-page
   content, and viewer capabilities.
6. Client renders server data and paginates each tab as needed.
7. Client may cache the previous response, but refreshes after profile/content
   mutations.

The backend must not delay responses to imitate the frontend spinner.

## 6. Current Profile Data Ownership Problems

My Profile currently combines unrelated stores:

- bio/location: local `AsyncStorage`
- display name/handle: static mock user
- avatar: deterministic mock image URL
- posts/saves/comments: in-memory Feed provider
- companions: mutable in-memory mock object
- Rescue cases: static `RESCUE_CASES`
- Rehomed/Adopted: Adoption context
- reviews: static global array
- trust: static user rating and verification
- privacy/blocking: separate local `AsyncStorage`
- alert toggles: screen-local state

Consequences:

- app restart loses several profile changes
- another device cannot see changes
- public and owner views can disagree
- profile counts can disagree with visible cards
- deleting or adding content does not reliably update all counts
- privacy settings do not affect profile queries
- account actions are not real

Production must use stable backend IDs and canonical cross-service queries.

## 7. Profile Owner Versus Public Viewer

Every profile request must be evaluated using:

- target user
- authenticated viewer, if any
- block relationship in either direction
- circle/relationship membership
- target privacy settings
- content-level visibility
- moderation/account state

Recommended viewer capability response:

```json
{
  "viewer": {
    "isOwner": false,
    "canViewProfile": true,
    "canViewPosts": true,
    "canViewCompanions": true,
    "canMessage": false,
    "canInviteToCircle": true,
    "canReport": true,
    "isBlockedByTarget": false,
    "hasBlockedTarget": false
  }
}
```

The client should render actions from backend capabilities. It must not infer
authorization only from local settings.

## 8. Editing Profile Fields

### Current frontend behavior

Settings allows editing only:

- bio
- location

The user taps the edit icon, changes text, then:

- taps Done, which saves if dirty
- or taps the header Save action

Saving:

- trims both values
- mutates `users.you`
- writes a patch to `AsyncStorage`
- shows `Profile updated`

Current gaps:

- no backend call
- no validation
- no length limits
- no location normalization
- no conflict handling
- no save error state
- no retry
- no moderation
- no edit history
- name, handle, website, and avatar cannot be edited

### Production workflow

1. Owner opens Edit Profile.
2. Client loads canonical editable fields and profile version.
3. User edits allowed fields.
4. Client validates basic length and format.
5. Client submits changed fields only with an idempotency key and expected
   profile version.
6. Backend validates ownership, rate limit, formats, prohibited content, and
   uniqueness where relevant.
7. Backend updates the profile transactionally.
8. Backend writes an audit event.
9. Backend invalidates profile/search caches.
10. Backend returns the canonical profile and new version.
11. Client replaces local draft with the returned record.

Recommended limits:

- display name: 1-80 characters
- handle: 3-30 normalized characters
- bio: 0-300 characters
- public location label: 0-100 characters
- website: one valid normalized HTTPS URL

The exact limits should be backend configuration shared with clients.

## 9. Display Name and Username

### Terminology

The product should call this value the **username** in user-facing screens.
The existing frontend model calls the same value `handle` and displays it as
`@handle`.

The backend may keep `handle` as an internal database field for compatibility,
while the public API consistently calls it `username`. There must still be
only one canonical value:

```text
username shown to user = profile.handle stored by backend
```

The username is not the account ID. All relationships, posts, messages, and
permissions must use the immutable server-generated user ID.

### Current frontend behavior

The current frontend has:

- static mock handles such as `@aisharahman`
- no signup or account onboarding screen
- no first-time username field
- no username availability request
- no working username edit control in Settings

The backend and future onboarding UI must implement the following workflow
rather than treating the mock handle as a real username.

### Username rules

- A username is required before a new user can finish profile onboarding.
- A display name does not need to be unique.
- A username is normalized to lowercase.
- A username is unique case-insensitively.
- Length is 3 to 30 normalized characters.
- Allowed characters are lowercase ASCII letters, numbers, period, and
  underscore.
- A username must begin with a letter.
- A username must end with a letter or number.
- Consecutive periods or underscores are rejected.
- Leading or trailing whitespace is trimmed before validation.
- Email addresses and phone numbers must not be used as usernames.
- Reserved system, staff, route, brand, and safety names are rejected.
- Impersonation, deceptive verification wording, and prohibited content are
  rejected.
- Unicode lookalikes are not accepted in the username field under this ASCII
  policy.
- Availability checks are advisory. The write transaction is authoritative.
- Repeated availability requests and submissions are rate-limited.

Examples:

```text
Allowed:
aisha
aisha.rahman
aisha_92

Rejected:
92aisha
_aisha
aisha_
aisha..rahman
aisha@example.com
admin
```

The exact limits and reserved-name rules must be backend configuration shared
with clients.

### Account onboarding state

Recommended account onboarding states:

```text
credentials_created
contact_verification_required
username_required
profile_required
complete
```

A new account may authenticate with a restricted onboarding session before it
has a username, but it must not be allowed to:

- publish posts or comments
- create Communities or Paw Circles
- send ordinary direct messages
- appear in public search
- receive a public profile URL

The restricted session may access only the endpoints required to complete,
resume, or cancel onboarding.

### First-time username creation workflow

This flow applies to password signup, phone signup, and social login when the
account does not already have a username.

1. Backend creates the account with an immutable user ID.
2. User completes required email or phone verification.
3. Backend reports `next_step: "username_required"`.
4. Client shows a required "Choose your username" screen.
5. User types a username without the leading `@`.
6. Client performs the same basic format validation used by the backend.
7. Client may request availability after a short debounce.
8. Availability response shows whether the normalized username is currently
   available and may include safe alternatives.
9. User submits the username.
10. Client sends an idempotency key.
11. Backend authenticates the restricted onboarding session.
12. Backend normalizes and validates the username again.
13. Backend checks reserved, prohibited, and impersonation rules.
14. Backend attempts the write under the database's unique normalized-handle
    constraint.
15. If another user claimed it after the availability check, backend returns
    `USERNAME_TAKEN`; it does not overwrite either account.
16. Backend stores the username on the user's profile.
17. Backend records a `username.initialized` audit event.
18. Backend advances onboarding to the next incomplete step or `complete`.
19. Search indexing and mention autocomplete update asynchronously only after
    the profile becomes discoverable.
20. Backend returns the canonical profile and next onboarding step.

The initial username assignment does not consume the later username-change
cooldown. Retrying the same successful request with the same idempotency key
must return the original result rather than creating duplicate history.

### First-time username API

Availability:

```http
GET /v1/usernames/{candidate}/availability
```

Example response:

```json
{
  "candidate": "Aisha.Rahman",
  "normalized": "aisha.rahman",
  "available": false,
  "reason": "taken",
  "suggestions": [
    "aisha.rahman92",
    "aisha_rahman"
  ]
}
```

Do not reveal who owns an unavailable username or any private account state.

Assignment:

```http
PUT /v1/me/username
Idempotency-Key: 9cae4d16-...
```

```json
{
  "username": "aisha.rahman"
}
```

Successful response:

```json
{
  "user_id": "user_123",
  "username": "aisha.rahman",
  "profile_path": "/@aisha.rahman",
  "onboarding": {
    "status": "profile_required",
    "next_step": "profile_required"
  }
}
```

The endpoint is for first-time assignment. If the account already has a
username, it returns `USERNAME_ALREADY_SET` and directs the client to the
authenticated username-change workflow.

### Username conflict and suggestion behavior

When a username is unavailable:

- preserve the user's form draft
- explain whether it is taken, reserved, or invalid
- return suggestions only when they pass all current validation rules
- never reserve a username merely because availability was checked
- never expose another user's email, phone, account ID, or account status
- permit another submission without restarting signup

Suggestion generation should be bounded and rate-limited. The backend must
still validate a selected suggestion at submission time.

### Social login and returning users

The app must not automatically publish a username copied from an email address,
social-provider nickname, or legal name.

For a new social-login account:

1. Create or link the account.
2. Import a display-name suggestion only when policy permits.
3. Require the user to explicitly choose and confirm a username.
4. Continue onboarding after the username is committed.

For an existing linked account, return its existing profile and do not start a
second username flow.

### Abandoned onboarding

If the user exits before selecting a username:

- keep the account in `username_required`
- allow the user to resume after authentication
- do not make the account publicly discoverable
- expire unused unverified accounts according to retention policy
- do not generate a permanent public username silently

### Changing an existing username

After onboarding, the user can change the username from Profile Settings.

Production rules:

- require recent authentication for sensitive or suspicious changes
- enforce a username-change cooldown
- retain prior handles for redirect and anti-impersonation policy
- prevent immediate takeover of recently released usernames
- rate-limit repeated availability checks and update attempts
- verify mentions and profile links through stable user ID, not mutable
  username text

Username update workflow:

1. Client checks availability.
2. User confirms the change.
3. Backend verifies recent authentication when required.
4. Backend rechecks validation and uniqueness inside the write transaction.
5. Backend creates a handle-history row containing old and new normalized
   values.
6. Backend starts the cooldown and prior-handle protection period.
7. Search and mention indexes update asynchronously.
8. Existing user-ID deep links remain valid.
9. Old username URLs follow the configured redirect or unavailable-name
   policy.

### Username errors

Recommended error codes:

```text
USERNAME_REQUIRED
USERNAME_INVALID
USERNAME_TOO_SHORT
USERNAME_TOO_LONG
USERNAME_TAKEN
USERNAME_RESERVED
USERNAME_PROHIBITED
USERNAME_ALREADY_SET
USERNAME_CHANGE_COOLDOWN
RECENT_AUTHENTICATION_REQUIRED
RATE_LIMITED
ONBOARDING_SESSION_INVALID
```

## 10. Profile Photo Selection

### Current frontend behavior

`Avatar` uses mock image URLs based on user ID. There is no profile-photo
picker, camera action, crop flow, upload, or backend media reference.

The project currently does not include `expo-image-picker`.

### Production Expo SDK 56 workflow

Use:

`https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/`

1. Owner taps the profile photo edit control.
2. Show:
   - Choose from library
   - Take photo
   - Remove photo, when one exists
3. Request camera permission only if Take photo is selected.
4. Request media-library permission only when required by the platform and
   selected flow.
5. Launch the picker directly from a user gesture on web.
6. Accept one image only.
7. Read URI or web `File`, MIME type, filename, size, width, and height.
8. Show the actual selected image in a crop/preview screen.
9. Allow cancel without changing the current avatar.
10. On Android, recover a lost picker result with
    `ImagePicker.getPendingResultAsync()`.
11. Upload the image.
12. Submit the ready media asset ID as the profile avatar.

Suggested limits:

- JPEG, PNG, HEIC, or WebP
- maximum 10 MB before processing
- minimum 256 x 256
- one image
- square crop preview

Do not upload base64 media in a normal profile API request.

## 11. Profile Photo Upload and Processing

Use direct-to-object-storage uploads:

1. Client requests a profile-avatar upload session.
2. Backend creates a pending media asset owned by the user.
3. Backend returns a short-lived signed upload URL and constraints.
4. Client uploads with progress.
5. Client calls upload-complete.
6. Backend verifies object existence, content signature, MIME, size, and
   dimensions.
7. Backend scans and moderates the image.
8. Backend strips EXIF and GPS metadata.
9. Backend generates avatar renditions.
10. Backend marks the asset ready.
11. Client updates the profile with `avatarMediaId`.
12. Backend swaps the avatar and schedules the old unattached asset for
    deletion after retention rules.

Only ready assets owned by the current user may be attached.

Repeated requests with the same idempotency key must not create duplicate
profile changes or orphaned assets.

## 12. Profile Location

The frontend stores one free-text value in both `loc` and `location`.

Production should separate:

- private account/operational location, if required
- normalized area ID
- coarse public label
- exact coordinates, if another feature has explicit permission

The profile setting `showLocation` controls public display. It must not delete
the saved location.

Do not infer that a profile location permits:

- exact geolocation sharing
- rescue location disclosure
- lost/found contact disclosure
- background location tracking

If the app offers current-location selection, follow:

`https://docs.expo.dev/versions/v56.0.0/sdk/location/`

Request foreground permission only in response to that explicit user action,
then store a coarse normalized area unless exact location is genuinely needed.

## 13. Impact Counts

The profile hero shows:

- Rescues
- Rehomed
- Adopted

Current calculation:

- Rescues: static `RESCUE_CASES`
- Rehomed: Adoption records, then static fallback values
- Adopted: Adoption records, then static fallback values
- current-user seed fallback: Rescues 12, Rehomed 8, Adopted 2

This can show a count larger than the visible profile items.

Production definitions:

- Rescues: eligible formal Rescue cases owned/coordinated by the user
- Rehomed: confirmed adoption records where the user was the poster/lister
- Adopted: confirmed adoption records where the user was the adopter

Counts must respect:

- viewer privacy
- content visibility
- moderation state
- archived/deleted records
- whether pending confirmation is included

Owner and public counts may differ.

The profile read model should return counts and the exact definitions/version
used to calculate them.

## 14. Profile Tabs

The frontend has:

- Posts
- Rescues
- Rehomed
- Adopted

Each tab must be backed by a cursor-paginated query.

Do not return one enormous profile payload for all historical content.

Recommended endpoint behavior:

```text
GET /users/:userId/profile-content?type=posts|rescues|rehomed|adopted&cursor=...
```

Every item must include:

- stable ID
- content type
- viewer capabilities
- moderation/availability state
- canonical timestamps

## 15. Posts Tab

Current profile filtering includes a feed post when:

- `post.userId` equals profile user ID, or
- the post is companion-authored and the companion belongs to the profile
  user

It excludes posts marked as circle-only.

Current state is in memory and resets on app restart.

Production rules:

- the post owner remains a user even when displayed as companion-authored
- public profile queries enforce post visibility and circle membership
- circle/community-only posts never leak into public profile
- removed/moderated posts are excluded or represented as unavailable according
  to policy
- profile edits do not rewrite historical post ownership
- reactions, comments, saves, and shares use the canonical feed service

The standalone Profile Posts screen currently includes only direct
`userId === 'you'` posts, while the main profile tab also includes
companion-authored posts. The backend/product contract must choose one
definition and use it consistently.

Recommended definition: include both, but return `displayAuthorType` so the UI
can distinguish the user from a companion.

## 16. Saved Posts

Current behavior:

- saved state is a Boolean on each in-memory post
- Saved screen lists those posts
- unsave and reaction work in the current provider
- comments and forward actions tell the user to open the post from Feed
- state resets with the provider/app

Production workflow:

1. User taps Save.
2. Feed service upserts a `(userId, postId)` saved relationship.
3. Save/un-save is idempotent.
4. Saved screen queries the user's private saved collection.
5. The server rechecks whether each post is still viewable.
6. Removed/private posts return unavailable state or disappear according to
   policy.

Saved collections are private by default and must not appear on public
profiles.

## 17. Activity

Current Activity shows only comments and replies written by the current user
on feed posts.

It does not include:

- reactions
- shares
- follows
- Rescue updates
- adoption actions
- Paw Circle activity
- account/security history

Production must define Activity narrowly or label it `Your comments`.

Recommended first version:

- private comment/reply history only
- cursor pagination
- canonical post visibility checks
- deleted comment tombstones where needed
- open the exact comment context

Do not expose private activity on public profiles.

## 18. Rescues Tab

Current profile Rescues comes from static `RESCUE_CASES`, not the live Rescue
provider.

Therefore new cases and updates may not appear.

Production must query the canonical Rescue service described in:

`docs/rescue-backend-workflow.md`

The same case must appear consistently in:

- Rescue hub
- My Cases
- My Profile
- public profile
- case detail

Profile visibility is an additional viewer filter, not a separate Rescue
record.

## 19. Rehomed Tab

Rehomed represents adoption records where the profile user was the
poster/lister.

Production data comes from the adoption service, not a static showcase table.

Include only records allowed for the viewer. The owner may see private workflow
state that public viewers cannot.

Owner actions such as `Post as owner` must be authorized from the adoption
record, not simply because the record appears on the profile.

## 20. Adopted Tab

Adopted represents adoption records where the profile user was the adopter.

Production behavior must distinguish:

- pending confirmation
- confirmed adoption
- update due
- update overdue
- closed/relisted
- completed update schedule

Private application/chat details must not appear on the public profile.

The backend should return a public-safe adoption card separately from the
owner/adopter workflow detail.

## 21. Adopted Warning Marker

The frontend warning marker is not a generic account warning.

It indicates missed post-adoption home-update milestones for adoption records
where the profile user is the adopter.

Frontend milestones:

- week 1
- month 1
- month 3
- month 6

The count:

1. Selects records where `adopterId` is the user.
2. Excludes `closed` and `pending_confirmation`.
3. For each milestone, computes due time from confirmed adoption time.
4. Treats the milestone as satisfied by:
   - a matching completed milestone
   - a qualifying adopter update at/after due time
   - a qualifying poster endorsement after due time
5. Counts a milestone as missed when it is past due and not satisfied/excused.
6. Adds all missed milestones across records.

The profile tab shows an alert icon and a count capped visually at `9+`.

The generic user Avatar also automatically displays an adoption-update alert
when `userHasPendingAdoptionUpdate` reports an obligation.

Production rules:

- adoption service computes obligations using server time
- one canonical obligation query drives Profile, Avatar, Adoption Chats, and
  notifications
- public viewers must not see private overdue counts
- owner sees exact count and actionable record links
- badges clear after the qualifying update commits
- idempotent retries do not satisfy a milestone twice
- scheduler and read-time reconciliation handle missed jobs

Recommended private summary:

```json
{
  "adoptionUpdateObligations": {
    "missedCount": 2,
    "dueSoonCount": 1,
    "records": [
      {
        "recordId": "uuid",
        "petName": "Max",
        "milestone": "month_3",
        "dueAt": "2026-06-10T00:00:00Z",
        "state": "overdue"
      }
    ]
  }
}
```

## 22. Companions

Current My Profile allows:

- add from a confirmed adoption
- add manually
- remove from profile

Manual fields:

- name, required
- species
- age text

Current implementation mutates a global in-memory companions object.

Current gaps:

- no persistence
- no media selection
- no server ownership check
- ID is generated from name and can collide globally
- no duplicate recovery flow
- remove is immediate and has no confirmation
- adoption linkage is inferred from pet name
- sibling links are mutable mock arrays
- profile privacy does not hide companions

Production companion record:

```text
companions
- id
- owner_user_id
- source
- adoption_record_id nullable
- name
- species
- breed nullable
- birth_date nullable
- age_display nullable
- gender nullable
- bio nullable
- avatar_media_id nullable
- visibility
- status
- created_at
- updated_at
```

`source` should distinguish:

- manual
- adoption
- transfer/import, if later supported

## 23. Add Companion From Adoption

Production workflow:

1. Backend lists confirmed adoption records where the current user is adopter
   and no active companion is linked.
2. User chooses one record.
3. Backend verifies adopter ownership and eligible status.
4. Backend creates the companion with a foreign key to the adoption record.
5. Creation is idempotent per adoption record.
6. Backend emits a companion-created event.
7. Profile counts and companion list refresh.

Do not use normalized pet name as the deduplication key.

## 24. Add Companion Manually

Production workflow:

1. Owner enters required and optional details.
2. Owner may select a real companion photo.
3. Media follows the same signed upload and processing pattern as profile
   avatar media.
4. Backend validates owner, fields, media, and account limits.
5. Backend creates a server-generated companion ID.
6. Client renders the returned companion.

Two different users may have companions with the same name.

## 25. Remove Companion

Removing from profile should not necessarily delete the companion and all
history.

Recommended workflow:

1. Show the consequences and ask for confirmation.
2. Owner chooses:
   - hide/archive from profile
   - transfer ownership, if supported
   - permanently delete eligible empty record
3. Backend checks ownership and dependent posts/adoption links.
4. Backend archives by default.
5. Historical posts retain safe companion attribution.
6. Profile list and counts update.

An adoption-linked companion should not be hard-deleted in a way that erases
the adoption audit record.

## 26. Reviews, Trust, and Safety

Current Reviews & Safety:

- always reads trust for user `you`
- displays every static review in the global `reviews` array
- derives trust from mock rating, review count, verification, and zero flags
- has no real report or appeal workflow

Production needs:

- reviews tied to an eligible completed interaction
- one reviewer/reviewee relationship per eligible event
- rating and review text moderation
- edit/delete policy
- aggregate rating computed from canonical reviews
- report and appeal workflow
- separate private moderation risk from public trust labels

Do not expose raw report counts or internal fraud scores publicly.

Verification must contain:

- type
- status
- verified timestamp
- issuer/reviewer
- expiry when relevant

The backend decides which verification badge is public.

## 27. Settings Menu

Current menu sections:

- About you
- Your shelf: Activity and Saved
- Alerts
- Privacy & account
- Sign out

Production should separate:

- Edit profile
- Notifications
- Privacy
- Safety/blocking
- Account and security
- Sessions
- Data controls
- Sign out

This makes account-security actions explicit instead of placing everything
under one accordion.

## 28. Alert Toggles

Current toggles:

- Post activity
- Adoption updates

They are component-local Booleans initialized to `true`.

They:

- reset when Settings remounts
- are not saved to local storage
- are not connected to Notifications
- do not change push/in-app/email delivery

Production notification preference model should support:

```text
notification_preferences
- user_id
- category
- in_app_enabled
- push_enabled
- email_enabled
- quiet_hours_start nullable
- quiet_hours_end nullable
- timezone
- updated_at
```

Suggested categories:

- post reactions/comments/shares
- adoption requests/messages
- adoption update reminders
- Rescue case updates
- Paw Circle messages/invites
- community activity
- account/security

Security notifications may be mandatory and not fully disableable.

## 29. Notification Preference Workflow

1. Client loads canonical preferences.
2. User changes one category/channel.
3. Client submits a patch.
4. Backend validates allowed combinations.
5. Backend saves preference and returns canonical state.
6. Notification fanout checks the preference at send time.
7. Existing in-app records remain unless separately dismissed.

Push permission and server preference are separate:

- OS permission controls whether the device can receive push.
- server preference controls whether the backend should send that category.

Use Expo SDK 56 notification behavior:

`https://docs.expo.dev/versions/v56.0.0/sdk/notifications/`

Register device tokens per installation. Remove invalid tokens and never treat
a push token as an account credential.

## 30. Privacy Settings

Current fields:

```ts
profileVisibility: 'everyone' | 'circles' | 'only_me'
postVisibility: 'everyone' | 'circles' | 'only_me'
messagePolicy: 'everyone' | 'circles' | 'none'
discoverable: boolean
showOnline: boolean
showLocation: boolean
showCompanions: boolean
```

They default to public/everyone and are saved only in local `AsyncStorage`.

Production settings record:

```text
user_privacy_settings
- user_id
- profile_visibility
- default_post_visibility
- message_policy
- discoverable
- show_online
- show_location
- show_companions
- updated_at
- version
```

The backend must enforce these settings on every relevant read/write path.

## 31. Profile Visibility

Recommended semantics:

### Everyone

Any eligible viewer may open the profile, subject to blocks, moderation, and
individual content visibility.

### Circles

Only:

- owner
- mutually accepted circle relationships, based on one clearly defined social
  graph rule
- authorized moderators

### Only me

Only owner and authorized moderators may view the full profile.

For restricted viewers, return a limited unavailable response rather than
leaking hidden fields or counts.

The frontend currently does not enforce any of these states.

## 32. Search Discoverability

When `discoverable` is false:

- omit the user from people-search results
- omit from suggested-user discovery where policy requires
- do not expose profile through handle autocomplete to unauthorized viewers

It does not necessarily invalidate:

- direct existing relationship access
- an allowed direct profile link
- moderation access

The product must define those cases explicitly.

Search index updates should be event-driven and eventually consistent, with
read-time authorization as the final defense.

## 33. Online Presence

`showOnline` currently changes no other screen.

Production presence:

- is ephemeral, not a permanent profile Boolean
- may be derived from active connections/recent activity
- must respect the target's privacy setting and blocks
- should use coarse labels such as Online or Recently active if needed
- must not reveal exact last-seen time unless explicitly designed

When disabled, return no presence state to ordinary viewers.

## 34. Default Post Visibility

`postVisibility` should be the default for newly created ordinary posts.

Rules:

- backend stores visibility on each post
- changing the default does not silently rewrite old posts
- user may change an individual post's visibility if product allows
- circle/community posts continue to follow their container policy
- Rescue/adoption records follow their own required visibility rules

The frontend currently saves the preference locally but the composer and feed
do not use it.

## 35. Show Location

When false:

- hide the public profile location
- omit profile location from ordinary post defaults/previews
- do not expose it through profile search facets

It must not automatically remove locations from:

- an explicitly published lost/found post
- a Rescue case
- an adoption listing

Those features require their own visibility and consent rules.

The frontend currently continues to display location despite this setting.

## 36. Show Companions

When false:

- public profile companion list is hidden
- companion count should be hidden or viewer-safe
- direct companion links must recheck authorization
- companion-authored public posts require a defined policy

Recommended policy: posts remain governed by post visibility, but hidden
companion profile details are not embedded beyond the minimum display author.

Owner always sees their companions.

## 37. Message Policy

Current public profile always shows Message for other users and navigates only
to the Messages tab. It does not:

- check `messagePolicy`
- create/open a conversation with that user
- check blocks
- show a denial reason

Production authorization:

1. Check blocks in both directions.
2. Check target account/moderation status.
3. Evaluate target message policy:
   - everyone
   - circles
   - none
4. Apply abuse/rate limits.
5. Return `canMessage` and reason code.
6. On tap, create or reuse one canonical direct conversation.

Conversation creation must be idempotent for a participant pair where the
messaging model is one direct thread per pair.

## 38. Blocking

### Current behavior

Blocking is available from a chat options sheet.

It:

- appends the peer user ID to local storage
- shows a toast
- appears in Settings -> Blocked users

The current block does not reliably:

- hide profiles
- prevent messages
- remove search results
- hide posts/comments
- remove circle relationships
- stop notifications
- close existing chat input
- synchronize to another device

### Production block workflow

1. User confirms Block.
2. Backend creates an idempotent directional block relation.
3. In the same transaction or event workflow:
   - deny new direct messages
   - stop message notifications
   - prevent profile access according to policy
   - suppress discovery/suggestions
   - hide or collapse interactions
   - revoke pending invites/requests where required
4. Existing conversation is retained for safety evidence but becomes
   non-sendable.
5. Return canonical block state.

Block is directional but enforcement usually protects both participants from
direct contact.

## 39. Unblocking

Current Unblock is immediate and local.

Production workflow:

1. User taps Unblock.
2. Optional confirmation explains consequences.
3. Backend removes the block relation idempotently.
4. Existing circle/message relationships are not automatically restored.
5. Messaging eligibility is recalculated from current policies.
6. Audit event records the change.

Unblocking must not recreate deleted requests or expose old private state
automatically.

## 40. Public Profile Actions

Current public profile has:

- Message
- Add to circle
- More

Current behavior:

- Message opens the general Messages tab
- Add to circle has no handler
- More has no handler
- privacy and blocks are not enforced

Production actions should use backend capabilities:

- Message: create/reuse authorized direct conversation
- Add to circle: send/cancel/accept relationship request through social graph
- More: report, block, copy profile link

Every action must handle:

- already requested
- already connected
- blocked
- account unavailable
- rate limited
- privacy restricted
- request rejected

## 41. Account Creation Date

Current Settings displays `Joined Jan 2022` from static text.

Production:

- store immutable `accounts.created_at`
- format it on the client
- do not accept joined date from profile edits
- choose whether full date or month/year is publicly visible

The owner may see a more precise account date than public viewers.

## 42. Sessions and Secure Token Storage

There is no real authentication/session implementation in this frontend.

Production must support:

- short-lived access tokens
- rotating refresh tokens or equivalent secure sessions
- per-device session records
- token revocation
- suspicious-login detection
- server-side account status checks

Use platform secure credential storage, not ordinary `AsyncStorage`, for
session secrets.

For Expo SDK 56, follow:

`https://docs.expo.dev/versions/v56.0.0/sdk/securestore/`

Do not treat SecureStore as the only source of truth for account existence.
Backend session revocation must remain authoritative.

## 43. Sign Out

Current Sign out only shows `Coming soon`.

Production workflow:

1. User taps Sign out.
2. Client optionally confirms when drafts/uploads are active.
3. Client calls session logout/revocation.
4. Backend revokes the current refresh/session token.
5. Client unregisters or disassociates the installation push token as
   appropriate.
6. Client clears access/refresh tokens from secure storage.
7. Client clears private cached profile, messages, saves, settings, drafts,
   and media URLs.
8. Client returns to authentication.

Sign out from this device must not delete the account or revoke every device
unless the user chooses that option.

If the network call fails, the client should still clear local credentials and
queue/retry server revocation where safely possible.

## 44. Account and Security Settings Missing From Frontend

The current UI does not provide:

- email/phone management
- password change/reset
- passkey or MFA management
- active sessions
- sign out all devices
- account deactivation
- account deletion
- data export
- consent/privacy-policy history

These should be explicit backend workflows before production, even if the
first frontend release exposes only a subset.

## 45. Account Deactivation

Recommended workflow:

1. User reauthenticates.
2. UI explains visibility and recovery behavior.
3. User confirms deactivation.
4. Backend sets account status to deactivated.
5. Revoke active sessions except any recovery session required by policy.
6. Hide profile and content according to deactivation policy.
7. Preserve legal, safety, transaction, adoption, and moderation records.
8. Allow reactivation within the defined window.

Deactivation is reversible and is not the same as deletion.

## 46. Account Deletion

Recommended workflow:

1. User requests deletion from an authenticated session.
2. Require recent reauthentication.
3. Explain retained records and consequences.
4. Create a deletion request with cooling-off period.
5. Revoke sessions and stop ordinary notifications.
6. Allow cancellation during the recovery window.
7. At execution time:
   - anonymize or delete profile data
   - delete private settings and saved relationships
   - delete unattached media
   - handle posts/comments under product policy
   - retain legally/safety-required adoption, payment, report, and audit data
8. Record completion without retaining unnecessary personal data.

Deletion must be an asynchronous auditable workflow, not a direct database
cascade from the mobile client.

## 47. Privacy Enforcement Matrix

The backend must enforce settings at these boundaries:

| Setting | Required enforcement |
| --- | --- |
| profile visibility | profile detail, deep links, counts |
| discoverable | search, suggestions, mentions |
| show online | presence APIs, message headers |
| post visibility | feed, profile tab, post detail, sharing |
| show location | profile payload, search index, previews |
| show companions | profile companion list, companion links |
| message policy | conversation create, message send |
| blocks | all profile, social, messaging, search, notifications |

Hiding UI controls is not authorization.

Every direct API and media URL must perform the same policy checks.

## 48. Suggested Database Model

```text
accounts
user_profiles
profile_handle_history
user_privacy_settings
notification_preferences
user_blocks
user_relationships
user_sessions
device_installations
media_assets
companions
saved_posts
reviews
review_eligibility
account_deletion_requests
audit_events
```

Cross-feature records stay in their owning services:

- feed posts/comments/reactions
- Rescue cases
- adoption records and milestones
- Paw Circles
- conversations/messages

Use stable user UUIDs across services.

Username-related fields and constraints:

```text
accounts
- id
- onboarding_status
- contact_verified_at
- created_at

user_profiles
- user_id
- display_name
- handle
- normalized_handle
- handle_set_at
- profile_version

profile_handle_history
- id
- user_id
- old_normalized_handle
- new_normalized_handle
- change_type
- protected_until
- changed_at

UNIQUE INDEX user_profiles(normalized_handle)
```

`change_type` should distinguish `initial_assignment` from `user_change`,
`moderator_change`, and `account_recovery`.

The database unique index is the final protection against two users claiming
the same normalized username concurrently.

## 49. Suggested API Surface

```text
GET    /me/profile
PATCH  /me/profile
GET    /users/:userId/profile
GET    /users/:userId/profile-content
GET    /users/:userId/profile-summary

GET    /usernames/:candidate/availability
PUT    /me/username
POST   /me/username-change

POST   /media/upload-sessions
POST   /media/:mediaAssetId/complete
GET    /media/:mediaAssetId/status
DELETE /media/:mediaAssetId
PUT    /me/profile/avatar
DELETE /me/profile/avatar

GET    /me/privacy-settings
PATCH  /me/privacy-settings

GET    /me/notification-preferences
PATCH  /me/notification-preferences

GET    /me/blocked-users
PUT    /me/blocked-users/:userId
DELETE /me/blocked-users/:userId

GET    /me/saved-posts
PUT    /me/saved-posts/:postId
DELETE /me/saved-posts/:postId

GET    /me/activity/comments

GET    /me/companions
POST   /me/companions
POST   /me/companions/from-adoption/:recordId
PATCH  /me/companions/:companionId
POST   /me/companions/:companionId/archive

GET    /users/:userId/reviews
POST   /reviews
POST   /reviews/:reviewId/report

GET    /me/sessions
DELETE /me/sessions/:sessionId
POST   /me/sessions/revoke-others
POST   /auth/logout

POST   /me/deactivate
POST   /me/reactivate
POST   /me/deletion-requests
DELETE /me/deletion-requests/current
```

## 50. Recommended Owner Profile Read Model

```json
{
  "profile": {
    "id": "user-uuid",
    "displayName": "Aisha Rahman",
    "handle": "aisharahman",
    "bio": "Foster mum to seniors",
    "avatar": {
      "mediaAssetId": "media-uuid",
      "url": "authorized-cdn-url",
      "thumbnailUrl": "authorized-thumbnail-url"
    },
    "publicLocationLabel": "Dhanmondi, Dhaka",
    "websiteUrl": "https://pawscare.bd",
    "verification": {
      "status": "verified",
      "type": "identity"
    },
    "joinedAt": "2022-01-15T10:00:00Z",
    "version": 8
  },
  "impact": {
    "rescues": 4,
    "rehomed": 3,
    "adopted": 2
  },
  "privateAlerts": {
    "adoptionMissedUpdates": 1,
    "adoptionDueSoon": 1
  },
  "viewer": {
    "isOwner": true,
    "canEditProfile": true,
    "canManageCompanions": true,
    "canManageSettings": true
  }
}
```

## 51. Recommended Public Profile Read Model

```json
{
  "profile": {
    "id": "user-uuid",
    "displayName": "Aisha Rahman",
    "handle": "aisharahman",
    "bio": "Foster mum to seniors",
    "avatar": {
      "thumbnailUrl": "authorized-thumbnail-url"
    },
    "publicLocationLabel": "Dhanmondi, Dhaka",
    "verification": {
      "status": "verified",
      "type": "identity"
    },
    "joinedLabel": "Joined January 2022"
  },
  "impact": {
    "rescues": 4,
    "rehomed": 3,
    "adopted": 2
  },
  "companions": [],
  "viewer": {
    "isOwner": false,
    "canViewProfile": true,
    "canViewPosts": true,
    "canViewCompanions": false,
    "canMessage": false,
    "messageDeniedReason": "circles_only",
    "canInviteToCircle": true,
    "canReport": true,
    "canBlock": true
  }
}
```

Private adoption obligation counts must never appear in this public response.

## 52. Concurrency and Offline Behavior

Profile and settings updates should support:

- optimistic UI only for low-risk fields
- explicit pending/saved/error state
- idempotency keys
- version/ETag conflict detection
- retry without duplicate writes

If two devices edit the profile:

- backend rejects stale version with conflict details
- client reloads current state
- user chooses whether to reapply their draft

Privacy, blocking, session revocation, and deletion should not rely on delayed
offline-only writes because they affect safety.

## 53. Cache Invalidation

After a profile update:

- invalidate owner profile cache
- invalidate public profile cache
- update user search document
- refresh author snippets where denormalized
- avoid rewriting every historical post synchronously

After privacy/block changes:

- authorization must take effect immediately at read time
- cached public payloads and media URLs must not bypass the new policy
- search/suggestion removal may be eventually consistent, with read-time
  filtering

## 54. Audit and Safety Events

Record private audit events for:

- initial username assignment
- handle change
- avatar change/removal
- verification change
- privacy setting change
- block/unblock
- notification preference change
- session revocation
- deactivation/deletion request

Audit records should contain actor, action, target, timestamp, and safe change
metadata. Do not store raw credentials or unnecessary sensitive content.

## 55. Backend Invariants

- Every profile belongs to exactly one account.
- Every fully onboarded public account has exactly one username.
- Accounts without a username remain restricted and undiscoverable.
- Public handles are unique after normalization.
- Username availability never guarantees ownership before the assignment
  transaction commits.
- First-time username assignment is idempotent and cannot replace an existing
  username.
- Profile IDs and account IDs are server-generated.
- Joined time is server-generated and immutable.
- Avatar media is ready, owned by the user, and valid for avatar purpose.
- Public profile responses never include credentials or private contact data.
- Impact counts derive from canonical eligible records.
- Owner-only adoption obligations never leak to public viewers.
- Profile and content visibility are enforced server-side.
- Block checks apply to profile, discovery, messaging, and notifications.
- Message creation checks current policy and blocks.
- Saved posts and private activity are visible only to their owner.
- Companion creation from adoption is idempotent per eligible adoption record.
- Archiving a companion does not erase required historical attribution.
- Notification preference changes affect future delivery, not account security
  requirements.
- Session tokens are not stored in ordinary AsyncStorage.
- Sign-out revokes the intended session and clears private client state.
- Deactivation and deletion are distinct workflows.
- Deletion preserves only records required by law, safety, or transactional
  integrity.

## 56. Current Frontend Gaps the Backend Must Not Copy

- Profile identity is mostly static mock data.
- There is no signup or account onboarding UI.
- Users cannot currently choose a first username.
- There is no username availability or first-time assignment request.
- Only bio and location can be edited.
- Bio/location changes are local to one installation.
- Profile editing mutates a shared mock object.
- There is no real avatar selection or upload.
- `loc` and `location` duplicate the same value.
- Profile counts use static fallback numbers.
- Visible cards can disagree with profile counts.
- Rescue profile content uses a static dataset.
- Feed posts, saves, reactions, and comments are in-memory.
- Companion creation/removal is in-memory.
- Companion IDs are generated from names.
- Companion remove has no confirmation or archival model.
- Reviews and trust are static and not correctly scoped by backend records.
- Post activity and Adoption alert toggles reset when Settings remounts.
- Notification toggles do not affect notification delivery.
- Privacy settings are local-only.
- Privacy settings are not enforced by public profile, feed, search, presence,
  companion, or messaging screens.
- Message action ignores message policy and does not open the intended user
  conversation.
- Add to circle and More public-profile actions are no-ops.
- Blocking is local-only and does not comprehensively enforce separation.
- Unblocking is immediate without backend synchronization.
- Joined date is static display text.
- Sign out only shows `Coming soon`.
- There is no authentication/session management.
- There is no account deactivation, deletion, or export workflow.
- Owner and public profile read models are not separated.
- The standalone Posts screen and main Posts tab use different authorship
  definitions.
- Saved and Activity are private concepts but have no backend privacy contract.
- The Adopted alert uses real frontend logic but has no server scheduler or
  canonical obligation endpoint.

## 57. Minimum Acceptance Scenarios

1. New account receives a restricted onboarding session.
2. Verified new account receives `username_required` as its next step.
3. User can check whether a valid username is currently available.
4. Invalid, reserved, prohibited, email-like, and phone-like usernames are
   rejected with field errors.
5. User successfully assigns one unique username and resumes onboarding.
6. Two concurrent attempts for the same normalized username result in exactly
   one successful owner.
7. Retrying successful assignment with the same idempotency key returns the
   original result.
8. A second first-time assignment cannot replace an existing username.
9. Account without a username cannot post, message, appear in search, or
   expose a public profile.
10. Social login requires explicit username choice for a new account.
11. Abandoned username onboarding resumes after the user authenticates again.
12. Username availability never exposes another account's private data.
13. Authenticated owner loads My Profile from the canonical backend.
14. Owner and public viewer receive different authorized read models.
15. Owner edits bio/location and sees the change across devices.
16. Invalid or excessive profile text is rejected with field errors.
17. Concurrent stale edit returns a conflict rather than silently overwriting.
18. Username change enforces normalization, uniqueness, cooldown, history,
    and recent authentication when required.
19. Owner selects, previews, uploads, and publishes a real profile photo.
20. Picker cancellation leaves the existing photo unchanged.
21. Permission denial preserves the edit draft and explains recovery.
22. Android picker activity recreation recovers the selected result.
23. Invalid MIME, oversized image, failed scan, and expired signed URL are
    recoverable.
24. Old avatar is safely retired after the new avatar commits.
25. Impact counts match canonical eligible Rescue and adoption records.
26. Public counts exclude content the viewer cannot access.
27. Posts tab consistently includes the chosen user/companion authorship rule.
28. Circle-only and private posts do not leak through public profile.
29. Save/un-save persists across devices and is idempotent.
30. Saved posts and Activity are private to the owner.
31. New Rescue case appears in Rescue hub and profile from one case record.
32. Rehomed and Adopted tabs reflect canonical adoption records.
33. Missed adoption milestone produces the owner-only Adopted warning count.
34. Posting a qualifying update clears the correct milestone and badge.
35. Public viewer never receives the owner's overdue update count.
36. Owner adds a companion from one eligible adoption exactly once.
37. Owner manually adds two same-named companions without global ID collision.
38. Companion avatar uses real media upload and processing.
39. Removing a companion archives safely and preserves historical links.
40. Notification preferences persist and affect future fanout.
41. OS push denial and server push preference remain distinct states.
42. Profile visibility Everyone permits eligible public viewing.
43. Profile visibility Circles denies unrelated viewers.
44. Profile visibility Only me denies ordinary direct-link access.
45. Discoverability off removes the user from search/suggestions.
46. Show online off hides presence from ordinary viewers.
47. Show location off removes location from profile and search payloads.
48. Show companions off hides companion list and protects direct companion
    access.
49. Default post visibility applies to new posts but does not rewrite old
    posts.
50. Message policy Everyone permits an eligible conversation.
51. Message policy Circles denies an unrelated viewer.
52. Message policy None denies new ordinary conversations.
53. Message action creates or reuses the correct canonical direct conversation.
54. Blocking immediately stops direct messages and profile/discovery access
    according to policy.
55. Block state synchronizes across devices.
56. Unblocking does not automatically recreate prior relationships.
57. Reviews are returned only for the target user and eligible interactions.
58. Internal report/fraud details never appear publicly.
59. Sign out revokes the current session and clears private client data.
60. Sign out from one device does not revoke all devices unless requested.
61. Revoked session cannot continue using cached credentials.
62. Deactivation hides the account while preserving required records.
63. Deletion request requires recent authentication and a recovery window.
64. Completed deletion removes/anonymizes eligible personal data and revokes
    public media access.
65. Direct API calls cannot bypass privacy, block, or ownership rules.
66. Cached profile/media responses cannot bypass a new privacy or block state.
