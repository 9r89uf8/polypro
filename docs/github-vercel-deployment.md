# GitHub and Vercel deployment

Use this workflow to publish repository changes safely.

## What deploys where

- GitHub repository: `9r89uf8/polypro`
- Production branch: `main`
- Vercel production site: `https://polypro-alpha.vercel.app`
- Every production change is committed and pushed directly to `main`.
- Do not create pull requests or deployment branches for this repository.
- A push to `main` triggers the Vercel production deployment.
- Convex is deployed separately. `npx convex deploy` does not deploy the
  Next.js site to Vercel.

## Direct-to-main GitHub workflow

Start from a clean understanding of the worktree. Do not stage unrelated IDE
files or use `git add -A` in a mixed worktree.

```powershell
git status -sb
git fetch origin
git switch main
git pull --ff-only origin main
```

Make and check the changes, then stage only the intended files:

```powershell
git add -- path/to/file1 path/to/file2
git diff --cached --check
git diff --cached --stat
git commit -m "<short description>"
```

Immediately before deployment, incorporate any newer remote commits and push
the local commit directly to `main`:

```powershell
git fetch origin
git rebase origin/main
git push origin main
```

Vercel deploys production after the push reaches `main`.

Never use `git push --force origin main`. If a push is rejected as
non-fast-forward, stop and run `git fetch origin` followed by
`git rebase origin/main`. Resolve and verify any conflicts before retrying the
normal `git push origin main`; never overwrite remote history.

## Convex changes

When the change includes `convex/` functions, schema, or generated API changes,
deploy Convex before the Vercel frontend:

```powershell
npx convex deploy
```

Confirm that Vercel's `NEXT_PUBLIC_CONVEX_URL` and
`NEXT_PUBLIC_CONVEX_SITE_URL` belong to that same production Convex
deployment. A mismatch can produce errors such as `Could not find public
function`.

After Convex succeeds, push the frontend commit directly to `main` so Vercel
deploys code that calls the newly available functions.

## Verify the Vercel deployment

1. Open the Vercel project's **Deployments** page.
2. Confirm the production deployment uses the expected `main` commit.
3. Wait for the deployment status to become **Ready**.
4. Open `https://polypro-alpha.vercel.app` and test the changed route.
5. Check the browser console for Convex or client-side errors.

If GitHub `main` has the correct commit but Vercel does not, verify that the
Vercel project is connected to `9r89uf8/polypro` and its production branch is
`main`. Then redeploy the expected commit from the Vercel Deployments page.

## Manual Vercel deployment

The GitHub-to-Vercel integration is the normal production path. Use a manual
CLI deployment only when intentionally bypassing that integration:

```powershell
npx vercel link
npx vercel --prod
```

Before confirming a manual production deployment, verify that the linked
Vercel project is `polypro` and that the local checkout contains the intended
commit.
