import { InMemoryCredentialStore, type Credential } from "../../piAi.js";
import { ModelRuntime } from "../../piSdk.js";

export async function createTestModelRuntime(initialCredentials: Record<string, Credential> = {}): Promise<{
  modelRuntime: ModelRuntime;
  credentials: InMemoryCredentialStore;
}> {
  const credentials = new InMemoryCredentialStore();
  await Promise.all(Object.entries(initialCredentials).map(async ([providerId, credential]) => {
    await credentials.modify(providerId, () => Promise.resolve(credential));
  }));
  const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
  return { modelRuntime, credentials };
}
