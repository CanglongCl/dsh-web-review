# npm 0.1.0 Release Plan

This plan publishes `@canglongcl/dsh-web-review@0.1.0` as the first public stable package. Pushing this document or its branch does not authorize merging, tagging, or publishing.

## 1. Prepare version 0.1.0

- Set the root and plugin package versions to `0.1.0`.
- Update README installation examples, tarball names, tag commands, and version-pinned tests.
- Keep the package name `@canglongcl/dsh-web-review`.
- Keep the source workspace manifest `private: true` so the source package cannot be published directly.
- Require the staged manifest and workflow publish command to use `access: public`.
- Commit the release preparation separately, for example:
  `dsh-web-review: prepare public 0.1.0 release`.

## 2. Configure GitHub Actions credentials

- Repository secret `NPM_READ_TOKEN`: read-only installation access for the pinned `@deepseek-ai/*` build dependencies.
- Repository secret `NPM_PUBLISH_TOKEN`: a short-lived npm granular token with read/write access limited to the `@canglongcl` scope and non-interactive publishing enabled.
- Do not reuse either token for the other purpose, write credentials into repository files, or expose them in logs.

## 3. Run release gates

```sh
pnpm install --frozen-lockfile
pnpm check
DSH_HARNESS=/absolute/path/to/deepseek-harness pnpm check --e2e
```

Confirm that typechecking, unit/component tests, all browser E2E scenarios, package allowlisting, checksum validation, the self-contained Node bundle, and both client bundle ID contracts pass.

## 4. Verify the exact tarball locally

```sh
pnpm package:official
dsh plugin --profile web add "$PWD/dist/canglongcl-dsh-web-review-0.1.0.tgz"
dsh --profile web --dump-config
dsh web
```

Inspect the staged manifest before approval:

- name is `@canglongcl/dsh-web-review`;
- version is `0.1.0`;
- `private` is absent;
- `publishConfig.registry` is `https://registry.npmjs.org/`;
- `publishConfig.access` is `public`;
- no source files, credentials, machine paths, local links, or development-only bundle are included.

Manually exercise Preview navigation, element selection, annotation editing, send/acknowledgement, and page-state rollback against the reviewed Harness baseline.

## 5. Merge only after review

- Review `main..codex/public-npm-release`.
- Confirm that public distribution is authorized before merging.
- Merge the branch into `main` and push `main`.
- Wait for the `main` workflow to pass before creating a tag.

No npm publication occurs in this step.

## 6. Tag and publish

Create the tag only on the reviewed public-release commit:

```sh
git tag -a v0.1.0 -m "dsh-web-review v0.1.0"
git push personal v0.1.0
```

The tag workflow must rebuild and verify the artifact, download the exact checked tarball, validate package/tag identity, and run:

```sh
npm publish <tarball> --access public --tag latest
```

The tag is the irreversible publication trigger. Do not reuse or move it.

## 7. Verify the registry release

```sh
npm view @canglongcl/dsh-web-review@0.1.0 \
  name version dist-tags dist.integrity
dsh plugin --profile web add @canglongcl/dsh-web-review@0.1.0
dsh --profile web --dump-config
```

Verify that anonymous metadata and package download work, `latest` points to `0.1.0`, the profile automatically activates the bundle, and the basic Preview/annotation flow works in a clean profile.

## 8. Close out the release

- Revoke or rotate the short-lived `NPM_PUBLISH_TOKEN` after publication.
- Retain `NPM_READ_TOKEN` only while CI needs the pinned build dependencies, keeping it read-only and minimally scoped.
- Record the workflow run, npm package URL, published integrity, and installation acceptance result.
- Consider migrating later releases to npm Trusted Publishing/OIDC to remove the stored write token.
