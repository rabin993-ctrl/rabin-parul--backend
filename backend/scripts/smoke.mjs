const baseUrl = process.env.API_URL ?? "http://127.0.0.1:8080/v1";
const suffix = Date.now().toString().slice(-8);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
  "base64",
);

async function request(path, options = {}) {
  const requestHeaders = new Headers(options.headers);
  if (options.body === undefined) {
    requestHeaders.delete("content-type");
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: requestHeaders,
  });
  const text = response.status === 204 ? "" : await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

function expectStatus(label, response, status) {
  if (response.status !== status) {
    throw new Error(`${label}: expected ${status}, got ${JSON.stringify(response)}`);
  }
  return response.body;
}

function headers(token) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function register(label) {
  const result = await request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `smoke.${label}.${suffix}@example.test`,
      password: "StrongPassword123!",
      displayName: `Smoke ${label}`,
      deviceName: "integration-smoke",
    }),
  });
  const body = expectStatus(`register ${label}`, result, 201);
  const username = await request("/me/username", {
    method: "PUT",
    headers: headers(body.tokens.accessToken),
    body: JSON.stringify({ username: `smoke${label.toLowerCase()}${suffix}` }),
  });
  expectStatus(`username ${label}`, username, 200);
  return {
    id: body.account.id,
    accessToken: body.tokens.accessToken,
    refreshToken: body.tokens.refreshToken,
    username: username.body,
  };
}

async function uploadImage(token, purpose) {
  const session = await request("/media/upload-sessions", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      purpose,
      mimeType: "image/png",
      byteSize: png.length,
      originalFilename: "smoke.png",
    }),
  });
  const upload = expectStatus(`media session ${purpose}`, session, 201);
  const put = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.requiredHeaders,
    body: png,
  });
  if (!put.ok) throw new Error(`media PUT ${purpose}: ${put.status} ${await put.text()}`);
  const completed = await request(`/media/${upload.mediaAssetId}/complete`, {
    method: "POST",
    headers: headers(token),
  });
  return expectStatus(`media complete ${purpose}`, completed, 200).id;
}

const owner = await register("Owner");
const member = await register("Member");
const ownerHeaders = headers(owner.accessToken);
const memberHeaders = headers(member.accessToken);

const profile = await request("/me/profile", {
  method: "PATCH",
  headers: ownerHeaders,
  body: JSON.stringify({
    version: owner.username.version,
    bio: "Full-stack smoke test",
    publicLocationLabel: "Dhaka",
  }),
});
expectStatus("profile", profile, 200);

const companion = await request("/companions", {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({
    name: "Max",
    species: "dog",
    breedPublic: "Mixed",
    profileVisibility: "everyone",
    care: { vaccinationStatus: "current", medicalNotes: "private smoke note" },
  }),
});
const companionBody = expectStatus("companion", companion, 201);
if ("medicalNotes" in companionBody) throw new Error("Private companion care data leaked.");

const publicProfile = await request(`/users/${owner.id}/profile`);
const publicProfileBody = expectStatus("public profile", publicProfile, 200);
if (publicProfileBody.companions.length !== 1) throw new Error("Visible companion missing.");

const privacy = expectStatus("privacy settings", await request("/me/privacy-settings", {
  headers: ownerHeaders,
}), 200);
const hiddenTreatsPrivacy = expectStatus("hide treat count", await request("/me/privacy-settings", {
  method: "PATCH",
  headers: ownerHeaders,
  body: JSON.stringify({ version: privacy.version, showTreatsOnProfile: false }),
}), 200);
const hiddenCompanion = expectStatus("hidden companion treats", await request(`/companions/${companionBody.id}`, {
  headers: memberHeaders,
}), 200);
if (hiddenCompanion.stats.treats !== null) throw new Error("Hidden treat count was exposed.");
expectStatus("restore treat count", await request("/me/privacy-settings", {
  method: "PATCH",
  headers: ownerHeaders,
  body: JSON.stringify({ version: hiddenTreatsPrivacy.version, showTreatsOnProfile: true }),
}), 200);

expectStatus("block member", await request(`/me/blocked-users/${member.id}`, {
  method: "PUT",
  headers: ownerHeaders,
}), 204);
const blocked = expectStatus("blocked users", await request("/me/blocked-users", {
  headers: ownerHeaders,
}), 200);
if (!blocked.users.some((user) => user.id === member.id)) throw new Error("Blocked user missing.");
expectStatus("blocked profile access", await request(`/users/${owner.id}/profile`, {
  headers: memberHeaders,
}), 404);
expectStatus("unblock member", await request(`/me/blocked-users/${member.id}`, {
  method: "DELETE",
  headers: ownerHeaders,
}), 204);

const walletBefore = expectStatus("treat wallet", await request("/me/treat-wallet", {
  headers: memberHeaders,
}), 200);
if (walletBefore.monthlyAllowance !== 100) throw new Error("Treat allowance is not 100.");
const treatKey = `treat-${suffix}`;
const treat = expectStatus("give treat", await request(`/companions/${companionBody.id}/treats`, {
  method: "POST",
  headers: { ...memberHeaders, "idempotency-key": treatKey },
}), 201);
const repeatedTreat = expectStatus("repeat treat", await request(`/companions/${companionBody.id}/treats`, {
  method: "POST",
  headers: { ...memberHeaders, "idempotency-key": treatKey },
}), 200);
if (treat.treat.id !== repeatedTreat.treat.id || treat.remaining !== repeatedTreat.remaining) {
  throw new Error("Treat idempotency did not return the original result.");
}
const treatSummary = expectStatus("treat summary", await request(`/companions/${companionBody.id}/treats/summary`, {
  headers: memberHeaders,
}), 200);
if (treatSummary.total !== 1) throw new Error("Treat total is incorrect.");

const feedPost = await request("/posts", {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({
    body: "Smoke test feed post",
    visibility: "everyone",
    presentationMode: "user",
    companionIds: [],
    assetIds: [],
    destinations: [{ type: "feed" }],
  }),
});
const feedPostBody = expectStatus("feed post", feedPost, 201);
expectStatus("feed comment", await request(`/posts/${feedPostBody.id}/comments`, {
  method: "POST",
  headers: memberHeaders,
  body: JSON.stringify({ body: "Smoke activity comment" }),
}), 201);
const activity = expectStatus("profile activity", await request("/me/activity/comments", {
  headers: memberHeaders,
}), 200);
if (!activity.comments.length) throw new Error("Comment activity was not recorded.");
expectStatus("profile review", await request("/reviews", {
  method: "POST",
  headers: memberHeaders,
  body: JSON.stringify({ subjectUserId: owner.id, rating: 5, text: "Reliable community member." }),
}), 201);
const profileReviews = expectStatus("profile reviews", await request(`/users/${owner.id}/reviews`, {
  headers: ownerHeaders,
}), 200);
if (!profileReviews.reviews.length) throw new Error("Profile review was not returned.");

const conversation = await request("/conversations/direct", {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({ recipientUserId: member.id }),
});
const conversationBody = expectStatus("direct conversation", conversation, 201);
const directMessage = await request(`/conversations/${conversationBody.id}/messages`, {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({
    type: "text",
    text: "Smoke message",
    assetIds: [],
    clientIdempotencyKey: `direct-${suffix}`,
  }),
});
expectStatus("direct message", directMessage, 201);

const community = await request("/communities", {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({
    name: `Smoke Community ${suffix}`,
    about: "A complete integration smoke-test community.",
    joinPolicy: "open",
  }),
});
const communityBody = expectStatus("community", community, 201);
expectStatus("community join", await request(`/communities/${communityBody.id}/join`, {
  method: "POST",
  headers: memberHeaders,
  body: "{}",
}), 200);
expectStatus("community post", await request(`/communities/${communityBody.id}/posts`, {
  method: "POST",
  headers: memberHeaders,
  body: JSON.stringify({
    body: "Community smoke post",
    visibility: "everyone",
    companionIds: [],
    assetIds: [],
  }),
}), 201);

expectStatus("circle onboarding", await request("/paw-circles/onboarding/complete", {
  method: "POST",
  headers: ownerHeaders,
}), 200);
const circle = await request("/paw-circles", {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({
    name: `Smoke Circle ${suffix}`,
    bio: "Integration circle",
    locationLabel: "Dhaka",
    privacy: "open",
  }),
});
const circleBody = expectStatus("circle", circle, 201);
expectStatus("circle join", await request(`/paw-circles/${circleBody.id}/join`, {
  method: "POST",
  headers: memberHeaders,
  body: "{}",
}), 200);
expectStatus("circle message", await request(`/paw-circles/${circleBody.id}/messages`, {
  method: "POST",
  headers: memberHeaders,
  body: JSON.stringify({
    text: "Circle smoke message",
    assetIds: [],
    clientIdempotencyKey: `circle-${suffix}`,
  }),
}), 201);

const ownerImage = await uploadImage(owner.accessToken, "adoption_listing");
const memberImage = await uploadImage(member.accessToken, "adoption_home_update");

const listing = await request("/adoption-listings", {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({
    animalName: "Milo",
    species: "cat",
    description: "Friendly rescued cat ready for a permanent home.",
    locationLabel: "Dhaka",
    assetIds: [ownerImage],
  }),
});
const listingBody = expectStatus("adoption listing", listing, 201);
const adoptionRequest = await request(`/adoption-listings/${listingBody.id}/requests`, {
  method: "POST",
  headers: memberHeaders,
  body: JSON.stringify({ message: "I can provide a calm and loving permanent home." }),
});
const adoptionRequestBody = expectStatus("adoption request", adoptionRequest, 201);
expectStatus("adoption approve", await request(`/adoption-requests/${adoptionRequestBody.id}/approve`, {
  method: "POST",
  headers: ownerHeaders,
}), 200);
const adopted = await request(`/adoption-requests/${adoptionRequestBody.id}/mark-adopted`, {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({ note: "Smoke adoption confirmed." }),
});
const adoptedBody = expectStatus("mark adopted", adopted, 200);
expectStatus("adoption home update", await request(`/adoption-records/${adoptedBody.id}/home-updates`, {
  method: "POST",
  headers: memberHeaders,
  body: JSON.stringify({ text: "Settling in well.", assetIds: [memberImage] }),
}), 201);

const rescue = await request("/rescue-cases", {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({
    animalName: "Lucky",
    species: "dog",
    headline: "Injured dog needs short-term help",
    originalStory: "Found near the road and moved to a safe temporary foster.",
    status: "needs_help",
    publicLocationLabel: "Dhaka",
    visibility: "everyone",
    assetIds: [ownerImage],
  }),
});
const rescueBody = expectStatus("rescue case", rescue, 201);
expectStatus("rescue follow", await request(`/rescue-cases/${rescueBody.id}/follow`, {
  method: "PUT",
  headers: memberHeaders,
}), 204);
expectStatus("rescue update", await request(`/rescue-cases/${rescueBody.id}/updates`, {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({
    text: "Vet assessment completed.",
    assetIds: [ownerImage],
    clientIdempotencyKey: `rescue-${suffix}`,
  }),
}), 201);

const lostFound = await request("/lost-found/alerts", {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({
    kind: "lost",
    subject: {
      species: "dog",
      appearance: "Small brown dog with a white patch on the chest.",
      collarDescription: "Blue collar",
    },
    occurredAt: new Date().toISOString(),
    location: { label: "Dhanmondi, Dhaka", publicPrecision: "area" },
    alertRadiusKm: 10,
    contactMode: "message",
    assetIds: [ownerImage],
  }),
});
const lostFoundBody = expectStatus("lost-found alert", lostFound, 201);
expectStatus("lost-found sighting", await request(`/lost-found/alerts/${lostFoundBody.id}/sightings`, {
  method: "POST",
  headers: memberHeaders,
  body: JSON.stringify({
    occurredAt: new Date().toISOString(),
    locationLabel: "Dhanmondi Lake",
    publicPrecision: "area",
    stillPresent: false,
    note: "Seen moving toward the south gate.",
  }),
}), 201);

const notifications = await request("/notifications", { headers: ownerHeaders });
const notificationsBody = expectStatus("notifications", notifications, 200);
if (!notificationsBody.notifications.length) throw new Error("Cross-domain notifications were not created.");
if (!notificationsBody.notifications.some((item) => item.type === "companion.treat_received")) {
  throw new Error("Treat notification was not created.");
}
expectStatus("read all notifications", await request("/notifications/read-all", {
  method: "POST",
  headers: ownerHeaders,
}), 204);

const refreshed = await request("/auth/refresh", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ refreshToken: owner.refreshToken }),
});
const refreshedBody = expectStatus("refresh", refreshed, 200);
expectStatus("logout", await request("/auth/logout", {
  method: "POST",
  headers: { authorization: `Bearer ${refreshedBody.tokens.accessToken}` },
}), 204);
expectStatus("revoked access", await request("/me/profile", {
  headers: { authorization: `Bearer ${refreshedBody.tokens.accessToken}` },
}), 401);

console.log(JSON.stringify({
  auth: "ok",
  profiles: "ok",
  companions: "ok",
  treats: "ok",
  media: "ok",
  feed: "ok",
  messages: "ok",
  communities: "ok",
  pawCircles: "ok",
  adoption: "ok",
  rescue: "ok",
  lostFound: "ok",
  notifications: "ok",
}, null, 2));
