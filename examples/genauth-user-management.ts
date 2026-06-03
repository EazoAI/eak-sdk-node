import { EzaoAgentKit } from "@eazo/eak";

const eak = new EzaoAgentKit({
  accessKey: mustGetEnv("EAK_ACCESS_KEY"),
  secretKey: mustGetEnv("EAK_SECRET_KEY"),
  host: process.env.EAK_HOST,
});

const users = await eak.genauth.users.list({
  page: 1,
  limit: 20,
});

console.log("GenAuth users:", users.data);

const created = await eak.genauth.users.create({
  username: `sdk-demo-${Date.now()}`,
  password: mustGetEnv("GENAUTH_DEMO_USER_PASSWORD"),
});

console.log("Created GenAuth user:", created.data);

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
