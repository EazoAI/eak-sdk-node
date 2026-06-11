import { describe, expect, it } from "vitest";
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
  it("covers list/get/getBatch/create/createBatch/update/deleteBatch with real GenAuth users", async () => {
    const client = liveClient();
    const existingUserId = await resolveLiveUserId(client);
    const createdUserIds: string[] = [];

    try {
      const listed = await client.genauth.users.list({ page: 1, limit: 1 });
      expect(firstUserId(listed.data)).toBeTruthy();
      await client.genauth.users.get({ userId: existingUserId });
      await client.genauth.users.getBatch({ userIds: [existingUserId] });

      const created = await client.genauth.users.create({
        username: `${livePrefix}-user`,
        password: livePassword(),
      });
      const createdId = extractId(created.data, "created GenAuth user");
      createdUserIds.push(createdId);

      const createdBatch = await client.genauth.users.createBatch({
        users: [{ username: `${livePrefix}-batch-user`, password: livePassword() }],
      });
      const batchId = firstUserId(createdBatch.data) || extractId(createdBatch.data, "batch GenAuth user");
      createdUserIds.push(batchId);

      await client.genauth.users.update({
        userId: createdId,
        nickname: `${livePrefix}-updated`,
      });
      await client.genauth.users.deleteBatch({ userIds: createdUserIds });
      createdUserIds.length = 0;
    } finally {
      if (createdUserIds.length) {
        await client.genauth.users.deleteBatch({ userIds: createdUserIds });
      }
    }
  });
});
