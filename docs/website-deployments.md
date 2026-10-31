# Website deployments

The stable website at `https://pi-web.dev/` normally deploys from a published
GitHub Release through `.github/workflows/publish.yml`, after npm publication.
Changes merged into `main` deploy separately to `https://pi-web.dev/dev/` through
`.github/workflows/docs-dev.yml`.

## Fix the stable website without publishing a package

Use **Deploy stable docs hotfix** (`.github/workflows/docs-hotfix.yml`) when a
website fix needs to ship without other unreleased changes from `main`.

1. Commit the fix and its tests, and merge them into `main`. Keep the website
   patch in one ordinary, single-parent commit; use that commit's full SHA,
   not a merge commit's SHA.
2. Identify the published release tag used by the stable website. Check the
   last successful stable deployment rather than assuming the latest tag was
   deployed successfully.
3. Verify the fix against that release in a separate worktree. Review the full
   `docs/` diff, run the relevant tests, and check any changed page's behavior.
4. Run the workflow from `main`, supplying `release_tag` and `hotfix_commit`:

   ```sh
   gh workflow run docs-hotfix.yml --ref main \
     -f release_tag=v1.202610.8 \
     -f hotfix_commit=FULL_40_CHARACTER_COMMIT_SHA
   ```

5. Check the workflow's summary and deployment result, then verify the live page.

The workflow checks out the published release and applies only the selected
commit's `docs/` patch. It fails if the patch does not apply cleanly, changes
Wrangler configuration, or contains no docs changes. Tests and other files from
the commit are not deployed. It uses the existing `CLOUDFLARE_API_TOKEN` secret
and `CLOUDFLARE_ACCOUNT_ID` variable. Stable release and hotfix deployments share
a concurrency group so their uploads do not overlap.

Each run replaces the whole stable website. It does **not** accumulate earlier
hotfixes: a later hotfix against the same release must include any earlier fixes
that should remain live, in a single cumulative patch commit. The next normal
release replaces the hotfix deployment, so keep every fix on `main` too.

Do not manually run `publish.yml` for a website-only fix: manual runs publish
npm and skip the stable website deployment. Do not move a published release tag.
