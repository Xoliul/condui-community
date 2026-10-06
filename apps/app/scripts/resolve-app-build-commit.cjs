const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

/** Written into staged Community source, which is built without the canonical git history. */
const BUILD_INFO_FILE = 'build-info.json'

function readBuildInfoFile(cwd) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cwd, BUILD_INFO_FILE), 'utf-8'))
    return {
      commit: typeof parsed.commit === 'string' ? parsed.commit.trim() : '',
      date: typeof parsed.date === 'string' ? parsed.date.trim() : '',
    }
  } catch {
    return { commit: '', date: '' }
  }
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', cwd, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/**
 * Git SHA for the current build (explicit VITE_APP_BUILD_COMMIT; staged Community `build-info.json`;
 * Netlify: COMMIT_REF; GitHub Actions: GITHUB_SHA; local: git).
 * @param {string} cwd - app root (e.g. `apps/app`)
 */
function resolveAppBuildCommit(cwd) {
  const candidates = [
    process.env.VITE_APP_BUILD_COMMIT,
    readBuildInfoFile(cwd).commit,
    process.env.COMMIT_REF,
    process.env.GITHUB_SHA,
    process.env.VERCEL_GIT_COMMIT_SHA,
  ]
  for (const c of candidates) {
    const trimmed = c?.trim()
    if (trimmed) return trimmed
  }
  return git(['rev-parse', 'HEAD'], cwd)
}

/**
 * ISO commit date of the build commit, so hosted and Community builds of one commit show the same date.
 * @param {string} cwd - app root (e.g. `apps/app`)
 * @param {string} [commit] - build commit; defaults to {@link resolveAppBuildCommit}
 */
function resolveAppBuildDate(cwd, commit = resolveAppBuildCommit(cwd)) {
  const explicit = process.env.VITE_APP_BUILD_DATE?.trim() || readBuildInfoFile(cwd).date
  if (explicit) return explicit
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) return ''
  return git(['show', '-s', '--format=%cI', commit], cwd)
}

module.exports = { BUILD_INFO_FILE, resolveAppBuildCommit, resolveAppBuildDate }
