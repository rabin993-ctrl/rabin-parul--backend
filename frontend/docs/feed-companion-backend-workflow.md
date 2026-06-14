# Feed Companion Backend Workflow

## 1. Purpose

This document describes how companions currently move through the frontend posting workflow:

1. A user selects one or more companions in the post composer.
2. The frontend stores those companion IDs on a Feed or Community post.
3. Feed and Community cards resolve those IDs into companion names and avatars.
4. Clicking a companion opens that companion's profile.
5. Posts connected to a companion contribute to some profile post counts.

It also separates two features that look similar but have different meanings:

- **Post with a companion:** the human user is the author and one or more companions are attached to the post.
- **Post as a companion:** the human user remains accountable for the action, but the companion is presented as the visible author.

This is a backend implementation guide. It records the current frontend behavior, calls out frontend inconsistencies, and defines the corrected canonical behavior the backend should enforce.

## 2. Main Frontend Sources

The workflow is primarily implemented in:

- `src/components/feed/PostComposer.tsx`
- `src/components/feed/FeedPostCard.tsx`
- `src/components/feed/PostAuthorRow.tsx`
- `src/context/FeedPostContext.tsx`
- `src/screens/FeedScreen.tsx`
- `src/context/CompanionContext.tsx`
- `src/components/CompanionProfile.tsx`
- `src/components/CompanionProfileOverlay.tsx`
- `src/utils/postAuthor.ts`
- `src/data/mockData.ts`
- `src/components/community/CommunityComposer.tsx`
- `src/screens/community/CommunityCreatePostScreen.tsx`
- `src/context/CommunityFeedContext.tsx`
- `src/data/communityPosts.ts`
- `src/components/community/CommunityPostAuthorRow.tsx`
- `src/components/community/CommunityFeedPost.tsx`
- `src/components/community/CommunityPostCard.tsx`
- `src/hooks/useProfileViewData.ts`
- `src/components/profile/ProfilePostDetailSheet.tsx`
- `src/screens/pawCircles/CircleSharedPostCard.tsx`

## 3. Current Companion Data

The frontend currently stores companions in a mutable in-memory record. A companion includes information such as:

- Companion ID
- Owner user ID
- Name
- Species and breed
- Avatar or image
- Age and gender
- Biography
- Adoption origin
- Sibling relationships
- Vaccination, neutering, and microchip information
- Post count

The production backend must not return the entire companion record whenever a post only needs a name and avatar. Health and identification fields must remain protected.

Use a safe public post summary:

```json
{
  "id": "companion_uuid",
  "name": "Max",
  "avatar_url": "https://cdn.example.com/max.jpg",
  "species": "dog",
  "profile_visibility": "public",
  "is_active": true
}
```

## 4. Two Companion Posting Modes

### 4.1 Human Posting With Companions

Example display:

> Aisha Rahman with Max

The human is the author. The companion is contextual information attached to the post.

Current Feed representation:

```ts
{
  userId: "you",
  author: "you",
  companions: ["max"],
  companionAuthorId: undefined
}
```

Current Community representation:

```ts
{
  authorId: "you",
  companionIds: ["max"]
}
```

The composer permits multiple companion selections. The stored array can therefore contain:

```json
["max", "luna", "milo"]
```

### 4.2 Human Posting As a Companion

Example display:

> Max

The companion is the presented author, but the human user is still the authenticated actor and accountable owner.

Current Feed representation:

```ts
{
  userId: "you",
  author: "you",
  companionAuthorId: "max",
  companions: ["max"],
  tag: "paw-posting"
}
```

The frontend opens this mode from the user's own companion profile. It sends:

```ts
openComposer({
  initialCompanionIds: [companion.id],
  postAsCompanionId: companion.id
})
```

The composer then:

- Changes its title to the companion's post.
- Changes the placeholder to ask what the companion is doing.
- Locks the destination to the main Feed.
- Hides the normal companion selector.
- Hides normal category selection.
- Adds the Paw Posting category or badge.
- Uses the selected companion as the presented author.

The current frontend does not support posting as a companion inside Community posts.

## 5. Accountable Actor Versus Display Author

These identities must never be merged in the database.

For every post, store:

- `actor_user_id`: the authenticated user who performed the action.
- `author_user_id`: the human account responsible for the post.
- `presentation_mode`: `user` or `companion`.
- `author_companion_id`: present only when the post is presented as a companion.

Example:

```json
{
  "actor_user_id": "user_123",
  "author_user_id": "user_123",
  "presentation_mode": "companion",
  "author_companion_id": "companion_456"
}
```

The backend must verify that the actor owns or is authorized to manage `companion_456`.

The client must never be trusted to decide ownership.

## 6. Default Companion Selection

The current normal Feed composer automatically starts with the first companion owned by the current user selected.

The user can:

- Leave the first companion selected.
- Deselect it and publish without a companion.
- Select another companion.
- Select multiple companions.

This means users can unintentionally publish "with Max" if they do not notice the default selection.

The corrected production behavior should be:

- Start with no companion selected for a normal post.
- Preselect a companion only when the user entered the composer from that companion's profile or another explicit companion action.
- An empty array means no companion.
- The backend must never invent a default companion.

## 7. Companion Selection Source

The Feed composer obtains companions by filtering the local companion store for:

```ts
companion.ownerId === "you"
```

Only the user's own companions are intended to appear in the selector.

However, the current list is memoized without a dependency that changes when companions are added or removed. The selector can therefore become stale during the app session.

The Community composer has the same general issue.

Production behavior:

1. Fetch the current user's manageable companions from the backend.
2. Refresh after adding, adopting, archiving, or changing companion access.
3. Validate all selected IDs again during post creation.
4. Do not depend on a cached client list for authorization.

## 8. Required Companion Access Rules

A user can attach or post as a companion only when:

- The companion exists.
- The companion is active or otherwise allowed for posting.
- The user is its owner or an authorized manager.
- The companion is not blocked from public posting by a moderation restriction.
- The requested presentation mode is supported by the destination.

Recommended roles:

- `owner`
- `co_owner`
- `caregiver`
- `editor`
- `viewer`

Only roles with `can_create_posts` may attach the companion. Posting as the companion should require the stronger `can_post_as_companion` permission.

## 9. Opening the Feed Composer

The Feed composer can be opened in several ways:

- As a normal empty post.
- With one or more initial companion IDs.
- In post-as-companion mode.
- With one or more destinations already selected.

Recommended composer initialization response:

```json
{
  "manageable_companions": [
    {
      "id": "companion_456",
      "name": "Max",
      "avatar_url": "https://cdn.example.com/max.jpg",
      "can_attach_to_post": true,
      "can_post_as_companion": true
    }
  ],
  "available_destinations": [
    {
      "type": "feed",
      "id": "main-feed",
      "can_post": true
    },
    {
      "type": "community",
      "id": "community_789",
      "name": "Golden Retriever Club",
      "can_post": true
    }
  ]
}
```

## 10. Normal Feed Post Creation

The current normal workflow is:

1. User opens the post composer.
2. User writes text.
3. User may select one or more companions.
4. User may select a category.
5. User may choose Feed, one Community, or multiple destinations.
6. User may add a photo placeholder in the mock frontend.
7. Frontend creates local post records.
8. Feed and Community contexts immediately display the records.

Recommended request:

```http
POST /v1/posts
Idempotency-Key: 7fb6d7a2-...
```

```json
{
  "body": "A sunny walk in the park.",
  "category": "daily-life",
  "presentation": {
    "mode": "user",
    "author_companion_id": null
  },
  "companion_ids": [
    "companion_456",
    "companion_789"
  ],
  "asset_ids": [
    "asset_123"
  ],
  "destinations": [
    {
      "type": "feed"
    },
    {
      "type": "community",
      "community_id": "community_333"
    }
  ]
}
```

## 11. Post-As-Companion Creation

Recommended request:

```json
{
  "body": "I found the best sunny spot.",
  "category": "paw-posting",
  "presentation": {
    "mode": "companion",
    "author_companion_id": "companion_456"
  },
  "companion_ids": [
    "companion_456"
  ],
  "asset_ids": [],
  "destinations": [
    {
      "type": "feed"
    }
  ]
}
```

Backend rules:

- `author_companion_id` is required.
- The actor must have `can_post_as_companion`.
- The author companion must also be present in `companion_ids`.
- Exactly one author companion is allowed.
- The category is set or normalized to `paw-posting`.
- The accountable human remains stored.
- Community destinations are rejected until Community explicitly supports companion authors.

Do not silently turn an invalid companion-author request into a normal human post.

## 12. Feed And Community Destinations

The normal composer supports:

- Main Feed only
- One Community only
- Feed and Community
- Feed and multiple Communities
- Multiple Communities

The current frontend creates separate local IDs for each destination. There is no durable cross-post relationship.

The backend should create:

- One canonical content record.
- One placement per destination.
- One cross-post batch identifier when multiple destinations are selected.

This allows each placement to have independent:

- Moderation state
- Visibility
- Community rules
- Comments
- Reactions
- Removal status

The underlying body, media, and original companion selection can still be shared.

## 13. Community Destination Validation

For every selected Community, validate:

- The Community exists.
- The user is a member when membership is required.
- The user is not banned or muted from posting.
- Posting is enabled.
- The selected post category is allowed.
- The media type and count are allowed.
- The selected companions are allowed under the Community's rules.
- The post is not attempting unsupported companion-author presentation.

For an all-or-nothing cross-post command, reject the full request if any destination is invalid.

Alternatively, an API may explicitly support partial completion, but it must return per-destination results. The frontend currently behaves as though one submit action succeeds as a unit, so atomic creation is the clearer contract.

## 14. Current Community Creation Paths

There are three frontend paths that can construct a Community post:

### 14.1 Global Feed Composer

The companion IDs selected in the global composer are copied to every selected Community post.

This is the clearest current cross-post path.

### 14.2 Community Composer Component

The Community composer:

- Supports multiple companion selection.
- Defaults to the first owned companion.
- Stores selected IDs in `companionIds`.

Its companion list can become stale after companion changes.

### 14.3 Community Create Post Screen

The separate create-post screen does not show a companion selector, but currently assigns the user's first companion anyway.

This is incorrect. It can label a Community post as being with a companion when the user made no such choice.

Corrected rule:

- No explicit selection means `companion_ids: []`.
- Never use the owner's first companion as a display fallback.

## 15. Media Selection In The Composer

The current Feed composer does not yet select a real local media file. The image and camera actions only switch a local `hasPhoto` flag and show a placeholder.

The production Expo 56 workflow should use `expo-image-picker`.

Library flow:

1. User taps the media library action.
2. Request media-library permission when required.
3. Call `launchImageLibraryAsync`.
4. If the result is canceled, keep the draft unchanged.
5. Read the selected assets.
6. Validate media type, size, dimensions, and count.
7. Show an editable preview.
8. Let the user remove or reorder media.
9. Upload media before or as part of post submission.

Camera flow:

1. User taps the camera action.
2. Request camera permission.
3. Call `launchCameraAsync`.
4. Handle cancellation.
5. Validate and preview the returned asset.
6. Upload it through the same asset pipeline.

On Android, the app should check `getPendingResultAsync` when restoring the relevant flow because the operating system may destroy the activity while the picker is open.

On web, picker launch must happen directly from the user's click or press event.

The frontend package currently does not list `expo-image-picker`, so it must be installed and configured before this becomes a real media workflow.

Official Expo SDK 56 reference:

- <https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/>

## 16. Media Upload Backend Workflow

Do not send local device file URIs as final post media.

Recommended sequence:

1. Frontend selects local media.
2. Frontend requests an upload session.
3. Backend returns an upload URL and asset ID.
4. Frontend uploads the bytes.
5. Frontend confirms upload completion if required.
6. Media service scans and processes the file.
7. Asset becomes `ready`.
8. Frontend submits the post with ready asset IDs.

Create upload:

```http
POST /v1/media/uploads
```

```json
{
  "purpose": "post",
  "mime_type": "image/jpeg",
  "file_size": 2841934,
  "width": 2048,
  "height": 1536
}
```

Response:

```json
{
  "asset_id": "asset_123",
  "upload_url": "https://uploads.example.com/...",
  "expires_at": "2026-06-14T12:30:00Z",
  "required_headers": {
    "Content-Type": "image/jpeg"
  }
}
```

The post service must verify that:

- Each asset belongs to the actor.
- Each asset has the correct purpose.
- Each asset is ready.
- Media counts and types comply with the destination rules.
- The same asset is not being attached in an unauthorized context.

## 17. Media Processing States

Recommended asset states:

- `created`
- `uploading`
- `uploaded`
- `scanning`
- `processing`
- `ready`
- `rejected`
- `failed`
- `deleted`

The UI should show pending processing separately from a failed upload. A post should not expose an unscanned public asset.

## 18. Feed Post Rendering

The Feed card resolves the presented author using `getPostPoster`.

Current logic:

1. If `companionAuthorId` resolves to a companion and its owner, use the companion as the presented author.
2. Otherwise, use the human user.
3. For a normal human post, resolve the first ID in `post.companions`.
4. Display that first companion after the word "with".

Current examples:

- Human only: `Aisha Rahman`
- Human with companion: `Aisha Rahman with Max`
- Companion author: `Max`

The card also shows Paw Posting when:

- `companionAuthorId` is present, or
- The post category is `paw-posting`.

## 19. Multiple Companion Rendering

Although the composer stores multiple IDs, the current Feed and Community author rows display only the first companion.

The backend response should preserve companion ordering:

```json
{
  "companions": [
    {
      "id": "companion_456",
      "name": "Max",
      "position": 0
    },
    {
      "id": "companion_789",
      "name": "Luna",
      "position": 1
    }
  ]
}
```

Recommended display:

- One: `Aisha with Max`
- Two: `Aisha with Max and Luna`
- Three or more: `Aisha with Max, Luna, and 1 more`

Each visible companion name should open the corresponding companion profile.

The backend should not discard later companion IDs simply because the current UI only renders the first one.

## 20. Community Post Rendering

Community posts currently always use the human as the primary author.

When a companion ID is present, the row displays:

> Aisha Rahman with Max

Community currently has no field equivalent to `companionAuthorId`, so it cannot correctly represent:

> Max

as the primary author.

Phase-one backend behavior should therefore reject `presentation.mode = companion` for Community placements.

If Community companion authors are added later, the Community post model and every card, search result, detail view, saved view, and moderation surface must use the same presentation contract as Feed.

## 21. Incorrect Community Companion Fallback

The current Community helper uses:

```ts
post.companionIds?.[0] ??
getDefaultCompanionIdsForOwner(post.authorId)[0]
```

This means that a Community post with no stored companion can still be displayed with the author's first companion.

That is not a harmless display default. It changes the meaning of the post.

Correct canonical rule:

```text
If companion_ids is empty, display no companion.
```

The backend response must return an explicit empty array. The frontend should render only the supplied relationship.

## 22. Safe Post Response Contract

Recommended response:

```json
{
  "id": "post_123",
  "body": "A sunny walk in the park.",
  "category": "daily-life",
  "presentation_mode": "user",
  "display_author": {
    "type": "user",
    "id": "user_123",
    "name": "Aisha Rahman",
    "avatar_url": "https://cdn.example.com/aisha.jpg"
  },
  "accountable_author": {
    "id": "user_123",
    "name": "Aisha Rahman"
  },
  "companions": [
    {
      "id": "companion_456",
      "name": "Max",
      "avatar_url": "https://cdn.example.com/max.jpg",
      "position": 0,
      "can_view_profile": true
    }
  ],
  "media": [
    {
      "id": "asset_123",
      "type": "image",
      "url": "https://cdn.example.com/post.jpg",
      "width": 2048,
      "height": 1536,
      "alt_text": null
    }
  ],
  "placement": {
    "type": "feed",
    "community_id": null,
    "moderation_status": "visible"
  },
  "capabilities": {
    "can_edit": true,
    "can_delete": true,
    "can_change_companions": true
  },
  "created_at": "2026-06-14T12:00:00Z"
}
```

For companion presentation:

```json
{
  "presentation_mode": "companion",
  "display_author": {
    "type": "companion",
    "id": "companion_456",
    "name": "Max",
    "avatar_url": "https://cdn.example.com/max.jpg"
  },
  "accountable_author": {
    "id": "user_123",
    "name": "Aisha Rahman"
  }
}
```

## 23. Companion Profile Navigation

Current Feed behavior:

- Tapping a companion author opens the companion profile.
- Tapping the first "with Max" companion opens the companion profile.

Current Community behavior:

- Feed, group, search, and post-detail surfaces can open the companion overlay.
- The saved-post surface displays the companion but does not pass the companion press handler.

Other inconsistencies:

- Lost and Found cards may show a companion but do not consistently provide a companion click action.
- Profile post-detail rows do not consistently provide author or companion navigation.
- A shared post inside Paw Circle does not preserve companion-as-author presentation.
- An older or alternate Community post card ignores companions.

The backend should return `can_view_profile` and a stable companion ID. Every frontend surface should use the same author-row component or the same navigation rules.

## 24. Companion Profile Post Aggregation

The Feed context currently treats a post as connected to a companion when:

```ts
post.companions.includes(companionId)
```

This includes:

- Human posts made with the companion.
- Posts presented as the companion.

That is a reasonable default for a companion's "Posts" section, but the API should make the relationship explicit.

Recommended query:

```http
GET /v1/companions/{companion_id}/posts?relationship=all
```

Optional filters:

- `relationship=featured`
- `relationship=author`
- `relationship=with`
- `placement=feed`
- `placement=community`
- `cursor=...`

## 25. Companion Post Counts

The current frontend combines:

- A seed `postsCount` stored on the companion.
- A count of newly created local Feed posts attached to that companion.

This is not a canonical production count.

The backend should calculate or maintain:

- Total visible companion-related posts.
- Posts presented as the companion.
- Posts made with the companion.
- Optional counts by destination.

Do not add a database count to a seeded client number.

## 26. Companion Profile Grid

The current companion profile does not render the actual media from linked posts. It uses the calculated count to create placeholder grid cells.

Production behavior:

1. Query visible posts related to the companion.
2. Return a thumbnail from each post's first eligible media asset.
3. Respect post, Community, user, and companion privacy.
4. Paginate the results.
5. Return no placeholder for a post the viewer cannot access.

The count and the visible list must use compatible visibility rules.

## 27. User Profile Post Aggregation

The current user profile includes:

- Feed posts where the user is the human author.
- Feed posts presented as a companion owned by the user.

Community posts are not included in the same aggregation.

The production API must define whether a user's Posts tab includes:

- Main Feed placements only, or
- Every visible placement authored by the user.

Recommended default:

- Show canonical posts once, even when cross-posted to several destinations.
- Add destination badges or placement links.
- Include companion-presented posts under the accountable owner's profile unless the user hides them through an explicit supported setting.

## 28. Community Posts On Companion Profiles

The current companion profile aggregation is based on Feed posts and does not include Community post relationships.

Production policy must be explicit:

- A public Community post can appear on a companion profile when the viewer can access that Community placement.
- A private Community post must not leak through a public companion profile.
- If the same canonical post exists in Feed and Community, show it once unless the product intentionally displays placements separately.

The query must evaluate viewer access for every placement.

## 29. Companion Privacy

The profile settings include a "show companions" preference, but the current mock frontend does not consistently enforce it.

Backend privacy should distinguish:

- Whether companions appear in the user's companion list.
- Whether a companion profile is public.
- Whether a companion may be attached to a public post.
- Whether a companion's past posts appear in its profile.
- Whether the owner relationship is publicly displayed.

An explicitly visible post may still need a minimal companion snapshot even when the full companion profile is private.

Example:

```json
{
  "id": "companion_456",
  "name": "Max",
  "avatar_url": null,
  "can_view_profile": false
}
```

Do not expose private companion health or owner data through post enrichment.

## 30. Companion Creation And Adoption

Companions can enter the frontend store through:

- Manual companion creation.
- Adoption completion.

The current mock IDs are generated from companion names. This can collide when two users have companions with the same name.

Production companion IDs must be globally unique immutable IDs, such as UUIDs.

Adoption completion should:

1. Create or transfer the companion record according to the adoption domain rules.
2. Grant the adopter the correct management role.
3. Preserve the adoption record.
4. Make the companion available to the post composer after synchronization.
5. Avoid duplicating an existing companion record for the same adopted animal.

## 31. Companion Removal

The current frontend hard-deletes a companion from its in-memory record and removes sibling links.

This causes historical posts to change:

- A post presented as the removed companion falls back to the human author.
- A normal post loses its "with companion" label.
- Community posts can no longer resolve the companion.

Production systems should archive rather than hard-delete a companion that has historical references.

Recommended fields:

- `status`: `active`, `archived`, `memorialized`, `transferred`, `deleted`
- `archived_at`
- `deleted_at`
- `display_name_snapshot`
- `avatar_snapshot_url`

Historical posts should retain the identity that was visible when published, subject to legal deletion and privacy requirements.

## 32. Historical Companion Snapshots

Each post-companion relationship should preserve minimal historical presentation data:

- Display name at publish time
- Avatar asset reference at publish time, when policy permits
- Relationship type
- Position

The live companion record remains the main source when viewable. The snapshot is used when the companion is archived, transferred, or no longer publicly viewable.

Do not copy private health or ownership data into the snapshot.

## 33. Recommended Database Model

### `companions`

```text
id
primary_owner_user_id
name
species
breed
avatar_asset_id
profile_visibility
status
created_at
updated_at
archived_at
```

### `companion_managers`

```text
companion_id
user_id
role
can_create_posts
can_post_as_companion
created_at
revoked_at
```

### `posts`

```text
id
actor_user_id
author_user_id
presentation_mode
author_companion_id
body
category
status
created_at
updated_at
deleted_at
```

### `post_companions`

```text
post_id
companion_id
relationship_type
position
display_name_snapshot
avatar_asset_id_snapshot
created_at
```

Suggested relationship types:

- `with`
- `author`
- `featured`

### `post_assets`

```text
post_id
asset_id
position
alt_text
```

### `post_placements`

```text
id
post_id
destination_type
community_id
visibility
moderation_status
created_at
removed_at
```

### `crosspost_batches`

```text
id
actor_user_id
idempotency_key
created_at
```

The `posts` table may also contain `crosspost_batch_id`.

## 34. Create Transaction

Recommended backend transaction:

1. Authenticate the actor.
2. Validate request structure.
3. Lock or consistently read the actor's companion permissions.
4. Validate every companion ID.
5. Validate presentation mode.
6. Validate every destination.
7. Validate all media assets.
8. Create the canonical post.
9. Create ordered post-companion relationships.
10. Create asset relationships.
11. Create placements.
12. Create moderation jobs or immediate moderation results.
13. Commit.
14. Publish events after commit.
15. Return all created placement results.

Use an idempotency key so repeated taps or retries do not create duplicate posts.

## 35. Editing Companion Associations

The product should explicitly decide whether a user can edit companions after publishing.

Recommended rules:

- The author may add or remove "with" companions while the post is editable.
- The backend revalidates authorization for every newly attached companion.
- Changing from human presentation to companion presentation is a significant identity change and should be restricted or disallowed after publication.
- Changing the companion author should be disallowed after publication.
- Community moderation rules are rechecked after relationship changes.
- Changes are audited.

Recommended endpoint:

```http
PATCH /v1/posts/{post_id}
```

```json
{
  "companion_ids": [
    "companion_456",
    "companion_789"
  ],
  "version": 4
}
```

Use optimistic concurrency through a version or `If-Match` value.

## 36. Deleting Posts

Deleting a canonical post should:

- Hide or delete all its placements according to product policy.
- Remove it from user and companion profile queries.
- Update post counts.
- Preserve audit records.
- Schedule media deletion only when no other object references the asset.

Removing one Community placement should not necessarily delete the main Feed placement.

## 37. Moderation

Moderation must understand both identities:

- The human user is accountable.
- The companion is a presentation identity.

Reports and enforcement should be tied to:

- Post ID
- Placement ID
- Actor user ID
- Accountable author user ID
- Presented companion ID, when present

A moderation action against a companion-presented post must not become unenforceable when the companion is archived.

## 38. Notifications

The current mock flow does not define a complete companion notification system.

Recommended behavior:

- Do not notify the actor for attaching their own companion.
- Notify other authorized owners or managers only if product policy enables it.
- For shared-management companions, allow notification preferences.
- Use the human actor in audit and notification metadata.
- Show the companion presentation in user-facing post previews when appropriate.

Cross-posting should avoid sending duplicate notifications for the same canonical post unless Community membership notifications are destination-specific.

## 39. Search And Filtering

The backend should support:

```http
GET /v1/feed?companion_id=companion_456
GET /v1/posts?presentation_mode=companion
GET /v1/communities/{id}/posts?companion_id=companion_456
```

Search results must use the same `display_author` and `companions` contract as normal Feed results.

Do not rebuild companion labels from incomplete search index fields.

## 40. Shared Posts

The current Paw Circle shared-post card does not preserve the full companion-as-author meaning. It renders the human owner and first companion using a different format.

A shared post should reference the original canonical post and receive:

- Original display author
- Accountable author where the viewer is allowed to see it
- Companion list
- Original media preview
- Original visibility state
- Deleted or unavailable state

The share surface should not independently guess the author from raw IDs.

## 41. Deleted Or Unavailable References

When a related item is unavailable:

- Deleted post: show "Post unavailable."
- Archived companion with allowed snapshot: show the historical name and non-clickable identity.
- Private companion: show permitted minimal identity and disable profile navigation.
- Removed Community placement: do not expose Community-only content through another endpoint.

The response should tell the client whether the identity is clickable instead of forcing it to infer availability.

## 42. Events

Recommended domain events:

- `post.created`
- `post.updated`
- `post.deleted`
- `post.placement_created`
- `post.placement_removed`
- `post.companion_attached`
- `post.companion_detached`
- `post.presented_as_companion`
- `companion.archived`
- `media.asset_ready`
- `media.asset_rejected`

Events must include stable IDs and actor metadata, not full private companion records.

## 43. Cache Invalidation

Invalidate or update:

- Main Feed
- Relevant Community feeds
- User profile posts
- Companion profile posts
- Companion post counts
- Search index
- Saved-post views
- Shared-post previews

When companion access or privacy changes, purge cached enriched post responses that exposed the old companion profile access.

## 44. Error Contract

Useful error codes:

- `COMPANION_NOT_FOUND`
- `COMPANION_NOT_MANAGEABLE`
- `COMPANION_POSTING_DISABLED`
- `COMPANION_AUTHOR_REQUIRED`
- `COMPANION_AUTHOR_MISMATCH`
- `COMPANION_PRESENTATION_NOT_SUPPORTED`
- `COMMUNITY_POSTING_NOT_ALLOWED`
- `COMMUNITY_MEMBERSHIP_REQUIRED`
- `MEDIA_NOT_READY`
- `MEDIA_TYPE_NOT_ALLOWED`
- `MEDIA_LIMIT_EXCEEDED`
- `POST_VERSION_CONFLICT`
- `DUPLICATE_REQUEST`

Return field-level details so the composer can preserve the draft and explain what must be changed.

## 45. Security Invariants

The backend must always enforce:

1. The authenticated actor is stored.
2. A client cannot impersonate another user.
3. A client cannot post as an unauthorized companion.
4. Every attached companion is authorized.
5. Empty companion selection stays empty.
6. Companion arrays preserve explicit order.
7. Private companion data is not returned in post summaries.
8. Community access is checked per viewer.
9. Media belongs to the actor and is safe to publish.
10. Historical accountability survives companion archival.

## 46. Accessibility And Content Metadata

The media model should support:

- Alt text
- Captions
- Image dimensions
- Video duration
- Processing status
- Content warnings

Companion names in author rows should be exposed as meaningful interactive labels when clickable.

## 47. Current Frontend Inconsistencies

These are current implementation facts, not recommended backend rules:

1. Normal composers default to the user's first companion.
2. One Community create path attaches the first companion without showing a selector.
3. Community rendering invents a first-companion fallback when no companion is stored.
4. Multiple selected companions are stored but only the first is displayed.
5. Post-as-companion is supported in Feed but not Community.
6. Some cards and saved/detail surfaces do not make the companion clickable.
7. Paw Circle shared posts lose the original companion-author presentation.
8. Companion lists can become stale after add or remove operations.
9. Removing a companion can silently change old post identity.
10. Companion post counts mix seeded values and local Feed additions.
11. Companion profile grids use placeholders instead of linked post media.
12. Community companion posts are not consistently included in companion profile aggregation.
13. The mock composer does not perform real media selection or upload.

The backend must use the corrected rules in this document instead of reproducing these inconsistencies.

## 48. End-To-End Human-With-Companion Workflow

1. User opens the composer.
2. Frontend loads manageable companions and valid destinations.
3. No companion is selected unless the entry point explicitly supplied one.
4. User selects Max and optionally Luna.
5. User writes text.
6. User selects media through the device library or camera.
7. Frontend previews and validates media.
8. Frontend uploads media.
9. Backend processes assets and marks them ready.
10. User selects Feed and/or Communities.
11. Frontend submits one idempotent create command.
12. Backend authenticates the user.
13. Backend validates companion management rights.
14. Backend validates destination rules.
15. Backend creates the canonical post, companion relations, media relations, and placements.
16. Feed response says the human is the display author and returns ordered companions.
17. UI displays `Aisha with Max and Luna`.
18. Each companion link opens the correct accessible profile.
19. The post appears in authorized user and companion profile queries.
20. Counts and caches update from canonical backend data.

## 49. End-To-End Post-As-Companion Workflow

1. User opens their own companion profile.
2. User taps the action to post as that companion.
3. Frontend opens the composer with `postAsCompanionId`.
4. Frontend displays the companion-specific composer state.
5. User writes text and optionally selects media.
6. Destination remains main Feed under the current product behavior.
7. Frontend sends `presentation.mode = companion`.
8. Backend verifies `can_post_as_companion`.
9. Backend stores the authenticated human as actor and accountable author.
10. Backend stores the companion as the display author.
11. Backend creates an `author` post-companion relationship.
12. Response returns the companion in `display_author`.
13. Feed shows the companion name and avatar with Paw Posting presentation.
14. Tapping the author opens the companion profile.
15. Owner profile and companion profile queries can include the post according to visibility policy.
16. Reports and moderation remain attached to the human account.

## 50. End-To-End Community Companion Workflow

1. User opens a Community-capable composer.
2. Frontend loads only destinations where the user can post.
3. User explicitly selects zero or more manageable companions.
4. Frontend never inserts a default companion behind the user's back.
5. Frontend submits a normal human-authored post with `companion_ids`.
6. Backend validates membership, posting permission, companion access, and Community rules.
7. Backend creates the Community placement.
8. Response returns the human display author and explicit companion list.
9. Community UI shows `Aisha with Max` only when Max was actually selected.
10. Saved, search, detail, group, and feed surfaces use the same response and click behavior.
11. Community-only posts appear on companion profiles only when the viewer may access them.
12. Attempts to post as the companion are rejected until the feature is explicitly supported.

## 51. Acceptance Checklist

The implementation is complete when:

- [ ] Normal posts can contain zero companions.
- [ ] Normal posts can contain multiple ordered companions.
- [ ] No backend or frontend display fallback invents a companion.
- [ ] Only authorized users can attach a companion.
- [ ] Only authorized users can post as a companion.
- [ ] The accountable human is always preserved.
- [ ] Feed supports both human-with-companion and companion-author presentation.
- [ ] Community supports explicit human-with-companion presentation.
- [ ] Community rejects unsupported companion-author presentation.
- [ ] Every card and detail surface renders the same author contract.
- [ ] Companion names open the correct accessible profile.
- [ ] Multiple companions are represented rather than silently dropped.
- [ ] Media is genuinely selected, previewed, uploaded, processed, and referenced by asset ID.
- [ ] Android pending picker results are handled.
- [ ] Cross-posts have durable canonical and placement relationships.
- [ ] Companion profile posts and counts come from canonical queries.
- [ ] Private companion fields never leak into post responses.
- [ ] Archived companions do not silently rewrite historical post identity.
- [ ] Requests are idempotent.
- [ ] Edits use concurrency control.
- [ ] Moderation and reporting identify the accountable human.

## 52. Canonical Product Summary

The intended production meaning is:

- A companion appears on a post only because the user explicitly selected it or explicitly chose to post as it.
- A human remains accountable for every action.
- "With a companion" and "as a companion" are different stored states.
- Feed currently supports both states.
- Community currently supports only "with a companion."
- Companion relationships must remain consistent in Feed cards, Community cards, search, saved posts, post details, shares, and profiles.
- Media must be uploaded as durable backend assets, not represented by a local placeholder or device URI.
- The backend is the authority for ownership, privacy, destination access, moderation, counts, and historical identity.
