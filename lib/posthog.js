import { PostHog } from "posthog-node/edge";

export function createPostHogClient(env) {
  const apiKey = env.POSTHOG_API_KEY;
  const host = env.POSTHOG_HOST;

  if (!apiKey) {
    if (env.CF_PAGES_BRANCH !== "production") {
      console.error(
        "POSTHOG_API_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once POSTHOG_API_KEY is configured"
      );
    }
    return null;
  }

  return new PostHog(apiKey, {
    host: host || "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: true
  });
}
