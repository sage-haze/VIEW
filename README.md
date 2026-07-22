# Cloudflare Pages OpenAI API key test

## Upload to GitHub

Upload the contents of this folder to the root of a GitHub repository. Keep this structure:

```
index.html
functions/
  api/
    test.js
```

Do not upload your API key to GitHub.

## Connect to Cloudflare Pages

1. Create or open a Cloudflare Pages project connected to the GitHub repository.
2. Use no framework preset, or select **None**.
3. Leave the build command blank.
4. Set the build output directory to `/` if Cloudflare requires one.
5. Deploy the project.

## Add the secret

In Cloudflare, open:

**Workers & Pages → your Pages project → Settings → Variables and Secrets**

Add an encrypted secret:

- Name: `OPENAI_API_KEY`
- Value: your OpenAI API key only

Add it to the environment you are testing: Production, Preview, or both.
Then create a new deployment.

## Test

Open the deployed site and press **Run test**, or visit:

```
https://YOUR-SITE.pages.dev/api/test
```

### Result meanings

- `stage: "cloudflare-binding"`: Cloudflare did not provide the secret to the Function.
- `stage: "openai-authentication"`: Cloudflare found the secret, but OpenAI rejected it.
- `stage: "complete"` and `ok: true`: the key works.
