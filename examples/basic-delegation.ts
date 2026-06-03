import { EAKEventTypes, EAKScopes, EzaoAgentKit } from "@eazo/eak";

const eak = new EzaoAgentKit({
  accessKey: mustGetEnv("EAK_ACCESS_KEY"),
  secretKey: mustGetEnv("EAK_SECRET_KEY"),
  host: process.env.EAK_HOST,
});

const user = await eak.currentUser({
  accessToken: mustGetEnv("GENAUTH_ACCESS_TOKEN"),
});
const userProfile = user.data as {
  id?: string;
  subject?: string;
  name?: string;
  email?: string;
};
const userId = userProfile.id ?? userProfile.subject;

if (!userId) {
  throw new Error("GenAuth user profile must include id or subject");
}

const delegation = await eak.delegateToken({
  user: {
    id: userId,
    subject: userProfile.subject ?? userId,
    name: userProfile.name,
    email: userProfile.email,
  },
  agent: "support-assistant",
  scopes: [
    EAKScopes.GUMEM_MEMORY_READ,
    EAKScopes.WEBAGENT_DO_ANYTHING_SESSION,
    EAKScopes.WEBAGENT_DO_ANYTHING_RUN,
    EAKScopes.WEBAGENT_DO_ANYTHING_EVENTS,
  ],
  mode: "silent",
});

if ("authorizationUrl" in delegation.data) {
  console.log("User approval required:", delegation.data.authorizationUrl);
  process.exit(0);
}

const token = delegation.data.token;

const memory = await eak.gumem.recall({
  token,
  sessionId: "support-assistant",
  query: "What context should the assistant remember before answering?",
});

const run = await eak.doAnything.run<{ id: string; sessionId: string }>({
  token,
  instruction: "Open the product documentation and summarize the most relevant setup steps.",
  context: { memory: memory.data },
  stream: {
    events: [
      EAKEventTypes.DO_ANYTHING_ACTION,
      EAKEventTypes.DO_ANYTHING_OBSERVATION,
      EAKEventTypes.DO_ANYTHING_FINAL,
    ],
  },
});

console.log("Started run:", run.data);

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
