import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  extractId,
  firstUserId,
  liveE2EEnabled,
  liveClient,
  livePassword,
  livePrefix,
  resolveLiveUserId,
} from "./helpers";

const describeLiveE2E = liveE2EEnabled ? describe : describe.skip;

describeLiveE2E("live e2e: GenAuth users", () => {
  let client: ReturnType<typeof liveClient>;
  let existingUserId: string;
  let createdUserId: string | undefined;
  const createdUserIds = new Set<string>();

  beforeAll(async () => {
    client = liveClient();
    existingUserId = await resolveLiveUserId(client);
  });

  afterAll(async () => {
    if (createdUserIds.size) {
      await client.genauth.users.deleteBatch({ userIds: Array.from(createdUserIds) }).catch(() => undefined);
    }
  });

  async function ensureCreatedUser() {
    if (createdUserId) return createdUserId;
    const created = await client.genauth.users.create({
      username: `${livePrefix}-user`,
      password: livePassword(),
    });
    createdUserId = extractId(created.data, "created GenAuth user");
    createdUserIds.add(createdUserId);
    return createdUserId;
  }

  it("genauth.users.list({ page, limit })", async () => {
    const listed = await client.genauth.users.list({ page: 1, limit: 1 });
    expect(firstUserId(listed.data)).toBeTruthy();
  });

  it("genauth.users.get({ userId })", async () => {
    const user = await client.genauth.users.get({ userId: existingUserId });
    expect(user.data).toBeTruthy();
  });

  it("genauth.users.getBatch({ userIds })", async () => {
    const users = await client.genauth.users.getBatch({ userIds: [existingUserId] });
    expect(users.data).toBeTruthy();
  });

  it("genauth.users.create({ username, password })", async () => {
    const userId = await ensureCreatedUser();
    expect(userId).toBeTruthy();
  });

  it("genauth.users.createBatch({ users })", async () => {
    const createdBatch = await client.genauth.users.createBatch({
      users: [{ username: `${livePrefix}-batch-user`, password: livePassword() }],
    });
    const batchId = firstUserId(createdBatch.data) || extractId(createdBatch.data, "batch GenAuth user");
    createdUserIds.add(batchId);
    expect(batchId).toBeTruthy();
  });

  it("genauth.users.update({ userId, nickname })", async () => {
    const userId = await ensureCreatedUser();
    await client.genauth.users.update({
      userId,
      nickname: `${livePrefix}-updated`,
    });
  });

  it("genauth.users.deleteBatch({ userIds })", async () => {
    const created = await client.genauth.users.create({
      username: `${livePrefix}-delete-user`,
      password: livePassword(),
    });
    const userId = extractId(created.data, "deleteBatch GenAuth user");
    createdUserIds.add(userId);
    await client.genauth.users.deleteBatch({ userIds: [userId] });
    createdUserIds.delete(userId);
  });
});
